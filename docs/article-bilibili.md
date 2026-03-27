# 用微信远程操控 Claude Code：从 iLink 协议逆向到 Agent SDK 实战

> 本文是 B站/YouTube 视频「微信 + Claude Code = 远程编程」的深度配套文章。视频侧重演示和概念，本文侧重原理和代码。
>
> 项目地址：https://github.com/crazynomad/weixin-claude-bot
> 视频：[YouTube](https://youtu.be/-xCZ9KtaC04) | [B站](https://www.bilibili.com/video/BV18rXbBaEK7/)

---

## 这个项目是什么？

一句话：在地铁上用微信让 AI 帮你改代码。

```
微信用户 ──► iLink 协议 ──► weixin-claude-bot ──► Claude Agent SDK ──► 本地文件系统
```

你在微信上发一条消息「帮我看看 src/index.ts 有 bug 吗」，服务器上的 Bot 会启动一个完整的 Claude Code 实例——它能读写文件、跑终端命令、搜索代码——然后把结果发回微信。

不是简单的聊天机器人，是一个能动手的 AI Agent。

整个项目只有 **1072 行 TypeScript**，没有任何框架依赖。

---

## 第一部分：iLink 协议——微信悄悄打开的大门

### 故事背景

2026 年 3 月，腾讯悄悄在 npm 上发了一个包 `@tencent-weixin/openclaw-weixin`：3756 行可读的 TypeScript 源码，MIT License，没有文档，没有公告。

这个包做了一件以前不可想象的事：让第三方开发者能通过标准 HTTP 与微信交互。

微信一直是封闭生态的代名词。之前接入微信只能靠灰色手段（网页版协议注入、Hook 注入），随时被封。而 iLink 的设计明显是面向开发者的——这是腾讯对 AI Agent 时代的一次试探性开放。

### 协议设计：极简到令人意外

整个协议只有 5 个 HTTP 端点：

| 端点 | 干什么 |
|------|--------|
| `getupdates` | Long-poll 拉取新消息 |
| `sendmessage` | 发送消息 |
| `getconfig` | 获取 bot 配置 |
| `sendtyping` | 发送「正在输入」状态 |
| `getuploadurl` | 获取 CDN 上传链接 |

没有 WebSocket，纯 HTTP POST。为什么？

1. 防火墙友好——纯 HTTP 不会被企业网络拦截
2. 任何语言都能接入——curl 就能测试
3. 无状态——服务端不用维护连接

Long-poll 的工作方式：客户端发请求，服务端 hold 住（最长 35 秒），有消息就返回，超时就返回空。客户端立即发下一次请求。类似 Telegram Bot API 的设计。

### 关键机制：context_token

这是 iLink 最重要的设计细节。每条入站消息带一个 `context_token`，回复时必须原样带上：

```typescript
// 收到消息
msg.context_token  // "eyJhbGciOiJIUz..."

// 回复时必须带上
sendMessage({
  msg: {
    to_user_id: fromUser,
    context_token: msg.context_token,  // ← 缺了这个，回复发不出去
    // ...
  }
})
```

这个设计的深层含义：服务端通过 token 做消息关联和权限验证，Bot 不能凭空给任意用户发消息，只能回复收到的消息。安全但也有限制——Bot 无法主动发起对话。

### 从 3756 行到 200 行

原始的 `openclaw-weixin` 包和 OpenClaw 框架深度耦合，无法直接在独立项目中使用。我们的做法是阅读源码理解协议，然后用最少代码重新实现。

最终我们的 iLink 封装只有约 200 行（`src/ilink/api.ts` + `src/ilink/types.ts` + `src/ilink/auth.ts`），覆盖了全部核心功能。

---

## 第二部分：Claude Agent SDK——不只是 API 调用

### 先搞清一件事

很多人以为 Claude Agent SDK 就是换了个名字的 Claude API。不是的。它们是完全不同的东西：

| | Claude API | Claude Agent SDK |
|---|---|---|
| 本质 | HTTP 请求 → 文本回复 | 启动子进程 → AI Agent 自主行动 |
| 能力 | 纯文本对话 | 读写文件、执行命令、搜索代码、Git 操作 |
| npm 包 | `@anthropic-ai/sdk` | `@anthropic-ai/claude-agent-sdk` |
| 调用方式 | `messages.create()` 返回 Promise | `query()` 返回 AsyncGenerator |

**关键认知**：`query()` 不是发一个 HTTP 请求——它 fork 一个完整的 Claude Code 子进程，这个子进程内置 20+ 工具（Read, Edit, Write, Bash, Grep, Glob, Agent, WebSearch...），能自主循环「思考 → 行动 → 观察」直到任务完成。

### npm 包的真面目

```
node_modules/@anthropic-ai/claude-agent-sdk/
├── cli.js          ← 13 MB 单文件 bundle（完整 Claude Code CLI）
├── sdk.mjs         ← 500 KB SDK 入口
├── sdk.d.ts        ← TypeScript 类型定义（唯一可读的 API 参考）
└── vendor/ripgrep/ ← 6 个平台的 rg 二进制
```

源码是完全闭源的。GitHub repo `anthropics/claude-agent-sdk-typescript` 只是 issue tracker。`sdk.d.ts` 类型定义文件是你理解 API 的唯一权威来源。

### 三个导出函数

SDK 只导出 3 样东西：

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
```

**query()** —— 核心。发一个 prompt，启动 agent 循环，返回消息流。

**tool()** —— 用 Zod schema 定义自定义工具。

**createSdkMcpServer()** —— 把自定义工具打包成进程内 MCP 服务器，零开销注入 agent。

我们的项目只用了 `query()`。但 `tool()` + `createSdkMcpServer()` 是做垂直应用的关键——比如给 Bot 加一个「查数据库」的能力，几行代码搞定，不需要单独部署 MCP 服务器。

### query() 的消息流

`query()` 返回的不是一个字符串，是一个 `AsyncGenerator<SDKMessage>`。每个 message 有不同类型：

```
query() 产出的消息流：

  system (init)          ← 初始化：工具列表、模型、权限
  user                   ← 你的输入（echo back）
  assistant              ← Claude 的回复（可能含 tool_use）
  user (synthetic)       ← 工具执行结果（系统自动注入）
  assistant              ← Claude 根据结果继续思考
  ...                    ← 循环 maxTurns 次
  result                 ← 最终结果（含 cost、usage）
```

在微信 Bot 中，我们只关心最后的 `result`：

```typescript
for await (const message of conversation) {
  if (message.type === "result" && message.subtype === "success") {
    // message.result 是最终文本
    // message.total_cost_usd 是费用
  }
}
```

中间的 assistant 消息（「让我来读一下这个文件...」）对微信用户没价值。当 result 到达时，我们清空所有中间文本，只保留最终总结。

---

## 第三部分：核心代码解析

### 整体架构

整个项目只有 6 个源文件：

```
src/
├── index.ts          # 主循环：长轮询 + 消息分发（276 行）
├── login.ts          # QR 扫码登录
├── config.ts         # 配置管理 CLI
├── store.ts          # 状态持久化（149 行）
├── ilink/
│   ├── api.ts        # 5 个 HTTP 端点封装（113 行）
│   ├── types.ts      # 协议类型定义
│   └── auth.ts       # QR 登录流程
└── claude/
    └── handler.ts    # Claude SDK 集成（76 行）
```

与 Claude SDK 交互的代码只有 **76 行**。

### handler.ts —— 整个 AI 集成的核心

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

export async function askClaude(prompt: string, opts: ClaudeOptions): Promise<ClaudeResponse> {
  const texts: string[] = [];
  let costUsd: number | undefined;
  let sessionId: string | undefined;

  // 启动 query —— fork 一个 Claude Code 子进程
  const conversation = query({
    prompt,
    options: {
      model: opts.model,             // "claude-sonnet-4-6"
      maxTurns: opts.maxTurns,       // 默认 10
      cwd: opts.cwd,                 // 工作目录
      permissionMode: opts.permissionMode,
      ...(opts.systemPrompt ? { appendSystemPrompt: opts.systemPrompt } : {}),
      ...(opts.sessionId ? { resume: opts.sessionId } : {}),
    },
  });

  // 消费 AsyncGenerator
  for await (const message of conversation) {
    // 捕获 session ID（多轮对话用）
    if ("session_id" in message && message.session_id && !sessionId) {
      sessionId = message.session_id;
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") texts.push(block.text);
      }
    } else if (message.type === "result") {
      if (message.subtype === "success" && message.result) {
        texts.length = 0;            // 清空中间文本
        texts.push(message.result);   // 只保留最终总结
      }
      costUsd = message.total_cost_usd;
    }
  }

  return { text: texts.join("\n").trim(), costUsd, sessionId };
}
```

**`texts.length = 0` 这行很重要**。在 agentic 流程中，Claude 可能产出十几条中间消息（「让我搜索一下...」「找到了，正在修改...」）。微信用户不需要看这些过程性文本。当 `result` 到达时，清空一切，只发最终总结。

### 主循环 —— Long-Poll 模式

```typescript
while (true) {
  const resp = await getUpdates(api, { get_updates_buf: syncBuf });

  // 保存游标（断点续传）
  if (resp.get_updates_buf) {
    saveSyncBuf(resp.get_updates_buf);
    syncBuf = resp.get_updates_buf;
  }

  // 处理每条消息
  for (const msg of resp.msgs ?? []) {
    await handleMessage(api, msg, claudeOpts, config.multiTurn);
  }
}
```

`get_updates_buf` 是一个不透明的游标。每次响应返回新的游标，下次请求带上，服务端就知道从哪里继续。Bot 重启后从磁盘读取上次保存的游标，不会漏消息。

### 消息处理流程

```typescript
async function handleMessage(api, msg, claudeOpts, multiTurn) {
  // 1. 只处理用户消息
  if (msg.message_type !== MessageType.USER) return;

  // 2. 提取文本（支持语音 ASR 转写）
  const text = extractText(msg);

  // 3. 重置命令检测
  if (multiTurn && RESET_COMMANDS.has(text.trim())) {
    clearSessionId(fromUser);
    await sendTextReply(api, fromUser, contextToken, "已开始新对话");
    return;
  }

  // 4. 发送「正在输入」状态
  showTyping(api, fromUser, contextToken);

  // 5. 调用 Claude（带 session 接续）
  const callOpts = multiTurn
    ? { ...claudeOpts, sessionId: getSessionId(fromUser) }
    : claudeOpts;
  const response = await askClaude(text, callOpts);

  // 6. 保存 session ID
  if (multiTurn && response.sessionId) {
    setSessionId(fromUser, response.sessionId);
  }

  // 7. 发送回复（超长自动分片 ≤ 4000 字）
  await sendTextReply(api, fromUser, contextToken, response.text);
}
```

---

## 第四部分：多轮对话——resume 机制

### 问题

默认情况下，每条微信消息都是独立的 Claude 会话。你问「帮我看看 auth.ts」，Claude 看了。你接着问「能优化一下吗」，Claude 完全不知道你在说什么——上一次会话已经结束了。

### 方案选择

SDK 提供了两种多轮对话方式：

**AsyncIterable 模式**：在一个 `query()` 内持续追加用户消息。适合交互式 CLI，但不适合微信——用户可能隔几小时才回，进程不能一直挂着。

**resume 模式**：每次 `query()` 独立调用，通过 session ID 接续上下文。Claude Code 在服务端保存了完整对话历史，传入 session ID 就能恢复。

我们选了 resume。

### 实现

核心只有三步：

1. 第一次调用：正常 `query()`，捕获返回的 `session_id`，存到磁盘
2. 后续调用：传入 `resume: sessionId`，Claude 自动恢复上下文
3. 重置：用户发「新对话」「/reset」「/clear」时清除存储的 session ID

```typescript
// 简化后的核心逻辑
const sessionId = multiTurn ? getSessionId(fromUser) : undefined;
const response = await askClaude(text, { ...opts, sessionId });
if (multiTurn && response.sessionId) {
  setSessionId(fromUser, response.sessionId);
}
```

### 注意事项

- 多轮对话会累积 token 消耗——Claude 每次要重新读取之前的对话历史
- 错误时自动清除 session ID，避免用户卡在损坏的会话中
- 对简单问答场景，关闭多轮（默认）更省钱

配置方式：`npm run config -- --multi-turn true`

---

## 第五部分：权限模型——Bot 场景的核心难题

### 问题

Claude Code CLI 是交互式的：每次执行工具都弹窗确认。但微信 Bot 没有人在终端前面，不能弹窗。

### 6 种权限模式

从安全到自由排列：

| 模式 | 文件编辑 | Shell 命令 | 适合 Bot？ |
|------|---------|-----------|-----------|
| `plan` | 禁止 | 禁止 | 只读场景 |
| `default` | 需确认 | 需确认 | 不适合（会卡住） |
| `dontAsk` | 白名单 | 白名单 | 锁定环境 |
| `acceptEdits` | 自动 | 需确认 | 半自动 |
| `auto` | 自动 | AI 分类器判断 | 推荐 |
| `bypassPermissions` | 自动 | 自动 | 隔离容器 |

### auto 模式详解

`auto` 是专为无人值守场景设计的。工作原理：

- 读写工作目录内的文件 → 直接放行（不经过分类器）
- Shell 命令和网络请求 → 交给 Sonnet 4.6 分类器判断
- 分类器判定危险 → 阻止，Claude 尝试替代方案

分类器会阻止的操作：`curl | bash`、`git push --force`、删除云存储、泄露 .env 内容等。

分类器会放行的操作：`npm test`、读写本地文件、`git push` 到当前分支等。

### 我们的选择

项目默认用 `bypassPermissions`（全放开），因为 `auto` 需要 Team plan。文档中推荐有条件的用户切换到 `auto`。

对于个人部署在自己机器上的 Bot，`bypassPermissions` + 限定 `cwd` 是务实的安全策略。但如果要对外提供服务，SDK 还提供了 `canUseTool` 回调做精细控制：

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === "Bash" && String(input.command).includes("rm ")) {
    return { behavior: "deny", message: "不允许删除文件" };
  }
  return { behavior: "allow", updatedInput: input };
}
```

---

## 第六部分：踩过的 7 个坑

视频里可能一笔带过，这里详细展开。

### 坑 1：from_user_id 不能填

发消息时 `from_user_id` 必须留空字符串。服务端根据 `Authorization` 头自动识别发送者。填了 Bot ID 反而导致后续消息全部被丢弃。

表现：第一条回复正常，之后全部消失。

### 坑 2：缺少 client_id

每条发送的消息需要唯一 `client_id`。没有它，服务端把后续消息当重复消息丢弃。

修复：`wcb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`

### 坑 3：SDK 没有 "claude" 导出

```typescript
// ❌ 很多人以为的用法
import { claude } from "@anthropic-ai/claude-agent-sdk";

