## 改动范围

### 1. 超级管理员侧边栏（`src/components/AppLayout.tsx`）
将 `superAdminItems` 扩展为「跨学院项 + 完整管理员菜单」：
- 顶部：学院管理、学院管理员（跨学院）
- 后接：数据看板、复核中心、全部审核、提交记录、学分排名、规则库、关键词库、案例库、学生管理、教师管理、批量导入账号、AI 模型设置、审计日志、实时一致性
- 不展示「学院品牌主题」（那是学院管理员的事）

由于 RLS 已对 `super_admin` 全开（`is_super_admin()` 通过），超级管理员访问这些路由时即可看到跨学院数据，无需额外接口改动。

### 2. 学院管理：软删除（`src/pages/super/Colleges.tsx`）
- 表格新增「停用」按钮，等价于 `active=false`（已通过 Switch 实现，再补一个明确的「停用/启用」按钮）
- 移除任何"删除"字眼，改为"停用学院"，并在停用前弹确认对话框
- 停用后的学院在新建管理员的下拉中过滤掉

### 3. 学院管理员页面（`src/pages/super/Admins.tsx`）
- 把表单字段「邮箱 *」改为「账号 *（工号）」+ 「姓名」+ 「初始密码」+ 「所属学院」
- 表格列「邮箱」改为「账号」，显示 `email.split("@")[0]`
- 调用 `create-college-admin` Edge Function 时，前端把 `account` 拼成 `${account}@admin.local` 传给后端（与 `Login.tsx` 的 `accountToEmail` 保持一致）

### 4. 顶部 header（`src/components/AppLayout.tsx`）
- 已存在 `account = user?.email?.split("@")[0]`，无需改逻辑
- 把 `account` 旁边的标签语义化（保持现状即可，因为它不显示完整邮箱）

### 5. 登录页（`src/pages/Login.tsx`）
当前已是账号登录形态，无需改动；只需确认整个项目没有任何"邮箱"字眼出现在管理面板表单 / 表格里。

### 不改动
- 数据库 schema、RLS、Edge Functions 后端逻辑（仍内部使用 email）
- 学院硬删除（按选择保留软删除）
- `Branding`/主题：仍归学院管理员

## 风险
- `create-college-admin` Edge Function 当前接收 `email`，前端拼接 `@admin.local` 即可兼容，无需改后端
- 超级管理员菜单变长，移动端需要可滚动（侧边栏已支持滚动）
