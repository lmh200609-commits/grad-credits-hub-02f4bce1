## 问题

工作助手（超管/学院管理员/教师 共用同一个 `staff-ai-assistant` Edge Function）回答"这一周内有多少名学生提交过申请"时返回"1 名"，与真实数据不符。同时聊天卡片显示英文字段名 `submitted_total`，跳转按钮显示裸路径 `/admin/users/students`，呈现"乱码"。

根因：
1. **数据层**：`query_stats` 工具的 metric 列表里**根本没有"近 7 天去重学生数"**，最接近的是 `submitted_total`（全时段去重）。模型只能强行选它，再口头加上"近 7 天"前缀，造成事实错误。
2. **作用域**：教师/学院管理员调用同一个工具时，`submitted_total` 是全表查询、未按学院过滤；超管返回全局值也未按身份做时间窗口区分，三类角色都会看到错误数字。
3. **UI 层**：`StaffAiAssistant.tsx` 直接渲染 `m.stats.metric` 原始 key 和 `m.action.payload.path` 原始路径，没有中文化。

## 修复方案

### 1. 后端补齐"时间窗口 + 真实数据"指标
文件：`supabase/functions/staff-ai-assistant/index.ts`

- `query_stats` 的 enum 新增：
  - `submitted_students_week` — 近 7 天去重提交学生数
  - `submitted_count_week` — 近 7 天提交申请总数
  - `submitted_students_month` — 近 30 天去重提交学生数
- 系统提示 metric 说明同步追加这三项中文释义。
- 实现分支按 `submitted_at >= now()-N天` 过滤后对 `student_id` 去重计数，全部走 Postgres 真实查询，不做任何兜底估算。

### 2. 三类角色全部按真实身份范围作答
对超管/学院管理员/教师的所有数据型工具（`query_stats`、`list_failing_students`、`student_full_profile`、`student_submission_history`、`find_student`、`account_provenance` 等）统一加 college 作用域：

- 超管：全局，不过滤。
- 学院管理员 / 教师：在 SQL 层附加 `college_id = <调用方学院>` 过滤，确保返回的人数、学生明细只覆盖本学院。
- 已经按 college 过滤的指标保持不变，缺失的（如 `submitted_total / submitted_count / total_students / passed_students / failing_students / auto_approved_total / manual_approved_total / rejected_total / pending_review / pending_ai`）逐一补齐。

### 3. 强化"严禁虚构"行为约束
在系统提示里加一条总纲：

> 凡涉及任何数量、人数、统计、学生明细、审核结论的提问，必须严格基于工具返回的数据库结果回答；如果用户问的指标不在 metric 列表里，必须直接回复"暂不支持该统计"，禁止用近义指标替代后再口头改写时间窗口、范围或单位。返回为空时必须如实回复"数据库中暂无相关记录"。

### 4. 前端去除"乱码"
文件：`src/components/StaffAiAssistant.tsx`

- 增加 `METRIC_LABELS` 字典，把所有 metric key 映射为中文（如 `submitted_total → "累计提交学生数"`、`submitted_students_week → "近 7 天提交学生数"`、`pending_review → "待人工复核"` 等），卡片渲染用中文标签。
- 跳转按钮文本改为基于路径前缀映射的中文（如 `/admin/users/students → "打开学生管理"`、`/admin/credits → "打开学分排名"`、`/teacher/students/{id} → "打开学生档案"` 等），不再显示原始路径字符串。

## 验证（三类角色各跑一遍）

1. 超管 / 学院管理员 / 教师 分别提问"这一周内有多少名学生提交过申请"——
   - 模型必须调用 `submitted_students_week`，卡片标题为中文「近 7 天提交学生数」，数值与对应 SQL（按角色作用域）一致。
2. 学院管理员 / 教师 提问"累计有多少学生提交过"——返回值必须等于本学院去重学生数，**不能**等于全平台数字。
3. 提问一个不存在的指标（如"近 3 天通过率"）——必须返回"暂不支持该统计"，不得用近义指标替代。
4. 卡片与跳转按钮中均不再出现 `submitted_total`、`/admin/...` 等英文字符串。

## 范围之外（不动）

- 不调整 RLS、表结构、其他 Edge Function。
- 不更换 AI 模型，也不改鉴权流程。
