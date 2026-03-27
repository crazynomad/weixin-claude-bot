# 07 — OpenClaw 微信插件源码深度解析

> 从 3756 行 TypeScript 中逆向学习 iLink 协议的全部细节

## 项目概况

`@tencent-weixin/openclaw-weixin` 是 OpenClaw 框架的微信 Channel 插件。它是目前唯一公开的 iLink 协议完整实现，也是我们 weixin-claude-bot 的技术参考来源。

| 项目 | 值 |
|------|------|
| npm 包 | `@tencent-weixin/openclaw-weixin` |
| 版本 | 2.0.0 |
| 最低 Host 版本 | OpenClaw >= 2026.3.22 |
| 源文件数 | 33 个 TypeScript 文件 |
| 架构模式 | OpenClaw ChannelPlugin 接口 |
| 协议 | iLink Bot HTTP API (long-poll) |

## 源码获取方式

```bash
# 从 npm 下载并解包
npm pack @tencent-weixin/openclaw-weixin
tar -xzf tencent-weixin-openclaw-weixin-*.tgz

# 包结构 (33 个源文件)
package/src/
├── channel.ts              # 插件主入口 (ChannelPlugin 接口)
├── runtime.ts              # 全局运行时单例
├── compat.ts               # 宿主版本兼容检查
├── log-upload.ts           # CLI 子命令 (日志上传/卸载)
├── vendor.d.ts             # 第三方类型声明
├── api/
│   ├── api.ts              # ⭐ HTTP 客户端 (5 个端点)
│   ├── types.ts            # ⭐ 协议类型定义
│   ├── config-cache.ts     # typing_ticket 缓存 (TTL + 退避)
│   └── session-guard.ts    # Session 过期保护 (errcode -14)
├── auth/
│   ├── login-qr.ts         # ⭐ QR 扫码登录流程
│   ├── accounts.ts         # 多账号持久化管理
│   └── pairing.ts          # 用户授权白名单 (文件锁)
├── cdn/
│   ├── aes-ecb.ts          # AES-128-ECB 加解密原语
│   ├── cdn-url.ts          # CDN URL 构建器
│   ├── cdn-upload.ts       # 加密上传 + 重试
│   ├── pic-decrypt.ts      # 下载 + AES 解密
│   └── upload.ts           # 完整上传管线
├── config/
│   └── config-schema.ts    # Zod 配置校验
├── media/
│   ├── media-download.ts   # 入站媒体下载分发器
│   ├── silk-transcode.ts   # SILK 语音 → WAV 转码
│   └── mime.ts             # MIME 类型映射
├── messaging/
│   ├── inbound.ts          # ⭐ context_token 管理 + 消息转换
│   ├── send.ts             # ⭐ 出站文本消息
│   ├── send-media.ts       # 出站媒体消息路由
│   ├── process-message.ts  # ⭐ 入站消息处理管线
│   ├── slash-commands.ts   # /echo, /toggle-debug
│   ├── error-notice.ts     # 错误通知 (fire-and-forget)
│   └── debug-mode.ts       # 调试模式开关 (磁盘持久化)
├── storage/
│   ├── state-dir.ts        # ~/.openclaw 状态目录
│   └── sync-buf.ts         # getUpdates 游标持久化
└── util/
    ├── logger.ts           # JSON-line 文件日志
    ├── random.ts           # ID/文件名生成
    └── redact.ts           # 日志脱敏
```

