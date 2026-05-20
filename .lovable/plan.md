## 问题

1. 系统从未导入身份证号（`profiles.id_card` 在导入流程中根本不写入），但 `reset-password` / `bulk-reset-password` 边缘函数却用 `id_card` 后 6 位生成默认密码，结果几乎都是 `000000` 兜底。
2. 教师端/管理端在重置密码弹窗一律显示「学号 + 身份证后 6 位」，对教师账号也不应称"学号"。

## 目标

默认密码统一为：**学号(学生) / 工号(教师·管理员) + 手机号后 6 位**；手机号缺失或不足 6 位时补 `0`。所有相关 UI 文案随角色显示「学号」或「工号」、且把「身份证后 6 位」改为「手机号后 6 位」。

## 改动范围

### 1. 边缘函数（核心逻辑）
- `supabase/functions/reset-password/index.ts`
  - 查询 `profiles` 改为 `select("full_name, student_no, phone, email")`
  - 生成密码：`tail = phone 末 6 位（不足补 0）`
  - 顶部注释同步更新
- `supabase/functions/bulk-reset-password/index.ts`
  - `defaultPassword(studentNo, phone, email)`：用 `phone` 替换 `id_card`
  - 查询字段、调用点同步更新
  - 顶部注释同步更新

### 2. 前端文案（按角色自适应）
- `src/pages/admin/UsersManage.tsx`（管理员管理学生 / 教师 / 管理员）
  - 单条重置确认弹窗描述：根据 `role`（`student` 用「学号」、其余用「工号」）+ 统一「手机号后 6 位」
- `src/components/BulkUserDialog.tsx`（批量重置）
  - 顶部说明 & 底部确认按钮描述：同样按 `role` 切换「学号/工号」，并改成「手机号后 6 位」
- `src/pages/teacher/Students.tsx`（教师重置学生）
  - 弹窗保持「学号」，但「身份证后 6 位」改为「手机号后 6 位」

### 3. 不改动
- 数据库结构、`profiles.id_card` 字段保留（学生档案展示仍需要）。
- 学生端 `MyProfile` 中身份证只读展示保持不变。
- 证书 / AI 评估中身份证的用途与默认密码无关，不动。

## 边界与一致性

- `phone` 字段在导入模板中已存在（`import-users` 已写入）；对历史无 `phone` 的账号，密码尾巴回退为 `000000`，与现状一致，不破坏旧账号可用性。
- 密码总长仍走 `< 8 则补 0 到 8 位` 的兜底，避免 Supabase Auth 6 位以下报错。
- 审计日志 `action: reset_password / bulk_reset_password` 字段不变。

## 验收

- 在 `/admin/users/teachers` 点单个教师"重置密码"：弹窗文案显示「工号 + 手机号后 6 位」，提交后返回密码 = 工号 + 该教师手机号末 6 位。
- 在 `/admin/users/students` 单条/批量重置：显示「学号 + 手机号后 6 位」。
- 教师端 `/teacher/students` 重置学生密码：显示「学号 + 手机号后 6 位」，结果一致。
