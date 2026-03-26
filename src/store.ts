/**
 * Simple file-based persistence for bot credentials and state.
 * Stores in ~/.weixin-claude-bot/
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const STATE_DIR = path.join(os.homedir(), ".weixin-claude-bot");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- Credentials ---

export type Credentials = {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
};

function credentialsPath(): string {
  return path.join(STATE_DIR, "credentials.json");
}

export function saveCredentials(creds: Omit<Credentials, "savedAt">): void {
  ensureDir(STATE_DIR);
  const data: Credentials = { ...creds, savedAt: new Date().toISOString() };
  fs.writeFileSync(credentialsPath(), JSON.stringify(data, null, 2));
  fs.chmodSync(credentialsPath(), 0o600);
  console.log(`凭证已保存到 ${credentialsPath()}`);
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

// --- Sync buffer (getUpdates cursor) ---

function syncBufPath(): string {
  return path.join(STATE_DIR, "sync-buf.txt");
}

export function loadSyncBuf(): string {
  try {
    return fs.readFileSync(syncBufPath(), "utf-8");
  } catch {
    return "";
  }
}

export function saveSyncBuf(buf: string): void {
  ensureDir(STATE_DIR);
  fs.writeFileSync(syncBufPath(), buf);
}

// --- Context tokens (per-user) ---

function contextTokensPath(): string {
  return path.join(STATE_DIR, "context-tokens.json");
}

let tokenCache: Record<string, string> = {};

export function loadContextTokens(): void {
  try {
    const raw = fs.readFileSync(contextTokensPath(), "utf-8");
    tokenCache = JSON.parse(raw) as Record<string, string>;
  } catch {
    tokenCache = {};
  }
}

export function getContextToken(userId: string): string | undefined {
  return tokenCache[userId];
}

export function setContextToken(userId: string, token: string): void {
  tokenCache[userId] = token;
  ensureDir(STATE_DIR);
  fs.writeFileSync(contextTokensPath(), JSON.stringify(tokenCache));
}

// --- Bot config ---

/**
 * Permission modes for Claude Code:
 * - "auto"              — Background classifier checks each action (recommended for Bot)
 * - "bypassPermissions" — No checks at all (only for isolated environments)
 * - "acceptEdits"       — Auto-approve file edits, prompt for commands
 * - "plan"              — Read-only, no edits
 * - "default"           — Prompt for everything (not suitable for Bot)
 * - "dontAsk"           — Only pre-approved tools allowed
 *
 * Note: "auto" requires Team plan + Sonnet 4.6 or Opus 4.6
 */
export type PermissionMode = "auto" | "bypassPermissions" | "acceptEdits" | "plan" | "default" | "dontAsk";

export type BotConfig = {
  /** Claude model to use (e.g. "claude-sonnet-4-6", "claude-opus-4-6") */
  model?: string;
  /** Max agentic turns per message */
  maxTurns?: number;
  /** System prompt prepended to every conversation */
  systemPrompt?: string;
  /** Working directory for Claude Code */
  cwd?: string;
  /** Permission mode for Claude Code tool execution */
  permissionMode?: PermissionMode;
};

const DEFAULT_CONFIG: Required<BotConfig> = {
  model: "claude-sonnet-4-6",
  maxTurns: 10,
  systemPrompt: "",
  cwd: process.cwd(),
  permissionMode: "bypassPermissions",
};

function configPath(): string {
  return path.join(STATE_DIR, "config.json");
}

export function loadConfig(): Required<BotConfig> {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const saved = JSON.parse(raw) as BotConfig;
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: BotConfig): void {
  ensureDir(STATE_DIR);
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  console.log(`配置已保存到 ${configPath()}`);
}
