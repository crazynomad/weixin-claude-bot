# 02 — 架构设计：从微信消息到 Claude Code

## 整体架构

```
┌──────────┐     iLink HTTP      ┌──────────────────┐    SDK subprocess    ┌────────────┐
│  微信用户  │ ◄──────────────────► │  weixin-claude-bot │ ◄──────────────────► │ Claude Code │
│ (手机/PC)  │    5个端点           │   (Node.js 进程)   │    query() API      │  (子进程)    │
└──────────┘                     └──────────────────┘                      └────────────┘
                                        │
                                        ▼
                                 ~/.weixin-claude-bot/
                                 ├── credentials.json  (登录凭证)
                                 ├── config.json       (模型/参数配置)
                                 ├── sync-buf.txt      (消息游标)
                                 └── context-tokens.json (会话令牌)
```

## 消息流程（完整生命周期）

```
1. 用户在微信发消息 "帮我看看 package.json"
      │
      ▼
2. iLink 服务器收到消息，hold 住 long-poll 连接
      │
      ▼
3. 我们的 Bot 通过 getupdates 收到消息
   - 提取 from_user_id、text、context_token
   - 缓存 context_token（用于回复）
   - 更新 sync_buf（断点续传游标）
      │
      ▼
4. 发送 typing 状态（"正在输入..."）
   - 先调 getconfig 获取 typing_ticket
   - 再调 sendtyping 发送状态
      │
      ▼
5. 调用 Claude Agent SDK 的 query() 函数
   - 启动一个 Claude Code 子进程
   - Claude 可能执行多个 turn（读文件、搜索、写代码...）
   - 收集最终结果文本
      │
      ▼
6. 通过 sendmessage 将回复发回微信
   - 必须携带之前缓存的 context_token
   - 长文本自动分段（每段 ≤ 4000 字符）
   - 每条消息带唯一 client_id（防重复）
      │
      ▼
7. 用户在微信收到 Claude 的回复
```

## 为什么选择独立项目而非 OpenClaw 扩展？

OpenClaw 已经有 82 个 channel 扩展（Telegram、Discord、LINE 等），我们完全可以写一个微信扩展。但选择独立项目的原因：

1. **iLink 仍是灰色地带** — 没有 SLA，随时可能变更，不适合直接集成到生产级框架
2. **教学目的** — 独立项目更容易理解完整流程，不需要学习 OpenClaw 的插件 SDK
3. **快速原型** — 验证可行性后再考虑正式集成

## 项目结构

```
weixin-claude-bot/
├── package.json
├── tsconfig.json
├── docs/                    # 教学文档（你正在看的）
├── src/
│   ├── index.ts             # 主入口：long-poll 循环 + 消息分发
│   ├── login.ts             # QR 扫码登录脚本
│   ├── config.ts            # 配置管理 CLI
│   ├── store.ts             # 状态持久化（凭证、游标、token、配置）
│   ├── vendor.d.ts          # 第三方类型声明
│   ├── ilink/
│   │   ├── types.ts         # iLink 协议类型定义
│   │   ├── api.ts           # 5 个 HTTP API 封装
│   │   └── auth.ts          # QR 扫码登录流程
│   └── claude/
│       └── handler.ts       # Claude Agent SDK 调用封装
```

## 设计决策记录

### 决策 1：从 openclaw-weixin 提取而非直接依赖

`@tencent-weixin/openclaw-weixin` 和 OpenClaw 插件 SDK 深度耦合（import 了 `openclaw/plugin-sdk/*` 的大量模块），无法在独立项目中直接使用。

我们的做法：阅读源码，理解协议，用最简代码重新实现核心 API。从 3756 行精简到约 200 行。

### 决策 2：permissionMode: "auto"（从 bypassPermissions 迁移）

Claude Code 正常使用时会在执行工具前询问用户确认。Bot 是无人值守的，没有人可以点"确认"。

最初我们用 `bypassPermissions`（跳过所有检查），后来改为 `auto` 模式：后台分类器在每次 Shell 命令/网络请求前自动判断是否安全，阻止明显危险的操作（force push、`curl | bash`、删除云存储等），同时对正常操作（读写文件、运行测试）无感放行。

`auto` 需要 Team plan + Sonnet/Opus 4.6。不满足条件时仍可退回 `bypassPermissions`。详见 [08-permission-modes.md](08-permission-modes.md)。

### 决策 3：from_user_id 留空

这是我们踩过的坑。原始代码中 `from_user_id: ""` 是刻意的：

- iLink 服务端会自动根据 bot_token 填充发送者身份
- 如果客户端自己填了 bot ID，服务端可能拒绝或产生不可预期行为
- 第一条消息能发，后续的不行 — 就是这个问题

### 决策 4：每条消息生成唯一 client_id

另一个踩过的坑。没有 client_id 时：

- 第一条回复正常送达
- 后续回复服务端可能当作重复消息丢弃

client_id 格式：`wcb-{timestamp}-{random_hex}`，保证全局唯一。