## 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OpenClaw 框架 (Host)                            │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐      │
│  │ Agent 路由 │  │ 会话管理    │  │ 权限控制    │  │ 多 Channel 网关│      │
│  └─────┬─────┘  └──────┬─────┘  └──────┬─────┘  └───────┬───────┘      │
│        └───────────────┼───────────────┼─────────────────┘              │
│                        ▼               ▼                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                openclaw-weixin 插件 (channel.ts)                  │   │
│  │                                                                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐       │   │
│  │  │ 认证模块  │  │ 消息处理  │  │ CDN 媒体  │  │ 状态持久化  │       │   │
│  │  │ auth/    │  │messaging/│  │  cdn/     │  │ storage/   │       │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘       │   │
│  │       └──────────────┼────────────┼───────────────┘              │   │
│  │                      ▼            ▼                              │   │
│  │              ┌──────────────────────────────┐                    │   │
│  │              │    api/api.ts (HTTP 客户端)    │                    │   │
│  │              │    5 个 iLink 端点统一封装      │                    │   │
│  │              └────────────┬─────────────────┘                    │   │
│  └──────────────────────────┼───────────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────────┘
                              │ HTTPS POST (JSON)
                              ▼
                ┌──────────────────────────┐      ┌──────────────────────┐
                │  ilinkai.weixin.qq.com   │      │ novac2c.cdn.weixin   │
                │   (iLink Bot API 服务)    │      │  .qq.com (CDN 存储)  │
                └──────────────────────────┘      └──────────────────────┘
```

## 模块依赖关系

```
channel.ts ─────────────────────────────── 插件主入口 (ChannelPlugin 接口)
    │
    ├── auth/
    │   ├── login-qr.ts ◄──── api/api.ts     QR 登录流程 (两步: 获取 → 轮询)
    │   ├── accounts.ts ◄──── storage/        账号持久化 (支持多账号)
    │   └── pairing.ts                        用户授权白名单 (文件锁保护)
    │
    ├── monitor/
    │   └── monitor.ts ◄──── api/api.ts       Long-poll 主循环 (无限运行)
    │        │
    │        └── messaging/
    │            ├── process-message.ts        消息处理管线 (7 步)
    │            │   ├── inbound.ts            入站消息转换 + context_token
    │            │   ├── slash-commands.ts     /echo /toggle-debug
    │            │   ├── debug-mode.ts         调试模式
    │            │   └── error-notice.ts       错误通知
    │            │
    │            ├── send.ts ◄──── api/api.ts  出站文本消息
    │            └── send-media.ts             出站媒体消息 (按 MIME 路由)
    │                └── cdn/
    │                    ├── upload.ts         上传管线 (文件→hash→加密→CDN)
    │                    │   ├── cdn-upload.ts AES 加密 + CDN POST (3次重试)
    │                    │   └── cdn-url.ts    URL 构建
    │                    ├── pic-decrypt.ts    下载 + AES 解密
    │                    └── aes-ecb.ts        AES-128-ECB 基础设施
    │
    ├── media/
    │   ├── media-download.ts                 入站媒体下载 (按类型分发)
    │   ├── silk-transcode.ts                 SILK → WAV 转码 (silk-wasm)
    │   └── mime.ts                           MIME ↔ 扩展名映射
    │
    ├── api/
    │   ├── api.ts                            HTTP 客户端 (所有请求的入口)
    │   ├── types.ts                          完整协议类型定义
    │   ├── config-cache.ts                   getConfig 缓存 (随机 24h TTL)
    │   └── session-guard.ts                  errcode -14 保护 (暂停 1h)
    │
    └── config/
        └── config-schema.ts                  Zod 配置校验 Schema
