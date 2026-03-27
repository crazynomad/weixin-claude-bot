# 06 — 使用指南：从零到跑通

## 前置条件

- Node.js 18+
- 一台安装了微信的手机（用来扫码）
- Anthropic API Key（Claude Code 需要）

## 第一步：安装

```bash
cd ~/Github/weixin-claude-bot
npm install
```

依赖很少：
- `@anthropic-ai/claude-agent-sdk` — Claude Agent SDK
- `qrcode-terminal` — 终端显示二维码
- `tsx` / `typescript` — 开发工具

## 第二步：扫码登录

```bash
npm run login
```

终端会显示一个二维码：

```
=== 微信 ClawBot 登录 ===

请使用微信扫描以下二维码：

▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
█ ▄▄▄▄▄ █ ██▀▀ ▄▄▄▀▀▀ █ ▄▄▄█▄▀█ ▄▄▄▄▄ █
█ █   █ █  ▀█ ▀▄ ▄▄█▄▀▄ ▄▀█ █▀█ █   █ █
...

如无法显示，请在浏览器打开: https://liteapp.weixin.qq.com/q/...
```

用微信扫码 → 确认 → 看到"✅ 微信连接成功！"

凭证自动保存到 `~/.weixin-claude-bot/credentials.json`

## 第三步：配置（可选）

```bash
# 查看当前配置
npm run config

# 切换模型
npm run config -- --model claude-opus-4-6        # 最强
npm run config -- --model claude-sonnet-4-6       # 默认，平衡
npm run config -- --model claude-haiku-4-5-20251001  # 最快

# 设置最大轮次
npm run config -- --max-turns 5      # 简单对话
npm run config -- --max-turns 20     # 需要操作文件

# 开启多轮对话（Claude 记住上下文）
npm run config -- --multi-turn true

# 设置工作目录（Claude Code 操作文件的根目录）
npm run config -- --cwd ~/Github/my-project

# 设置系统提示
npm run config -- --system-prompt "你是一个友好的编程助手，用简洁的中文回复"

# 组合使用
npm run config -- --model claude-haiku-4-5-20251001 --max-turns 5 --multi-turn true
```

配置保存在 `~/.weixin-claude-bot/config.json`

## 第四步：启动 Bot

```bash
npm start
```

输出：
```
=== 微信 Claude Bot 已启动 ===
账号: df412faf283b@im.bot
Base URL: https://ilinkai.weixin.qq.com
模型: claude-sonnet-4-6
最大轮次: 10
工作目录: /Users/greentrain/Github/weixin-claude-bot
等待消息中...
```

现在可以在微信上给 Bot 发消息了！

## 使用示例

### 简单对话
```
你: 什么是 TypeScript？
Bot: TypeScript 是 JavaScript 的超集，添加了静态类型系统...
```

### 读取代码
```
你: 帮我看看 package.json 有哪些依赖
Bot: 你的 package.json 中有以下依赖：
     - @anthropic-ai/claude-agent-sdk: ^0.2
     - qrcode-terminal: ^0.12.0
     ...
```

### 多轮对话（需要 --multi-turn true）
```
你: 帮我看看 package.json 有哪些依赖
Bot: 你的 package.json 中有以下依赖：...

你: 其中哪个是 AI 相关的？
Bot: @anthropic-ai/claude-agent-sdk 是 AI 相关的，它是 Claude Agent SDK...

你: 新对话
Bot: 已开始新对话
```

发送 **"新对话"**、**"/reset"** 或 **"/clear"** 可重置会话，开始全新对话。

### 修改代码（需要 maxTurns ≥ 5）
```
你: 在 src/index.ts 里加一个启动时打印版本号的功能
Bot: 已修改 src/index.ts，在启动时会打印版本号 0.1.0...
```

## 停止 Bot

按 `Ctrl+C` 优雅关闭。

## 重新登录

Token 过期时（进程会提示），重新运行：
```bash
npm run login
```

## 文件结构说明

```
~/.weixin-claude-bot/           # Bot 状态目录
├── credentials.json            # 登录凭证（bot_token 等）
├── config.json                 # 用户配置（模型、参数等）
├── sync-buf.txt                # 消息游标（断点续传）
├── context-tokens.json         # 会话令牌（per-user）
└── session-ids.json            # Claude 会话 ID（多轮对话）
```

所有数据都在本地，没有上传到任何服务器。删除 `~/.weixin-claude-bot/` 目录即可完全清除。