// ✅ 实际只有这三个
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
```

### 坑 4：query() 返回 AsyncGenerator

```typescript
// ❌ 不是 Promise
const result = await query({ prompt: "hello" });

// ✅ 需要遍历
for await (const message of query({ prompt: "hello" })) {
  if (message.type === "result") console.log(message.result);
}
```

### 坑 5：context_token 必须持久化

Bot 重启后丢失内存中的 token 就无法回复。必须写磁盘。

### 坑 6：微信不渲染 Markdown

Claude 默认输出 Markdown（`**加粗**`、`` `代码` ``）。微信显示为原始文本，很丑。

缓解方案：通过 `systemPrompt` 告诉 Claude「用纯文本格式回复」。

### 坑 7：qrcode-terminal 没有 TypeScript 类型

需要手写一个 `.d.ts` 声明文件。3 行搞定。

---

## 第七部分：SDK 更名——从 Claude Code SDK 到 Agent SDK

2026 年 3 月，Anthropic 将 Claude Code SDK 更名为 Claude Agent SDK，反映它不只是写代码的工具。

### 迁移要点

| 方面 | 旧 | 新 |
|------|-----|-----|
| npm 包名 | `@anthropic-ai/claude-code` | `@anthropic-ai/claude-agent-sdk` |
| Python 包名 | `claude-code-sdk` | `claude-agent-sdk` |

API 不变，`query()` 仍是核心。但有两个破坏性变更：

**1. 系统提示不再默认加载**

旧版自动使用 Claude Code 的系统提示。新版需要显式指定：

```typescript
options: {
  systemPrompt: { type: "preset", preset: "claude_code" }
}
```

**2. 设置源不再默认读取**

旧版自动读 `CLAUDE.md` 和 `settings.json`。新版需要显式声明：

```typescript
options: {
  settingSources: ["user", "project", "local"]
}
```

这两个变更是为了让 SDK 应用有可预测的行为，不被本地配置意外影响。

---

## 第八部分：费用参考

Agent SDK 的费用 = Claude API 的 token 费用 + 多轮工具调用的累积。

典型场景（使用 Sonnet）：

| 任务 | Agent 轮次 | 大约耗时 | 大约费用 |
|------|-----------|---------|---------|
| 简单问答 | 1-2 | 5-15s | $0.001-0.005 |
| 读一个文件 | 2-3 | 10-20s | $0.005-0.02 |
| 修改代码 | 5-10 | 30-90s | $0.02-0.10 |
| 复杂重构 | 10-30 | 2-5min | $0.10-0.50 |

微信用户对延迟敏感（看不到实时输出），建议：
- 日常用 Sonnet（10-30s）
- 简单对话用 Haiku（3-10s）
- 复杂任务用 Opus 或 opusplan（1-3min，但更可靠）

`maxTurns` 默认 10，覆盖大部分场景。过大容易费用失控，过小会被截断。

---

## 总结：1072 行代码能做什么

这个项目证明了一个观点：在 AI Agent SDK 时代，「胶水代码」的价值比以前更高了。

我们没有训练模型，没有写推理引擎，没有实现工具执行器。我们只做了一件事：**把两个已有的能力（微信消息 + Claude Code）用最少的代码粘在一起**。

- iLink 给了我们微信消息的通道
- Claude Agent SDK 给了我们 AI Agent 的能力
- 我们写了 1072 行 TypeScript 把它们连起来

这就是 2026 年的软件开发：不是从零造轮子，而是理解和组合已有的能力。

---

## 资源链接

- 项目源码：https://github.com/crazynomad/weixin-claude-bot
- 完整教学文档：项目 `docs/` 目录（9 篇，含 OpenClaw 源码深度分析）
- Claude Agent SDK 官方文档：https://platform.claude.com/docs/en/agent-sdk/overview
- Claude Agent SDK 迁移指南：https://platform.claude.com/docs/en/agent-sdk/migration-guide

有问题欢迎在评论区讨论，或者去 GitHub 提 Issue。