```

## 核心时序图

### 时序图 1：QR 扫码登录

```
  用户(手机微信)      终端(CLI)         login-qr.ts        iLink 服务器
       │                │                   │                   │
       │                │  startLogin()     │                   │
       │                │──────────────────►│                   │
       │                │                   │                   │
       │                │                   │  POST /get_bot_qrcode
       │                │                   │  { bot_type: "3" }│
       │                │                   │──────────────────►│
       │                │                   │                   │
       │                │                   │  { qrcode_url,    │
       │                │                   │◄───uuid, ticket } │
       │                │                   │                   │
       │                │  终端显示二维码     │                   │
       │                │◄──────────────────│                   │
       │                │  ┌──────────┐     │                   │
       │                │  │ ██ ██ ██ │     │                   │
       │                │  │ ██    ██ │     │                   │
       │                │  │ ██ ██ ██ │     │                   │
       │                │  └──────────┘     │                   │
       │                │                   │                   │
       │   扫码          │                   │                   │
       │───────────────►│                   │                   │
       │                │                   │                   │
       │                │  waitForLogin()   │                   │
       │                │──────────────────►│                   │
       │                │                   │                   │
       │                │          ┌────────┤  长轮询循环         │
       │                │          │ 最多    │  (总超时 480s)     │
       │                │          │ 480s   │                   │
       │                │          │        │  POST /get_qrcode_status
       │                │          │        │  { uuid, ticket } │
       │                │          │        │──────────────────►│
       │                │          │        │                   │
       │                │          │        │  status: "wait"   │
       │                │          │        │◄──────────────────│
       │                │          │        │        ...        │
       │                │          │        │──────────────────►│
       │                │          │        │  status: "scanned"│
       │                │          │        │◄──────────────────│
       │                │          │        │                   │
       │  确认登录       │          │        │                   │
       │───────────────►│          │        │                   │
       │                │          │        │──────────────────►│
       │                │          │        │                   │
       │                │          │        │  status:"confirmed"
       │                │          │        │◄─{ bot_token,     │
       │                │          │        │    account_id,    │
       │                │          └────────┤    base_url,      │
       │                │                   │    user_id }      │
       │                │                   │                   │
       │                │  凭证已保存 ✅     │                   │
       │                │◄──────────────────│                   │
       │                │                   │                   │

状态机:  wait ──► scanned ──► confirmed
           │                      ✅ 成功
           └──► expired ──► 刷新 QR (最多 3 次)
```

### 时序图 2：消息收发完整生命周期

```
  微信用户         iLink 服务器        monitor.ts       process-message.ts      AI Agent
    │                  │                  │                    │                   │
    │  发送消息         │                  │                    │                   │
    │─────────────────►│                  │                    │                   │
    │                  │                  │                    │                   │
    │                  │  POST getupdates │                    │                   │
    │                  │◄─────────────────│                    │                   │
    │                  │  (long-poll 35s) │                    │                   │
    │                  │                  │                    │                   │
    │                  │  { msgs: [...],  │                    │                   │
    │                  │   get_updates_buf}│                    │                   │
    │                  │─────────────────►│                    │                   │
    │                  │                  │                    │                   │
    │                  │                  │ ① 保存游标          │                   │
    │                  │                  │    (断点续传)       │                   │
    │                  │                  │                    │                   │
    │                  │                  │ processOneMessage()│                   │
    │                  │                  │───────────────────►│                   │
    │                  │                  │                    │                   │
    │                  │                  │           ┌────────┤                   │
    │                  │                  │           │  7 步管线                    │
    │                  │                  │           │        │                   │
    │                  │                  │           │ ② Slash 命令检查             │
    │                  │                  │           │   /echo? → 直接回复          │
    │                  │                  │           │   /toggle-debug?            │
    │                  │                  │           │        │                   │
    │                  │                  │           │ ③ 媒体下载                   │
    │                  │                  │           │   图片/语音/视频/文件         │
    │                  │                  │           │   CDN下载→AES解密            │
    │                  │                  │           │   SILK→WAV 转码             │
    │                  │                  │           │        │                   │
    │                  │                  │           │ ④ 消息格式转换                │
    │                  │                  │           │   WeixinMessage→MsgContext  │
    │                  │                  │           │        │                   │
    │                  │                  │           │ ⑤ 权限检查                   │
    │                  │                  │           │   allowFrom 白名单          │
    │                  │                  │           │        │                   │
    │                  │                  │           │ ⑥ 缓存 context_token        │
    │                  │                  │           │   (回复时必须携带)            │
    │                  │                  │           │        │                   │
    │                  │                  │           │ ⑦ 路由到 Agent               │
    │                  │                  │           └────────┤                   │
    │                  │                  │                    │  dispatch         │
    │                  │                  │                    │──────────────────►│
    │                  │                  │                    │                   │
    │                  │ POST sendtyping  │                    │  typing 回调       │
    │                  │◄────────────────────────────────────────(每 5s 保活)       │
    │  "正在输入..."    │                  │                    │                   │
    │◄─────────────────│                  │                    │                   │
    │                  │                  │                    │                   │
    │                  │                  │                    │  AI 思考 + 执行... │
    │                  │                  │                    │                   │
    │                  │                  │                    │  回复文本          │
    │                  │                  │                    │◄─────────────────│
    │                  │                  │                    │                   │
    │                  │                  │           ┌────────┤ 回复处理           │
    │                  │                  │           │        │                   │
    │                  │                  │           │ Markdown → 纯文本           │
    │                  │                  │           │ 长文本 → 分段 (≤4000字)      │
    │                  │                  │           │ 生成唯一 client_id           │
    │                  │                  │           │ from_user_id: ""            │
    │                  │                  │           └────────┤                   │
    │                  │                  │                    │                   │
    │                  │  POST sendmessage│                    │                   │
    │                  │◄────────────────────────────────────────                   │
    │  收到回复         │                  │                    │                   │
    │◄─────────────────│                  │                    │                   │
    │                  │                  │                    │                   │
