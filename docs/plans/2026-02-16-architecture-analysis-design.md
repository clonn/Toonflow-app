# Toonflow-app 架构分析文档（完整版）

> 内部开发参考 | 2026-02-16

---

## 目录

1. [项目定位](#1-项目定位)
2. [技术架构分层](#2-技术架构分层)
3. [数据模型](#3-数据模型)
4. [核心业务流水线](#4-核心业务流水线)
5. [AI Provider 集成](#5-ai-provider-集成)
6. [工具函数详解](#6-工具函数详解)
7. [路由接口详解](#7-路由接口详解)
8. [Agent 系统详解](#8-agent-系统详解)
9. [文件存储系统](#9-文件存储系统)
10. [认证与安全](#10-认证与安全)
11. [提示词管理系统](#11-提示词管理系统)
12. [部署架构](#12-部署架构)
13. [构建与 CI/CD](#13-构建与-cicd)
14. [项目目录结构](#14-项目目录结构)
15. [关键设计决策](#15-关键设计决策)

---

## 1. 项目定位

Toonflow 是一款 **AI 短剧工厂**，核心价值是将小说文本通过 AI 自动化流水线转化为短剧视频。

- **技术栈:** TypeScript + Express 5 + SQLite (better-sqlite3/Knex) + Electron
- **AI 框架:** Vercel AI SDK (`ai` v6)
- **部署方式:** Electron 桌面客户端 / Docker / 云端 Node.js (PM2)
- **版本:** v1.0.6
- **许可证:** AGPL-3.0

---

## 2. 技术架构分层

```
┌─────────────────────────────────────────────┐
│           入口层 (Entry Layer)               │
│  app.ts (Express 服务, 端口 60000)           │
│  scripts/main.ts (Electron 主进程)           │
├─────────────────────────────────────────────┤
│           路由层 (Route Layer)                │
│  77 个路由文件，由 core.ts 自动扫描生成注册   │
│  9 个业务模块: project / novel / outline /   │
│  script / storyboard / video / assets /      │
│  setting / user                              │
├─────────────────────────────────────────────┤
│           Agent 层 (AI Agent Layer)          │
│  OutlineScript Agent (3 个子 Agent)          │
│  Storyboard Agent (2 个子 Agent)             │
├─────────────────────────────────────────────┤
│           工具层 (Utils Layer)               │
│  AI Text (20+ LLM)                          │
│  AI Image (7 providers)                     │
│  AI Video (8+ providers)                    │
│  DB (SQLite/Knex) | OSS (本地文件存储)       │
├─────────────────────────────────────────────┤
│           基础设施层 (Infra Layer)            │
│  env.ts | err.ts | logger.ts                │
│  middleware.ts (Zod 参数校验)                │
│  lib/responseFormat.ts                       │
└─────────────────────────────────────────────┘
```

### 2.1 入口层详解

#### `src/app.ts` — Express 服务入口

**启动流程:**
1. 导入 `logger.ts`, `err.ts`, `env.ts` (副作用导入，初始化全局)
2. 开发环境下调用 `core.ts` 自动生成路由文件
3. 初始化 Express + WebSocket 支持 (`express-ws`)
4. 配置中间件: morgan 日志、CORS (允许所有源)、JSON body (100mb 限制)、URL 编码
5. 检测 Electron 环境，设置 uploads 目录
6. 注册静态文件服务 (uploads 目录)
7. JWT 认证中间件 (白名单: `/other/login`)
8. 动态导入并注册路由 (`src/router.ts`)
9. 404 和全局错误处理
10. 监听端口 (默认 60000)

**关键细节:**
- 非 Electron 环境直接调用 `startServe()`
- Electron 环境由 `scripts/main.ts` 延迟调用
- 导出 `closeServe()` 供 Electron 优雅关闭

#### `scripts/main.ts` — Electron 主进程

**功能:**
- 创建 BrowserWindow (900x600, 隐藏菜单栏)
- 开发模式: 加载 `scripts/web/index.html` (相对路径)
- 生产模式: 加载 `app.getAppPath()/scripts/web/index.html`
- 检测 `NODE_ENV=dev` 或 `!app.isPackaged` 判断开发模式
- 应用退出时调用 `closeServe()` 关闭后端
- macOS 激活时重新创建窗口

#### `src/core.ts` — 路由自动生成器

**算法:**
1. 使用 `fast-glob` 扫描 `src/routes/**/*.ts`
2. 文件路径 → Express 路由路径映射:
   - `assets/addAssets.ts` → `/assets/addAssets`
   - `index/index.ts` → `/index`
   - `[id].ts` → `/:id` (动态参数)
   - `[...slug].ts` → `/*` (通配)
3. 生成 import 语句和 `app.use()` 注册代码
4. 使用 MD5 哈希比对，避免不必要的文件写入

#### `src/router.ts` — 自动生成的路由注册

**注意: 此文件由 `core.ts` 自动生成，不应手动修改**

包含 77 个路由的 import 和 `app.use()` 注册。

### 2.2 基础设施层详解

#### `src/env.ts` — 环境变量加载

**逻辑:**
1. 判断 `NODE_ENV` (默认: Electron 打包=prod, 否则=dev)
2. Electron 使用 `userData/env/` 目录，Node.js 使用 `./env/`
3. 自动创建目录和 `.env.{env}` 文件 (如不存在)
4. 逐行解析 `KEY=VALUE` 格式，写入 `process.env`

**默认环境变量:**
```
NODE_ENV=dev|prod
PORT=60000
OSSURL=http://127.0.0.1:60000/
```

#### `src/err.ts` — 全局异常捕获

- `unhandledRejection`: 捕获未处理的 Promise 拒绝，使用 `serialize-error` 序列化
- `uncaughtException`: 捕获未捕获的同步异常
- 输出: 错误名称、消息、堆栈、序列化详情

#### `src/logger.ts` — 日志系统

**功能:**
- 日志文件: `logs/app.log` (Electron 在 userData 目录)
- 拦截 `console.log/info/warn/error/debug` → 同时写入文件
- 拦截 `process.stdout/stderr` → 捕获 morgan HTTP 日志
- 去除 ANSI 颜色代码
- 日志格式: `[YYYY-MM-DD HH:MM:SS.sss] [LEVEL] message`
- 日志轮转: 单文件最大 1GB，超出时保留后半部分

**API:**
| 方法 | 功能 |
|------|------|
| `init()` | 初始化日志系统 |
| `exportLogs()` | 读取完整日志内容 |
| `clear()` | 删除日志文件 |
| `close()` | 恢复原始 console/stream |

#### `src/middleware/middleware.ts` — Zod 参数校验

```typescript
validateFields(shape: Record<string, ZodTypeAny>, source: "body"|"query"|"params")
```
- 使用 Zod 中文语言包 (`zod/locales` zhCN)
- 校验失败返回 400 + 字段级错误信息

#### `src/lib/responseFormat.ts` — 统一响应格式

```typescript
interface ApiResponse { code: number; data: any; message: string; }
success<T>(data, message = "成功") → { code: 200, data, message }
error<T>(message, data)           → { code: 400, data, message }
```

---

## 3. 数据模型

### 3.1 数据库初始化 (`src/lib/initDB.ts`)

**16 张表完整 Schema:**

#### `t_user` — 用户表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 用户 ID |
| name | text | 用户名 |
| password | text | 密码 (明文) |

初始数据: `{ id: 1, name: "admin", password: "admin123" }`

#### `t_project` — 项目表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 项目 ID |
| name | text | 项目名称 |
| intro | text | 项目简介 |
| type | text | 类型 (如"都市言情") |
| artStyle | text | 风格 (如"写实") |
| videoRatio | text | 画面比例 (如"16:9") |
| createTime | integer | 创建时间戳 |
| userId | integer | 所属用户 |

#### `t_novel` — 小说章节表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 章节记录 ID |
| chapterIndex | integer | 章节序号 |
| reel | text | 分卷名 |
| chapter | text | 章节名 |
| chapterData | text | 章节正文 |
| projectId | integer | 所属项目 |
| createTime | integer | 创建时间戳 |

#### `t_storyline` — 故事线表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 故事线 ID |
| name | text | 故事线名称 |
| content | text | 故事线内容 |
| novelIds | text | 关联章节 ID |
| projectId | integer | 所属项目 |

#### `t_outline` — 大纲表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 大纲 ID |
| episode | integer | 集数 |
| data | text | JSON 格式大纲数据 (EpisodeData) |
| projectId | integer | 所属项目 |

#### `t_script` — 剧本表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 剧本 ID |
| name | text | 剧本名称 (如"第1集") |
| content | text | 剧本内容 |
| projectId | integer | 所属项目 |
| outlineId | integer | 关联大纲 |

#### `t_assets` — 资产表 (角色/道具/场景/分镜)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 资产 ID |
| name | text | 名称 |
| intro | text | 介绍描述 |
| prompt | text | AI 提示词 |
| remark | text | 备注 |
| videoPrompt | text | 视频提示词 |
| type | text | 类型: "角色"/"道具"/"场景"/"分镜" |
| episode | text | 集数 |
| duration | text | 时长 |
| filePath | text | 图片文件路径 |
| projectId | integer | 所属项目 |
| scriptId | integer | 关联剧本 |
| segmentId | integer | 片段 ID |
| shotIndex | integer | 镜头索引 |
| state | text | 状态 |

#### `t_image` — 图片表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 图片 ID |
| filePath | text | 文件路径 |
| type | text | 图片类型 |
| assetsId | integer | 关联资产 |
| scriptId | integer | 关联剧本 |
| projectId | integer | 所属项目 |
| videoId | integer | 关联视频 |
| state | text | 状态 (如"生成成功") |

#### `t_video` — 视频表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 视频 ID |
| resolution | text | 分辨率 |
| prompt | text | 提示词 |
| filePath | text | 视频文件路径 |
| firstFrame | text | 首帧图片 |
| storyboardImgs | text | JSON: 分镜图片数组 |
| model | text | 使用的模型 |
| time | integer | 时长 |
| configId | integer | 关联视频配置 |
| aiConfigId | integer | 关联 AI 配置 |
| scriptId | integer | 关联剧本 |
| state | integer | 状态: 0=生成中, 1=成功, -1=失败 |

#### `t_videoConfig` — 视频配置表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 配置 ID |
| scriptId | integer | 关联剧本 |
| projectId | integer | 所属项目 |
| manufacturer | text | 厂商 |
| mode | text | 模式: startEnd/multi/single/text |
| resolution | text | 分辨率 |
| duration | integer | 时长 (秒) |
| prompt | text | 提示词 |
| startFrame | text | JSON: 首帧数据 |
| endFrame | text | JSON: 尾帧数据 |
| images | text | JSON: 图片数组 |
| selectedResultId | integer | 选中的生成结果 |
| audioEnabled | integer | 是否启用音频 |
| errorReason | text | 错误原因 |
| createTime | integer | 创建时间戳 |
| updateTime | integer | 更新时间戳 |

#### `t_config` — AI 模型配置表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 配置 ID |
| type | text | 类型: text/image/video |
| model | text | 模型名称 |
| modelType | text | 模型子类型 |
| apiKey | text | API 密钥 |
| baseUrl | text | API 地址 |
| manufacturer | text | 厂商名称 |
| name | text | 配置名称 |
| createTime | integer | 创建时间戳 |
| userId | integer | 所属用户 |

#### `t_setting` — 系统设置表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 设置 ID |
| userId | integer | 用户 ID |
| tokenKey | text | JWT 签名密钥 |
| imageModel | text | JSON: 图像模型配置 |
| languageModel | text | JSON: 语言模型配置 |
| projectId | integer | 默认项目 |

初始数据: `{ id: 1, userId: 1, tokenKey: uuid().slice(0,8) }`

#### `t_prompts` — 提示词模板表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 提示词 ID |
| code | text UNIQUE | 唯一标识码 |
| name | text | 显示名称 |
| type | text | 类型分类 |
| defaultValue | text | 默认提示词 |
| customValue | text | 用户自定义值 |
| parentCode | text | 父级分组 |

#### `t_chatHistory` — 对话历史表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 记录 ID |
| type | text | 类型: "outlineWebChat" 等 |
| data | text | JSON: 对话数据 |
| novel | text | 章节数据 |
| projectId | integer | 所属项目 |

#### `t_taskList` — 任务列表表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 任务 ID |
| projectName | integer | 项目名称 |
| name | text | 任务名称 |
| prompt | text | 提示词 |
| state | text | 状态 |
| startTime | text | 开始时间 |
| endTime | text | 结束时间 |

#### `t_aiModelMap` — AI 模型映射表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK | 映射 ID |
| configId | integer | 关联 AI 配置 |
| key | text UNIQUE | 语义键名 |
| name | text | 显示名称 |

初始映射 (8 条):
| key | name |
|-----|------|
| storyboardAgent | 分镜Agent |
| storyboardImage | 分镜图 |
| outlineScriptAgent | 大纲Agent |
| videoPromptAgent | 视频描述Agent |
| polishPromptRole | 角色提示词润色 |
| polishPromptScene | 场景提示词润色 |
| polishPromptProps | 道具提示词润色 |
| generateScriptAgent | 生成剧本Agent |

### 3.2 数据库迁移 (`src/lib/fixDB.ts`)

**已执行的迁移:**
- `t_video`: 新增 `time` (integer), `aiConfigId` (integer) 列
- `t_config`: 新增 `modelType` (text) 列；修改 `modelType` 为 text 类型
- `t_videoConfig`: 新增 `audioEnabled` (integer), `errorReason` (text) 列
- `t_outline`: 删除 `index` 列

### 3.3 数据关系图

```
t_project (顶层)
  ├── t_novel[] (章节, 1:N)
  ├── t_storyline (故事线, 1:1)
  ├── t_outline[] (大纲, 1:N 按集)
  │     └── t_script[] (剧本, 1:N)
  ├── t_assets[] (角色/道具/场景/分镜)
  │     └── t_image[] (资产图片, 1:N)
  ├── t_videoConfig[] (视频配置)
  │     └── t_video[] (生成的视频, 1:N)
  └── t_chatHistory[] (对话记录)

t_config (AI 模型配置, 独立)
  └── t_aiModelMap[] (语义映射, N:1)
t_setting (系统设置, 独立)
t_prompts (提示词模板, 独立)
t_user (用户, 独立)
t_taskList (任务列表, 独立)
```

---

## 4. 核心业务流水线

### 端到端创作流程

```
小说导入 → 故事线提取 → 剧集大纲 → 剧本生成 → 分镜制作 → 视频合成
  Novel      Storyline    Outline     Script    Storyboard    Video
   (1)         (2a)        (2b)        (3)        (4)          (5)
```

### 4.1 阶段 1：小说导入

**路由:** `novel/addNovel` (POST)

**输入:**
```typescript
{
  projectId: number,
  data: Array<{
    index: number,      // 章节序号
    reel: string,       // 分卷名
    chapter: string,    // 章节名
    chapterData: string // 正文内容
  }>
}
```

**处理:** 批量插入 `t_novel`，附带 `createTime = Date.now()`

### 4.2 阶段 2：故事线 + 大纲生成

**入口:** `outline/agentsOutline` (WebSocket)

详见第 8 节 Agent 系统。

### 4.3 阶段 3：剧本生成

**路由:** `script/generateScriptApi` (POST)

**输入:** `{ outlineId: number, scriptId: number }`

**处理流程:**
1. 获取大纲数据 → 解析 `chapterRange`
2. 查询 `t_novel` 获取对应章节原文
3. 合并章节文本
4. 调用 AI Text 生成剧本
5. 更新 `t_script.content`

### 4.4 阶段 4：分镜制作

**入口:** `storyboard/chatStoryboard` (WebSocket)

详见第 8 节 Agent 系统。

### 4.5 阶段 5：视频合成

**路由:** `video/generateVideo` (POST)

**输入:**
```typescript
{
  projectId: number,
  scriptId: number,
  configId?: number,
  aiConfigId: number,
  filePath: string[],         // 图片路径数组
  duration: number,           // 时长 (秒)
  resolution: string,         // 分辨率
  prompt: string,             // 提示词
  mode: "startEnd"|"multi"|"single"|"text",
  audioEnabled: boolean
}
```

**处理流程:**
1. 验证 AI 配置和视频配置存在
2. RunningHub 特殊处理: 多图拼接为网格 (最大 3x3, sharp contain 模式)
3. 处理图片路径 (base64/URL/文件路径)
4. 验证 OSS 文件存在
5. 插入 `t_video` 记录 (state=0)
6. **立即返回** `{ id: videoId }`
7. 后台异步执行:
   - 获取项目和图片数据
   - 图片转 base64
   - 构建增强提示词 (风格要求)
   - 调用 AI 视频生成
   - 成功: 更新 state=1 + filePath
   - 失败: 更新 state=-1

---

## 5. AI Provider 集成

### 5.1 文本生成 (LLM)

**入口:** `src/utils/ai/text/index.ts`

**两种调用方式:**

```typescript
// 流式输出 (Agent 对话)
u.ai.text.stream({
  system: string,
  tools: Record<string, Tool>,
  messages: ModelMessage[],
  maxStep: number
}, config)

// 结构化输出 (带 Schema)
u.ai.text.invoke({
  system: string,
  output: ZodSchema,
  prompt: string
}, config)
```

**模型选择逻辑:**
1. 根据 `config.manufacturer` 和 `config.model` 在 `modelList` 中查找
2. `manufacturer === "other"` 时使用通用 OpenAI 兼容接口
3. 调用对应厂商的 SDK 实例工厂

**输出格式策略:**
- `responseFormat === "schema"`: 使用模型原生 schema 支持
- `responseFormat === "object"`: 在 system prompt 中追加 JSON 格式要求

**完整模型列表 (46 个):**

| 厂商 | 模型 | responseFormat | image | think | tool |
|------|------|---------------|-------|-------|------|
| **DeepSeek** | deepseek-chat | schema | - | - | true |
| | deepseek-reasoner | schema | true | true | - |
| **Doubao** | doubao-seed-1-8-250607 | schema | true | true | true |
| | doubao-seed-1-6-250605 | schema | true | true | true |
| | doubao-seed-1-6-lite-250615 | schema | - | - | true |
| | doubao-seed-1-6-flash-250828 | schema | - | - | true |
| **Zhipu** | glm-4.7 | object | - | true | true |
| | glm-4.5-flash | object | - | - | true |
| | glm-4.5-flash-250414 | object | - | true | true |
| | glm-4.6v | object | true | - | true |
| | glm-4.6-flash | object | - | - | true |
| | glm-z1-airx | object | - | true | true |
| | glm-z1-flash | object | - | true | true |
| | glm-4-flash-250414 | object | - | - | true |
| | glm-4-air | object | - | - | true |
| **Qwen** | qwen-vl-max | schema | true | - | true |
| | qwen-plus-latest | schema | - | - | true |
| | qwen-max | schema | - | - | true |
| | qwen-turbo-latest | schema | - | - | true |
| | qwen2.5-vl-72b-instruct | schema | true | - | true |
| | qwq-plus | schema | - | true | true |
| **OpenAI** | gpt-4o | schema | true | - | true |
| | gpt-4o-mini | schema | true | - | true |
| | gpt-4.1 | schema | true | - | true |
| | gpt-5.x | schema | true | - | true |
| | gpt-5.x-mini | schema | true | - | true |
| **Gemini** | gemini-2.5-pro | schema | true | true | true |
| | gemini-2.5-flash | schema | true | true | true |
| | gemini-2.0-flash | schema | true | - | true |
| | gemini-2.0-flash-lite | schema | true | - | true |
| | gemini-1.5-pro | schema | true | - | true |
| | gemini-1.5-flash | schema | true | - | true |
| **Anthropic** | claude-opus-4-5 | schema | true | - | true |
| | claude-sonnet-4-5-20250929 | schema | true | - | true |
| | claude-haiku-4-5-20251001 | schema | true | - | true |
| | claude-3-5-sonnet-20241022 | schema | true | - | true |
| | claude-3-5-haiku-20241022 | schema | true | - | true |
| | claude-3-opus-20240229 | schema | true | - | true |
| | claude-3-sonnet-20240229 | schema | true | - | true |
| | claude-3-haiku-20240307 | schema | true | - | true |
| **XAI** | grok-3 | schema | - | - | true |
| | grok-4 | schema | - | - | true |
| | grok-4.1 | schema | true | - | true |
| **Other** | (自定义) | schema | - | - | true |

### 5.2 图像生成

**入口:** `src/utils/ai/image/index.ts`

**统一接口:**
```typescript
AIImage(input: {
  prompt: string,
  images?: string[],    // base64 参考图
  resolution?: string,
  resType?: "base64"|"url"
}, config: { model, apiKey, baseUrl, manufacturer })
```

**处理流程:**
1. 检测 base64 编码格式 (JPEG/PNG/GIF/WebP 魔数)
2. 添加 MIME 前缀 (如缺失)
3. 路由到对应厂商实现
4. 标准化输出 (URL→base64 或反之)

#### Provider 实现详解

**Volcengine (火山引擎):**
```
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
Body: { model, prompt, size, response_format: "url", image: [base64] }
分辨率映射: "1K"→"1024x1024", "2K"→"2048x2048", "4K"→"4096x4096"
```

**Kling (可灵):**
- API Key 格式: `accessKey|secretKey`
- JWT 认证: HS256, 30分钟有效期
- 图片压缩: 单张 ≤10MB
- 超过 10 张图: 合并为一张
- 异步任务轮询: POST 创建 → GET 查询状态
- 状态: submitted → processing → succeed/failed

**Gemini:**
- 使用 Google Generative AI SDK
- 支持多模态 (文本+图片)
- 超时: 60 秒
- 输出: `result.files[0]` → Data URL

**Vidu:**
- URL 格式: `requestUrl|queryUrl`
- 支持模板变量替换: `{variableName}`
- 最大 7 张图 (多余合并)
- 模型解析: `viduq1` → modelName + mode
- 比例: 16:9, 9:16, 1:1, 3:4, 4:3, 21:9, 2:3, 3:2

**RunningHub:**
- 图片上传: FormData binary → `/openapi/v2/media/upload/binary`
- 压缩: ≤7MB (先降质量，后缩尺寸)
- 生成: `/text-to-image` (无图) 或 `/edit` (有图)
- 状态码: 0=成功, 804/813=进行中, 805=失败

**ApiMart:**
```
POST https://api.apimart.ai/v1/images/generations
Body: { model, prompt, size, n: 1 }
轮询: GET https://api.apimart.ai/v1/tasks/{taskId}
状态: completed/failed/cancelled
```

**Other (通用 OpenAI 兼容):**
- Gemini 类模型: 使用 `generateText()` + 图片内容
- 标准图像模型: 使用 `generateImage()` + 比例/尺寸映射
- 回退提取: Markdown 图片语法 → base64 → HTTP URL

### 5.3 视频生成

**入口:** `src/utils/ai/video/index.ts`

**统一接口:**
```typescript
AIVideo(input: {
  prompt: string,
  images?: string[],
  resolution?: string,
  duration?: number,
  audioEnabled?: boolean
}, config: { model, apiKey, baseUrl, manufacturer })
```

#### Provider 实现详解

**Volcengine (Doubao Seedance):**
```
POST {baseURL}
Body: {
  model, content: [text + images],
  duration, resolution, watermark: false,
  generate_audio: boolean
}
图片角色: first_frame / last_frame (2张图时)
轮询状态: succeeded/failed/cancelled/expired/queued/running
时长-分辨率映射表:
  2-4s: 480p/720p/1080p
  5-12s: 480p/720p/1080p (不同模型支持不同)
```

**Kling (可灵):**
- 配置: `text2videoUrl|image2videoUrl|queryUrl`
- 模型解析: `kling-v2-6(PRO)` → mode: "pro"
- 支持: prompt, aspect_ratio, image, image_tail

**Vidu:**
- 文本端点: `/ent/v2/text2video`
- 图片端点: `/ent/v2/img2video`
- 查询: `/ent/v2/tasks?task_ids=[...]`
- 状态: success/failed/created/queueing/processing

**Wan (万象):**
- 分辨率映射详表:
  - 480p: 832x480 (16:9), 480x832 (9:16), 624x624 (1:1)
  - 720p: 1280x720, 720x1280, 960x960 ...
  - 1080p: 1920x1080, 1080x1920, 1440x1440 ...
- 端点: `{i2vUrl}` (文生视频), `{kf2vUrl}` (关键帧生视频)

**Gemini (Veo):**
```
提交: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predictLongRunning
查询: GET https://generativelanguage.googleapis.com/v1beta/{operationName}
认证: x-goog-api-key header
视频下载: axios arraybuffer → 写入文件系统
```

**RunningHub:**
- 端点按模型/类型路由:
  - `/openapi/v2/rhart-video-s/image-to-video[-pro]`
  - `/openapi/v2/rhart-video-s/text-to-video[-pro]`
- 图片压缩: ≤5MB
- 状态: SUCCESS/FAILED/QUEUED/RUNNING

**ApiMart:**
- 预签名上传: POST `/api/upload/presign` → PUT presignedUrl
- 生成: POST `/v1/videos/generations`
- 查询: GET `/v1/tasks/{taskId}`

**Other (通用):**
- FormData: model, prompt, seconds, size, input_reference
- 状态: SUCCESS/FAILURE/CANCEL/NOT_START/SUBMITTED/IN_PROGRESS

### 5.4 AI 通用工具 (`src/utils/ai/utils.ts`)

**`validateVideoConfig()`:** 验证视频配置兼容性
- 图片数量是否匹配模型类型
- 时长是否在支持范围内
- 分辨率-时长组合是否有效
- 音频是否支持
- 文生视频的比例验证

**`pollTask()`:** 异步任务轮询
- 默认: 500 次 x 2s = ~16 分钟超时
- 返回: `{ completed, url?, error? }`

### 5.5 完整视频模型列表

| 厂商 | 模型 | 时长 | 分辨率 | 类型 | 音频 |
|------|------|------|--------|------|------|
| **Volcengine** | doubao-seedance-1-5-pro | 4-12s | 480-1080p | t2v+i2v | Yes |
| | doubao-seedance-1-0-pro | 2-12s | 480-1080p | t2v+i2v | - |
| | doubao-seedance-1-0-lite-i2v | 2-12s | 480-1080p | i2v only | - |
| | doubao-seedance-1-0-lite-t2v | 2-12s | 480-1080p | t2v only | - |
| **Kling** | kling-v1 (STD/PRO) | 5-10s | 720-1080p | t2v+i2v | - |
| | kling-v1-6 (STD/PRO) | 5-10s | 720-1080p | t2v+i2v | - |
| | kling-v2-5-turbo (STD/PRO) | 5-10s | 720-1080p | t2v+i2v | - |
| | kling-v2-6 (STD/PRO) | 5-10s | 720-1080p | t2v+i2v | - |
| **Vidu** | viduq3-pro | 1-16s | 540-1080p | t2v+i2v | Yes |
| | viduq2-pro/turbo | 1-10s | 540-1080p | t2v+i2v+ref | - |
| | viduq1 | 5s | 1080p | t2v+i2v+ref | - |
| | vidu2.0 | 4-8s | 360-1080p | i2v+ref+startEnd | - |
| **Wan** | wan2.6-t2v/i2v | 2-15s | 720-1080p | t2v/i2v | Yes |
| | wan2.5-i2v-preview | 5-10s | 480-1080p | i2v | Yes |
| | wan2.2 系列 | 5s | 480-1080p | t2v/i2v | - |
| | wanx2.1 | 5s | 480-720p | t2v/i2v | - |
| **Gemini** | veo-3.1-generate-preview | 4-8s | 720-1080p | 多模态 | Yes |
| | veo-3.0-generate-preview | 4-8s | 720-1080p | 有限输入 | Yes |
| | veo-2.0-generate-001 | 5-8s | 720p | t2v+i2v | - |
| **RunningHub** | sora-2 | 10-15s | 16:9/9:16 | t2v+i2v | - |
| | sora-2-pro | 15-25s | 16:9/9:16 | t2v+i2v | - |
| **ApiMart** | sora-2 / sora-2-pro | 同上 | 同上 | 同上 | - |

---

## 6. 工具函数详解

### 6.1 工具聚合 (`src/utils.ts`)

所有工具通过 `u` 对象统一导出:

```typescript
export default {
  db,                    // Knex 查询构建器
  oss,                   // 文件存储
  ai: {
    text: AIText,        // LLM 文本
    image: AIImage,      // 图像生成
    video: AIVideo,      // 视频生成
  },
  editImage,             // 图片编辑
  number2Chinese,        // 数字转中文
  deleteOutline,         // 大纲删除
  getConfig,             // AI 配置获取
  uuid,                  // UUID 生成
  error,                 // 错误标准化
  imageTools,            // 图片压缩/合并
  getPromptAi,           // 提示词 AI 配置
}
```

### 6.2 数据库 (`src/utils/db.ts`)

- 检测环境: Electron → `userData/db.sqlite`, Node → `./db.sqlite`
- 自动创建目录
- 使用 Knex.js + SQLite3 客户端
- 开发模式: 调用 `sql-ts` 生成 `src/types/database.d.ts`
- MD5 哈希避免不必要的类型文件写入

### 6.3 文件存储 (`src/utils/oss.ts`)

**存储根目录:**
- Electron: `app.getPath('userData')/uploads/`
- Node: `process.cwd()/uploads/`

**方法详解:**

| 方法 | 签名 | 功能 |
|------|------|------|
| `getFileUrl` | `(relPath) → string` | 返回 HTTP URL (OSSURL + 路径) |
| `getFile` | `(relPath) → Buffer` | 读取文件为 Buffer |
| `getImageBase64` | `(relPath) → string` | 图片→Data URL (含 MIME 检测) |
| `writeFile` | `(relPath, data) → void` | 写入文件 (自动建目录) |
| `deleteFile` | `(relPath) → void` | 删除单个文件 |
| `deleteDirectory` | `(relPath) → void` | 递归删除目录 |
| `fileExists` | `(relPath) → boolean` | 检查文件存在 |

**支持的 MIME:** jpg, png, gif, webp, bmp, svg, ico, tiff

**安全:** `isPathInside()` 防止目录遍历

### 6.4 图片编辑 (`src/utils/editImage.ts`)

**`editImage(images, directive, projectId)`**

1. 解析图片别名 (`@图8` → `图1`, `图2` ...)
2. 验证所有引用的别名存在
3. 从数据库 ID / URL / base64 获取图片数据
4. 调用 AI 图像服务
5. 提取 base64 → 保存到 `/{projectId}/storyboard/{uuid}.jpg`

### 6.5 图片工具 (`src/utils/imageTools.ts`)

**`compressImage(base64, maxSize="10mb")`:**
- 解析大小字符串 (支持 kb/mb/gb/b)
- 迭代降质: quality 90→10 (步进 -10)
- 质量耗尽后缩放: 0.8x 每次
- 使用 sharp JPEG 编码

**`mergeImages(base64List, maxSize="10mb")`:**
- 找到最高图片高度
- 按比例计算各图宽度
- 水平拼接 (RGBA 白色背景)
- 对合并结果执行压缩

### 6.6 配置获取 (`src/utils/getConfig.ts`)

**`getConfig<T>(aiType, manufacturer?)`:**
- 查询 `t_config` 表
- 返回: `{ model, apiKey, manufacturer, baseURL }`

### 6.7 提示词 AI 配置 (`src/utils/getPromptAi.ts`)

**`getPromptAi(key)`:**
```sql
SELECT config.model, config.apiKey, config.baseUrl, config.manufacturer
FROM t_aiModelMap
LEFT JOIN t_config ON t_config.id = t_aiModelMap.configId
WHERE t_aiModelMap.key = ?
```

### 6.8 数字转中文 (`src/utils/number2Chinese.ts`)

- 单位: 零一二三四五六七八九
- 小单位: 十百千
- 大单位: 万亿
- 特例: 10-19 去掉前导"一" (十一 而非 一十一)

### 6.9 大纲删除 (`src/utils/deleteOutline.ts`)

**`deleteOutline(id, projectId)`:**
1. 获取目标大纲的资产名称 (characters/props/scenes)
2. 收集项目其他大纲的所有资产名称
3. 计算仅属于目标大纲的独有资产
4. 删除: 大纲记录 + 独有资产 + 关联剧本

### 6.10 错误标准化 (`src/utils/error.ts`)

**`normalizeError(error)`:**
```typescript
interface NormalizedError {
  name: string;
  message: string;
  code?: string;
  status?: number;
  stack?: string;
  cause?: NormalizedError;
  responseData?: unknown;    // Axios 响应数据
  meta?: Record<string, unknown>;
}
```
- Axios 错误: 提取 response data, status, url, method
- Error 对象: serialize-error 处理
- 非 Error: 字符串化

---

## 7. 路由接口详解

### 7.1 项目管理 (`/project/`)

| 路由 | 方法 | 输入 | 功能 | 数据库 |
|------|------|------|------|--------|
| `/addProject` | POST | name, intro, type, artStyle, videoRatio | 创建项目 | INSERT t_project |
| `/getProject` | POST | - | 获取所有项目 | SELECT t_project |
| `/getSingleProject` | POST | id | 获取单个项目 | SELECT t_project WHERE id |
| `/updateProject` | POST | id, intro?, type?, artStyle?, videoRatio? | 更新项目 | UPDATE t_project |
| `/delProject` | POST | id | 级联删除项目 | DELETE 8 张表 + OSS 清理 |
| `/getProjectCount` | POST | projectId | 统计项目数据 | COUNT t_assets/t_script/t_video |

**级联删除顺序:** t_project → t_novel → t_storyline → t_outline → t_script → t_assets → t_image → t_video → t_chatHistory → OSS 目录

### 7.2 小说管理 (`/novel/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/addNovel` | POST | projectId, data[] | 批量添加章节 |
| `/getNovel` | POST | projectId | 获取章节列表 (按序) |
| `/updateNovel` | POST | id, index, reel, chapter, chapterData | 更新章节 |
| `/delNovel` | POST | id | 删除章节 |

### 7.3 大纲管理 (`/outline/`)

| 路由 | 方法 | 输入 | 功能 | 特殊 |
|------|------|------|------|------|
| `/addOutline` | POST | projectId, data(JSON) | 添加大纲 | - |
| `/getOutline` | POST | projectId | 获取大纲列表 | - |
| `/updateOutline` | POST | id, data(JSON) | 更新大纲 | - |
| `/delOutline` | POST | id, projectId | 删除大纲+关联 | 调用 u.deleteOutline |
| `/agentsOutline` | **WS** | ?projectId | Agent 对话 | WebSocket 流式 |
| `/getStoryline` | POST | projectId | 获取故事线 | - |
| `/updateStoryline` | POST | projectId, content | 更新故事线 | upsert |
| `/getPartScript` | POST | projectId | 获取剧本列表 | - |
| `/updateScript` | POST | id, content | 更新剧本 | - |
| `/getHistory` | POST | projectId | 获取对话历史 | 自动创建 |
| `/setHistory` | POST | projectId, data(JSON) | 保存对话历史 | upsert |

### 7.4 剧本管理 (`/script/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/generateScriptApi` | POST | outlineId, scriptId | AI 生成剧本 |
| `/generateScriptSave` | POST | outlineId, scriptId, content | 手动保存剧本 |
| `/geScriptApi` | POST | projectId | 获取剧本+关联资产 |

### 7.5 资产管理 (`/assets/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/addAssets` | POST | projectId, name, intro, type, prompt, ... | 添加资产 |
| `/getAssets` | POST | projectId, type | 获取资产列表 |
| `/updateAssets` | POST | id, name, intro, type, prompt, ... | 更新资产 |
| `/delAssets` | POST | id | 删除资产 |
| `/getImage` | POST | assetsId | 获取资产图片 |
| `/saveAssets` | POST | id, projectId, base64?, filePath? | 保存资产图片 |
| `/generateAssets` | POST | id, type, projectId, name, prompt, base64? | AI 生成资产图片 |
| `/polishPrompt` | POST | assetsId, projectId, type, name, describe | AI 润色提示词 |
| `/getStoryboard` | POST | projectId | 获取分镜列表 |

**`generateAssets` 详细流程:**
1. 获取项目信息 (artStyle, type, intro)
2. 获取提示词模板
3. 构建系统/用户提示词 (基于 type: role/scene/props/storyboard)
4. 调用 AI Image 生成
5. Sharp 处理 (可选文字叠加)
6. UUID 命名上传至 OSS
7. 记录到 t_image (state="生成成功")

**`polishPrompt` 详细流程:**
1. 获取项目信息
2. 获取所有大纲数据 → 解析角色/道具/场景
3. 匹配目标资产名称
4. 获取关联章节原文
5. 获取润色提示词模板
6. AI Text 结构化输出

### 7.6 分镜管理 (`/storyboard/`)

| 路由 | 方法 | 输入 | 功能 | 特殊 |
|------|------|------|------|------|
| `/chatStoryboard` | **WS** | ?projectId&scriptId | Agent 对话 | WebSocket |
| `/generateStoryboardApi` | POST | filePath, prompt, projectId, assetsId | 生成分镜图 | 调用 editImage |
| `/generateShotImage` | POST | cells, scriptId, projectId, ... | 生成镜头图 | generateImageTool |
| `/getStoryboard` | POST | scriptId, projectId | 获取分镜列表 | 含生成图片 |
| `/saveStoryboard` | POST | results[] | 批量保存分镜 | - |
| `/keepStoryboard` | POST | id, filePath, prompt | 保留分镜图 | 图片替换逻辑 |
| `/uploadImage` | POST | projectId, base64Data | 上传图片 | 纯 OSS |
| `/batchSuperScoreImage` | POST | projectId, scriptId, imageList | 批量超分辨率 | AI 增强 |
| `/generateVideoPrompt` | POST | projectId, scriptId, id, prompt, src | 生成视频提示词 | AI+图片 |

**`generateVideoPrompt` 详细流程:**
1. 获取剧本内容和项目数据
2. 图片 URL → base64
3. AI 分析图片 + 剧本上下文
4. 返回: `{ videoPrompt, duration, name }`

### 7.7 视频管理 (`/video/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/generateVideo` | POST | (见阶段5) | AI 生成视频 (异步) |
| `/addVideo` | POST | scriptId, type, resolution, filePath[], ... | 手动添加视频 |
| `/getVideo` | POST | scriptId, specifyIds? | 获取视频列表 |
| `/saveVideo` | POST | id, filePath, storyboardImgs?, ... | 保存视频 |
| `/addVideoConfig` | POST | scriptId, projectId, configId, mode, ... | 添加视频配置 |
| `/getVideoConfigs` | POST | scriptId | 获取视频配置列表 |
| `/upDateVideoConfig` | POST | id, resolution?, duration?, ... | 更新视频配置 |
| `/deleteVideoConfig` | POST | id | 删除配置+关联视频+文件 |
| `/getVideoStoryboards` | POST | scriptId | 获取视频分镜 |
| `/reviseVideoStoryboards` | POST | storyboardId, prompt, duration | 修改分镜提示词 |
| `/getManufacturer` | POST | userId | 获取视频厂商列表 |
| `/getVideoModel` | POST | userId | 获取视频模型名称 |
| `/generatePrompt` | POST | images, prompt, duration, type? | AI 生成视频提示词 |

### 7.8 系统设置 (`/setting/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/addModel` | POST | type, model, baseUrl, apiKey, manufacturer, modelType | 添加 AI 模型 |
| `/updateModel` | POST | id, type, model, baseUrl, apiKey, manufacturer, modelType | 更新 AI 模型 |
| `/updeteModel` | POST | 同上 | 同上 (拼写错误的副本) |
| `/delModel` | POST | id | 删除模型+更新映射 |
| `/getSetting` | POST | - | 获取非视频模型配置 |
| `/getVideoModelList` | POST | - | 获取视频模型配置 |
| `/getAiModelMap` | POST | - | 获取 AI 模型映射 |
| `/configurationModel` | POST | id, configId | 配置模型映射 |
| `/getLog` | POST | - | 导出应用日志 (仅admin) |

### 7.9 其他接口 (`/other/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/login` | POST | username, password | 登录 (JWT 180天) |
| `/getCaptcha` | GET | - | 获取验证码 (占位) |
| `/testAI` | POST | modelName, apiKey, baseURL?, manufacturer | 测试 AI 文本 |
| `/testImage` | POST | modelName?, apiKey, baseURL?, manufacturer | 测试 AI 图像 |
| `/testVideo` | POST | modelName?, apiKey, baseURL?, manufacturer | 测试 AI 视频 |
| `/clearDatabase` | POST | - | 清空数据库 |
| `/deleteAllData` | POST | - | 删除所有 OSS 文件 |

### 7.10 提示词管理 (`/prompt/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/getPrompts` | GET | - | 获取所有提示词 |
| `/updatePrompt` | POST | id, customValue, code | 更新自定义提示词 |

### 7.11 任务管理 (`/task/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/getTaskApi` | GET | ?projectName&taskName&state&page&limit | 分页查询任务 |
| `/taskDetails` | POST | taskId | 获取任务详情 |

### 7.12 用户管理 (`/user/`)

| 路由 | 方法 | 输入 | 功能 |
|------|------|------|------|
| `/getUser` | GET | - | 获取首个用户 |

---

## 8. Agent 系统详解

### 8.1 OutlineScript Agent (`src/agents/outlineScript/index.ts`)

#### 架构

```
用户消息 ──→ Main Agent (导演台)
                 │          系统提示词: outlineScript-main
                 │
           ┌─────┼──────┐
           ↓     ↓      ↓
          AI1   AI2  Director
        故事师  大纲师   导演
    outlineScript-a1  -a2  -director
```

#### 类结构: `OutlineScript`

**属性:**
- `projectId: number` — 项目 ID
- `emitter: EventEmitter` — 事件发射器
- `history: ModelMessage[]` — 对话历史
- `novelChapters: DB["t_novel"][]` — 已加载章节

#### 工具定义 (Tool)

**数据读取工具:**
- `getChapter({ chapterNumbers })` — 批量获取章节原文
- `getStoryline({})` — 获取故事线
- `getOutline({ simplified })` — 获取大纲 (简化/完整)

**数据写入工具:**
- `saveStoryline({ content })` — upsert 故事线
- `deleteStoryline({})` — 删除故事线
- `saveOutline({ episodes, overwrite, startEpisode? })` — 保存大纲 (覆盖/追加)
- `updateOutline({ id, data })` — 更新单集大纲
- `deleteOutline({ ids })` — 批量删除大纲

**资产工具:**
- `generateAssets({})` — 从大纲提取资产

**子 Agent 调度工具:**
- `AI1({ taskDescription })` — 调用故事师
- `AI2({ taskDescription })` — 调用大纲师
- `director({ taskDescription })` — 调用导演

#### 上下文构建

`buildEnvironmentContext()` 生成环境信息:
```
<环境信息>
项目ID: {id}
系统时间: {time}
{小说名称/简介/类型/风格/画幅}
已加载章节列表: {章节号/分卷/章节名}
故事线状态: 已生成/未生成
大纲状态: 共 N 集
可用工具: [列表]
</环境信息>
```

#### 子 Agent 调用流程

1. 发射 `transfer` 事件
2. 从 `t_prompts` 获取子 Agent 系统提示词
3. 从 `t_aiModelMap` 获取 AI 模型配置 (key: "outlineScriptAgent")
4. 构建完整上下文 (环境 + 历史 + 当前任务)
5. 调用 `u.ai.text.stream()` 流式生成
6. 逐 token 发射 `subAgentStream` 事件
7. 工具调用发射 `toolCall` 事件
8. 完成后发射 `subAgentEnd`，写入历史

#### 大纲保存逻辑

**覆盖模式 (overwrite=true):**
1. 删除所有现有大纲和关联剧本
2. 从第 1 集开始插入

**追加模式 (overwrite=false):**
1. 获取当前最大集数
2. 从 maxEpisode+1 开始插入

**每集大纲插入后:** 自动创建空剧本记录 (`t_script`)

#### 资产生成逻辑

1. 从所有大纲的 JSON 数据中提取 characters/props/scenes
2. 按名称去重 (`uniqueByName`)
3. 对每个资产执行 upsert:
   - 不存在 → 插入
   - 存在但描述不同 → 更新
   - 存在且描述相同 → 跳过

### 8.2 Storyboard Agent (`src/agents/storyboard/index.ts`)

#### 架构

```
用户消息 ──→ Main Agent
                 │          系统提示词: storyboard-main
                 │
           ┌─────┴──────┐
           ↓             ↓
      segmentAgent   shotAgent
        片段师         分镜师
   storyboard-segment  storyboard-shot
```

#### 类结构: `Storyboard`

**属性:**
- `projectId: number`, `scriptId: number`
- `emitter: EventEmitter`
- `history: ModelMessage[]`
- `segments: Segment[]` — 片段数据
- `shots: Shot[]` — 分镜数据
- `shotIdCounter: number` — 分镜 ID 计数器
- `generatingShots: Set<number>` — 正在生成图片的分镜

#### 数据结构

```typescript
interface Segment {
  index: number;
  description: string;
  emotion?: string;
  action?: string;
}

interface Shot {
  id: number;           // 分镜独立 ID
  segmentId: number;    // 对应片段 ID
  title: string;
  x: number; y: number;
  cells: Array<{
    src?: string;       // 生成的图片 URL
    prompt?: string;    // 镜头提示词
    id?: string;        // UUID
  }>;
  fragmentContent: string;
  assetsTags: Array<{ type: "role"|"props"|"scene", text: string }>;
}
```

#### 工具分配

| 工具 | segmentAgent | shotAgent | Main |
|------|:-----------:|:---------:|:----:|
| getScript | Y | Y | Y |
| getAssets | Y | Y | Y |
| updateSegments | Y | - | Y |
| getSegments | - | Y | Y |
| addShots | - | Y | Y |
| updateShots | - | Y | Y |
| deleteShots | - | Y | Y |
| generateShotImage | - | Y | Y |

#### 分镜图生成流程 (`generateShotImage`)

1. 验证分镜存在且未在生成中
2. 标记 `generatingShots.add(shotId)`
3. 发射 `shotImageGenerateStart` 事件
4. **异步执行** (不阻塞 Agent):

```
generateSingleShotImage(shotId):
  │
  ├─ 提取所有镜头提示词
  │
  ├─ generateImageTool(prompts, scriptId, projectId):
  │   ├─ 获取剧本大纲数据
  │   ├─ 加载角色/场景/道具图片
  │   ├─ AI 筛选相关资产 (filterRelevantAssets)
  │   ├─ 压缩图片 (单张≤3MB, 超10张合并, 总计≤10MB)
  │   ├─ 构建资源映射提示词 (人物1=图片1)
  │   ├─ generateImagePromptsTool 优化提示词
  │   └─ 调用 AI Image 生成宫格图
  │
  ├─ imageSplitting(gridImage, count):
  │   ├─ 计算网格: 1→1x1, 2→2x1, 3→3x1, 4→2x2, 5-9→3x3
  │   ├─ sharp.extract() 逐格切割
  │   └─ 返回 PNG Buffer 数组
  │
  ├─ 保存到 OSS: {projectId}/chat/{scriptId}/storyboard/shot_{id}_take_{i}_{ts}.png
  │
  └─ 更新 shot.cells[].src → 发射 shotsUpdated
```

#### WebSocket 事件

| 事件 | 数据 | 说明 |
|------|------|------|
| `data` | text | Main Agent 文本流 |
| `subAgentStream` | { agent, text } | 子 Agent 文本流 |
| `subAgentEnd` | { agent } | 子 Agent 完成 |
| `toolCall` | { agent, name, args } | 工具调用 |
| `transfer` | { to } | Agent 切换 |
| `refresh` | type | 数据更新 |
| `segmentsUpdated` | Segment[] | 片段数据更新 |
| `shotsUpdated` | Shot[] | 分镜数据更新 |
| `shotImageGenerateStart` | { shotIds } | 开始生成图片 |
| `shotImageGenerateProgress` | { shotId, status, message, progress? } | 生成进度 |
| `shotImageGenerateComplete` | { shotId, shot, imagePaths } | 生成完成 |
| `shotImageGenerateError` | { shotId, error } | 生成失败 |

### 8.3 分镜图像工具

#### `generateImageTool.ts`

**`compressImage(base64, maxSize=3MB)`:**
迭代降质 (90→10) → 缩放 (0.8x)

**`mergeImages(base64List, maxSize=10MB)`:**
水平拼接，等高等比

**`ensureTotalSizeLimit(images, maxSize=10MB)`:**
按大小排序，优先压缩大图

**`processImages(images, maxCount=10)`:**
前 9 张独立压缩，第 10+ 合并为一张

**`filterRelevantAssets(cells, resources, config)`:**
AI 筛选当前分镜相关的角色/场景/道具

**`buildResourcesMapPrompts(resources)`:**
```
可用资源参考：
人物1=图1 [人物名]
场景1=图2 [场景名]
...
```

#### `generateImagePromptsTool.ts`

**`calculateGridLayout(count)`:** 计算网格布局

**`getAspectRatioDescription()`:** 比例→描述映射
- 16:9 → "电影宽银幕"
- 9:16 → "竖屏短剧"

**`generateGridPrompt(options)`:**
1. 构建网格位置模板: `[第1行第1列]: content`
2. 加入资产描述
3. AI 优化提示词
4. 返回 `{ prompt, gridLayout }`

#### `imageSplitting.ts`

**`imageSplitting(image, length)`:**
1. 获取网格布局
2. `cellWidth = totalWidth / cols`
3. `cellHeight = totalHeight / rows`
4. `sharp.extract({ left, top, width, height })` 逐格
5. 返回 PNG Buffer 数组

---

## 9. 文件存储系统

详见 6.3 节。

**文件路径组织:**
```
uploads/
  └── {projectId}/
      ├── assets/
      │   ├── role/{uuid}.jpg        # 角色图
      │   ├── scene/{uuid}.jpg       # 场景图
      │   └── props/{uuid}.jpg       # 道具图
      ├── storyboard/{uuid}.jpg      # 分镜图
      └── chat/
          └── {scriptId}/
              └── storyboard/
                  └── shot_{shotId}_take_{i}_{ts}.png  # 镜头图
```

---

## 10. 认证与安全

**认证方式:** JWT Token (jsonwebtoken)

**登录流程:**
1. POST `/other/login` { username, password }
2. 查询 `t_user` 验证
3. 获取 `t_setting.tokenKey` (8字符 UUID)
4. 签发 JWT: `{ userId, username }`, 有效期 180 天
5. 返回 `Bearer {token}`

**请求认证:**
- Header: `Authorization: Bearer {token}`
- 或 Query: `?token={token}`
- 白名单: `/other/login`

---

## 11. 提示词管理系统

**存储:** `t_prompts` 表，`code` 唯一标识

**优先级:** `customValue` > `defaultValue`

**关键提示词:**

| Code | 用途 | 分类 |
|------|------|------|
| `outlineScript-main` | OutlineScript 主 Agent | Agent |
| `outlineScript-a1` | 故事师 Agent | Agent |
| `outlineScript-a2` | 大纲师 Agent | Agent |
| `outlineScript-director` | 导演 Agent | Agent |
| `storyboard-main` | Storyboard 主 Agent | Agent |
| `storyboard-segment` | 片段师 Agent | Agent |
| `storyboard-shot` | 分镜师 Agent | Agent |
| `polishPrompt-role` | 角色提示词润色 | 资产 |
| `polishPrompt-scene` | 场景提示词润色 | 资产 |
| `polishPrompt-props` | 道具提示词润色 | 资产 |
| `generateAssets-*` | 资产图片生成 | 资产 |

---

## 12. 部署架构

### 12.1 Electron 桌面客户端

**electron-builder.yml 配置:**
- appId: `net.toonflow.www`
- productName: `ToonFlow`
- ASAR: 启用 (代码打包加密)
- Windows: NSIS 安装器 + 便携版 (per-machine)
- macOS: DMG + ZIP
- Linux: AppImage + deb

**排除文件:** .md, .map, LICENSE, .d.ts, .ts, README, src/

### 12.2 Docker 部署

**生产 Dockerfile (多阶段构建):**

**阶段 1 - 构建:**
- 基础: node:24-alpine + git
- 支持 GitHub / Gitee 源
- 动态版本: TAG > BRANCH > 最新 tag > 默认分支
- NPM 镜像: npmmirror.com
- esbuild 编译

**阶段 2 - 运行:**
- 基础: node:24-alpine + nginx + supervisor
- Supervisor 管理两个进程:
  - nginx (前端静态资源, 端口 80)
  - PM2 → app.js (后端 API, 端口 60000)
- nginx SPA 路由 (try_files)
- 日志重定向 stdout/stderr

**docker-compose.yml:**
- 构建参数: GIT, TAG, BRANCH
- 健康检查: wget 端口 80, 每 30s, 40s 启动延迟
- Volume: logs 持久化

**docker-compose.local.yml:**
- 使用本地源码 (无 git clone)
- 端口 8080→80

### 12.3 云端部署

**PM2 集群模式:**
```json
{
  "name": "toonflow-app",
  "script": "build/app.js",
  "instances": "max",
  "exec_mode": "cluster",
  "env": {
    "NODE_ENV": "prod",
    "PORT": 60000,
    "OSSURL": "http://127.0.0.1:60000/"
  }
}
```

---

## 13. 构建与 CI/CD

### 13.1 构建脚本 (`scripts/build.ts`)

**esbuild 并行编译:**
1. 自动创建 `.env.prod` (如不存在)
2. 编译 `src/app.ts` → `build/app.js` (CJS, node 平台)
3. 编译 `scripts/main.ts` → `build/main.js` (CJS, node 平台)
4. External: electron, sqlite3, better-sqlite3 (不打包)
5. Minification: 关闭

### 13.2 GitHub Actions (`release.yml`)

**触发:** git tag push

**流程:**

```
push tag → build-windows (windows-latest)
         → build-macos (macos-latest)
              ↓
         → release (ubuntu, 依赖两个构建)
              ↓
           创建 GitHub Release
           上传 .exe/.zip/.dmg
           beta/alpha 标记为 prerelease
```

**产物保留:** 30 天

### 13.3 许可证检查 (`scripts/license.ts`)

- 扫描直接依赖
- 生成 `NOTICES.txt`
- 格式: Name, License, Repository

### 13.4 TypeScript 配置 (`tsconfig.json`)

```json
{
  "target": "ESNext",
  "module": "CommonJS",
  "strict": true,
  "moduleResolution": "Node",
  "outDir": "build",
  "paths": { "@/*": ["src/*"] },
  "sourceMap": false,
  "incremental": true,
  "resolveJsonModule": true
}
```

---

## 14. 项目目录结构

```
Toonflow-app/
├── .dockerignore                 # Docker 排除列表
├── .github/
│   └── workflows/
│       └── release.yml           # CI/CD 发布流水线
├── .gitignore                    # Git 忽略配置
├── backup/                       # 旧版代码备份
│   └── agents/
│       ├── models.ts             # 旧版模型配置 (LangChain)
│       ├── outlineScript/index.ts
│       └── storyboard/
│           ├── generateImagePromptsTool.ts
│           ├── generateImageTool.ts
│           ├── imageSplitting.ts
│           └── index.ts
├── docker/
│   ├── Dockerfile                # 生产多阶段构建
│   ├── Dockerfile.local          # 本地构建
│   ├── docker-compose.yml        # 生产编排
│   └── docker-compose.local.yml  # 本地编排
├── docs/
│   ├── README.en.md              # 英文 README
│   ├── logo.png, chat*QR.jpg     # 资源图片
│   ├── sponsored/sophnet.png     # 赞助商
│   └── plans/
│       └── 2026-02-16-architecture-analysis-design.md  # 本文档
├── electron-builder.yml          # Electron 打包配置
├── env/
│   ├── .env.dev                  # 开发环境变量
│   └── .env.prod                 # 生产环境变量
├── LICENSE                       # AGPL-3.0
├── NOTICES.txt                   # 第三方依赖声明
├── package.json                  # 项目配置 (v1.0.6)
├── README.md                     # 中文项目说明
├── scripts/
│   ├── build.ts                  # esbuild 构建脚本
│   ├── license.ts                # 许可证扫描
│   ├── logo.ico, logo.png        # 应用图标
│   ├── main.ts                   # Electron 主进程
│   └── web/
│       ├── favicon.ico           # 网站图标
│       └── index.html            # 前端 SPA 入口 (编译产物)
├── src/
│   ├── app.ts                    # Express 服务入口
│   ├── core.ts                   # 路由自动生成器
│   ├── router.ts                 # 自动生成的路由 (勿手动修改)
│   ├── env.ts                    # 环境变量加载
│   ├── err.ts                    # 全局异常处理
│   ├── logger.ts                 # 日志系统 (文件+console)
│   ├── utils.ts                  # 工具聚合导出
│   ├── agents/
│   │   ├── outlineScript/
│   │   │   └── index.ts          # 故事线/大纲 Agent (737行)
│   │   └── storyboard/
│   │       ├── index.ts          # 分镜 Agent (733行)
│   │       ├── generateImageTool.ts      # 分镜图生成 (~335行)
│   │       ├── generateImagePromptsTool.ts # 提示词优化 (~129行)
│   │       └── imageSplitting.ts          # 宫格图分割 (~95行)
│   ├── lib/
│   │   ├── initDB.ts             # 数据库初始化 (16表)
│   │   ├── fixDB.ts              # 数据库迁移
│   │   └── responseFormat.ts     # { code, data, message }
│   ├── middleware/
│   │   └── middleware.ts         # Zod 校验 (中文)
│   ├── routes/                   # 77 个路由文件
│   │   ├── assets/     (9)       # addAssets, delAssets, generateAssets,
│   │   │                         # getAssets, getImage, getStoryboard,
│   │   │                         # polishPrompt, saveAssets, updateAssets
│   │   ├── index/      (1)       # index
│   │   ├── novel/      (4)       # addNovel, delNovel, getNovel, updateNovel
│   │   ├── other/      (7)       # clearDatabase, deleteAllData, getCaptcha,
│   │   │                         # login, testAI, testImage, testVideo
│   │   ├── outline/    (11)      # addOutline, agentsOutline(WS), delOutline,
│   │   │                         # getHistory, getOutline, getPartScript,
│   │   │                         # getStoryline, setHistory, updateOutline,
│   │   │                         # updateScript, updateStoryline
│   │   ├── project/    (6)       # addProject, delProject, getProject,
│   │   │                         # getProjectCount, getSingleProject, updateProject
│   │   ├── prompt/     (2)       # getPrompts, updatePrompt
│   │   ├── script/     (3)       # geScriptApi, generateScriptApi, generateScriptSave
│   │   ├── setting/    (8)       # addModel, configurationModel, delModel,
│   │   │                         # getAiModelMap, getLog, getSetting,
│   │   │                         # getVideoModelList, updateModel, updeteModel
│   │   ├── storyboard/ (9)       # batchSuperScoreImage, chatStoryboard(WS),
│   │   │                         # generateShotImage, generateStoryboardApi,
│   │   │                         # generateVideoPrompt, getStoryboard,
│   │   │                         # keepStoryboard, saveStoryboard, uploadImage
│   │   ├── task/       (2)       # getTaskApi, taskDetails
│   │   ├── user/       (1)       # getUser
│   │   └── video/      (13)      # addVideo, addVideoConfig, deleteVideoConfig,
│   │                              # generatePrompt, generateVideo, getManufacturer,
│   │                              # getVideo, getVideoConfigs, getVideoModel,
│   │                              # getVideoStoryboards, reviseVideoStoryboards,
│   │                              # saveVideo, upDateVideoConfig
│   ├── types/
│   │   └── database.d.ts        # 自动生成的数据库类型
│   └── utils/
│       ├── ai/
│       │   ├── text/
│       │   │   ├── index.ts      # LLM 统一接口 (stream/invoke)
│       │   │   └── modelList.ts  # 46 个模型配置
│       │   ├── image/
│       │   │   ├── index.ts      # 图像统一接口
│       │   │   ├── modelList.ts  # 10+ 模型配置
│       │   │   └── owned/
│       │   │       ├── volcengine.ts  # 火山引擎
│       │   │       ├── kling.ts       # 可灵 (JWT 认证)
│       │   │       ├── gemini.ts      # Google Gemini
│       │   │       ├── vidu.ts        # Vidu (双 URL)
│       │   │       ├── runninghub.ts  # RunningHub (文件上传)
│       │   │       ├── apimart.ts     # ApiMart (任务轮询)
│       │   │       └── other.ts       # 通用 OpenAI 兼容
│       │   ├── video/
│       │   │   ├── index.ts      # 视频统一接口
│       │   │   ├── modelList.ts  # 30+ 模型配置
│       │   │   └── owned/
│       │   │       ├── volcengine.ts  # Doubao Seedance
│       │   │       ├── kling.ts       # 可灵
│       │   │       ├── vidu.ts        # Vidu
│       │   │       ├── wan.ts         # 万象
│       │   │       ├── gemini.ts      # Veo
│       │   │       ├── runninghub.ts  # RunningHub/Sora
│       │   │       ├── apimart.ts     # ApiMart/Sora
│       │   │       └── other.ts       # 通用
│       │   ├── generateVideo.ts  # 视频生成辅助
│       │   └── utils.ts          # validateVideoConfig, pollTask
│       ├── db.ts                 # SQLite/Knex 连接
│       ├── oss.ts                # 本地文件存储 (安全路径)
│       ├── editImage.ts          # 图片编辑 (别名解析+AI)
│       ├── imageTools.ts         # 压缩/合并 (sharp)
│       ├── error.ts              # 错误标准化
│       ├── getConfig.ts          # AI 配置查询
│       ├── getPromptAi.ts        # 提示词 AI 配置
│       ├── number2Chinese.ts     # 数字→中文
│       └── deleteOutline.ts      # 大纲级联删除
├── tsconfig.json                 # TypeScript 配置
└── yarn.lock                     # 依赖锁定
```

---

## 15. 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 数据库 | SQLite + Knex | 单用户/小团队，无需外部数据库 |
| 路由注册 | 文件系统自动生成 | 避免手动维护，MD5 防重复写入 |
| AI 调用 | Vercel AI SDK v6 | 统一多厂商 LLM，流式+结构化 |
| Agent 通信 | WebSocket + EventEmitter | 实时流式 + 进度回调 |
| 文件存储 | 本地 OSS 抽象 | 适配 Electron/服务端双环境 |
| 桌面客户端 | Electron | 前后端一体打包，零配置 |
| 提示词管理 | 数据库存储 | 用户可自定义，无需改代码 |
| 图片生成 | 宫格图+分割 | 一次 API 生成多镜头，省成本 |
| 视频生成 | 异步轮询 | 耗时操作，立即返回 ID |
| 类型安全 | 自动生成 database.d.ts | 编译时检查数据库操作 |
| 多 Agent | 主 Agent + 子 Agent | 分工明确，各司其职 |
| 备份代码 | backup/ 目录 | 保留旧版 LangChain 实现 |

---

## 附录 A：前端仓库

前端代码: [Toonflow-web](https://github.com/HBAI-Ltd/Toonflow-web)
构建后 `dist/` → `scripts/web/` 目录

## 附录 B：backup 目录说明

`backup/` 保留了旧版基于 LangChain 的实现:
- `models.ts`: 使用 ChatOpenAI 的模型抽象
- `outlineScript/index.ts`: 旧版大纲 Agent (LangChain 风格)
- `storyboard/`: 旧版分镜工具

当前版本已迁移到 Vercel AI SDK (`ai` 包)。

## 附录 C：第三方依赖

核心依赖 (from package.json):
- **AI:** @ai-sdk/anthropic, @ai-sdk/deepseek, @ai-sdk/google, @ai-sdk/openai, @ai-sdk/xai, ai, qwen-ai-provider, zhipu-ai-provider
- **Web:** express, express-ws, cors, morgan
- **数据库:** better-sqlite3, knex, @rmp135/sql-ts
- **图像:** sharp
- **HTTP:** axios, axios-retry, form-data
- **安全:** jsonwebtoken, js-md5
- **验证:** zod
- **工具:** uuid, dotenv, fast-glob, serialize-error, best-effort-json-parser, is-path-inside

开发依赖:
- **构建:** typescript, tsx, cross-env
- **桌面:** electron, electron-builder, electronmon
- **其他:** license-checker, nodemon
