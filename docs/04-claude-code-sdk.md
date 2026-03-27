# 04 — Claude Agent SDK：不只是 API 调用

## Claude Code vs Claude API

很多人会混淆这两者：

| | Claude API | Claude Agent SDK |
|---|---|---|
| 是什么 | 纯 LLM 对话接口 | **Agentic 编程助手** |
| 能做什么 | 发文本、收文本 | 读写文件、执行命令、搜索代码、Git 操作... |
| 适合场景 | 聊天机器人 | 远程操控开发环境 |
| npm 包 | `@anthropic-ai/sdk` | `@anthropic-ai/claude-agent-sdk` |
| 调用方式 | `messages.create()` | `query()` — 异步生成器 |

我们选择 Claude Agent SDK 而非纯 API，因为这样微信 Bot 就拥有了**操控本地文件系统和终端的能力**。你可以在地铁上通过微信让 Bot 帮你改代码。

## SDK 核心：query() 函数

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const conversation = query({
  prompt: "帮我看看 package.json 里有哪些 scripts",
  options: {
    model: "claude-sonnet-4-6",
    maxTurns: 10,
    cwd: "/path/to/project",
    permissionMode: "bypassPermissions",
  },
});

// query() 返回 AsyncGenerator，逐条产出消息
for await (const message of conversation) {
  console.log(message.type, message);
}
```

### 返回值：AsyncGenerator\<SDKMessage\>

`query()` 不是返回一个 Promise\<string\>，而是返回一个**异步生成器**，逐条产出消息。这些消息类型包括：

| type | 含义 |
|------|------|
| `system` | 初始化信息（工具列表、模型、权限模式） |
| `assistant` | Claude 的思考/回复内容 |
| `result` | 最终结果（包含总结、cost、usage） |

### 提取最终回复

```typescript
for await (const message of conversation) {
  if (message.type === "result" && message.subtype === "success") {
    // message.result 是最终的文本总结
    // message.total_cost_usd 是本次调用的费用
  }
}
```

## maxTurns 详解

一个 "turn" = Claude 思考一次 + 执行一个工具调用。

### 简单问答（2-3 turns）
```
用户: "JavaScript 的 map 和 forEach 有什么区别？"
Turn 1: Claude 直接回答（不需要工具）
→ 完成
```

### 读取文件（2-3 turns）
```
用户: "帮我看看 package.json"
Turn 1: Claude 调用 Read 工具读取文件
Turn 2: Claude 分析内容并回复
→ 完成
```

### 代码修改（5-10 turns）
```
用户: "把所有 var 改成 const"
Turn 1: Grep 搜索所有包含 var 的文件
Turn 2: Read 第一个文件
Turn 3: Edit 修改第一个文件
Turn 4: Read 第二个文件
Turn 5: Edit 修改第二个文件
...
→ 完成
```

### 复杂重构（10-30 turns）
```
用户: "帮我把用户认证从 session 改成 JWT"
Turn 1-5: 搜索和阅读相关文件
Turn 6-15: 修改多个文件
Turn 16-20: 修改测试
Turn 21-25: 运行测试、修复问题
...
→ 完成
```

### 微信场景的建议配置

- **纯聊天/问答** → `maxTurns: 5`（响应快，token 消耗少）
- **读写代码** → `maxTurns: 10-20`（默认值，平衡点）
- **复杂任务** → `maxTurns: 30+`（但微信用户要等好几分钟）

## permissionMode

Claude Code 有 6 种权限模式，Bot 场景需要选择一个不需要人工交互的模式：

| 模式 | 含义 | 适用场景 |
|------|------|---------|
| `auto` | 后台分类器检查每个操作 | **Bot 推荐** |
| `bypassPermissions` | 自动批准所有操作，无任何检查 | 隔离容器/VM |
| `acceptEdits` | 自动批准文件编辑，命令需确认 | 半自动 |
| `plan` | 只规划不执行 | 代码审查 |
| `default` | 每次工具调用都要确认 | 交互式 CLI |
| `dontAsk` | 仅允许预设白名单工具 | 锁定环境 |

### auto 模式（推荐）

`auto` 是 2026 年新增的模式，专为无人值守场景设计。它的工作方式：

1. 读文件、编辑工作目录内的文件 → **自动放行**（不经过分类器）
2. Shell 命令、网络请求等 → **由后台分类器判断**
3. 分类器判定为危险的操作 → **阻止**，Claude 会尝试替代方案

分类器默认**阻止**的操作：
- 下载并执行代码（`curl | bash`）
- 向外部端点发送敏感数据
- 生产环境部署和数据库迁移
- 大规模删除云存储
- 修改 IAM/仓库权限
- Force push 或直接推送到 main

分类器默认**放行**的操作：
- 工作目录内的本地文件操作
- 安装 lock file 中已声明的依赖
- 只读 HTTP 请求
- 推送到当前分支或 Claude 创建的分支

**注意**：`auto` 模式需要 Team plan + Claude Sonnet 4.6 或 Opus 4.6。如果不满足条件，可以退回 `bypassPermissions`。

### bypassPermissions 模式

完全跳过所有权限检查，每个操作立即执行。只应在隔离环境（容器、VM）中使用。

### 配置方式

```bash
# 推荐：auto 模式
npm run config -- --permission-mode auto