```

### 时序图 3：CDN 媒体加密上传

```
  Bot 进程                          iLink API                CDN 服务器
    │                                  │           (novac2c.cdn.weixin.qq.com)
    │                                  │                        │
    │  读取本地文件                      │                        │
    │  ┌───────────────────────┐       │                        │
    │  │ 1. 计算文件 MD5 hash   │       │                        │
    │  │ 2. 生成随机 AES-128 key│       │                        │
    │  │ 3. 生成随机 filekey    │       │                        │
    │  └───────────────────────┘       │                        │
    │                                  │                        │
    │  POST /getuploadurl              │                        │
    │  { md5, file_key,                │                        │
    │    media_type, file_size }       │                        │
    │─────────────────────────────────►│                        │
    │                                  │                        │
    │  { encrypted_query_param }       │                        │
    │◄─────────────────────────────────│                        │
    │                                  │                        │
    │  ┌──────────────────────────┐    │                        │
    │  │ AES-128-ECB 加密          │    │                        │
    │  │ ┌────────────────────┐   │    │                        │
    │  │ │ 原始数据 (N 字节)    │   │    │                        │
    │  │ │       ▼             │   │    │                        │
    │  │ │ PKCS7 Padding      │   │    │                        │
    │  │ │ (补齐到 16 的倍数)   │   │    │                        │
    │  │ │       ▼             │   │    │                        │
    │  │ │ ECB 模式逐块加密    │   │    │                        │
    │  │ │ (每 16 字节独立)     │   │    │                        │
    │  │ └────────────────────┘   │    │                        │
    │  └──────────────────────────┘    │                        │
    │                                  │                        │
    │  POST /upload?encrypted_query_param&filekey               │
    │  Content-Type: application/octet-stream                   │
    │  Body: [加密后的二进制数据]         │                        │
    │──────────────────────────────────────────────────────────►│
    │                                  │                        │
    │  Header: x-encrypted-param       │     200 OK             │
    │◄──────────────────────────────────────────────────────────│
    │                                  │                        │
    │  构建消息 item:                    │                        │
    │  { media: {                      │                        │
    │      encrypt_query_param,        │                        │
    │      aes_key,                    │                        │
    │      filekey                     │                        │
    │  }}                              │                        │
    │                                  │                        │
    │  POST /sendmessage               │                        │
    │  (携带 CDN 引用)                  │                        │
    │─────────────────────────────────►│                        │
    │                                  │                        │
