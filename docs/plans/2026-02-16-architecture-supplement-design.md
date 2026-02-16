# Toonflow-app 架构补充文档

> 补充原架构分析文档 | 内部开发参考 | 2026-02-16

---

## 目录

1. [缺失分析](#1-缺失分析)
2. [功能扩展性改进方案](#2-功能扩展性改进方案)
3. [内部开发指南](#3-内部开发指南)

---

## 1. 缺失分析

原架构文档 `2026-02-16-architecture-analysis-design.md` 已涵盖技术分层、数据模型、业务流水线、AI Provider、工具函数、路由接口、Agent 系统等 15 个章节。以下补充原文档未覆盖的关键维度。

### 1.1 安全风险点

| 风险 | 位置 | 现状 | 影响 |
|------|------|------|------|
| 明文密码 | `src/lib/initDB.ts` → `t_user` | `password: "admin123"` 直接存储 | 数据泄露即可登录 |
| CORS 全开 | `src/app.ts` → `cors()` | 无 origin 限制，允许所有来源 | 跨站请求伪造 |
| JWT 密钥过短 | `t_setting.tokenKey` | `uuid().slice(0,8)` 仅 8 字符 | 暴力破解风险 |
| 无速率限制 | `src/app.ts` | JSON body 100MB + 无请求频率限制 | DoS 攻击风险 |
| 危险接口无权限 | `/other/clearDatabase`, `/other/deleteAllData` | 仅 JWT 认证，无角色检查 | 任意用户可清空数据 |
| API Key 明文存储 | `t_config.apiKey` | 数据库明文 | 数据泄露即暴露所有 Key |

### 1.2 错误处理策略地图

```
┌─────────────────────────────────────────────────┐
│              全局异常层 (err.ts)                  │
│  unhandledRejection / uncaughtException          │
│  → console 输出 + serialize-error                │
│  → 无告警、无重启策略                             │
├─────────────────────────────────────────────────┤
│              Express 错误中间件                    │
│  404 → error("接口不存在")                        │
│  全局 catch → error("系统异常")                   │
│  → 统一 {code, data, message} 响应               │
├─────────────────────────────────────────────────┤
│              路由级                               │
│  Zod 校验失败 → 400 + 字段级错误                  │
│  业务 try-catch → error(message) 或 抛出          │
├─────────────────────────────────────────────────┤
│              Agent 级                             │
│  AI 调用失败 → emit("error") → WS 推送            │
│  工具执行失败 → 返回错误文本给 AI 重试             │
│  无结构化重试机制                                  │
├─────────────────────────────────────────────────┤
│              AI Provider 级                       │
│  视频生成: 异步 try-catch → state=-1 + errorReason │
│  图片生成: 同步 try-catch → 返回空或错误           │
│  轮询: 500次 x 2s = ~16分钟硬超时，无指数退避      │
└─────────────────────────────────────────────────┘
```

**关键缺失:**
- 无结构化重试机制（指数退避、最大重试次数）
- 无任务级错误通知（仅 DB 状态标记，无 Push/Webhook）
- 无错误聚合与监控（无 Sentry / 自定义告警）
- Agent 子 Agent 失败时，主 Agent 无感知恢复策略

### 1.3 并发与竞态分析

| 场景 | 风险 | 现状 |
|------|------|------|
| 同一项目多个视频并发生成 | AI API 限流 | 无排队，直接并发调用 |
| 多实例启动时 DB 迁移 | `fixDB` 无版本锁 | 可能重复执行迁移 |
| WebSocket Agent 实例 | per-connection 隔离 | 安全，无共享状态冲突 |
| `shotIdCounter` 内存计数 | 连接断开后重置 | 重新连接时从 0 开始，可能 ID 冲突 |
| `core.ts` 路由生成 | 多进程写同一文件 | MD5 哈希避免重复写入，基本安全 |
| SQLite 写操作 | 单写者锁 | 高并发写入排队，性能瓶颈 |

### 1.4 前后端交互协议

原文档未记录前后端交互的完整协议。补充如下:

**REST API 协议:**
- 统一响应: `{ code: 200|400, data: T, message: string }`
- 认证: `Authorization: Bearer {token}` 或 `?token={token}`
- 白名单: `/other/login` 无需认证

**WebSocket 协议 (Agent 通信):**

客户端 → 服务端:
```typescript
{ type: "msg", data: { type: "user", data: "用户消息" } }
{ type: "cleanHistory" }
{ type: "generateShotImage", data: { shotId } }
{ type: "replaceShot", data: { segmentId, cellId, cell } }
```

服务端 → 客户端:
```typescript
// 文本流
{ type: "stream", data: "token" }
{ type: "response_end", data: "完整回复" }

// 子 Agent 通信
{ type: "subAgentStream", data: { agent, text } }
{ type: "subAgentEnd", data: { agent } }
{ type: "transfer", data: { to: "agentName" } }

// 工具调用
{ type: "toolCall", data: { agent, name, args } }

// 数据更新
{ type: "segmentsUpdated", data: Segment[] }
{ type: "shotsUpdated", data: Shot[] }
{ type: "refresh", data: "type" }

// 图片生成进度
{ type: "shotImageGenerateStart", data: { shotIds } }
{ type: "shotImageGenerateProgress", data: { shotId, status, message, progress? } }
{ type: "shotImageGenerateComplete", data: { shotId, shot, imagePaths } }
{ type: "shotImageGenerateError", data: { shotId, error } }

// 错误
{ type: "error", data: errorInfo }
```

**前端轮询模式 (视频生成):**
```
POST /video/generateVideo → { id: videoId }
  ↓ (轮询)
POST /video/getVideo { scriptId } → 检查 state 字段
  state=0: 生成中 (继续轮询)
  state=1: 成功 (下载 filePath)
  state=-1: 失败 (显示 errorReason)
```

### 1.5 性能考量

| 维度 | 现状 | 潜在问题 |
|------|------|----------|
| 图片内存 | base64 全部加载到内存 | 多张高分辨率图片可能 OOM |
| AI 请求并发 | 无限制 | 大量并发可能触发 Provider 限流 |
| SQLite 写入 | 单写者锁 | 高并发场景性能瓶颈 |
| 日志文件 | 单文件最大 1GB | 超过后截断可能丢失关键日志 |
| Sharp 操作 | 同步图片处理 | 大图处理阻塞事件循环 |
| WebSocket 连接 | 无心跳检测 | 僵尸连接占用资源 |

---

## 2. 功能扩展性改进方案

### 2.1 AI Provider 插件化

**现状问题:**

新增 Provider 需修改 3 处代码:
1. `src/utils/ai/{type}/owned/` 新建实现文件
2. `src/utils/ai/{type}/modelList.ts` 添加模型配置
3. `src/utils/ai/{type}/index.ts` 添加 manufacturer 分支

**改进设计:**

```typescript
// 1. 定义标准接口
interface AIVideoProvider {
  manufacturer: string;
  models: VideoModelConfig[];
  generate(input: VideoInput, config: AIConfig): Promise<string>;  // → filePath
  validate?(input: VideoInput, config: AIConfig): string | null;   // → error or null
}

// 2. Provider 自注册
// src/utils/ai/video/owned/volcengine.ts
export default {
  manufacturer: "volcengine",
  models: [
    { model: "doubao-seedance-1-5-pro", duration: [4,12], resolution: ["480p","1080p"], ... }
  ],
  async generate(input, config) { /* 实现 */ },
  validate(input, config) { /* 校验 */ }
} satisfies AIVideoProvider;

// 3. 自动扫描注册 (类似 core.ts 的模式)
// src/utils/ai/video/index.ts
const providers = new Map<string, AIVideoProvider>();
const files = glob.sync("./owned/*.ts");
for (const file of files) {
  const provider = require(file).default;
  providers.set(provider.manufacturer, provider);
}

export async function AIVideo(input, config) {
  const provider = providers.get(config.manufacturer);
  if (!provider) throw new Error(`Unknown manufacturer: ${config.manufacturer}`);
  if (provider.validate) {
    const err = provider.validate(input, config);
    if (err) throw new Error(err);
  }
  return provider.generate(input, config);
}
```

**收益:**
- 新增 Provider 只需新建一个文件
- 模型配置与实现耦合，不会遗漏
- 自动发现，无需手动注册

### 2.2 Agent 框架泛化

**现状问题:**

OutlineScript (~737 行) 和 Storyboard (~733 行) Agent 有大量重复逻辑:
- 对话历史管理 (~50 行)
- 子 Agent 调度 (~80 行)
- WebSocket 事件发射 (~30 行)
- 环境上下文构建 (~40 行)
- 工具注册模式 (~20 行)

**改进设计:**

```typescript
// 1. 基类
abstract class BaseAgent {
  protected projectId: number;
  protected emitter: EventEmitter;
  protected history: ModelMessage[];

  // 通用方法
  protected buildContext(): string;
  protected invokeSubAgent(type: string, task: string): Promise<string>;
  protected getPrompt(code: string): Promise<string>;
  protected getAIConfig(key: string): Promise<AIConfig>;

  // 子类实现
  abstract getTools(): Record<string, Tool>;
  abstract getSubAgents(): SubAgentConfig[];
  abstract getMainPromptCode(): string;

  // 统一调用入口
  async call(prompt: string): Promise<void>;
}

// 2. 声明式子 Agent 配置
interface SubAgentConfig {
  name: string;           // 如 "AI1", "segmentAgent"
  promptCode: string;     // t_prompts 中的 code
  tools: string[];        // 可用工具名称列表
  displayName: string;    // 如 "故事师", "片段师"
}

// 3. 具体 Agent 简化
class OutlineScript extends BaseAgent {
  getMainPromptCode() { return "outlineScript-main"; }

  getSubAgents() {
    return [
      { name: "AI1", promptCode: "outlineScript-a1", tools: ["getChapter", "saveStoryline"], displayName: "故事师" },
      { name: "AI2", promptCode: "outlineScript-a2", tools: ["getOutline", "saveOutline"], displayName: "大纲师" },
      { name: "director", promptCode: "outlineScript-director", tools: ["updateOutline"], displayName: "导演" },
    ];
  }

  getTools() {
    return {
      getChapter: { /* ... */ },
      saveStoryline: { /* ... */ },
      // ...业务工具
    };
  }
}
```

**收益:**
- 新增 Agent 代码量从 ~700 行降至 ~200 行
- 通用逻辑集中维护
- 子 Agent 配置一目了然

### 2.3 任务队列系统

**现状问题:**

- 视频/图片生成直接并发调用 AI API，无排队
- 失败无自动重试
- 无优先级控制
- `t_taskList` 表已有基础结构但未用于调度

**改进设计:**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   API 请求       │────→│   任务队列       │────→│   Worker 池      │
│   (立即返回 ID)  │     │  (优先级排序)    │     │  (并发控制)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │                        │
                              ↓                        ↓
                        ┌───────────┐           ┌───────────┐
                        │ t_taskList │           │ AI Provider│
                        │ 状态追踪   │           │ 调用+重试  │
                        └───────────┘           └───────────┘
```

**Phase 1 (内存队列):**
```typescript
class TaskQueue {
  private queue: PriorityQueue<Task>;
  private running: Map<string, Task>;
  private maxConcurrent: number;

  async enqueue(task: Task, priority?: number): Promise<string>;
  async cancel(taskId: string): Promise<void>;
  getStatus(taskId: string): TaskStatus;
}

// 使用
const taskId = await taskQueue.enqueue({
  type: "video",
  handler: () => AIVideo(input, config),
  retry: { maxAttempts: 3, backoff: "exponential" },
  timeout: 20 * 60 * 1000,  // 20分钟
});
```

**Phase 2 (持久化队列):**
- 扩展 `t_taskList` 表: 增加 `priority`, `retryCount`, `maxRetries`, `nextRetryAt`, `payload`
- Worker 从数据库拉取任务
- 支持服务重启后恢复

### 2.4 多用户演进路径

**Phase 1: 用户级 API Key 隔离**
```
t_config 已有 userId 字段
→ 查询时加 WHERE userId = currentUserId
→ 每个用户配置自己的 AI API Key
→ 改动量: ~10 个路由的查询条件
```

**Phase 2: 项目级权限 (RBAC)**
```sql
-- 新增权限表
CREATE TABLE t_project_member (
  id INTEGER PRIMARY KEY,
  projectId INTEGER,
  userId INTEGER,
  role TEXT,  -- "owner" | "editor" | "viewer"
  createTime INTEGER
);
```

**Phase 3: 多租户**
```
→ 数据库级隔离: 每租户独立 SQLite 文件
→ 或表级隔离: 所有表加 tenantId
→ 配额管理: API 调用次数、存储空间限制
```

### 2.5 存储层抽象

**改进设计:**

```typescript
// 接口定义
interface StorageProvider {
  getFileUrl(relPath: string): string;
  getFile(relPath: string): Promise<Buffer>;
  getImageBase64(relPath: string): Promise<string>;
  writeFile(relPath: string, data: Buffer | string): Promise<void>;
  deleteFile(relPath: string): Promise<void>;
  deleteDirectory(relPath: string): Promise<void>;
  fileExists(relPath: string): Promise<boolean>;
}

// 工厂
function createStorage(): StorageProvider {
  switch (process.env.STORAGE_TYPE) {
    case "s3": return new S3Storage(process.env.S3_BUCKET, ...);
    case "oss": return new AliyunOSSStorage(...);
    default: return new LocalStorage();  // 现有实现
  }
}
```

**现有 `oss.ts` 已是接口化设计，改造成本低。**

---

## 3. 内部开发指南

### 3.1 新增 API 路由

**步骤:**

1. 在 `src/routes/{module}/` 新建 `.ts` 文件
2. 重启 dev 服务 (`yarn dev`)
3. `core.ts` 自动扫描生成路由到 `router.ts`

**标准模板 (POST 接口):**

```typescript
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";

const router = Router();

router.post(
  "/",
  validateFields({
    projectId: z.number({ message: "项目ID不能为空" }),
    name: z.string({ message: "名称不能为空" }),
  }),
  async (req, res) => {
    try {
      const { projectId, name } = req.body;
      const result = await u.db("t_project").where({ id: projectId }).first();
      if (!result) {
        return res.status(200).send(error("项目不存在"));
      }
      // 业务逻辑...
      res.status(200).send(success(data, "操作成功"));
    } catch (err: any) {
      res.status(200).send(error(err.message || "系统异常"));
    }
  }
);

export default router;
```

**标准模板 (WebSocket 接口):**

```typescript
import { Router } from "express";
import u from "@/utils";

const router = Router();

// @ts-ignore (express-ws 类型兼容)
router.ws("/", async (ws: any, req: any) => {
  const projectId = Number(req.query.projectId);

  ws.on("message", async (msg: string) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "msg") {
        // 处理用户消息
        ws.send(JSON.stringify({ type: "stream", data: "回复内容" }));
      }
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", data: err.message }));
    }
  });

  ws.on("close", () => {
    // 清理资源
  });
});

