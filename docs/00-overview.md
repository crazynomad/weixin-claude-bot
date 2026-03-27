# weixin-claude-bot 教学文档

> 配套 YouTube 频道「绿皮火车」节目

## 这个项目是什么？

一个独立的微信 Bot，通过腾讯刚刚（半公开）开放的 **iLink 协议** 连接微信，桥接 **Claude Agent SDK**，实现通过微信消息远程操控本地开发环境。

## 为什么做这个？

2026 年是 AI Agent 爆发的一年。微信作为中国最大的 IM 平台，一直对第三方开发者封闭。而 iLink 的出现可能标志着微信生态向开放迈出的第一步。

这个项目展示了：
1. 如何逆向理解一个没有文档的协议（通过阅读 npm 包源码）
2. 如何用 Claude Agent SDK 构建一个有 agentic 能力的 Bot
3. AI Agent 时代 IM 平台开放的意义

## 文档目录

| 文档 | 内容 |
|------|------|
| [01 — iLink 协议](01-ilink-protocol.md) | 协议设计哲学、5个端点、context_token、风险评估 |
| [02 — 架构设计](02-architecture.md) | 整体架构、消息流程、项目结构、设计决策 |
| [03 — QR 扫码登录](03-qr-login.md) | 登录流程、时序图、Token 持久化 |
| [04 — Claude Agent SDK](04-claude-code-sdk.md) | SDK vs API、query() 用法、maxTurns、模型选择 |
| [05 — 踩坑记录](05-pitfalls.md) | 7 个实战踩坑及修复过程 |
| [06 — 使用指南](06-usage-guide.md) | 从零到跑通的完整步骤 |
| [07 — OpenClaw 源码分析](07-openclaw-analysis.md) | 33个源文件深度解析、时序图、架构图、协议类型体系、CDN加密方案 |
| [08 — 权限模式](08-permission-modes.md) | auto 模式详解、6 种模式对比、安全策略 |

## 技术栈

- **Runtime**: Node.js + TypeScript (ESM)
- **WeChat 接入**: iLink 协议（HTTP long-poll）
- **AI 引擎**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **状态存储**: 本地文件系统 (`~/.weixin-claude-bot/`)

## 参考资料

- 原始分析文章：《深入iLink协议：微信ClawBot背后的技术架构与开放信号》(伟叔Steven, 2026-03-23)
- npm 包：`@tencent-weixin/openclaw-weixin`
- OpenClaw 项目：`openclaw/openclaw`（82+ channel 扩展的多通道 AI Bot 网关）