```

### 时序图 4：CDN 媒体解密下载

```
  Bot 进程                                CDN 服务器
    │                                        │
    │  从入站消息中提取:                        │
    │  ┌─────────────────────────────┐       │
    │  │ encrypt_query_param          │       │
    │  │ aes_key (⚠️ 两种编码)        │       │
    │  └─────────────────────────────┘       │
    │                                        │
    │  GET /download?encrypted_query_param   │
    │───────────────────────────────────────►│
    │                                        │
    │  [加密的二进制数据]                       │
    │◄───────────────────────────────────────│
    │                                        │
    │  ┌─────────────────────────────────┐   │
    │  │ 解析 AES Key                     │   │
    │  │                                 │   │
    │  │ base64 解码 → 得到 buffer        │   │
    │  │   ├─ length == 16 字节?         │   │
    │  │   │  └─ 格式 A: 直接用           │   │
    │  │   └─ length > 16?               │   │
    │  │      └─ 格式 B: hex 解码后再用    │   │
    │  │                                 │   │
    │  │ AES-128-ECB 解密                 │   │
    │  │ 去除 PKCS7 Padding               │   │
    │  └─────────────────────────────────┘   │
    │                                        │
    │  保存解密后的文件                         │
    │  (图片/语音/视频/文件)                    │
    │                                        │
```

## 协议类型体系

```
WeixinMessage ─── 一条完整的微信消息
│
├── message_id            唯一消息 ID (服务端生成)
├── from_user_id          发送者
│                           入站: 用户 ID
│                           出站: "" (必须留空, 服务端自动填充)
├── to_user_id            接收者
├── client_id             客户端唯一 ID (防重复投递, 格式: prefix-timestamp-hex)
├── session_id            会话 ID
├── group_id              群聊 ID (如有)
├── message_type          USER = 1 (用户发的)
│                         BOT  = 2 (Bot 发的)
├── message_state         NEW       = 0 (新消息)
│                         GENERATING = 1 (流式生成中)
│                         FINISH     = 2 (完成)
├── context_token         会话令牌 ⚠️ 关键
│                           每条消息都不同
│                           必须缓存, 回复时必须回传
│                           是消息能否送达的关键
├── ref_msg               引用消息 (回复场景)
│   └── WeixinMessage       递归结构
│
└── item_list[]           消息内容列表
    │                       一条消息可包含多个元素
    │
    └── MessageItem
        ├── type              类型标识
        │
        ├── TEXT = 1 ──────── text_item
        │                     └── text: string
        │
        ├── IMAGE = 2 ─────── image_item
        │                     ├── media: CDNMedia
        │                     └── aeskey?: string (hex, 优先于 media.aes_key)
        │
        ├── VOICE = 3 ─────── voice_item
        │                     ├── media: CDNMedia
        │                     ├── voice_length: number (毫秒)
        │                     └── voice_text?: string (ASR 转写)
        │
        ├── FILE = 4 ──────── file_item
        │                     ├── media: CDNMedia
        │                     ├── file_name: string
        │                     └── file_size: number
        │
        └── VIDEO = 5 ─────── video_item
                              ├── media: CDNMedia
                              └── duration: number


CDNMedia ─── CDN 媒体引用
├── encrypt_query_param     加密的查询参数 (用于构建 CDN URL)
├── aes_key                 AES-128-ECB 密钥 (base64 编码)
└── filekey                 文件标识符
```

## 五个 iLink API 端点详解

### 统一请求格式

```
POST https://ilinkai.weixin.qq.com/ilink/bot/{endpoint}

Headers:
  Authorization: Bearer {bot_token}      ← 登录时获取
  AuthorizationType: ilink_bot_token     ← 固定值
  X-WECHAT-UIN: {随机数字}               ← 不是真实 UIN, 是协议兼容字段
  Content-Type: application/json
```

### 端点 1：getupdates — 拉取新消息 (long-poll)

```
请求:                              响应:
{                                  {
  "get_updates_buf": "...",          "msgs": [
  "timeout": 35                        { WeixinMessage },
}                                      { WeixinMessage },
                                       ...
get_updates_buf:                     ],
  ""        → 从头拉取               "get_updates_buf": "新游标",
  "上次的值" → 增量拉取               "errcode": 0,
  相当于消息的 "书签"                  "errmsg": "ok"
                                   }
超时行为:
  ┌─────────────────────────────────────────┐
  │ 35s 内有新消息  → 立即返回 msgs          │
  │ 35s 无消息      → 返回空 msgs, 正常      │
  │ 客户端 AbortError → 静默处理, 重新轮询    │
  │ errcode: -14    → Session 过期, 暂停 1h  │
  └─────────────────────────────────────────┘
