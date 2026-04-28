# 数据看板合格统计 + Excel 导出 + 教师端同步

## 1. 管理员数据看板：新增"合格 / 不合格"统计

文件：`src/pages/admin/Dashboard.tsx`

- 复用 Credits 页面的口径（`PASS_THRESHOLD = 4`，APPROVED 状态累计 `final_credit ?? ai_suggested_credit`）。
- 在现有统计卡区域下方新增一张 Card「学生合格情况」：
  - 表格两行：合格人数 / 不合格人数，列：人数、占比（百分比，1 位小数）。
  - 两行整行可点击（cursor-pointer + hover），点击后 `navigate` 到 `/admin/credits?passFilter=pass` 或 `/admin/credits?passFilter=fail`。
  - 旁边附一个小型 Pie 图直观显示比例（绿/红双色，复用现有 Recharts）。
- 仅基于已有 `student_id` 集合 + applications 计算，无需新查询。

## 2. 学分排名：导出 CSV → 导出 Excel（.xlsx）

文件：`src/pages/admin/Credits.tsx`

- 已存在依赖 `xlsx@0.18.5`，直接 `import * as XLSX from "xlsx"`。
- 重写 `exportCsv`（改名 `exportXlsx`）：
  - 使用 `XLSX.utils.aoa_to_sheet` 生成工作表，列与现有 CSV 一致 + 新增"是否合格"列。
  - 文件名：`学分排名_${当前筛选 pass/fail/全部}_${日期}.xlsx`。
  - 导出范围 = 当前 `filtered`（尊重用户的 dept / search / passFilter）。
- 按钮文案：`导出 Excel`，icon 不变。

## 3. 教师端同步「数据看板」+「学分排名」

### 3.1 新增教师页面（薄包装，复用逻辑）

为了避免硬编码"admin"路径并保持权限隔离，新建：

- `src/pages/teacher/Dashboard.tsx` — 复制 Admin Dashboard 的内容，去掉「打开复核中心」按钮中的 `/admin/review` 改为 `/reviews`，"快捷入口"中的链接改为教师可访问路径（`/reviews`、`/teacher/credits`、`/teacher/students`）。
- `src/pages/teacher/Credits.tsx` — 复制 Admin Credits，行操作的"详情"链接已是 `/teacher/students/{id}` 无需改；StatCard 点击后跳转使用相对当前路径（`/teacher/credits?passFilter=...`）。

> 决定使用复制而非抽公共组件：两页未来管理员/教师可能展示不同字段（如教师不一定看到全部院系），复制更稳妥；改动可控。

### 3.2 路由与侧边栏

文件：`src/App.tsx`
- 新增 `/teacher/dashboard` → `TeacherDashboard`（role=teacher）。
- 新增 `/teacher/credits` → `TeacherCredits`（role=teacher）。

文件：`src/components/AppLayout.tsx`
- `teacherItems` 工作台改为指向 `/teacher/dashboard`（icon 用 `BarChart3`），并新增「学分排名」`/teacher/credits`（icon `Trophy`），插在「学生管理」之前。
- `extraTitles` 不需要改（已通过菜单标题命中）。

### 3.3 工作助手（StaffAiAssistant）支持教师跳转

文件：`supabase/functions/staff-ai-assistant/index.ts`
- 路径白名单新增：
  - `/teacher/dashboard`
  - `/teacher/credits（支持 ?passFilter=fail|pass|all、?dept=xxx）`
- `list_failing_students` 与 `query_stats` 中 `navigate_path` 当前固定指向 `/admin/credits?passFilter=...`：改为根据请求 body 中的 `role` 字段动态选择：
  - admin → `/admin/credits?passFilter=...`
  - teacher → `/teacher/credits?passFilter=...`
- 同步把"数据看板"路径在 system prompt 里区分 admin/teacher。
- 教师角色不可访问 `/admin/*`，提示词中保持现有限制。

文件：`src/components/StaffAiAssistant.tsx`
- 已传 `role` 给 edge function，无需改动；候选学生跳转分支已正确（teacher 走 `/teacher/students/{id}`）。

## 4. 自测要点

- 管理员 `/admin/dashboard` 看到「学生合格情况」表格 + 饼图，点击两行分别跳转到对应筛选的学分排名。
- 学分排名（管理员/教师）「导出 Excel」生成 .xlsx，可被 Excel/WPS 打开，包含当前筛选数据 + 是否合格列。
- 教师登录后侧边栏出现「工作台 / 学分排名」，页面正常加载（受 RLS 约束；与 Admin 同口径）。
- 工作助手在教师端问"查看不合格学生"，跳转 `/teacher/credits?passFilter=fail`；管理员端依旧跳 `/admin/credits?passFilter=fail`。

## 技术细节

- 比例计算：`pass / (pass + fail)`，分母为 0 时显示 `—`。
- xlsx 列宽：通过 `ws['!cols']` 给序号 6、姓名 12、学号 14、院系/专业/班级 16、数值列 10。
- 教师可见学生范围依赖现有 RLS（profiles + user_roles 的 teacher 策略已存在），无需新建数据库策略。
- 不新增数据库表 / RPC / secret。