export default router;
```

**命名约定:**
- GET 查询: `get{Resource}` (如 `getProject`)
- POST 创建: `add{Resource}` (如 `addProject`)
- POST 更新: `update{Resource}` (如 `updateProject`)
- POST 删除: `del{Resource}` (如 `delProject`)
- AI 生成: `generate{Resource}` (如 `generateVideo`)
- WebSocket: `chat{Module}` / `agents{Module}`

### 3.2 新增 AI Provider

**步骤:**

1. **新建实现文件**: `src/utils/ai/{type}/owned/{manufacturer}.ts`
2. **添加模型配置**: `src/utils/ai/{type}/modelList.ts`
3. **注册 manufacturer**: `src/utils/ai/{type}/index.ts` 的路由分支

**图像 Provider 模板:**

```typescript
// src/utils/ai/image/owned/newProvider.ts
import axios from "axios";

export default async function newProviderImage(
  input: {
    prompt: string;
    images?: string[];
    resolution?: string;
  },
  config: {
    model: string;
    apiKey: string;
    baseUrl: string;
  }
): Promise<string> {
  // 1. 调用 API
  const response = await axios.post(config.baseUrl, {
    model: config.model,
    prompt: input.prompt,
    // ...
  }, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });

  // 2. 轮询 (如果是异步任务)
  // const result = await pollTask(queryFn, 500, 2000);

  // 3. 返回 base64 或 URL
  return response.data.url;  // 或 base64 字符串
}
```

**视频 Provider 模板:**

```typescript
// src/utils/ai/video/owned/newProvider.ts
import u from "@/utils";
import { pollTask } from "../utils";