```

### 端点 2：sendmessage — 发送消息

```
请求:                              响应:
{                                  {
  "to_user_id": "用户ID",            "errcode": 0,
  "from_user_id": "",                "errmsg": "ok"
  "client_id": "wcb-xxx-xxx",     }
  "message_type": 2,
  "message_state": 2,             ⚠️ 三个必踩的坑:
  "context_token": "...",
  "item_list": [                   ① from_user_id 必须为 ""
    {                                填了 bot ID → 第一条能发
      "type": 1,                     后续全部失败
      "text_item": {
        "text": "回复内容"           ② client_id 必须唯一
      }                              缺失 → 服务端去重丢弃
    }
  ]                                ③ context_token 必须是最新的
}                                    不匹配 → 消息无法送达
```

### 端点 3：getconfig — 获取配置

```
请求:                              响应:
{                                  {
  "context_token": "用户的token"     "typing_ticket": "...",
}                                    "errcode": 0
                                   }
用途: 获取 typing_ticket
原始实现: 24h TTL 缓存 + 失败指数退避 (2s → 4s → 8s → ... → 1h)
我们的实现: 每次请求, 不缓存 (简单优先)
```

### 端点 4：sendtyping — 发送输入状态

```
请求:                              响应:
{                                  {
  "to_user_id": "用户ID",            "errcode": 0
  "typing_status": 1,              }
  "typing_ticket": "..."
}

typing_status:
  1 = TYPING   "正在输入..."
  2 = CANCEL   取消输入状态

原始实现: 每 5 秒发送一次保活
```

### 端点 5：getuploadurl — 获取媒体上传地址

```
请求:                              响应:
{                                  {
  "md5": "文件MD5",                  "encrypted_query_param": "...",
  "file_key": "随机filekey",         "errcode": 0
  "media_type": 1,                 }
  "file_size": 12345
}                                  media_type 枚举:
                                     1 = IMAGE
CDN 上传地址:                         2 = VIDEO
  novac2c.cdn.weixin.qq.com          3 = FILE
                                     4 = VOICE
```

## Session 保护机制

```
     正常运行                  errcode -14             恢复
       │                          │                     │
  ┌────┴────┐                     │                     │
  │ API 调用 │ ──── 正常响应 ────► │                     │
  │ 正常工作 │                     │                     │
  └────┬────┘                     │                     │
       │                          │                     │
       │  收到 errcode: -14       │                     │
       │─────────────────────────►│                     │
       │                          │                     │
       │                   ┌──────┤                     │
       │                   │ 暂停  │                     │
       │                   │ 所有  │  1 小时冷却期        │
       │                   │ API  │                     │
       │                   │      │  isSessionPaused()  │
       │                   │      │  → true             │
       │                   │      │                     │
       │                   │      │  assertSessionActive()
       │                   │      │  → throw Error      │
       │                   │      │                     │
       │                   │      │  所有出站消息被拦截    │
       │                   │      │  monitor 循环暂停    │
       │                   │      │                     │
       │                   │      │  1 小时后...         │
       │                   └──────┤                     │
       │                          │────────────────────►│
       │                          │                     │
       │◄──────────────────────────────── 恢复正常 ──────│
       │                          │                     │

触发原因: Token 过期 / 账号被踢 / 服务端维护
解决方案: 重新扫码登录
```

## 多账号架构

```
~/.openclaw/openclaw-weixin/
│
├── accounts.json ──────── 账号索引 (数组)
│   ["abc123@im.bot", "def456@im.bot"]
│
├── accounts/
│   ├── abc123@im.bot.json ── 账号 A 凭证
│   │   { botToken, baseUrl, userId }
│   │
│   └── def456@im.bot.json ── 账号 B 凭证
│       { botToken, baseUrl, userId }
│
├── context-tokens-abc123.json ── 账号 A 会话令牌
│   { "user_001": "token_a1", "user_002": "token_a2" }
│
├── context-tokens-def456.json ── 账号 B 会话令牌
│   { "user_001": "token_b1", "user_003": "token_b3" }
│
├── debug-mode.json ── 调试模式
│   { "abc123@im.bot": true }
│
└── credentials/
    ├── openclaw-weixin-abc123-allowFrom.json ── 白名单
    └── openclaw-weixin-def456-allowFrom.json


