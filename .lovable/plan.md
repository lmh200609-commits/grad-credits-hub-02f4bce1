# 多学院（多租户）改造方案 v2

把当前单租户系统升级为按"学院"隔离的多租户系统：超级管理员创建并管理学院与学院管理员；每个学院管理员可上传本学院院徽，自动作为系统主题/UI 视觉参考；师生数据严格按学院隔离。

## 1. 角色体系

| 角色 | 来源 | 视野 | 主要职责 |
|---|---|---|---|
| `super_admin`（新增） | 系统初始 / 由现有 admin 升级 | 全平台 | 创建/停用学院、创建学院管理员、跨学院看板、AI 模型设置 |
| `admin`（学院管理员） | **仅由 super_admin 在后台创建**（不可自助注册） | 仅本学院 | 现有 admin 全部功能（自动按学院过滤）+ 上传本学院院徽 / 调整主题 |
| `teacher` | 学院 admin 导入 | 仅本学院 | 现有 teacher 功能 |
| `student` | 学院 admin 导入 | 仅本人 | 现有 student 功能 |

## 2. 数据模型

### 新增 `colleges` 表
- `id` `code` `name` `short_name` `system_title`
- `badge_url` (text) — 院徽图片，存储桶 URL
- `theme` (jsonb) — 自动 + 手动：
  - `primary` / `accent` / `background` (HSL，初始由院徽主色提取，可手动覆盖)
  - `font_pair`（字体对 preset）
  - `layout`（`sidebar` | `top-nav` | `compact`）
  - `radius`
- `active` (boolean)
- `created_by` (uuid → super_admin)

### 新增存储桶 `college-badges`（public）
- 路径：`{college_id}/badge.{ext}`
- RLS：所有人可读；仅本学院 admin 与 super_admin 可写/覆盖

### 现有表扩展
- `profiles.college_id uuid`（与 `department` 共存）
- `applications.college_id uuid`（trigger 自动从学生 profile 写入）
- `user_roles` 增加可空 `college_id`；枚举 `app_role` 增加 `super_admin`

### 安全函数
- `current_user_college_id()` security definer
- `is_super_admin(uid)` security definer
- 所有业务表 RLS 加学院过滤；super_admin 跨学院全开

## 3. 超级管理员后台（新增）

新增路由：
- `/super/dashboard` — 跨学院汇总看板（按学院切片）
- `/super/colleges` — 学院 CRUD：创建学院（code/name/short_name/system_title），停用/启用
- `/super/admins` — 创建学院管理员：
  - 输入邮箱、姓名、所属学院
  - Edge Function `create-college-admin` 调用 `auth.admin.createUser` 生成账号 + 写 `user_roles(role=admin, college_id=X)` + 写 `profiles`
  - 一键重置密码、转移管理员、停用
  - **学院管理员账号无法通过普通注册流程产生，只能由 super_admin 创建**
- `/super/audit` — 全平台审计

## 4. 学院管理员的院徽与主题

新增 `/admin/branding` 页面（仅本学院 admin 可见）：
1. **上传院徽**（PNG/SVG/JPG，≤2MB）→ 存入 `college-badges/{college_id}/badge.xxx`
2. 上传后调用 Edge Function `extract-badge-palette`：
   - 用 `node-vibrant` 兼容方案在浏览器端提取主色 / 辅色（轻量，纯前端实现，不必走 edge）
   - 自动转换为 HSL，写入 `colleges.theme.primary` / `accent` / `background`
3. **可视化微调**：管理员看到实时预览（侧边栏、按钮、卡片），可手动覆盖主色、字体对、布局变体（sidebar / top-nav / compact）、圆角强度
4. 保存后所有本学院师生下次刷新即生效

院徽用途：
- 系统 Header 左上角 Logo（替换"学分认证系统"前的图标）
- 登录页学院 Logo
- 证书 PDF 加水印 / 抬头
- 主题色取色参考

## 5. UI 主题注入机制

- `useCollegeTheme()` hook：登录后根据 `college_id` 拉取 `colleges.theme` + `badge_url`
- 注入 CSS 变量到 `:root`，覆盖 `index.css` 中的 `--primary`、`--accent`、`--background`、`--radius`
- 切换字体对（动态 link Google Fonts）
- `AppLayout.tsx` 根据 `theme.layout` 渲染 `sidebar` / `top-nav` / `compact` 三种布局变体
- `system_title` 替换 header 文案
- super_admin 默认主题 = 平台中性主题；预览某学院时可临时切换

## 6. 批量导入归属

`ImportUsers.tsx` + `import-users` Edge Function：
- 学院 admin 导入：自动写其 `college_id`；Excel 中"学院"列若与本院不一致则报错
- super_admin 导入：必须在 Excel 提供"学院"列（按 `code` 或 `name` 匹配）
- AI 解析助手 (`ai-parse-roster`) 输出新增 `college` 字段

## 7. RLS 策略改写

- `applications` `submission_records` `application_reviews` `audit_logs` `profiles`：admin/teacher 限本学院；super_admin 全部；student 仍按 `student_id`
- `colleges`：全员可读自己学院；super_admin 可全部增删改；学院 admin 仅可改本学院 `theme` 与 `badge_url`、`system_title`
- `user_roles`：仅 super_admin 可创建/修改 admin 行；学院 admin 仅可创建/修改本学院 teacher/student 行
- `rules` `keywords` `cases` `certificate_types` 保持全局共享

## 8. 数据迁移

1. Migration：建表、加字段、加枚举值、建存储桶
2. 数据回填：把现有 `profiles.department` 聚合为 colleges → 回填 `college_id`、`applications.college_id`
3. 把当前唯一 admin 升级为 `super_admin`，由其登录后在 `/super/admins` 给各学院创建管理员
4. RLS 一次性切换为新策略

## 9. 影响文件

- 新增：`src/pages/super/Dashboard.tsx` `Colleges.tsx` `Admins.tsx` `Audit.tsx`、`src/pages/admin/Branding.tsx`、`src/hooks/useCollegeTheme.ts`、`src/lib/extractPalette.ts`、Edge Function `create-college-admin`
- 修改：`useAuth.tsx`（暴露 `collegeId` / `isSuperAdmin`）、`RoleRoute.tsx`、`App.tsx`、`AppLayout.tsx`（主题/布局/Logo）、`ImportUsers.tsx`、`import-users` / `ai-parse-roster` Edge Functions、菜单按角色与学院过滤
- 列表页（Dashboard/Credits/Reviews/SubmissionRecords/UsersManage/Students/AuditLogs）查询逻辑无需改动，由 RLS 自动收紧；仅替换"全平台"等文案

## 10. 风险

- 主题 CSS 变量必须用 HSL，避免破坏现有设计系统
- 院徽取色若是单色 Logo 可能不适合做背景，需做"对比度兜底"——当提取色对比不足时自动回退到中性色
- 历史 `applications` / `audit_logs` 必须迁移到位，否则 RLS 收紧后看不到任何数据
- 规则库默认全局共享；如某学院希望规则也独立，请告知，可后续扩展为 `rules.college_id`（null = 全局）

---

确认即开始实施。