export default async function newProviderVideo(
  input: {
    prompt: string;
    images?: string[];
    resolution?: string;
    duration?: number;
    audioEnabled?: boolean;
    savePath: string;
  },
  config: {
    model: string;
    apiKey: string;
    baseUrl: string;
  }
): Promise<string> {
  // 1. 提交任务
  const taskId = await submitTask(input, config);

  // 2. 轮询结果
  const videoUrl = await pollTask(async () => {
    const status = await queryTask(taskId, config);
    return {
      completed: status === "success",
      url: status.url,
      error: status === "failed" ? status.message : undefined,
    };
  });

  // 3. 下载并保存
  const response = await axios.get(videoUrl, { responseType: "arraybuffer" });
  await u.oss.writeFile(input.savePath, Buffer.from(response.data));
  return input.savePath;
}
```

**modelList 注册示例:**

```typescript
// src/utils/ai/video/modelList.ts 中添加
{
  manufacturer: "newProvider",
  model: "model-name",
  durationResolutionMap: [{ duration: [5, 10], resolution: ["720p", "1080p"] }],
  aspectRatio: ["16:9", "9:16"],
  type: ["text", "singleImage"],
  audio: false,
},
```

### 3.3 新增 Agent

**步骤:**

1. **创建 Agent 目录**: `src/agents/{agentName}/index.ts`
2. **创建 WebSocket 路由**: `src/routes/{module}/chat{AgentName}.ts`
3. **注册提示词**: 在 `src/lib/initDB.ts` 的 `t_prompts` 初始数据中添加
4. **注册 AI 模型映射**: 在 `t_aiModelMap` 初始数据中添加

**Agent 类核心结构:**

```typescript
import { EventEmitter } from "events";
import u from "@/utils";