出站消息路由逻辑:
┌──────────────────────────────────────────────────────┐
│  resolveOutboundAccountId(recipientId)               │
│                                                      │
│  accounts.length == 1?                               │
│  ├── YES → 直接使用唯一账号                            │
│  └── NO  → 遍历所有账号的 context-tokens              │
│            找到包含 recipientId 的那个账号              │
│            ├── 找到 → 使用该账号发送                   │
│            └── 没找到 → 抛出错误                      │
└──────────────────────────────────────────────────────┘
```

## AES-128-ECB 加密方案详解

```
  ┌─────────── 加密 (上传) ──────────┐     ┌─────────── 解密 (下载) ──────────┐
  │                                  │     │                                  │
  │  原始文件                         │     │  CDN 返回的密文                   │
  │  ┌──────────────────────────┐    │     │  ┌──────────────────────────┐    │
  │  │ 文件数据 (N 字节)          │    │     │  │ 加密数据 (M 字节)          │    │
  │  └────────────┬─────────────┘    │     │  └────────────┬─────────────┘    │
  │               ▼                  │     │               ▼                  │
  │  ┌──────────────────────────┐    │     │  ┌──────────────────────────┐    │
  │  │ PKCS7 Padding            │    │     │  │ 解析 AES Key             │    │
  │  │                          │    │     │  │                          │    │
  │  │ 补齐到 16 的整数倍         │    │     │  │ base64 解码 aes_key 字段  │    │
  │  │ padding = 16-(N%16)      │    │     │  │   │                      │    │
  │  │ 例: N=100 → 补 12 个 0x0C│    │     │  │   ├─ 16字节? → 直接使用   │    │
  │  └────────────┬─────────────┘    │     │  │   │   (格式 A)            │    │
  │               ▼                  │     │  │   └─ >16字节?             │    │
  │  ┌──────────────────────────┐    │     │  │       → hex解码后使用      │    │
  │  │ AES-128-ECB              │    │     │  │       (格式 B)            │    │
  │  │                          │    │     │  └────────────┬─────────────┘    │
  │  │ Key: 随机 16 字节         │    │     │               ▼                  │
  │  │ 模式: ECB                │    │     │  ┌──────────────────────────┐    │
  │  │  每 16 字节独立加密       │    │     │  │ AES-128-ECB 解密          │    │
  │  │  无 IV (ECB 特性)        │    │     │  │ + 去除 PKCS7 Padding      │    │
  │  └────────────┬─────────────┘    │     │  └────────────┬─────────────┘    │
  │               ▼                  │     │               ▼                  │
  │  密文 → POST 到 CDN             │     │  原始文件 → 保存到本地            │
  │                                  │     │                                  │
  └──────────────────────────────────┘     └──────────────────────────────────┘
