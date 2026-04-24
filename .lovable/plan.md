

## 批量管理 + 默认密码规则 + 文案修正

### 目标
1. 重置密码的默认值 = `学号 + 身份证号后6位`（无需输入新密码）
2. 管理员端学生/教师管理：批量删除、批量重置密码、按院系/专业/班级筛选
3. 教师端学生管理：批量重置密码、单条重置加二次确认、按院系/专业/班级筛选
4. 所有批量操作记录到 `audit_logs`，审查日志可查
5. 修复"学号或工号"文案错误

---

### 一、默认密码规则

**规则**：`{student_no}{id_card 后6位}`
- 学号缺失 → 用 email 前缀
- 身份证缺失 → 用学号 + `000000`
- 所有重置操作（单条/批量）均使用该规则，不再让用户输入密码
- 重置成功后 toast 显示生成的默认密码（管理员/教师可线下告知）

教师账号无身份证时退化为 `工号 + 000000`。

---

### 二、Edge Functions 改造与新增

**改造 `reset-password`**
- 入参改为 `{ user_id }`（不再接收 `new_password`）
- 内部读取 `profiles.student_no` 和 `profiles.id_card`，生成默认密码
- 调用 `auth.admin.updateUserById` 更新
- 写入 `audit_logs`：`action='reset_password'`，`metadata` 含目标姓名/学号（不含密码明文）
- 返回 `{ success, password }` 给前端展示一次

**新增 `bulk-reset-password`**
- 入参 `{ user_ids: string[] }`（≤200，zod 校验）
- admin 可重置任意角色；teacher 仅可重置 student
- 循环生成默认密码并更新，统计成功/失败
- 写入 `audit_logs`：`action='bulk_reset_password'`，`target_ids/labels`、`success_count`、`failure_count`
- 返回 `{ results: [{user_id, password, ok, error?}] }` 供前端展示

**新增 `bulk-delete-users`**
- admin only，入参 `{ user_ids: string[] }`（≤200）
- 清理 `user_roles` → `profiles` → `auth.admin.deleteUser`
- 写入 `audit_logs`：`action='bulk_delete_users'`

`config.toml` 添加两个新函数（`verify_jwt = false`）。

---

### 三、新组件 `src/components/BulkUserDialog.tsx`

可复用弹窗，承载"批量删除"或"批量重置密码"：
- props: `mode: 'delete' | 'reset'`、`role: 'student' | 'teacher'`、`open`、`onClose`、`onDone`
- 内部加载该角色全部用户，提供：
  - 文本搜索：姓名/学号/工号/手机号/班级/专业/院系
  - 三个 Select 下拉：院系 / 专业 / 班级（教师端隐藏专业、班级）
  - 表头复选框全选当前筛选结果；行内复选框
  - 顶部展示"已选 N / 共 M"
  - 底部"执行"按钮 → `AlertDialog` 二次确认 → 调用对应 edge function
- 完成后：
  - 删除模式：toast 显示成功/失败计数
  - 重置模式：弹出结果列表（姓名 + 生成的默认密码），可一键复制

---

### 四、`src/pages/admin/UsersManage.tsx` 修改

- 筛选 Card：搜索框旁新增三个 Select（院系/专业/班级；教师页隐藏专业、班级）
- 搜索框右侧新增按钮："批量重置密码"、"批量删除账号"，打开 `BulkUserDialog`
- placeholder 按角色拆分：
  - 学生："搜索姓名 / 学号 / 手机号 / 班级 / 院系"
  - 教师："搜索姓名 / 工号 / 手机号 / 院系"
- 列表筛选逻辑加入院系/专业/班级三个维度
- 单条"重置密码"：移除"输入新密码"Dialog，改为 `AlertDialog` 二次确认 → 直接重置为默认密码 → toast 展示生成的密码
- 单条"删除账号"：保持现有 `AlertDialog`

---

### 五、`src/pages/teacher/Students.tsx` 修改

- 筛选区已有院系、专业；新增"班级"Select
- 搜索框右侧新增"批量重置密码"按钮（教师无删除权限）→ 复用 `BulkUserDialog`
- 单条"重置密码"：移除新密码输入框，改为 `AlertDialog` 二次确认 → 调用 `reset-password` → toast 展示默认密码
- placeholder 已正确，无需改动

---

### 六、审查日志 `src/pages/admin/AuditLogs.tsx`

`ACTION_LABEL` 增加：
```ts
reset_password:      { label: "重置密码",    variant: "secondary" },
bulk_reset_password: { label: "批量重置密码", variant: "secondary" },
bulk_delete_users:   { label: "批量删除",    variant: "destructive" },
```
现有筛选/徽章/详情弹窗自动支持。

---

### 七、文案修复

- 管理员 `UsersManage.tsx` 当前 placeholder「学号或工号」按角色拆分（如上）
- 教师 `Students.tsx` 经检查无"工号"字样，无需改动

---

### 技术要点
- 默认密码生成函数共用：在 edge function 内实现（不在前端推导，前端不读 `id_card`）
- `audit_logs` 由 edge function 用 service role 写入，不受 RLS 影响
- 复用 shadcn `Checkbox` / `Select` / `AlertDialog` / `ScrollArea`
- 单批 ≤200 条，超出在前端提示分批
- 重置/删除涉及 auth admin API，全部通过 edge function；前端不直接接触 service role

