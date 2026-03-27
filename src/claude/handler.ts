/**
 * Claude Code SDK integration.
 * Processes WeChat messages through Claude Code and returns text responses.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { BotConfig, PermissionMode } from "../store.js";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

export type ClaudeResponse = {
  text: string;
  durationMs: number;
  costUsd?: number;
  sessionId?: string;
};

export type ClaudeOptions = Pick<Required<BotConfig>, "model" | "maxTurns" | "systemPrompt" | "cwd" | "permissionMode"> & {
  sessionId?: string;
};

/**
 * Send a prompt to Claude Code and collect the text response.
 * Claude Code runs in a subprocess with access to the local filesystem.
 */
export async function askClaude(prompt: string, opts: ClaudeOptions): Promise<ClaudeResponse> {
  const start = Date.now();
  const texts: string[] = [];
  let costUsd: number | undefined;
  let sessionId: string | undefined;

  const conversation = query({
    prompt,
    options: {
      model: opts.model,
      maxTurns: opts.maxTurns,
      cwd: opts.cwd,
      // Cast needed: SDK types haven't added "auto" and "dontAsk" yet,
      // but the runtime supports them.
      permissionMode: opts.permissionMode as Options["permissionMode"],
      ...(opts.systemPrompt ? { appendSystemPrompt: opts.systemPrompt } : {}),
      ...(opts.sessionId ? { resume: opts.sessionId } : {}),
    },
  });

  try {
    for await (const message of conversation) {
      if ("session_id" in message && message.session_id && !sessionId) {
        sessionId = message.session_id;
      }
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            texts.push(block.text);
          }
        }
      } else if (message.type === "result") {
        if (message.subtype === "success" && message.result) {
          texts.length = 0;
          texts.push(message.result);
        }
        costUsd = message.total_cost_usd;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("exited with code")) {
      throw new Error(
        `Claude Code 进程异常退出。可能原因：` +
        `permissionMode "${opts.permissionMode}" 需要 Team 计划，` +
        `或模型 "${opts.model}" 不可用。` +
        `原始错误: ${msg}`,
      );
    }
    throw err;
  }

  const text = texts.join("\n").trim() || "(Claude 没有返回文本内容)";

  return {
    text,
    durationMs: Date.now() - start,
    costUsd,
    sessionId,
  };
}
