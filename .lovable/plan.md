## 功能：提交时间区间（批次）+ 到期报告

### 一、数据库

新增表 `submission_windows`（每个学院多批次）：
- `id`、`college_id`（学院隔离）、`name`（批次名，如「2026春季」）
- `starts_at`、`ends_at`（提交起止时间）
- `active`（是否启用）、`created_by`、`created_at`、`updated_at`
- `report_generated_at`、`report_path`（到期报告快照路径，存 storage）

新增表 `submission_window_reports`（保留历史报告快照）：
- `id`、`window_id`、`college_id`
- `summary`（jsonb：KPI、状态分布、未提交名单 user_id 数组、学生汇总数组、申请明细数组、图表数据）
- `file_path`（CSV/Excel 在 `application-files` 桶下的路径，可下载）
- `generated_at`、`generated_by`（NULL=系统自动）

辅助函数 `public.current_open_window(_college uuid)`：返回当前 `now()` 落在 `[starts_at, ends_at]` 且 `active=true` 的窗口 id（任一即可）。

辅助函数 `public.is_submission_open(_college uuid)`：上面的布尔包装。

### 二、RLS

`submission_windows`：
- 学院 admin 增删改查本学院
- super_admin ALL
- 已认证用户 SELECT 本学院（学生需要看「截止时间」倒计时）

`submission_window_reports`：
- 学院 admin / super_admin SELECT + INSERT 本学院
- 学生不可见

### 三、提交拦截（关键）

在 `applications` 表增加 BEFORE INSERT 触发器 `enforce_submission_window`：
- 若调用者是学生（非 teacher/admin/super_admin），且 `is_submission_open(NEW.college_id)` 为 false → `RAISE EXCEPTION '当前不在开放提交时间内'`
- 教师/管理员补录、AI 重评不受影响

学生端 `Apply.tsx` 增加：
- 加载本学院当前开放窗口；若无 → 禁用提交按钮 + 显示「未开放，下次开放：xxx」
- 显示倒计时（剩余 X 天 X 小时）

### 四、管理员 UI

新页面 `/admin/submission-windows`（学院 admin 可见）：
- 列表：批次名 / 起止时间 / 状态（未开始/进行中/已结束）/ 报告状态
- 新建/编辑批次（DateTimePicker）
- 操作：启用/停用、删除（无报告才能删）
- 「立即生成报告」按钮 → 调用 edge function

超级管理员页 `/super/submission-windows`：可切换学院查看所有批次。

### 五、报告生成

Edge function `generate-window-report`：
- 入参 `window_id`，权限：admin/super_admin/service_role
- 按学院范围聚合 `applications`、`profiles`、`user_roles`：
  - **学生级汇总**：每个学生的提交数、通过数、累计学分、是否达标
  - **申请明细**：所有申请条目（状态、AI 学分、最终学分、关键词、规则、提交时间）
  - **图表数据**：状态分布、按日提交趋势、按院系分布、按规则 Top10
  - **未提交名单**：本学院 student 角色中没有 application 落在窗口期内的
- 生成 `.xlsx`（用 `xlsx` 库，多 sheet：汇总/明细/未提交/图表数据）上传到 storage `application-files/reports/<window_id>.xlsx`
- 写入 `submission_window_reports`，更新 `submission_windows.report_generated_at` 与 `report_path`
- 返回下载 signed URL

### 六、自动到期触发

在 `pg_cron` 中加任务（每 10 分钟）：扫描 `ends_at < now() AND report_generated_at IS NULL AND active=true` 的窗口，调用 `net.http_post` 触发 `generate-window-report`。该 cron 创建 SQL 由用户在 SQL Editor 手动执行（包含 service-role key，不能进 migration）。我会在实现完成后给出一段可直接粘贴的 SQL。

### 七、报告下载

管理员页面：每个已生成报告的批次显示「下载 Excel」按钮 → `supabase.storage.createSignedUrl(...)`，60s 有效期。历史报告走 `submission_window_reports` 列表。

### 技术细节

- 时间统一存 `timestamptz`，前端用 `date-fns` + `Calendar` + 时间输入框组合
- Excel 生成使用 Deno 兼容的 `https://esm.sh/xlsx@0.18.5`
- 拦截触发器使用 `SECURITY DEFINER` + `search_path=public`，通过 `has_role` 判断角色
- 学生端窗口信息查询走 RLS SELECT，不走 edge function，降低延迟
- 触发器只在 INSERT 时拦截，UPDATE 不拦截（学生改自己 pending_ai 的允许，已有 guard）

### 路由

- `/admin/submission-windows`（admin 角色）
- `/super/submission-windows`（super_admin）

### 验收

1. 学院 admin 创建窗口 → 学生在窗口期内可提交，期外提交报错
2. 多批次并存：任一开放即可
3. 窗口 `ends_at` 到达后 10 分钟内自动生成 Excel，管理员可下载
4. 管理员可手动「立即生成」（窗口未结束也允许，生成中间报告）