export class NewAgent {
  projectId: number;
  emitter: EventEmitter;
  history: any[];

  constructor(projectId: number) {
    this.projectId = projectId;
    this.emitter = new EventEmitter();
    this.history = [];
  }

  // 获取工具定义
  private getTools() {
    return {
      toolName: {
        description: "工具描述",
        parameters: z.object({ /* Zod schema */ }),
        execute: async (args: any) => {
          // 业务逻辑
          return "工具结果";
        },
      },
    };
  }

  // 子 Agent 调用
  private async invokeSubAgent(agentType: string, task: string) {
    const promptCode = `{agentName}-${agentType}`;
    const prompts = await u.db("t_prompts").where("code", promptCode).first();
    const systemPrompt = prompts?.customValue || prompts?.defaultValue || "";
    const config = await u.getPromptAi("{agentName}Agent");

    const result = u.ai.text.stream({
      system: systemPrompt,
      messages: [/* 上下文 */],
      tools: this.getSubAgentTools(agentType),
      maxStep: 20,
    }, config);

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        this.emitter.emit("subAgentStream", { agent: agentType, text: part.textDelta });
      }
    }
    this.emitter.emit("subAgentEnd", { agent: agentType });
  }

  // 主调用入口
  async call(prompt: string) {
    const mainPrompts = await u.db("t_prompts").where("code", "{agentName}-main").first();
    const systemPrompt = mainPrompts?.customValue || mainPrompts?.defaultValue || "";
    const config = await u.getPromptAi("{agentName}Agent");

    const result = u.ai.text.stream({
      system: systemPrompt,
      messages: [...this.history, { role: "user", content: prompt }],
      tools: this.getTools(),
      maxStep: 30,
    }, config);

    let fullText = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        fullText += part.textDelta;
        this.emitter.emit("data", part.textDelta);
      } else if (part.type === "tool-call") {
        this.emitter.emit("toolCall", { name: part.toolName, args: part.args });
      }
    }

    this.history.push({ role: "user", content: prompt });
    this.history.push({ role: "assistant", content: fullText });
    this.emitter.emit("response", fullText);
  }
}
```

**提示词注册 (initDB.ts):**

```typescript
// t_prompts 初始数据中添加
{ code: "{agentName}-main", name: "主Agent", type: "{agentName}", defaultValue: "你是...", parentCode: "{agentName}" },
{ code: "{agentName}-sub1", name: "子Agent1", type: "{agentName}", defaultValue: "你是...", parentCode: "{agentName}" },
```

**AI 模型映射 (initDB.ts):**

```typescript
// t_aiModelMap 初始数据中添加
{ key: "{agentName}Agent", name: "{显示名}Agent" },
```

### 3.4 数据库变更

**新增表:**

在 `src/lib/initDB.ts` 的 `initDB()` 函数中添加:

```typescript
if (!(await db.schema.hasTable("t_newTable"))) {
  await db.schema.createTable("t_newTable", (table) => {
    table.increments("id").primary();
    table.text("name");
    table.integer("projectId");
    table.integer("createTime");
  });
}
```

**新增列 (迁移):**

在 `src/lib/fixDB.ts` 中添加:

```typescript
if (!(await db.schema.hasColumn("t_existingTable", "newColumn"))) {
  await db.schema.alterTable("t_existingTable", (table) => {
    table.text("newColumn");
  });
}
```

**类型更新:**
- 修改后运行 `yarn dev`，类型文件 `src/types/database.d.ts` 会自动重新生成
- 使用 MD5 哈希避免不必要的重写

### 3.5 调试技巧

**日志查看:**
```bash
# 查看完整日志
cat logs/app.log

