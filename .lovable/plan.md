

# 计划：统一两端 AI 助手输出格式与呈现规范（含学生端）

## 目标
- 解决"杂乱符号"（裸露 `**`、`###`、`---`、`|`）和列表/表格不清晰
- 学生端、教师端、管理员端**三端统一**渲染管线与输出契约
- 必要时由轻量国产模型做"二次整理"，去除原生生成痕迹

## 一、前端：统一渲染层（三端共用）

新建 `src/components/AssistantMessage.tsx` —— 学生端 `AiAssistant.tsx` 与员工端 `StaffAiAssistant.tsx` 共用：

1. **Markdown 渲染**：引入 `react-markdown` + `remark-gfm` + `rehype-sanitize`，废弃 `whitespace-pre-wrap` 裸显
2. **样式 token**：Tailwind `prose prose-sm max-w-none` + 自定义覆盖
   - 标题：h1/h2/h3 收敛为同一字号 + 主题色小色块前缀
   - 列表：紧凑行距，嵌套≤2 层
   - 表格：shadcn `<Table>` 包裹，圆角斑马纹，可横向滚
   - 引用：左侧主题色竖条；代码：浅底等宽
3. **结构化卡片**：识别后端 `sections` 字段，按"结论 / 依据 / 补充 / 操作建议"分卡渲染，每卡有图标 + chip 标题，不再依赖正文里的"结论："字样
4. **fallback**：只有 `answer` 时仍跑 markdown 管线
5. **学生端三段式特殊适配**：保留"结论 / 依据 / 补充"语义，但用三张紧凑卡片替代三行纯文本，视觉与员工端统一

替换点：
- `src/components/AiAssistant.tsx` 第 142-148 行：`<div … whitespace-pre-wrap>{m.content}</div>` → `<AssistantMessage content={m.content} sections={m.sections}/>`，HINT_MSG / WELCOME 同样走新渲染
- `src/components/StaffAiAssistant.tsx` 第 140-147 行：同上替换；候选学生卡 / stats 卡 / 跳转按钮逻辑保留

## 二、前端清洗工具

新建 `src/lib/sanitizeMarkdown.ts`：
- 折叠 ≥3 个连续 `*`/`-`/`=` 分割线为单条 `<hr>`
- 去除常见寒暄："作为 AI 助手…""根据您提供的信息…""我将为您…"
- 孤立 `|` 表格残片转列表
- 多空行规范为 1 空行
- 去除模型偶尔输出的 ```` ```markdown ```` 包裹

## 三、后端：输出契约统一

### 1. 共享格式化器
新建 `supabase/functions/_shared/format-answer.ts`：
- `normalizeMarkdown(raw)`：服务端清洗（同上规则）
- `toSections(raw)`：切分"结论/依据/补充/操作建议"四段为 `{key,title,body}[]`，未命中放 `summary`
- 统一返回：`{ answer, sections?, meta?: { polished: boolean } }`

### 2. `ask-credit-assistant`（学生端）
- SYSTEM_PROMPT 调整：
  > 用 markdown 输出三段：`## 结论` / `## 依据` / `## 补充`。允许无序列表、表格、加粗。禁止一级标题、emoji、分割线、代码块、寒暄开场
- 现有硬编码回复（"暂无您的申请记录"、"未找到相关认定规则…"）也走 `normalizeMarkdown` + `toSections`，与员工端视觉一致
- "我的学分汇总"由当前长文本换为表格化提示词，模型更易输出整齐表格

### 3. `staff-ai-assistant`（教师/管理员端）
- SYSTEM_PROMPT 增补"输出格式"：
  > 结论一句先行；列表 ≥5 行必须用表格呈现；不要写"我将为您查询…"等过程语；只用 ##、列表、表格、加粗
- 工具结果向 LLM 注入时预格式化为 markdown 表格，减少模型自由发挥
- 返回前同样跑 `normalizeMarkdown` + `toSections`

### 4. 二次整理（按需触发）
新建 edge function `polish-answer`（默认 DeepSeek，可切 Qwen，温度 0，max_tokens 800）

触发条件（在两个助手内部判断，避免每次都调）：
1. 原始 answer > 600 字 **或**
2. 含 ≥3 处疑似杂乱符号（正则 `\*{3,}`、孤立 `|`、连续 `###`） **或**
3. 工具调用 ≥2 次（员工端复杂回答）

提示词："你是排版编辑。在不增减事实、不改动数字/姓名/学号/学分的前提下，把内容改写为整洁 markdown：先一句结论，列表/表格陈列要点，去除寒暄与冗余符号。"

失败/超时（>3s）→ 回退原文，不阻塞主流程。返回 `meta.polished=true`，前端显示淡灰"已整理"小标。

复用已有 `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY`，无需新 secret。

## 四、依赖与配置

新增前端依赖：`react-markdown`、`remark-gfm`、`rehype-sanitize`

无新数据库迁移，无新 secrets。`supabase/config.toml` 注册 `polish-answer`（`verify_jwt = false`，由两个助手内部 service-to-service 调用）。

## 五、技术架构

```text
┌─────────────── 用户问 (学生 / 教师 / 管理员) ───────────────┐
│   edge function (ask-credit / staff-ai)                    │
│   ├─ 业务逻辑 + LLM 生成 raw                                │
│   ├─ normalizeMarkdown(raw)                                │
│   ├─ 触发器命中? → polish-answer ─→ DeepSeek/Qwen 排版整理 │
│   ├─ toSections() → sections[]                             │
│   └─ return { answer, sections, meta }                     │
│                                                            │
│   <AssistantMessage>  (三端共用)                           │
│   ├─ sections 存在 → 卡片式分块渲染 (结论/依据/补充/操作)  │
│   └─ 否则 → react-markdown + sanitize 渲染 answer          │
└────────────────────────────────────────────────────────────┘
```

## 六、文件改动清单

新建：
- `src/components/AssistantMessage.tsx`
- `src/lib/sanitizeMarkdown.ts`
- `supabase/functions/_shared/format-answer.ts`
- `supabase/functions/polish-answer/index.ts`

修改：
- `src/components/AiAssistant.tsx`（学生端）
- `src/components/StaffAiAssistant.tsx`（教师/管理员端）
- `package.json`（3 个新依赖）
- `supabase/functions/ask-credit-assistant/index.ts`
- `supabase/functions/staff-ai-assistant/index.ts`
- `supabase/config.toml`（注册 polish-answer）

## 七、用户需要确认

执行前请批准：1）安装 3 个 npm 依赖；2）新建 + 修改上述前后端文件；3）部署 3 个 edge function。所有"二次整理"严格遵守"不改数字/姓名/学号/学分"，失败自动回退原文，不会影响数据准确性。

