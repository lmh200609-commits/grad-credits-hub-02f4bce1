
# 学分认证系统 — Lovable 复刻方案

> 数据库：连接你自己的 Supabase（非 Lovable Cloud）。AI：通过 Edge Function 调用 OpenAI(GPT‑4o-mini vision)，密钥以 Supabase Secret 存储。前端：React + Vite + Tailwind + shadcn。

---

## 一、整体架构

- **三端单仓库**：登录后按角色路由到 `/student`、`/teacher`、`/admin`，角色由 `user_roles` 表 + `has_role()` security definer 函数判定（避免角色提权）。
- **数据库（Supabase）**：10 张核心表 + Storage bucket `certification-images` + 触发器维护学分汇总 + Realtime 订阅。
- **Edge Functions**：`ai-verify`（提交后AI审核）、`reset-password`、`bulk-import-users`（管理员Excel导入）。
- **实时同步**：使用 `student_submissions / credit_change_logs / student_profiles` 的 Realtime 订阅；触发器自动写学分日志、自动累加 `total_credits`，前端不重复计算（解决原系统教师/管理员数据不同步问题）。

---

## 二、数据库设计（按原文档 1.2 节 1:1 还原）

**核心表**：`student_profiles / teacher_profiles / admin_users / student_submissions / credit_change_logs / manual_reviews / rule_cases / keywords / keyword_categories` + 安全表 `user_roles`（enum: student/teacher/admin）。

**关键约束与触发器**
- 所有表启用 RLS
- `has_role(uid, role)` security definer 函数
- 触发器 `trg_after_review_approved`：当 `student_submissions.workflow_status` 变为 `approved` 且 `final_score>0` → 自动 INSERT `credit_change_logs` → 自动 UPDATE `student_profiles.total_credits`
- 触发器 `trg_handle_new_user`：`auth.users` 插入后按元数据自动创建对应 profile + user_role
- Storage policy：学生只能写入自己 uid 前缀目录；教师/管理员可读全部

**RLS 概览**
- `student_profiles`：本人可读写；教师/管理员可读
- `student_submissions`：本人可 INSERT/SELECT 自己；教师/管理员可 SELECT/UPDATE 全部
- `credit_change_logs`：本人 SELECT 自己；教师/管理员 SELECT 全部，仅触发器/管理员可写
- `rule_cases / keywords / keyword_categories`：所有登录用户可读；仅教师/管理员可写
- `manual_reviews`：教师/管理员可读写，本人 SELECT 自己提交的复核

---

## 三、种子数据（自动入库脚本）

执行迁移时一并 INSERT：

1. **keyword_categories**（三级分类）
   - 一级：论文、科研项目、知识产权、大创项目、竞赛、英语、计算机/职业证书、第二课堂、其他证书
   - 二级/三级：按级别（国家级/省级/校级、SCI/EI/普刊…）

2. **rule_cases（来自"学校规则.txt"34 条）**
   - 每条解析 `项目/级别/身份/学分` → 一行 `rule_cases`，`is_rule=true`、`is_active=true`
   - 第一章/第二章条款（规则1‑4）作为 `rule_cases` 备注或独立 `policy_articles`（建议放规则案例的 `case_description` 中并打 `category_tags=['policy']`）

3. **keywords + 案例 rule_cases（来自"示例.txt"44 条上届毕业生通过案例）**
   - 每条解析 `项目/成果/级别/身份/学分` → 同时写入：
     - `rule_cases`：`is_case=true`，`achievement_name=成果`
     - `keywords`：`name=成果`、关联 `rule_case_id`、`default_credit_score=学分`，挂到对应 `keyword_categories`

提供 SQL 迁移文件（包含 INSERT 语句）+ 一份"重新解析 txt"的 Node 脚本，方便后续追加。

---

## 四、页面与路由

### 学生端 `/student`
- `/student` 首页：累计学分卡、达标进度（≥4分高亮）、最近5条提交
- `/student/submit` 提交材料：图片上传 → 分类树选关键词 → 选规则案例（带预览图） → 自定义关键词 → 补充说明 → 提交触发 `ai-verify`
- `/student/records` 我的提交：状态 Tab（全部/审核中/通过/拒绝/复核中）+ 详情抽屉（AI分析+人工意见）
- `/student/reapply/:id` 申请复核
- `/student/profile` 个人中心

