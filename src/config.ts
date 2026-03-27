/**
 * CLI config tool: `npm run config -- --model claude-opus-4-6`
 *
 * Usage:
 *   npm run config                                  # Show current config
 *   npm run config -- --model claude-opus-4-6       # Set model
 *   npm run config -- --permission-mode auto        # Set permission mode
 *   npm run config -- --max-turns 5                 # Set max turns
 *   npm run config -- --system-prompt "..."         # Set system prompt
 *   npm run config -- --cwd /path/to/dir            # Set working directory
 *   npm run config -- --multi-turn true             # Enable multi-turn conversations
 */
import { loadConfig, saveConfig, type PermissionMode } from "./store.js";

/** Full model IDs */
const KNOWN_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "claude-opus-4-1",
];

/** Claude Code model aliases — resolved by the Claude Code subprocess */
const MODEL_ALIASES: { alias: string; desc: string }[] = [
  { alias: "sonnet",     desc: "→ claude-sonnet-4-6" },
  { alias: "opus",       desc: "→ claude-opus-4-6" },
  { alias: "haiku",      desc: "→ claude-haiku-4-5-20251001" },
  { alias: "opusplan",   desc: "→ 规划用 Opus，执行用 Sonnet（推荐复杂任务）" },
  { alias: "sonnet[1m]", desc: "→ Sonnet + 100万 token 扩展上下文" },
  { alias: "opus[1m]",   desc: "→ Opus + 100万 token 扩展上下文" },
];

const PERMISSION_MODES: { mode: PermissionMode; desc: string }[] = [
  { mode: "auto",              desc: "后台分类器检查每个操作（推荐，需 Team plan + Sonnet/Opus 4.6）" },
  { mode: "bypassPermissions", desc: "跳过所有检查（仅限隔离环境）" },
  { mode: "acceptEdits",       desc: "自动批准文件编辑，命令需确认" },
  { mode: "plan",              desc: "只读模式，不执行修改" },
  { mode: "default",           desc: "每次操作都需确认（不适合 Bot）" },
  { mode: "dontAsk",           desc: "仅允许预设白名单工具" },
];

const VALID_MODES = PERMISSION_MODES.map((p) => p.mode);

function printConfig() {
  const config = loadConfig();
  console.log("\n=== 当前配置 ===");
  console.log(`模型 (--model):                ${config.model}`);
  console.log(`权限模式 (--permission-mode):   ${config.permissionMode}`);
  console.log(`最大轮次 (--max-turns):         ${config.maxTurns}`);
  console.log(`工作目录 (--cwd):               ${config.cwd}`);
  console.log(`系统提示 (--system-prompt):     ${config.systemPrompt || "(无)"}`);
  console.log(`多轮对话 (--multi-turn):        ${config.multiTurn ? "开启" : "关闭"}`);
  console.log(`\n可用模型: ${KNOWN_MODELS.join(", ")}`);
  console.log("\n模型别名（Claude Code 子进程解析）:");
  for (const { alias, desc } of MODEL_ALIASES) {
    console.log(`  ${alias.padEnd(14)} ${desc}`);
  }
  console.log("\n权限模式:");
  for (const { mode, desc } of PERMISSION_MODES) {
    const marker = mode === config.permissionMode ? " ◄ 当前" : "";
    console.log(`  ${mode.padEnd(20)} ${desc}${marker}`);
  }
  console.log();
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printConfig();
    return;
  }

  let hasChanges = false;
  const updates: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--model":
        if (!next) { console.error("--model 需要参数"); process.exit(1); }
        updates.model = next;
        i++;
        hasChanges = true;
        break;
      case "--permission-mode":
        if (!next) { console.error("--permission-mode 需要参数"); process.exit(1); }
        if (!VALID_MODES.includes(next as PermissionMode)) {
          console.error(`无效的权限模式: ${next}`);
          console.error(`可用模式: ${VALID_MODES.join(", ")}`);
          process.exit(1);
        }
        updates.permissionMode = next;
        i++;
        hasChanges = true;
        break;
      case "--max-turns":
        if (!next) { console.error("--max-turns 需要参数"); process.exit(1); }
        updates.maxTurns = parseInt(next, 10);
        if (isNaN(updates.maxTurns as number)) { console.error("--max-turns 必须是数字"); process.exit(1); }
        i++;
        hasChanges = true;
        break;
      case "--system-prompt":
        if (!next) { console.error("--system-prompt 需要参数"); process.exit(1); }
        updates.systemPrompt = next;
        i++;
        hasChanges = true;
        break;
      case "--cwd":
        if (!next) { console.error("--cwd 需要参数"); process.exit(1); }
        updates.cwd = next;
        i++;
        hasChanges = true;
        break;
      case "--multi-turn":
        if (!next || (next !== "true" && next !== "false")) {
          console.error("--multi-turn 需要参数 (true/false)");
          process.exit(1);
        }
        updates.multiTurn = next === "true";
        i++;
        hasChanges = true;
        break;
      default:
        console.error(`未知参数: ${arg}`);
        process.exit(1);
    }
  }

  if (hasChanges) {
    saveConfig(updates);
    printConfig();
  }
}

main();
