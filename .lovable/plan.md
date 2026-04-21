
## 替换 AI 模型为通义千问 + 架构优化

将系统默认 AI 模型从 Gemini 替换为通义千问（DashScope），DeepSeek 作为可选补充。同时严格分离"Excel 解析/入库（纯后端逻辑）"与"AI 语义辅助"两个职责。

### 现状盘点

| 调用点 | 当前模型 | 用途 |
|---|---|---|
| `ai-parse-roster` | Lovable Gateway → `google/gemini-2.5-flash` | 名册列名映射 |
| `evaluate-application` | DashScope → `qwen3-vl-32b-thinking` | 申请审核（已是 Qwen，保留） |
| `ask-credit-assistant` | DeepSeek → `deepseek-chat` | 学生问答（保留为 DeepSeek 补充） |
| `import-users` | 无 AI | 批量建账号（已是纯后端，需优化失败解释） |

已具备 `DASHSCOPE_API_KEY` 与 `DEEPSEEK_API_KEY`，无需新增 secret。

---

### 改动总览

#### 1. 新建公共 AI 调用层（Edge Function 内）
新文件：`supabase/functions/_shared/ai-client.ts`
- 封装 `callQwen(messages, opts)` → DashScope `qwen-plus`（默认）/ `qwen-turbo`（高并发轻量）
- 封装 `callDeepseek(messages, opts)` → `deepseek-chat`（可选补充）
- 统一 `callAI(messages, { provider: "qwen" | "deepseek", jsonMode, tools })`，默认 `qwen`
- 统一处理：429 / 402 / 超时 / JSON 修复 / 重试（指数退避，最多 2 次）
- 注：Edge Function 不支持跨函数 import 子目录，因此该文件以"模板"方式分别复制到每个函数目录中（`ai-parse-roster/_ai.ts`、`ai-explain-import/_ai.ts`），保持逻辑一致即可。

#### 2. 改造 `ai-parse-roster`（语义识别 → 通义千问）
- 模型：`google/gemini-2.5-flash` → **`qwen-plus`**（DashScope OpenAI 兼容端点 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`）
- **强化"只送样本，不送全量"的契约**：
  - 仅取前 5 行 + 全部列名 → 让 AI 输出 `mapping` JSON
  - AI 调用使用 `response_format: { type: "json_object" }`
  - 全量行数据在 Deno 端用 mapping 本地映射（已有逻辑，保留）
- 增加保护：单次请求 sample 字符串 > 8KB 时截断，防止 prompt 注入与超额计费
- 错误码透传：429/402 → 中文友好提示

#### 3. 新建 `ai-explain-import`（导入失败原因解释，可选）
新 Edge Function：`supabase/functions/ai-explain-import/index.ts`
- 入参：`{ errors: [{line, message, row?}], total }` —— 仅传**结构化错误摘要**，不传整份 Excel
- 调用 `qwen-turbo`（轻量、便宜、并发友好）生成自然语言中文解释与修复建议
- 输出：`{ summary, suggestions: string[] }`
- 在 `import-users` 失败返回时，由前端 `ImportUsers.tsx` 触发该函数获得人类可读的错误说明

#### 4. 优化 `import-users` 并发与批处理
现状已有 `CONCURRENCY = 10` 并行创建。改进：
- **分片入队**：将 `rows` 切为 `BATCH_SIZE = 200` 的 chunk，逐 chunk 串行、chunk 内并行 → 避免 Auth API burst 触发上游限流
- **冲突预检批量化**：当前 `in("student_no", chunk)` 已 500/批，保留
- **失败收敛**：失败时不再"全量回滚"，改为"已成功的保留 + 返回失败行清单 + 调用 `ai-explain-import` 给出说明"。前端展示成功/失败两栏，允许用户下载失败行 CSV 重导。
  - （此为破坏性行为变更，列入计划征求确认 → 默认保留旧"全量回滚"，新增 `partial: true` 入参开启部分提交模式）
- 增加每 chunk 完成的进度日志，便于在 Edge Function logs 排查 2000+ 行的卡点

#### 5. 学生端问答 `ask-credit-assistant`
- 保留 DeepSeek 作为"高并发/低成本补充"（符合需求）
- 增加 `provider` 入参（默认 `deepseek`，可切 `qwen`），方便后台 A/B
- 仍只把"已检索到的相关规则文本片段"喂给模型，不送全库（现状已如此，确认保留）

#### 6. 申请审核 `evaluate-application`
- 已使用 `qwen3-vl-32b-thinking`（多模态），符合要求 → **不改模型**
- 复核：仅传单条申请的结构化字段 + 附件 URL，不传跨用户数据 → 当前实现合规

#### 7. 前端微调
- `src/pages/admin/ImportUsers.tsx`：
  - 导入失败时调用 `ai-explain-import`，在错误面板顶部展示 AI 给出的"原因摘要 + 建议"
  - 增加"下载失败行 CSV"按钮（仅在开启 `partial` 模式时）
- 不改其他页面 UI

---

### 架构合规性核对（对照需求）

| 需求 | 落地方式 |
|---|---|
| 主模型 = 通义千问 | `ai-parse-roster` / `ai-explain-import` 默认 `qwen-plus`/`qwen-turbo` |
| DeepSeek 作为补充 | `ask-credit-assistant` 保留 DeepSeek，统一 client 支持切换 |
| Excel 解析/入库纯后端 | `import-users` 不调 AI；`ai-parse-roster` 仅做"列名映射"，行数据由 Deno 本地处理 |
| AI 仅用于字段语义识别 | `ai-parse-roster` 输出仅是 `mapping` JSON |
| AI 用于失败原因解释 | 新 `ai-explain-import` 函数 |
| 禁止整份 Excel 入模型 | sample = 前 5 行 + 列名，硬编码 8KB 截断保护 |
| 高并发批量优化 | `import-users` 分片队列（200/chunk × 10 并发）+ Qwen 调用退避重试 |

### 不改动
- 数据库 schema、RLS 策略
- `src/integrations/supabase/types.ts`
- 现有 Storage bucket、认证流程
- 学生端 `AiAssistant` 的 UI 引导（上轮已完成）

### 待确认（如需要可一并确认；否则按"默认值"实施）
- 默认 Qwen 模型档位：`qwen-plus`（精度优先） vs `qwen-turbo`（速度/成本优先）→ **默认 `qwen-plus` 用于列名映射，`qwen-turbo` 用于错误解释**
- `import-users` 是否启用"部分提交"模式 → **默认仍为全量回滚，新增可选 `partial` 开关，前端暂不暴露**