# 退回无限制模式
npm run config -- --permission-mode bypassPermissions
```

**安全提示**：无论使用哪种模式，通过微信发来的指令都会被 Claude 执行。要注意：
- 控制 `cwd`（工作目录），不要指向敏感目录
- `auto` 模式下分类器会阻止明显危险的操作，但不能保证 100% 安全
- 不要把 Bot 暴露给不信任的用户

## model 选择

Claude Agent SDK 支持所有 Claude 模型：

### 最新模型（推荐）

| 模型 | 特点 | 微信场景建议 |
|------|------|-----------|
| `claude-opus-4-6` | 最强，最贵，慢 | 复杂编程任务 |
| `claude-sonnet-4-6` | 平衡，默认 | 日常使用 |
| `claude-haiku-4-5-20251001` | 最快最便宜 | 简单对话、快速回复 |

### 模型别名

除了完整的 model ID，Claude Code 还支持**模型别名**，由 Claude Code 子进程自动解析：

| 别名 | 解析为 | 说明 |
|------|--------|------|
| `sonnet` | `claude-sonnet-4-6` | 简写 |
| `opus` | `claude-opus-4-6` | 简写 |
| `haiku` | `claude-haiku-4-5-20251001` | 简写 |
| **`opusplan`** | 动态切换 | **规划阶段用 Opus，执行阶段用 Sonnet** |
| `sonnet[1m]` | Sonnet + 扩展上下文 | 100 万 token 上下文窗口 |
| `opus[1m]` | Opus + 扩展上下文 | 100 万 token 上下文窗口 |

#### opusplan 详解

`opusplan` 是一个特殊别名，它不是固定映射到某个模型，而是**根据当前阶段动态切换**：

```
用户: "帮我重构 auth 模块"
    │
    ▼
Plan 阶段（思考、分析、制定方案）
  → 使用 Opus（更强的推理能力）
    │
    ▼
Act 阶段（读写文件、运行命令）
  → 切换到 Sonnet（更快、更便宜）
```

这个策略兼顾了质量和成本：复杂的架构决策交给 Opus，重复性的文件操作用 Sonnet 就够了。

**注意**：`opusplan` 需要 Opus 访问权限（Max 或 Team Premium plan）。我们的默认值仍然是 `claude-sonnet-4-6`，因为它对所有账户类型都可用。如果你有 Opus 权限且经常做复杂编程任务，推荐切换到 `opusplan`：

```bash
npm run config -- --model opusplan
```

### 历史版本（仍可用）
- `claude-sonnet-4-5` / `claude-opus-4-5` / `claude-opus-4-1`
- `claude-sonnet-4-0` / `claude-opus-4-0`

### 微信场景的选择逻辑

微信用户对响应时间很敏感（不像终端里可以看到实时输出）。建议：

- 默认用 **Sonnet**：10-30 秒内响应，质量足够好
- 简单问答切 **Haiku**：3-10 秒响应，体验接近即时通讯
- 重要任务切 **Opus**：可能要等 1-3 分钟，但结果更可靠
- 复杂编程用 **opusplan**：规划用 Opus 保证质量，执行用 Sonnet 控制成本

## appendSystemPrompt

通过配置文件可以给 Claude 追加系统提示：

```bash
npm run config -- --system-prompt "你是一个友好的编程助手，用简洁的中文回复。不要输出 Markdown 格式，因为微信不支持渲染。"
```

这在微信场景很有用：
- Claude Code 默认输出 Markdown（微信显示为原始文本，很丑）
- 可以指导 Claude 用纯文本格式回复
- 可以限定 Claude 的角色和能力范围
