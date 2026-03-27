/**
 * weixin-claude-bot — Bridge WeChat messages to Claude Code via iLink protocol.
 *
 * Flow: WeChat → iLink getupdates → Claude Code SDK → iLink sendmessage → WeChat
 */
import crypto from "node:crypto";
import {
  getUpdates,
  sendMessage,
  sendTyping,
  getConfig,
  type ApiOptions,
} from "./ilink/api.js";
import {
  MessageType,
  MessageItemType,
  MessageState,
  TypingStatus,
  type WeixinMessage,
} from "./ilink/types.js";
import { askClaude, type ClaudeOptions } from "./claude/handler.js";
import {
  loadCredentials,
  loadConfig,
  loadSyncBuf,
  saveSyncBuf,
  loadContextTokens,
  getContextToken,
  setContextToken,
  loadSessionIds,
  getSessionId,
  setSessionId,
  clearSessionId,
} from "./store.js";

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000; // 1 hour
const RESET_COMMANDS = new Set(["新对话", "/reset", "/clear"]);

// --- Message text extraction ---

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      const ref = item.ref_msg;
      if (ref?.title) {
        return `[引用: ${ref.title}]\n${item.text_item.text}`;
      }
      return item.text_item.text;
    }
    // Voice ASR transcript
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

// --- Send text reply (split into chunks if needed) ---

const MAX_MSG_LEN = 4000; // WeChat has a ~4096 limit, leave some margin

function generateClientId(): string {
  return `wcb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function sendTextReply(
  api: ApiOptions,
  toUserId: string,
  contextToken: string,
  text: string,
): Promise<void> {
  const chunks =
    text.length <= MAX_MSG_LEN
      ? [text]
      : text.match(new RegExp(`.{1,${MAX_MSG_LEN}}`, "gs")) || [text];

  for (const chunk of chunks) {
    const msg: WeixinMessage = {
      to_user_id: toUserId,
      from_user_id: "",          // iLink server fills this automatically
      client_id: generateClientId(), // unique per message, prevents dedup
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: chunk },
        },
      ],
    };
    await sendMessage(api, { msg });
  }
}

// --- Typing indicator ---

async function showTyping(
  api: ApiOptions,
  userId: string,
  contextToken?: string,
): Promise<void> {
  try {
    const config = await getConfig(api, userId, contextToken);
    if (config.typing_ticket) {
      await sendTyping(api, {
        ilink_user_id: userId,
        typing_ticket: config.typing_ticket,
        status: TypingStatus.TYPING,
      });
    }
  } catch {
    // Non-critical, ignore errors
  }
}

// --- Process a single inbound message ---

async function handleMessage(
  api: ApiOptions,
  msg: WeixinMessage,
  claudeOpts: ClaudeOptions,
  multiTurn: boolean,
): Promise<void> {
  // Only process user messages
  if (msg.message_type !== MessageType.USER) return;

  const fromUser = msg.from_user_id;
  if (!fromUser) return;

  const text = extractText(msg);
  if (!text) {
    console.log(`  [skip] 非文本消息 from ${fromUser}`);
    return;
  }

  // Cache context_token
  if (msg.context_token) {
    setContextToken(fromUser, msg.context_token);
  }
  const contextToken = msg.context_token || getContextToken(fromUser);
  if (!contextToken) {
    console.error(`  [error] 没有 context_token for ${fromUser}`);
    return;
  }

  console.log(`\n📩 收到消息 from ${fromUser}: ${text.substring(0, 80)}${text.length > 80 ? "..." : ""}`);

  // Handle reset commands (multi-turn only)
  if (multiTurn && RESET_COMMANDS.has(text.trim())) {
    clearSessionId(fromUser);
    await sendTextReply(api, fromUser, contextToken, "已开始新对话");
    console.log(`  🔄 已重置 ${fromUser} 的会话`);
    return;
  }

  // Show typing indicator
  showTyping(api, fromUser, contextToken);

  // Attach session ID for multi-turn conversations
  const callOpts = multiTurn
    ? { ...claudeOpts, sessionId: getSessionId(fromUser) }
    : claudeOpts;

  try {
    // Send to Claude Code
    console.log(`  🤖 正在调用 Claude Code (${callOpts.model})...`);
    const response = await askClaude(text, callOpts);
    console.log(`  ✅ Claude 响应完成 (${(response.durationMs / 1000).toFixed(1)}s)`);

    // Save session ID for next turn
    if (multiTurn && response.sessionId) {
      setSessionId(fromUser, response.sessionId);
    }

    // Send response back to WeChat
    await sendTextReply(api, fromUser, contextToken, response.text);
    console.log(`  📤 已发送回复 (${response.text.length} chars)`);
  } catch (err) {
    console.error(`  ❌ 处理失败:`, err);
    // If resume failed, clear session and let user retry
    if (multiTurn) {
      clearSessionId(fromUser);
    }
    // Send error message back to user
    await sendTextReply(
      api,
      fromUser,
      contextToken,
      `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
  }
}

// --- Main loop ---

async function main() {
  const creds = loadCredentials();
  if (!creds) {
    console.error("未找到登录凭证。请先运行: npm run login");
    process.exit(1);
  }

  const api: ApiOptions = {
    baseUrl: creds.baseUrl,
    token: creds.botToken,
  };

  const config = loadConfig();
  const claudeOpts: ClaudeOptions = {
    model: config.model,
    maxTurns: config.maxTurns,
    systemPrompt: config.systemPrompt,
    cwd: config.cwd,
    permissionMode: config.permissionMode,
  };

  console.log("=== 微信 Claude Bot 已启动 ===");
  console.log(`账号: ${creds.accountId}`);
  console.log(`Base URL: ${creds.baseUrl}`);
  console.log(`模型: ${config.model}`);
  console.log(`权限模式: ${config.permissionMode}`);
  console.log(`最大轮次: ${config.maxTurns}`);
  console.log(`工作目录: ${config.cwd}`);
  console.log(`多轮对话: ${config.multiTurn ? "开启" : "关闭"}`);
  if (config.systemPrompt) console.log(`系统提示: ${config.systemPrompt.substring(0, 60)}...`);
  console.log("等待消息中...\n");

  // Restore state
  loadContextTokens();
  loadSessionIds();
  let syncBuf = loadSyncBuf();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n正在关闭...");
    process.exit(0);
  });

  // Long-poll loop
  let consecutiveFailures = 0;

  while (true) {
    try {
      const resp = await getUpdates(api, { get_updates_buf: syncBuf });

      // Handle errors
      if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
        if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
          console.error(`⚠️  Session 过期，暂停 1 小时后重试...`);
          console.error("   提示：可能需要重新登录 (npm run login)");
          await sleep(SESSION_PAUSE_MS);
          continue;
        }

        consecutiveFailures++;
        console.error(
          `getUpdates 错误: ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/3)`,
        );
        if (consecutiveFailures >= 3) {
          console.error("连续失败 3 次，等待 30 秒...");
          consecutiveFailures = 0;
          await sleep(30_000);
        } else {
          await sleep(2_000);
        }
        continue;
      }

      consecutiveFailures = 0;

      // Save sync cursor
      if (resp.get_updates_buf) {
        saveSyncBuf(resp.get_updates_buf);
        syncBuf = resp.get_updates_buf;
      }

      // Process messages
      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        await handleMessage(api, msg, claudeOpts, config.multiTurn);
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`Poll 异常 (${consecutiveFailures}/3):`, err instanceof Error ? err.message : err);
      if (consecutiveFailures >= 3) {
        consecutiveFailures = 0;
        await sleep(30_000);
      } else {
        await sleep(2_000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
