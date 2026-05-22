## 目标

把审计日志（`/admin/audit-logs`）列表和详情弹窗里的"操作者"列，从当前显示的账号邮箱前缀，改为更可读的"角色 + 姓名"格式。

## 显示规则

根据操作者在 `user_roles` 中的最高角色决定文案（优先级：super_admin > admin > teacher > student）：

- **超级管理员**：`超级管理员 {full_name}`（若无姓名则回退为账号前缀）
- **学院管理员（admin）**：`{学院 short_name 或 name}管理员 {full_name}`，例如 `经济学院管理员 刘明辉`
- **教师**：`教师 {full_name}`，例如 `教师 刘明辉`
- **学生**：`学生 {full_name}`（一般不会出现在审计日志，但保留兜底）
- **查不到角色/姓名**：回退到原来的 `actor_email` 前缀，再不行显示 `—`

姓名解析复用 `src/lib/displayName.ts` 中的 `resolveDisplayName`，保持与工作台问候语一致。

## 实现范围（仅前端，单文件）

只改 `src/pages/admin/AuditLogs.tsx`：

1. 在 `load()` 里拉到 logs 之后，收集所有 `actor_id`（去重，排除 null）。
2. 并行批量查询：
   - `profiles`：`select user_id, full_name` where `user_id in (...)`
   - `user_roles`：`select user_id, role, college_id` where `user_id in (...)`
   - 根据 user_roles 收集到的 `college_id`，再查 `colleges`：`select id, name, short_name`
3. 构建一个 `actorMap: Record<user_id, { label: string }>`，按上面的优先级规则拼接文案。
4. 把状态 `setActors(actorMap)` 存到组件 state。
5. 渲染处：
   - 表格列 `操作者` 单元格：`actors[l.actor_id]?.label ?? (l.actor_email?.split("@")[0] ?? "—")`
   - 详情弹窗中"操作者："那一行同样替换。
6. 筛选框（按账号关键字搜索）保持不变 —— 仍按 `actor_email` 模糊匹配，避免破坏现有筛选体验（如需也支持按姓名搜索，可后续单独提）。

## 不改动的部分

- 数据库结构、RLS、edge function（`audit-log` 写入逻辑）均不变 —— 仍然只记录 `actor_id` + `actor_email`，姓名/角色在前端查询时拼接，保证历史日志也能正确显示。
- 其他页面不受影响。

## 风险/注意

- 一次性可能有较多 `actor_id`，但审计日志页本身是分页/筛选后的数据，且 `.in()` 查询单次足够；若用户量极大可后续加缓存。
- 用户角色可能变动，这里展示的是"当前角色"而非"操作发生时的角色"——符合大多数审计 UI 的常规做法；如需"历史角色快照"才需要改 edge function 落库，本次不做。
