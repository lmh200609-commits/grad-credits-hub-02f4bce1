本轮按你的确认执行三件事，**学生名册不在本轮处理**（你之后在 `/admin/import` 自己上传 Excel）。

## 一、本轮要做的事

### 1. 清空业务数据（不可恢复）
清空以下表的全部行：
- `applications`（学分申请）
- `application_reviews`（评审记录）
- `submission_records`（提交流水）
- `audit_logs`（审计日志）

保留：`rules`、`rule_library`、`keywords`、`cases`、`certificate_types`、`ai_providers`、`ai_function_bindings`、当前你正在登录的管理员账号。

### 2. 删除所有非管理员账号
- 查出所有 `user_roles.role IN ('student','teacher')` 的 `user_id`
- 同时删除 `auth.users` 行（连带触发 profile/role 清理）
- 删除孤儿 profile（`profiles` 表里在 `user_roles` 没有对应行的）
- 这一步会一并干掉 dev-seed 创建的 `2024001 / T001 / S2024xxx` 等测试账号，以及 `__perftest__` 性能测试账号

### 3. 新增一个新管理员账号
- 账号：`A` + 8 位随机数字，例如 `A47390215`
- 邮箱：`A47390215@admin.local`（前端登录时输入账号即可）
- 密码：随机 12 位强密码（含大小写字母 + 数字，去掉易混淆字符 0/O/1/l）
- 在 `user_roles` 写入 `admin` 角色
- **会在聊天里完整展示账号 + 密码一次**，请立即记下来；之后系统不再保存明文密码

### 4. 新建一个一次性 Edge Function `admin-purge-and-bootstrap`
专门用于本次清理，调用方为当前登录的 admin。完成后保留该函数（管理员后续若再次需要重置整个环境也能用），但写入清晰的"会清空全部业务数据"警告。

请求体：
```json
{ "confirm": "PURGE", "create_new_admin": true }
```
必须传 `confirm: "PURGE"` 才会执行；否则返回 400。

返回：
```json
{
  "deleted_applications": 123,
  "deleted_reviews": 45,
  "deleted_submission_records": 67,
  "deleted_audit_logs": 12,
  "deleted_users": 38,
  "new_admin": { "account": "A47390215", "email": "A47390215@admin.local", "password": "xxxxxxxxxxxx" }
}
```

### 5. 触发执行
我会在 Edge Function 部署完成后，用 `supabase--curl_edge_functions` 带你当前登录态调用一次，把返回的新管理员账号密码贴回聊天给你。

## 二、密码规则（用于之后你上传名册时）
你已确认：默认密码 = `学号 + 电话号码后六位`，无电话或不足 6 位时 → `学号 + 000000` 补齐。

这个规则需要改 `supabase/functions/ai-parse-roster/index.ts`（目前它对 password 列只做"≥6 位才用，否则取默认密码"），新增逻辑：
- 当导入页未在表格中提供 password 列时，按 `student_no + (phone 后 6 位 || '000000')` 计算每行密码
- 在解析返回的预览里展示前几位 + 后 4 位的脱敏密码，避免泄漏

这一步**本轮一并实现**，方便你之后直接上传名册即可，不需要再改代码。

## 三、文件改动清单
- 新建：`supabase/functions/admin-purge-and-bootstrap/index.ts`
- 编辑：`supabase/functions/ai-parse-roster/index.ts`（按 学号+电话后6位 生成默认密码）
- 编辑：`supabase/config.toml`（注册新函数 `verify_jwt = false`，函数内自行用 JWT + admin 角色校验）

## 四、风险提示
- 第 1、2 步**不可逆**。执行前我会再次在调用前确认。
- 你当前登录的管理员账号 **不会被删除**（函数里会跳过 caller_id）。
- 删除 auth user 不会自动级联到 `applications`，所以执行顺序固定为：先清业务表 → 再删用户。
- 性能测试相关 `cases.notes='__perftest__'` 不在清理范围（cases 表整体保留）；如要顺带清，请在执行前告诉我。

## 五、之后你要做的
1. 用本轮返回的新管理员账号登录
2. 进入 **AI 名册导入助手** 页（侧边栏 → 导入用户），上传 Excel
3. 系统会按 `学号 + 电话后6位` 自动生成每个学生的默认密码
4. 预览确认 → 点击"确认导入"，2000+ 条名册会分批 200 条创建