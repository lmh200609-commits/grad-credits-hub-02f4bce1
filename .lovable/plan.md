## 问题

工作助手目前没有"账号导入溯源"工具，因此无法回答「某账号是谁导入的、什么时候导入的」。所有导入事件实际上都已写入 `public.audit_logs`（action = `import_users`，actor_email、target_ids、target_labels、created_at、metadata 都齐全），只是 AI 拿不到。

## 关于「信息工程学院 · 张三」的答案（直接查库已得到）

该院有两个张三，导入信息分别为：

- 张三 / 学号 20240001：2026-05-09 07:10:03（北京时间 15:10:03），由 `13647488835@admin.local` 通过批量导入（文件 `账号导入模板.xlsx`）创建。
- 张三 / 学号 20240002：2026-05-09 07:18:18（北京时间 15:18:18），同一管理员 `13647488835@admin.local`，同一模板文件再次导入。

回答完整问题时建议要求用户提供学号区分。

## 修复方案

只改一份 edge function：`supabase/functions/staff-ai-assistant/index.ts`。

1. 新增工具 `account_provenance(query)`：
   - 入参：学号或姓名（可加院系修饰，函数内部只取关键词）。
   - 实现步骤：
     a. 在 `profiles` 中按 `student_no = query` 精确匹配；若无，再按 `full_name ilike %query%` 匹配，必要时按 `department` 进一步过滤。
     b. 收集匹配到的 `user_id` 与 `student_no` 列表。
     c. 查询 `audit_logs`：`action = 'import_users'` 且 (`target_ids && {user_ids}` 或 `target_labels && {student_nos}`)，按 `created_at` 升序。
     d. 返回结构：`{ matches: [{ user_id, full_name, student_no, department, class_name, imported_at, imported_by_email, file_name, audit_log_id }], note }`。命中 0 条时返回 `{ matches: [], note: "audit_logs 中无导入记录" }`，禁止 AI 编造。
   - 同名多人时返回多条，让 AI 在回复中列出并提示用学号区分。

2. 在 `TOOLS` 数组里追加该工具的 OpenAI function schema。

3. 更新 `SYSTEM_PROMPT`：
   - 在能力清单里加 `account_provenance(query)：查询某账号是谁、什么时候、用什么文件导入的（来源 audit_logs）`。
   - 在行为约束里追加：「询问"账号是谁导入的/什么时候创建的/导入来源"必须先调用 account_provenance；返回为空时如实回答"审计日志中没有该账号的导入记录"，不得猜测。」

4. 不改前端、不改数据库、不改其它 edge functions。`audit_logs` 已有 RLS，且本函数走 service-role client，可直接读。

## 技术细节

- 数组重叠查询用 supabase-js 的 `.overlaps('target_ids', userIds)` / `.overlaps('target_labels', studentNos)`，分两次查再在 JS 里按 `id` 去重合并，避免 `or` 子句中数组操作符的转义麻烦。
- 时间戳返回 ISO，外加一个 `imported_at_cn`（`Asia/Shanghai`，`zh-CN` 本地化字符串）方便模型直接朗读。
- `imported_by_email` 来自 `actor_email`；如为 null 则 fallback 到 `actor_id`。
- 工具结果保持 ≤ 20 条，超过截断并附 `truncated: true`。

## 验证

修复后在工作助手里再问「信息工程学院的张三这个账号是什么时候导入的，由谁导入的」，期望模型先调用 `account_provenance("张三")`，返回上面两条记录，然后用表格列出 学号 / 导入时间 / 导入人 / 导入文件，并提示按学号区分两个同名学生。