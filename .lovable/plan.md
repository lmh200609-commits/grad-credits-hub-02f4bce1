## 问题
截图中聊天气泡里出现了原样的 `**`、`1️⃣`、`📎` 等"AI 感"符号。原因有两处：

1. **管理员导入页的 AI 气泡用纯文本渲染**（`whitespace-pre-wrap`，没经过 Markdown），所以 `**不会**` 这种 markdown 加粗符号被原样显示。
2. **硬编码问候语 + 后端系统提示词** 大量使用 `**加粗**`、`①②③`、`1️⃣`、`⚠️`、`📎`、`👇` 等装饰，AI 也学着这样输出。

## 改动范围

### 1. 新增「纯文本净化」工具
- 在 `src/lib/sanitizeMarkdown.ts` 新增导出 `toPlainText(input)`：去掉 `**x**` / `__x__` / `*x*` / `_x_` / 行首 `#`、`>`、表情数字 `1️⃣–9️⃣`、装饰性 emoji（⚠️ 📎 👇 ✅ ❌ 🎉 🤖 …仅在前端展示前剥离，不影响业务文本）保留正文内容。
- 同时在原有 `sanitizeMarkdown` 内剥离 `1️⃣–9️⃣`、行首装饰 emoji，让 Markdown 渲染也更干净。

### 2. 前端：所有「纯文本 AI 气泡」走净化
- `src/pages/admin/ImportUsers.tsx` `MessageBubble` 中 `kind === "ai"` 分支改为 `{toPlainText(msg.text)}`。
- 检查 `AiVerdictCard.tsx`、`SubmissionRecords.tsx`、`ApplicationDetail.tsx` 三处 `whitespace-pre-wrap`，如果展示的是 AI/系统生成文本，也套 `toPlainText`。

### 3. 前端：硬编码问候语去掉「AI 感」
- `ImportUsers.tsx` 第 182 行的导入引导语重写为干净中文：去掉 `**`、`1️⃣`、`⚠️`、`📎`、`👇`，保持步骤清晰但语气自然。例如：

  ```text
  这里只能识别和预览数据，账号需要按下面三步手工创建：
  1. 点击输入框左侧的「上传文件」按钮，选择 Excel 或 CSV
  2. 在弹出的预览表中核对数据（异常行会标红）
  3. 点击预览下方的「确认导入」按钮才会真正写入
  完成后会出现绿色的成功卡片。
  ```

### 4. 后端：所有 AI 提示词禁用 markdown 装饰
对以下 edge functions 的 SYSTEM_PROMPT 增加一条强制约束 ——
**「禁止使用 `**` `__` `*` `_` `#` 等 markdown 强调符号；禁止使用 ⚠️📎👇✅❌🎉🤖 等装饰性 emoji 和 1️⃣2️⃣3️⃣ 等带圈数字。需要强调时直接用「」书名号或换行。」**
并把现有提示词内已有的 `**` 全部去掉：

- `supabase/functions/import-assistant-chat/index.ts`
- `supabase/functions/staff-ai-assistant/index.ts`
- `supabase/functions/ask-credit-assistant/index.ts`
- `supabase/functions/ai-explain-import/index.ts`
- `supabase/functions/polish-answer/index.ts`

### 5. 后端：返回前再清洗一次（防御性）
在上述每个聊天类 edge function 返回 `answer` 之前，调用一个共享的 `stripDecorations(text)` 工具（放到 `supabase/functions/_shared/format-answer.ts`），剥离 `**` `__` `*` `_` 强调符与装饰 emoji。这样即使模型偶尔违规，用户也看不到。

`evaluate-application` / `ai-parse-roster` 是结构化 JSON 输出，不影响展示，不修改。

## 不改动
- `AssistantMessage.tsx` 的 ReactMarkdown 渲染保留（其他页面的 AI 助手仍走 markdown，`**` 在那里能正确渲染为粗体；本次只解决「纯文本气泡」与「过度装饰」两个真问题）。
- 业务表格、审核数据、导入数据本身不做字符过滤。

## 验收
- 重新打开管理员「批量导入账号」页，发送任意一句话或点击快速提问，气泡里不再出现 `**`、`1️⃣`、`📎` 等字符。
- 老师端 / 学生端 AI 助手回答里不再出现 `**xxx**` 这种符号。
- 导入流程功能不变，只是文案更克制自然。