# 实时跟踪
tail -f logs/app.log

# Electron 环境日志位置
# macOS: ~/Library/Application Support/ToonFlow/logs/app.log
# Windows: %APPDATA%/ToonFlow/logs/app.log
```

**AI 接口测试:**
```bash
# 测试文本模型
curl -X POST http://localhost:60000/other/testAI \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"modelName":"gpt-4o","apiKey":"sk-...","manufacturer":"openai"}'

# 测试图像模型
curl -X POST http://localhost:60000/other/testImage \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"modelName":"dall-e-3","apiKey":"sk-...","manufacturer":"openai"}'

# 测试视频模型
curl -X POST http://localhost:60000/other/testVideo \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"modelName":"sora-2","apiKey":"...","manufacturer":"runninghub"}'
```

**数据重置:**
```bash
# 清空数据库 (保留表结构)
curl -X POST http://localhost:60000/other/clearDatabase \
  -H "Authorization: Bearer {token}"

# 删除所有上传文件
curl -X POST http://localhost:60000/other/deleteAllData \
  -H "Authorization: Bearer {token}"
```

**Agent 调试:**
- WebSocket 连接后，所有 `toolCall` 事件包含工具名和参数
- `subAgentStream` 事件可看到子 Agent 的思考过程
- `transfer` 事件显示 Agent 切换

**数据库直接查询:**
```bash
# 安装 sqlite3 命令行工具
sqlite3 db.sqlite

