# 05 — 踩坑记录：那些文档里不会告诉你的事

## 坑 1：from_user_id 不能填 Bot ID

### 现象
第一条消息能正常收到回复，后续消息进程日志显示已发送，但微信上收不到。

### 原因
我们最初在 `sendMessage` 时设置了 `from_user_id: botId`（Bot 的 account ID）。但 iLink 的设计是：

```typescript
// ❌ 错误
msg: {
  from_user_id: "df412faf283b@im.bot",  // 不要填！
  to_user_id: "xxx@im.wechat",
  ...
}

// ✅ 正确
msg: {
  from_user_id: "",  // 留空，服务端自动填充
  to_user_id: "xxx@im.wechat",
  ...
}
```

iLink 服务端会根据 `Authorization` 头中的 bot_token 自动识别发送者。客户端填了 `from_user_id` 反而导致服务端行为异常。

### 如何发现的
对比 `@tencent-weixin/openclaw-weixin` 包的 `send.ts` 源码：

```typescript
// 原始实现（openclaw-weixin/src/messaging/send.ts）
function buildTextMessageReq(params) {
  return {
    msg: {
      from_user_id: "",  // ← 这里是空字符串
      to_user_id: to,
      client_id: clientId,
      ...
    }
  };
}
```

### 教训
没有文档的 API，读源码是唯一可靠的参考。而且要注意那些看似"不重要"的细节（谁会想到一个空字符串是刻意的设计？）。

---

## 坑 2：缺少 client_id 导致消息被丢弃

### 现象
和坑 1 一样的表现：第一条回复正常，后续回复无声无息地消失。

### 原因
每条发送的消息需要一个唯一的 `client_id`。没有它，服务端可能将后续消息视为第一条消息的重复，直接丢弃。

### 修复

```typescript
import crypto from "node:crypto";

function generateClientId(): string {
  return `wcb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

// 每条消息都生成新的 client_id
const msg = {
  client_id: generateClientId(),
  ...
};
```

### 教训
即时通讯协议中，消息去重是标配功能。`client_id` 就是去重的依据。这在 Telegram Bot API 中也有类似机制（`message_id`），但 Telegram 是服务端生成的，iLink 是客户端生成的。

---

## 坑 3：Claude Agent SDK 的导出名不叫 "claude"

### 现象
```
error TS2305: Module '"@anthropic-ai/claude-agent-sdk"' has no exported member 'claude'.
```

### 原因
很多教程和示例会写：
```typescript
// ❌ 错误 — 没有这个导出
import { claude } from "@anthropic-ai/claude-agent-sdk";
```

实际导出是：
```typescript
// ✅ 正确
import { query } from "@anthropic-ai/claude-agent-sdk";
```

SDK 一共只导出 3 个东西：`query`、`tool`、`createSdkMcpServer`。

### 如何发现的
```bash
node -e "const m = require('@anthropic-ai/claude-agent-sdk'); console.log(Object.keys(m))"
# 输出: query, tool, createSdkMcpServer
```

### 教训
不确定 API 的时候，直接检查模块导出。对于 TypeScript 项目，读 `.d.ts` 声明文件是最可靠的。

---

## 坑 4：query() 返回 AsyncGenerator 而非 Promise

### 现象
如果你把 `query()` 当作返回 `Promise<string>` 来用，什么也得不到。

### 正确用法
```typescript
// ❌ 这样不行
const result = await query({ prompt: "hello" });
console.log(result); // 不是你想要的

// ✅ 需要遍历 async generator
const conversation = query({ prompt: "hello" });
for await (const message of conversation) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result); // 这才是最终结果
  }
}
```

### 教训
Claude Agent SDK 设计为流式输出（因为 agentic 执行可能很长），所以用了 AsyncGenerator。如果只需要最终结果，仍然需要遍历完整个 generator。

---

## 坑 5：context_token 必须持久化

### 现象
Bot 重启后，收到新消息但无法回复（服务端拒绝）。

### 原因
每条入站消息的 `context_token` 是回复这条消息所必需的。如果 Bot 重启丢失了内存中的 token，就无法回复。

### 修复
将 context_token 持久化到磁盘：

```typescript
// 收到消息时保存
if (msg.context_token) {
  setContextToken(fromUser, msg.context_token);
  // → 写入 ~/.weixin-claude-bot/context-tokens.json
}

// 回复时读取
const contextToken = msg.context_token || getContextToken(fromUser);
```

### 教训
任何需要跨请求/跨重启保持的状态，都必须持久化。内存缓存只是加速手段，不能作为唯一存储。

---

## 坑 6：微信不支持 Markdown 渲染

### 现象
Claude 回复的内容包含 `**加粗**`、`` `代码` ``、`### 标题` 等 Markdown 语法，在微信中显示为原始文本，很不美观。

### 缓解方案

1. **通过 systemPrompt 限制**：
   ```bash
   npm run config -- --system-prompt "用纯文本格式回复，不要使用 Markdown 语法"
   ```

2. **后处理转换**（openclaw-weixin 的做法）：
   ```typescript
   // 移除 Markdown 语法，保留内容
   text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim());
   text = text.replace(/\*\*(.*?)\*\*/g, "$1");
   text = text.replace(/`([^`]+)`/g, "$1");
   ```

### 教训
不同平台的消息格式能力差异很大。Telegram 支持 Markdown，Discord 支持 Markdown，但微信只支持纯文本。在跨平台 Bot 开发中，消息格式化是一个需要认真处理的问题。

---

## 坑 7：qrcode-terminal 没有类型声明

### 现象
```
error TS7016: Could not find a declaration file for module 'qrcode-terminal'.
```

### 修复
创建 `src/vendor.d.ts`：

```typescript
declare module "qrcode-terminal" {
  const qrcode: {
    generate(text: string, opts?: { small?: boolean }): void;
  };
  export default qrcode;
}
```

### 教训
很多 npm 包（特别是老的、小的包）没有 TypeScript 类型声明。解决方式有三种：
1. 安装 `@types/xxx`（如果有的话）
2. 写一个最小的 `.d.ts` 声明文件（推荐）
3. 在 tsconfig 中设置 `"skipLibCheck": true`（治标不治本）
