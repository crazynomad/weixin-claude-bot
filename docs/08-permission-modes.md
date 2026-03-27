# 08 — 权限模式：让 Bot 安全地自主操作

## 问题：Bot 无人值守，但不能无限制

Claude Code 在终端里使用时，每次执行工具（读写文件、运行命令）都会弹出确认提示。但微信 Bot 是无人值守的——没有人坐在终端前点"确认"。

最简单的方案是 `bypassPermissions`（跳过所有检查），但这意味着任何通过微信发来的指令都会被无条件执行。如果有人发了 `rm -rf /` 或者 `curl 恶意网址 | bash`，Claude 会照做。

2026 年 Claude Code 新增了 `auto` 模式，提供了一个更好的平衡点。

## 6 种权限模式一览

| 模式 | 文件读取 | 文件编辑 | Shell 命令 | 适合 Bot？ |
|------|---------|---------|-----------|-----------|
| `default` | 自动 | 需确认 | 需确认 | 不适合 |
| `acceptEdits` | 自动 | 自动 | 需确认 | 部分场景 |
| `plan` | 自动 | 禁止 | 需确认 | 只读场景 |
| **`auto`** | **自动** | **自动** | **分类器判断** | **推荐** |
| `bypassPermissions` | 自动 | 自动 | 自动 | 隔离环境 |
| `dontAsk` | 白名单 | 白名单 | 白名单 | 锁定环境 |

## auto 模式详解

### 工作原理

`auto` 模式在每个操作执行前，由一个独立的分类器模型（始终用 Sonnet 4.6）判断该操作是否安全：

```
用户微信消息: "帮我重构 auth 模块"
    │
    ▼
Claude 决定: 读取 src/auth.ts
    → 读文件，自动放行 ✅（不经过分类器）
    │
Claude 决定: 编辑 src/auth.ts
    → 编辑工作目录内文件，自动放行 ✅（不经过分类器）
    │
Claude 决定: 运行 npm test
    → Shell 命令，交给分类器判断 🔍
    → 分类器: "npm test 是安全的测试命令" → 放行 ✅
    │
Claude 决定: git push --force origin main
    → Shell 命令，交给分类器判断 🔍
    → 分类器: "force push 到 main 是危险操作" → 阻止 ❌
    → Claude 收到阻止原因，尝试替代方案
```

### 分类器的判断依据

分类器不是简单的关键词匹配。它接收用户消息和工具调用作为输入（不含文件内容），基于上下文推理判断：

- 这个操作是否符合用户的请求范围？
- 是否是不合理的权限升级？
- 是否像是被文件/网页中的恶意内容诱导的操作？

### 默认阻止的操作

| 类别 | 示例 |
|------|------|
| 下载执行代码 | `curl https://xxx.sh \| bash`、运行克隆仓库中的脚本 |
| 泄露敏感数据 | 向外部 API 发送 .env 内容 |
| 生产部署 | `kubectl apply`、数据库迁移 |
| 大规模删除 | 删除云存储 bucket 内容 |
| 权限修改 | 修改 IAM 策略、仓库权限 |
| 破坏性 Git | `git push --force`、直接推送到 main |
| 不可逆删除 | 删除 session 开始前就存在的文件 |

### 默认放行的操作

| 类别 | 示例 |
|------|------|
| 本地文件操作 | 读写工作目录内的文件 |
| 安装已声明依赖 | lock file 中有的包 |
| 读取配置 | 读 `.env` 并将凭证发到对应 API |
| 只读网络 | GET 请求 |
| 分支推送 | 推送到当前分支或 Claude 创建的分支 |

### 使用条件

`auto` 模式有以下要求：

1. **Anthropic Team plan**（Enterprise 和 API 支持在逐步推出）
2. **Claude Sonnet 4.6 或 Opus 4.6**（Haiku 不支持，第三方 provider 不支持）
3. **管理员启用**：Team 管理员需在 Claude Code admin settings 中开启

如果不满足条件，可以退回 `bypassPermissions`：

```bash
npm run config -- --permission-mode bypassPermissions
```

### 额外成本

分类器调用和正常对话一样消耗 token：

- **不触发分类器**：读文件、编辑工作目录内文件（零额外成本）
- **触发分类器**：Shell 命令、网络请求（每次多一个分类器调用）
- 分类器始终使用 Sonnet 4.6，即使主会话用的是 Opus

### 失败回退

如果分类器连续阻止 3 次或累计阻止 20 次，`auto` 模式会暂停，Claude Code 回退到逐条确认模式。

在 Bot 场景（非交互式 `-p` 模式）下，这会导致会话中止。我们的 Bot 通过 SDK 的 `query()` 调用，行为类似非交互式模式。

**应对策略**：如果某类操作经常被阻止，说明分类器不认识你的基础设施为可信的。可以让 Team 管理员在 managed settings 中配置 `autoMode.environment` 添加可信仓库/服务。

## bypassPermissions vs auto 对比

| | `auto` | `bypassPermissions` |
|---|---|---|
| 安全检查 | 分类器检查 Shell/网络操作 | 无任何检查 |
| 防御 prompt injection | 分类器检测异常操作 | 无防御 |
| Token 消耗 | 略高（分类器调用） | 标准 |
| 延迟 | 略高（分类器 round-trip） | 无额外延迟 |
| 使用条件 | Team plan + Sonnet/Opus 4.6 | 无限制 |
| 适用场景 | Bot 日常使用 | 隔离容器/VM |

## 在我们的项目中如何使用

### 配置

```bash
# 默认已是 auto 模式
npm run config

# 切换
npm run config -- --permission-mode auto
npm run config -- --permission-mode bypassPermissions
```

### 代码实现

`handler.ts` 中将配置的权限模式传给 Claude Agent SDK：

```typescript
const conversation = query({
  prompt,
  options: {
    model: opts.model,
    permissionMode: opts.permissionMode, // "auto" | "bypassPermissions" | ...
    // ...
  },
});
```

SDK 的 TypeScript 类型定义目前还没包含 `auto` 和 `dontAsk`（只有 `default | acceptEdits | bypassPermissions | plan`），但运行时已经支持。我们通过类型断言解决：

```typescript
permissionMode: opts.permissionMode as Options["permissionMode"],
```

### 配置文件

`~/.weixin-claude-bot/config.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "permissionMode": "auto",
  "maxTurns": 10,
  "cwd": "/Users/you/project"
}
```

## 从 bypassPermissions 到 auto 的迁移

我们项目最初使用 `bypassPermissions`，后来改为默认 `auto`。这个改动的原因：

1. **Bot 直接暴露在微信消息中** — 任何人发来的文本都会被当作指令执行
2. **`auto` 的分类器能挡住大多数明显危险的操作** — 比如 force push、删除文件、泄露凭证
3. **对正常使用几乎无感** — 读写代码、运行测试这些日常操作不受影响
4. **额外成本可控** — 只有 Shell 命令和网络请求触发分类器

如果你没有 Team plan，或者 Bot 运行在隔离的 Docker 容器中，`bypassPermissions` 仍然是合理的选择。