### 教师端 `/teacher`
- `/teacher/review` 待审核列表 + 审核弹窗（图片放大、AI 结果、设置 0‑12 分、意见）
- `/teacher/students` 学生列表（年级/班级/专业筛选 + 搜索）
- `/teacher/stats` 班级/年级通过率 + 学生学分排名（直接从数据库聚合视图读，不前端算）
- `/teacher/keywords` 关键词分类树管理 + CRUD
- `/teacher/rules` 规则案例 CRUD（含图片上传）
- `/teacher/profile`

### 管理员端 `/admin`
- `/admin/review` 六分类卡片（AI通过/AI拒绝/申请复核/人工通过/人工拒绝/待审核）
- `/admin/dashboard` 统计面板（总提交、通过率、年级/班级分布饼图柱图）
- `/admin/credits` 学生学分排名（从 `student_profiles.total_credits` + 提交统计视图）
- `/admin/users/students` & `/admin/users/teachers` 增删改、重置密码（Edge Function）
- `/admin/import` Excel AI 智能导入（上传 → AI 识别表头 → 预览 → 批量 invite）
- `/admin/profile`

---

## 五、AI 审核流程（Edge Function `ai-verify`）

1. 接收 `submission_id`，从表读图 URL + 用户描述 + 选中的 rule + 关键词 + 学生姓名
2. 调用 OpenAI GPT‑4o-mini（vision）：
   - OCR 提取图片文字
   - 检测是否截图/编辑/AI 生成
   - 与 rule_case + keywords + 学生姓名做一致性比对
   - 返回 `consistency_score(0‑1)` + `reasoning` JSON
3. 写回 `ai_analysis_result / ai_image_check / ai_consistency_score`
4. 分流：≥0.8 → `approved` + `final_score=rule.credit_score`（触发器自动入账）；0.5‑0.79 → `pending`；<0.5 → `rejected`
5. 失败兜底：状态置 `pending`，错误写入 `workflow_message`

提示词内置在 Edge Function 后端，不暴露给客户端。

---

## 六、安全要点

- 角色存于独立 `user_roles` 表 + `has_role()`，绝不读 profile 角色字段
- 全表 RLS；`credit_change_logs` 仅 service_role/触发器可写
- Edge Function 内做 JWT 校验
- Storage 路径前缀绑定 uid
- 重置密码使用 admin API（service_role）由管理员端 Edge Function 执行

---

## 七、实施步骤（按顺序逐步交付）

**Step 1 · 接入 Supabase + 基础架构**
- 你提供 Supabase URL + anon key + service_role key（service_role 加为 Edge Function Secret）
- 建客户端、auth helper、路由骨架、登录/注册/重置密码页

**Step 2 · 数据库迁移 + 种子数据**
- 一键 SQL：建表 + RLS + 触发器 + Storage bucket + INSERT 34条规则 + 44条关键词案例 + 分类树
- 你在 Supabase SQL Editor 执行

**Step 3 · 学生端**
- 首页、提交、记录、复核、个人中心 + Storage 上传

**Step 4 · `ai-verify` Edge Function**
- 你提供 `OPENAI_API_KEY`，部署函数，提交后端到端跑通

**Step 5 · 教师端**
- 审核、学生管理、统计、关键词与规则管理

**Step 6 · 管理员端**
- 六分类复核、Dashboard、学分排名、用户管理、Excel AI 导入

**Step 7 · Realtime 订阅 + 全链路联调**
- 三端订阅、降级轮询、修复原系统统计延迟问题

**Step 8 · 打磨**
- 中文 UI、动效（用 easeOut 替代 spring，避免抖动）、移动端适配、空态/加载态

---

## 八、需要你准备的东西

1. Supabase 项目的 **Project URL** 与 **anon public key**（点 Implement Plan 后我会让你填）
2. **service_role key**（用于管理员端 reset password / bulk import）→ 作为 Edge Function Secret
3. **OPENAI_API_KEY** → Edge Function Secret（Step 4 时再加也行）
4. 是否要我把"学校规则.txt 第一/二章条款（规则1‑4）"做成单独的"规则文档"页面给学生查看？默认会做。

确认后点击下方 Implement plan，我从 Step 1 开始执行。