# 查看所有表
.tables

# 查看表结构
.schema t_video

# 查询视频状态
SELECT id, state, errorReason FROM t_video WHERE state != 1;
```

### 3.6 常见问题排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 路由不生效 | `router.ts` 未更新 | 删除 `src/router.ts` 后重启 `yarn dev` |
| 数据库类型错误 | `database.d.ts` 未同步 | 重启 `yarn dev` 自动重新生成 |
| 图片生成失败 | API Key 或 baseUrl 错误 | 检查 `t_config` 表对应配置 |
| 视频一直 state=0 | AI 调用超时或失败 | 查看 `logs/app.log` 中的错误日志 |
| Agent 无响应 | AI 模型映射缺失 | 检查 `t_aiModelMap` 表是否配置了对应 key |
| 提示词不生效 | customValue 为空 | 检查 `t_prompts` 表的 `customValue` 字段 |
| Electron 白屏 | 前端文件缺失 | 确认 `scripts/web/index.html` 存在 |
| 端口被占用 | 其他进程占用 60000 | `lsof -i :60000` 查看并 kill |

### 3.7 项目结构速查

```
src/
├── app.ts              # Express 入口 (改中间件/全局配置来这里)
├── core.ts             # 路由生成器 (不需要手动修改)
├── router.ts           # 自动生成 (不要手动修改!)
├── env.ts              # 环境变量 (改端口/存储路径来这里)
├── agents/             # Agent 系统 (新增 Agent 来这里)
│   ├── outlineScript/  #   故事线/大纲 Agent
│   └── storyboard/     #   分镜 Agent
├── routes/             # API 路由 (新增接口来这里)
│   ├── assets/         #   资产管理 (角色/道具/场景)
│   ├── novel/          #   小说管理
│   ├── outline/        #   大纲管理 (含 WebSocket)
│   ├── project/        #   项目管理
│   ├── script/         #   剧本管理
│   ├── storyboard/     #   分镜管理 (含 WebSocket)
│   ├── video/          #   视频管理
│   ├── setting/        #   系统设置
│   └── other/          #   登录/测试/清理
├── utils/              # 工具函数
│   ├── ai/             #   AI 调用 (新增 Provider 来这里)
│   │   ├── text/       #     文本生成 (20+ LLM)
│   │   ├── image/      #     图像生成 (7 providers)
│   │   └── video/      #     视频生成 (8+ providers)
│   ├── db.ts           #   数据库连接
│   ├── oss.ts          #   文件存储
│   └── ...             #   其他工具
├── lib/
│   ├── initDB.ts       #   数据库 Schema (改表结构来这里)
│   ├── fixDB.ts        #   数据库迁移 (加列来这里)
│   └── responseFormat.ts #  响应格式
└── types/
    └── database.d.ts   #   自动生成 (不要手动修改!)
```

---

## 附录: 关键文件行数参考

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/agents/outlineScript/index.ts` | ~737 | 大纲 Agent (最复杂) |
| `src/agents/storyboard/index.ts` | ~733 | 分镜 Agent |
| `src/agents/storyboard/generateImageTool.ts` | ~335 | 图片生成工具 |
| `src/utils/ai/text/index.ts` | ~200 | 文本 AI 入口 |
| `src/utils/ai/text/modelList.ts` | ~250 | 46 个模型配置 |
| `src/utils/ai/video/modelList.ts` | ~490 | 30+ 视频模型 |
| `src/lib/initDB.ts` | ~350 | 数据库初始化 |
| `src/app.ts` | ~120 | Express 入口 |
| `src/router.ts` | ~160 | 77 路由注册 |
