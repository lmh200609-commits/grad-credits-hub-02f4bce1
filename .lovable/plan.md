## 一、当前权限识别情况（已审计）

### ✅ 已正确实现
- 路由层 `RoleRoute`：`super_admin` 自动绕过所有角色检查，可访问 admin / teacher 路由。
- 学院数据隔离 RLS（`profiles`、`applications`、`user_roles` 等）：基于 `current_user_college_id()` 严格按学院隔离，跨学院读写已阻断。
- `user_roles` RLS：学院管理员只能 INSERT/UPDATE/DELETE `teacher`、`student` 角色，并且不能修改自己 → **学院管理员无法直接通过表 API 添加学院管理员**。
- `create-college-admin`、`reset-admin-password`、`/super/colleges`、`/super/admins`：仅 super_admin。
- `delete-user`：admin + super_admin（已在前一步修复）。
- `generate-window-report`、`import-users`、`ai-provider-admin`（鉴权层）：均接受 admin + super_admin。

### ⚠️ 发现的问题（需要修复）

**[P0-1] 学院管理员可通过"批量导入"绕过边界，给本学院添加新的学院管理员**
- `supabase/functions/import-users/index.ts` 第 197 行的角色校验允许 `["admin","teacher","student"]`。
- 学院管理员上传一份 `role=admin` 的 Excel，后端会把 `collegeIdForRow` 强制设为该管理员自己的 `college_id` 然后写入 `user_roles`（service_role 绕过 RLS），导致越权创建同学院管理员。
- 设计原则应是：**只有 super_admin 才能创建 admin 角色**，学院管理员只能导入 teacher / student。

**[P0-2] super_admin 调用以下 edge function 会被 403 拒绝**（仅检查了 `admin` 角色，未识别 `super_admin`）：
- `bulk-delete-users/index.ts`（第 28-29 行）
- `bulk-reset-password/index.ts`（第 37-39 行）
- `reset-password/index.ts`（第 31-39 行）
- `admin-purge-and-bootstrap/index.ts`（第 69-70 行）
- 同时 `bulk-reset-password` 第 47 行的 `教师仅可重置学生密码` 检查依赖 `has_role`，super_admin 走该分支会异常。

**[P0-3] `ai-provider-admin` 鉴权层放行 admin，但底层 RLS 仅 super_admin**
- 第 48-49 行允许 admin 调用 → 后续 DB 写入（`ai_providers`、`ai_function_bindings`）会被 RLS 拒绝，体验为"看似允许实则失败"。
- 应统一收紧为 super_admin only，与表 RLS、菜单（`/admin/ai-models` 已是 super_admin）保持一致。

**[P0-4] `admin-purge-and-bootstrap`（高危一键重建）目前接受任何 admin**
- 该操作会删除所有非管理员账号，学院管理员触发将影响其他学院。建议改为 super_admin only。

### ℹ️ 设计性确认（非 Bug，仅说明）
- 教师端：`reset-password` 教师只能重置学生 ✓；其他写操作均通过 RLS 限制在本学院学生。
- 学院管理员：可管理本学院的 teacher、student 与本学院数据；**不能**管理学院（colleges 表 super_admin only）、不能创建/删除其他 admin、不能改 AI 模型配置（应有的边界 ✓，但需要修复上述漏洞才能真正生效）。

---

## 二、修复方案

### 修复 1：`import-users` 强制 admin 角色边界
- 在循环校验中，如果 `!isSuperAdmin && r.role === "admin"` → 直接报错"仅超级管理员可导入管理员账号"。
- 前端 `ImportUsers.tsx`：当 `!isSuperAdmin` 时，把"默认角色"下拉里的"管理员"项隐藏，并对解析出的 `admin` 行高亮校验失败提示。

### 修复 2：统一 super_admin 鉴权识别
对以下 4 个 edge function 增加 super_admin 识别（与 `delete-user` 已采用的同一模式：直接查 `user_roles` 取 `["admin","super_admin"]`）：
- `bulk-delete-users/index.ts`
- `bulk-reset-password/index.ts`（同时为 super_admin 分支放行所有目标用户类型）
- `reset-password/index.ts`
- `admin-purge-and-bootstrap/index.ts` → 收紧为 super_admin only（高危）

### 修复 3：`ai-provider-admin` 收紧为 super_admin only
- 鉴权改为只接受 `super_admin`，与 `/admin/ai-models` 路由及表 RLS 一致，消除 admin 的"幻觉权限"。

### 修复 4（可选小优化）：`has_role` 调用模式
- 受 `has_role` 函数自身的安全限制（非 admin 调用者只能查自己），edge function 中查询其他用户角色应统一改为 service-role 直查 `user_roles`，避免静默返回 false。会一并在上述函数中替换。

---

## 三、技术细节（参考实现片段）

```ts
// 通用：edge function 鉴权片段
const { data: roleRows } = await admin
  .from("user_roles").select("role")
  .eq("user_id", callerId)
  .in("role", ["admin", "super_admin"]);
const isSuper = roleRows?.some(r => r.role === "super_admin");
const isAdmin = roleRows?.some(r => r.role === "admin");
if (!isSuper && !isAdmin) return json({ error: "Forbidden" }, 403);
```

```ts
// import-users 内 per-row 校验补丁
if (!isSuperAdmin && r.role === "admin") {
  errors.push({ line, message: "仅超级管理员可导入管理员账号" });
}
```

```ts
// ai-provider-admin 鉴权改为 super_admin only
if (!(roles ?? []).some(r => r.role === "super_admin")) {
  return { ok: false, resp: json({ error: "Forbidden: super_admin only" }, 403) };
}
```

---

## 四、验收标准
1. 学院管理员上传含 `role=管理员` 的 Excel → 校验阶段被拒，无任何账号写入。
2. super_admin 在用户管理页可以批量删除、批量改密、单个改密，不再 403。
3. super_admin 可访问"系统重置"页并执行（学院管理员被前端继续放行但后端会 403，下一步可一并隐藏菜单——本计划暂不改菜单）。
4. 普通学院管理员访问 AI 模型设置接口直接 403（菜单本就不显示，仅作纵深防御）。
5. 教师端只能重置/查看本学院学生（既有 RLS 已保证，无需改动）。