```

## 我们 vs 原始实现：精简对照

| 模块 | openclaw-weixin | weixin-claude-bot | 精简策略 |
|------|----------------|-------------------|---------|
| API 客户端 | `api/api.ts` (~200行) | `ilink/api.ts` (~120行) | 去掉日志、route tag、重试 |
| 协议类型 | `api/types.ts` (~180行) | `ilink/types.ts` (~80行) | 只保留文本消息类型 |
| QR 登录 | `auth/login-qr.ts` (~200行) | `ilink/auth.ts` (~120行) | 逻辑一致, 去掉框架耦合 |
| 消息收发 | `messaging/*.ts` (~600行) | `src/index.ts` (~150行) | 去掉媒体/路由/权限/slash |
| CDN 媒体 | `cdn/*.ts` (~400行) | *未实现* | 纯文本 Bot 不需要 |
| 媒体处理 | `media/*.ts` (~300行) | *未实现* | 同上 |
| 多账号 | `auth/accounts.ts` (~350行) | — | 单账号 |
| Session 保护 | `session-guard.ts` (~60行) | — | 简单重启 |
| 配置缓存 | `config-cache.ts` (~80行) | — | 每次请求 |
| 存储层 | `storage/*.ts` (~200行) | `store.ts` (~80行) | 单文件简化 |
| 插件集成 | `channel.ts` + `runtime.ts` (~600行) | — | 不需要框架 |
| 工具模块 | `util/*.ts` (~200行) | — | 内联或不需要 |
| **合计** | **~3756 行** | **~550 行** | **精简 85%** |

**精简原则：**
1. **不需要的功能直接砍掉** — CDN 媒体、多账号、调试模式、日志上传、SILK 转码
2. **框架耦合的代码重写** — OpenClaw ChannelPlugin SDK 的 import 全部替换为独立实现
3. **保留核心协议逻辑** — 5 个 API 端点、消息格式、认证流程、关键 edge case 一个不少

## 从源码中发现的未文档化行为

这些行为没有任何官方文档，完全是从阅读 3756 行源码中逆向发现的：

| # | 发现 | 来源文件 | 踩坑后果 |
|---|------|---------|---------|
| 1 | `from_user_id` 必须为空字符串 | `messaging/send.ts` | 填了 bot ID → 第一条能发, 后续全部失败 |
| 2 | 每条消息必须有唯一 `client_id` | `messaging/send.ts` | 缺失 → 服务端去重导致消息丢失 |
| 3 | `context_token` 每条消息都不同 | `messaging/inbound.ts` | 必须缓存最新的, 回复时使用旧的会失败 |
| 4 | AES key 有两种编码格式 | `cdn/pic-decrypt.ts` | 用错格式 → 解密出乱码 |
| 5 | `errcode: -14` = session 过期 | `api/session-guard.ts` | 不处理 → 无限失败循环 |
| 6 | `X-WECHAT-UIN` 用随机数即可 | `api/api.ts` | 不是真实 UIN, 是协议兼容字段 |
| 7 | Long-poll AbortError 不是错误 | `api/api.ts` | 当错误处理 → 触发重连风暴 |
| 8 | 语音消息是 SILK 格式 | `media/silk-transcode.ts` | 需要 silk-wasm 才能转为通用音频 |

## OpenClaw 的完整架构（供参考）

```
                      ┌───────────────────────────────────┐
                      │         外部 IM 平台               │
                      │                                   │
                      │  WeChat  Telegram  Discord  LINE  │
                      │  Slack   WhatsApp  ...82个扩展     │
                      └─────────┬─────────────────────────┘
                                │ webhook / long-poll
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                        OpenClaw 框架                               │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Gateway 层 — 控制面                                       │   │
│  │  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌─────────┐  │   │
│  │  │ Channel  │ │ 权限控制      │ │ 消息路由   │ │ 会话管理 │  │   │
│  │  │ Plugin   │ │ (allowFrom)  │ │ (routing) │ │(session)│  │   │
│  │  │ 注册中心  │ │              │ │           │ │         │  │   │
│  │  └──────────┘ └──────────────┘ └─────┬─────┘ └─────────┘  │   │
│  └──────────────────────────────────────┼─────────────────────┘   │
│                                         │                         │
│  ┌──────────────────────────────────────┼─────────────────────┐   │
│  │  Agent 层 — 执行面                    │                     │   │
│  │                                      ▼                     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │   │
│  │  │ Claude   │  │ GPT-4    │  │ Gemini   │  ... N 个 Agent  │   │
│  │  │ Agent    │  │ Agent    │  │ Agent    │                  │   │
│  │  └──────────┘  └──────────┘  └──────────┘                 │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Provider 层 — LLM 接口                                    │   │
│  │  Anthropic / OpenAI / Google / Azure / Local / ...         │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘

我们的 weixin-claude-bot 实现了其中最核心的一条通路:

  WeChat ──► iLink API ──► Claude Agent SDK ──► 本地文件系统 ──► 回复

不需要 Gateway 层 (单用户), 不需要 Provider 层 (只用 Claude Agent SDK).
```
