# 修复"Forbidden"误判 + 增加提问模板

## 真正的 Bug

某些用户（如同时拥有 `admin` 和 `super_admin` 两条角色记录的账号）调用 `import-assistant-chat` 时仍报 Forbidden。

DB 查询确认：
- 当前 `super_admin` 账号中，有一个 `user_id = 9b1f36f2-…` 同时存在两条 `user_roles`：`['admin','super_admin']`。
- 上一版修复用 `.in('role', ['admin','super_admin']).maybeSingle()` —— `maybeSingle()` 在结果 > 1 行时直接返回错误且 `data = null`，于是 `!roleRow` 判定为 Forbidden。

`import-users` 第 147–153 行同样写法，同样会对该账号失败；`ai-provider-admin` 也是同模式，但用的是 `eq('role','super_admin')`，不一定中招，但应统一加固。

## 修改清单

### 1. 用 limit(1) 替代 maybeSingle，彻底兼容多角色账号
**`supabase/functions/import-assistant-chat/index.ts` (line 66-69)**
- 改为：`.select('role').eq('user_id', callerId).in('role', ['admin','super_admin']).limit(1)`。
- 判定 `Array.isArray(data) && data.length > 0` 才放行。

**`supabase/functions/import-users/index.ts` (line 147-154)**
- 同样改写：用 `.limit(1)`，再单独算 `callerCollegeId`（取该行的 `college_id`）。
- 保持后续 `isSuperAdmin` 判定逻辑不变（按取到的 role 字段判断）。

### 2. UI 增加"完整提问模板"快捷按钮
**`src/pages/admin/ImportUsers.tsx`**
在聊天输入框上方加入一行 chip 形式的"快速提问"按钮（点击即填入输入框并发送）。预设 6 条覆盖管理员最常问的问题：
- "默认角色=教师"
- "默认角色=学生"
- "怎么导入教师账号？"
- "学院列必须填什么？"
- "密码规则是什么？"
- "导入失败怎么排查？"

模板入口仅在 `pendingRows == null` 且消息数较少时显示，避免占用聊天空间；点击不直接发请求，而是先把文本写入输入框（用户可改）。

### 3. 系统提示词补一条"提示用户可点模板"
**`supabase/functions/import-assistant-chat/index.ts` SYSTEM_PROMPT**
- 在结尾加一句："如果用户问题模糊，先列出 3-5 个常见提问让他选择。"

## 不改动

- RLS、表结构、模板下载、教师导入逻辑均不动。
- `ai-provider-admin` 暂不改——其 `maybeSingle` 调用都是按业务唯一键查询，不涉及多角色。

## 验证

1. 用 `9b1f36f2-…` 这个同时拥有两个角色的超级管理员登录，发送任何文字 → 应正常回复，不再 Forbidden。
2. 用纯 super_admin / 纯 admin 账号登录，行为不变。
3. 聊天框上方出现 6 个"快速提问"按钮，点击后填入输入框，可直接发送或修改后发送。
