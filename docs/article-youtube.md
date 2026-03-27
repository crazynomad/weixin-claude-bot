# YouTube 视频描述 + 置顶评论

## 视频描述 (Description)

用微信远程操控 Claude Code——在地铁上让 AI 帮你改代码。

基于腾讯刚开放的 iLink 协议 + Anthropic 的 Claude Agent SDK，1072 行 TypeScript 搞定。

--- 深度文章 ---
B站专栏（深度配套长文）：[发布后填入链接]
GitHub 项目 + 完整教学文档（9 篇）：https://github.com/crazynomad/weixin-claude-bot

--- 核心概念 ---
iLink 协议：腾讯 2026 年半公开的微信 Bot 通信协议，5 个 HTTP 端点覆盖完整即时通讯功能
Claude Agent SDK：不是普通 API 调用——它启动一个完整的 AI Agent 子进程，内置 20+ 工具，能自主读写文件、执行命令、搜索代码
多轮对话：通过 SDK 的 resume 机制，每条微信消息独立调用但共享上下文

--- 技术栈 ---
Node.js + TypeScript (ESM)
iLink HTTP Long-Poll
@anthropic-ai/claude-agent-sdk
本地文件存储（零云依赖）

--- 相关链接 ---
Claude Agent SDK 官方文档：https://platform.claude.com/docs/en/agent-sdk/overview
SDK 迁移指南（Code SDK → Agent SDK）：https://platform.claude.com/docs/en/agent-sdk/migration-guide
iLink 来源包：https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin

--- 提到的关键代码 ---
SDK 集成（76 行）：https://github.com/crazynomad/weixin-claude-bot/blob/main/src/claude/handler.ts
主循环：https://github.com/crazynomad/weixin-claude-bot/blob/main/src/index.ts
iLink 协议封装：https://github.com/crazynomad/weixin-claude-bot/blob/main/src/ilink/api.ts

#ClaudeCode #AI #微信 #WeChat #TypeScript #AIAgent #ClaudeAgentSDK

---

## 置顶评论 (Pinned Comment)

视频内容的深度配套文章已发布，比视频更详细地讲解了：

1. iLink 协议的 context_token 机制和 long-poll 设计
2. Claude Agent SDK 的 3 个导出函数（query/tool/createSdkMcpServer）和消息流架构
3. 76 行代码怎么集成完整 AI Agent 能力
4. 多轮对话的 resume 实现细节
5. 6 种权限模式在 Bot 场景的取舍
6. 7 个实战踩坑（from_user_id 为空、client_id 去重、AsyncGenerator 陷阱...）
7. SDK 更名迁移的 2 个破坏性变更

B站专栏：[发布后填入链接]
GitHub 完整文档：https://github.com/crazynomad/weixin-claude-bot/tree/main/docs

项目只有 1072 行 TypeScript，适合用来学习 AI Agent 开发。欢迎 Star & 提 Issue！
