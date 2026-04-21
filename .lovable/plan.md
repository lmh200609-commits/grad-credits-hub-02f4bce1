

## 教师端学生管理：补充重置密码功能 + 排查显示

### 改动范围

**1. 在教师端 `Students.tsx` 增加「重置密码」操作**
- 复用管理员端 `UsersManage.tsx` 已有的密码重置弹窗 UI 模式（输入新密码 → 校验 → 调用 edge function）
- 表格「操作」列在「查看详情」右侧增加「重置密码」按钮
- 复用 `resetPasswordSchema`（≥8 位、含字母+数字）
- 不加删除功能（按你的选择，删除保留为管理员专属）

**2. 后端 edge function `reset-password` 放开教师权限**
- 当前函数硬编码 `admin only`，教师调用会 403
- 改为「admin 或 teacher」均可重置学生密码
- 增加一道安全校验：teacher 仅可重置 `student` 角色的账号（不能重置其他教师/管理员的密码），防止越权
- admin 不受此限制

**3. 关于「看不到测试账号」**
- 上一轮已清理 2000 个 `__perftest__` 测试账号（确认）
- 当前数据库实际仅 5 个真实账号、1 条申请；session replay 显示真实学生「白雪 2024001」可正常显示，列表功能本身无 bug
- 「暂无符合条件的学生」是因为筛选/搜索条件命中为 0，清空筛选即可
- 本次不重新造测试账号；如需手动体验功能，登录 admin 在「批量导入账号」造 5-10 个真实可登录账号即可

### 技术细节

**`supabase/functions/reset-password/index.ts`**
```ts
// 校验调用者角色
const { data: isAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
const { data: isTeacher } = await admin.rpc("has_role", { _user_id: callerId, _role: "teacher" });
if (!isAdmin && !isTeacher) return json({ error: "Forbidden" }, 403);

// teacher 仅能重置 student 账号
if (!isAdmin) {
  const { data: targetIsStudent } = await admin.rpc("has_role", { _user_id: user_id, _role: "student" });
  if (!targetIsStudent) return json({ error: "教师仅可重置学生密码" }, 403);
}
```

**`src/pages/teacher/Students.tsx`**
- 引入 `Dialog`、`Label`、`resetPasswordSchema`、`toast`
- 新增 state：`resetTarget` / `newPassword` / `pwError` / `resetting`
- 新增 `resetPassword()` 处理函数，调用 `supabase.functions.invoke("reset-password", ...)`
- 表格「操作」单元格改为两个按钮并排：详情 + 重置密码
- 在 `AppLayout` 外层之后加 `<Dialog>` 弹窗（与 `UsersManage.tsx` 结构一致）

### 用户视角

- 教师进入「学生管理」→ 在任一学生行点击「重置密码」→ 弹窗输入新密码（如 `Abc12345`）→ 确认 → toast 成功提示 → 通过线下渠道告知学生新密码
- 教师无法通过此入口重置其他教师或管理员的密码
- 删除账号仍需联系管理员，避免误操作丢失学生历史申请数据
