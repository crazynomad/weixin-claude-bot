/**
 * weixin-claude-bot — Bridge WeChat messages to Claude Code via iLink protocol.
 *
 * Flow: WeChat → ILinkClient.poll() → Claude Code SDK → ILinkClient.sendTextChunked() → WeChat
 */
import {
  ILinkClient,
  MessageType,
  MessageItemType,
  type WeixinMessage,
} from "weixin-ilink";
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

// --- Process a single inbound message ---

async function handleMessage(
  client: ILinkClient,
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
    await client.sendText(fromUser, "已开始新对话", contextToken);
    console.log(`  🔄 已重置 ${fromUser} 的会话`);
    return;
  }

  // Show typing indicator (non-blocking, non-critical)
  client.sendTyping(fromUser, contextToken).catch(() => {});

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
    const chunks = await client.sendTextChunked(fromUser, response.text, contextToken);
    console.log(`  📤 已发送回复 (${response.text.length} chars, ${chunks} 条消息)`);
  } catch (err) {
    console.error(`  ❌ 处理失败:`, err);
    // If resume failed, clear session and let user retry
    if (multiTurn) {
      clearSessionId(fromUser);
    }
    // Send error message back to user
    await client.sendText(
      fromUser,
      `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`,
      contextToken,
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

  const client = new ILinkClient({
    baseUrl: creds.baseUrl,
    token: creds.botToken,
  });

  // Restore sync cursor
  client.cursor = loadSyncBuf();

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

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n正在关闭...");
    process.exit(0);
  });

  // Long-poll loop
  let consecutiveFailures = 0;

  while (true) {
    try {
      const resp = await client.poll();

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

      // Persist sync cursor
      saveSyncBuf(client.cursor);

      // Process messages
      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        await handleMessage(client, msg, claudeOpts, config.multiTurn);
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
