

# 修复四项问题：助手位置、学生列表为空、日期乱码、邮箱→账号/手机号

## 问题与根因

1. **教师端「快捷指令」面板太靠下** — `StaffAiAssistant` 固定在右下角且高度 620px，快捷指令 Tab 内容贴底，鼠标够不上。
2. **教师端学生管理「暂无符合条件的学生」** — 数据库里实际有 3 名学生角色 + 匹配 profile，但 `user_roles` 表**缺少 teacher SELECT 策略**（上一轮迁移文件未应用到数据库）。教师身份查 `user_roles` 返回空，导致 `studentIds` 集合为空，全部 profile 被过滤掉。
3. **审计日志日期栏乱码** — 截图里的「yyyy/mm/日」是浏览器 `<input type="date">` 在窄宽度下的占位文字（实际是 yyyy/mm/dd 因列宽被压缩出现"日"字残留视觉错乱），并且筛选区一行 4 列在 ~880px 视口下挤压严重。
4. **系统不再用邮箱** — 登录已用账号（学号/工号/手机号），但表格列、占位符、对话框文案仍写「邮箱」。需统一替换为「账号 / 手机号」。

## 修复方案

### 1. `StaffAiAssistant` — 面板向上抬升，快捷指令置顶

`src/components/StaffAiAssistant.tsx`：
- 默认打开时切到 **「快捷指令」** Tab（`useState("quick")`），让用户首屏直接看到 6 个操作卡
- 面板锚点从 `bottom-6` 改为 `bottom-20`，让面板整体上移避开浏览器底部栏
- 快捷指令网格改为 `grid-cols-1`（窄面板下两列卡片字小拥挤），加大卡片内边距与图标对比
- 顶部加一句简短提示「点击下方卡片即可一键执行」

### 2. 学生列表为空 — 补齐 RLS + 兜底

**数据库迁移**（必须执行）：
```sql
CREATE POLICY "Teachers can view all roles"
ON public.user_roles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'teacher'));
```
（上一轮的迁移文件存在但未应用，本轮重新生成一条新迁移确保落库）

`src/pages/teacher/Students.tsx`：
- 当前是先查 `user_roles` 再交集 `profiles`。改为**反向查询**：直接从 profiles + 一次 `user_roles` 联合判断，并在 `user_roles` 返回 0 行时退化为「展示所有可见 profile」+ 控制台告警，避免再出现整列空白
- 顶部替换为 `PageHeader`，与其它后台页统一

### 3. 审计日志日期乱码 + 筛选布局

`src/pages/admin/AuditLogs.tsx`：
- 筛选区从 `md:grid-cols-4` 改为 `md:grid-cols-2 xl:grid-cols-4`，在 ~880px 视口下变两列，避免日期 input 被挤压
- 日期改为「开始日期 / 结束日期」两个带 `<Label>` 的字段，加 `lang="zh-CN"`，并设置 `className="w-full"`
- 在每个日期 input 上方加中文 Label（"开始日期" / "结束日期"），不依赖浏览器默认占位符

### 4. 全系统去「邮箱」，改为「账号 / 手机号」

**修改清单**（仅 UI 文案与列名，不动 schema）：
- `src/pages/teacher/Students.tsx`：搜索框 placeholder「搜索姓名 / 学号 / 账号 / 班级」；删除"邮箱"列，新增「账号」列显示 `student_no`（已存在），并保留 `phone` 列改名「手机号」（需在 select 中加 `phone`）
- `src/pages/admin/UsersManage.tsx`：删除「邮箱」列；保留「手机号」列；搜索 placeholder 改「搜索姓名 / 学号或工号 / 手机号 / 班级 / 院系」；重置密码弹窗标题用 `full_name ?? student_no` 兜底
- `src/pages/teacher/StudentDetail.tsx`：去掉「邮箱」字段，保留「电话」改为「手机号」
- `src/pages/admin/AuditLogs.tsx`：操作者搜索框 placeholder 从「操作者邮箱」改为「操作者账号」（继续匹配 `actor_email` 列因为它实际存的是 `xxxx@admin.local`，前端用 `split("@")[0]` 显示账号）；表格「操作者」列展示时也做 `actor_email?.split("@")[0]`
- `src/pages/Login.tsx`：副标题已为账号，无需改
- 不动数据库列 `profiles.email` / `audit_logs.actor_email`，仅前端不再展示 / 不再叫「邮箱」

## 文件改动清单

**新增**
- `supabase/migrations/{timestamp}_teacher_select_user_roles.sql` — teacher 的 SELECT RLS 策略

**修改**
- `src/components/StaffAiAssistant.tsx` — 默认 Tab、位置、快捷指令布局
- `src/pages/teacher/Students.tsx` — RLS 兜底、PageHeader、列改为账号/手机号
- `src/pages/teacher/StudentDetail.tsx` — 去邮箱字段
- `src/pages/admin/UsersManage.tsx` — 删邮箱列、文案
- `src/pages/admin/AuditLogs.tsx` — 日期布局、Label、操作者展示去 @域名

**不动**
- 数据库 schema、登录认证流程、其它页面

## 验收

- 教师打开右下角助手 → 默认看到 6 个快捷指令卡，整体面板上移不贴底
- 教师进入「学生管理」→ 看到 3 名学生（含白雪），可点击「查看详情」
- 管理员审计日志筛选栏在 880px 视口下两列布局，日期字段带中文 Label，无乱码
- 全系统所有表格、搜索框、详情页找不到「邮箱」字样，统一为「账号」「手机号」

