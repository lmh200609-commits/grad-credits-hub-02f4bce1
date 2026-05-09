# 批量导入教师账号 — 修复与功能完善

针对超级管理员"批量导入账号"页两个问题：聊天助手返回 Forbidden、教师导入流程不通畅。

## 问题分析

1. **AI 助手 "Forbidden"**：`import-assistant-chat` 边缘函数只允许 `role = 'admin'`，未放行 `super_admin`，因此超级管理员发任何消息都会 403。
2. **教师导入失败的根因**：
   - `import-users` 函数把"调用者所属学院 (callerCollegeId)"写入新账号的 `college_id`。超级管理员没有学院，导致教师被创建为 `college_id = NULL`，后续按学院过滤的查询完全看不到这些教师。
   - 当前模板没有"学院"列，超级管理员无法在表中按行指定学院归属。
3. **教师模板缺失**：现有统一模板含大量学生字段（专业、班级、宿舍、床号等），让教师导入显得混乱。

---

## 修改清单

### 1. 修复 AI 助手 403
**`supabase/functions/import-assistant-chat/index.ts`**
- 把权限校验从 `eq('role','admin')` 改为 `in('role', ['admin','super_admin'])`，与 `import-users` 保持一致。

### 2. 新增独立"教师导入模板"按钮
**`src/lib/parseRoster.ts`**
- 新增 `downloadTeacherTemplate()`，仅含教师相关列：`工号、姓名、性别、民族、政治面貌、出生日期、手机号、学院、角色`。
- 表头说明里强调："学院"列必填（超级管理员场景），按列名匹配 `colleges.name`。
- 角色列示例值固定为"教师"。

**`src/pages/admin/ImportUsers.tsx`**
- 在现有「下载导入模板」旁加一个「下载教师模板」按钮。
- 顶部说明区追加一段教师专用提示，告知超级管理员必须在表里填"学院"列。

### 3. 解析阶段识别"学院"列并解析为 college_id
**`src/lib/parseRoster.ts`**
- 解析时读取「学院 / 学院名称 / college」列，作为字符串 `college_name` 放进 `ParsedRow`。
- 不在前端做学院 → ID 映射，交给后端，避免重复维护。

**`src/pages/admin/ImportUsers.tsx`**
- 在 `validateRow`：当当前用户是超级管理员、且某行 role=teacher/admin 时，要求 `college_name` 非空。
- 通过 `useEffect` 一次性查询当前用户的角色（`super_admin?`）来驱动校验开关。

### 4. 后端按行接受 college_name
**`supabase/functions/import-users/index.ts`**
- `Row` 类型增加 `college_name?: string`。
- 入口处加载 `colleges` 表（id+name）建立查找表。
- 对每一行：
  - 若调用者是 `super_admin`：使用该行 `college_name` 解析出的 `college_id`；找不到则该批整体失败并返回该行错误（与现有错误风格一致）。
  - 若调用者是普通 `admin`：忽略行内 `college_name`，沿用 `callerCollegeId`。
- `createOneUser` 把决定后的 `college_id` 同时写入 `profiles.college_id` 和 `user_roles.college_id`（替换原先固定使用 `callerCollegeId` 的两处）。

### 5. AI 助手 system prompt 同步
**`supabase/functions/import-assistant-chat/index.ts`**
- 在导入规则中追加一条："超级管理员导入教师 / 管理员时，每行必须填写「学院」列；普通学院管理员导入时学院由当前账号自动归属，无需填写。"
- 默认角色支持"教师"已经在正则里 (`管理员|教师|老师|学生`)，无需修改。

---

## 不改动的内容

- 不改 RLS 策略、不改 `colleges` / `profiles` / `user_roles` 表结构。
- 不动学生导入既有流程；学生默认仍走"调用者学院"。
- 不动密码生成规则（学号 + 手机后 6 位）。

## 验证步骤

1. 以超级管理员身份在导入页发任意文字 → 应正常回复，不再 Forbidden。
2. 发送"默认角色=教师" → 顶部 Badge 切换为"默认角色：教师"。
3. 点击"下载教师模板"，模板仅含教师字段且含"学院"列。
4. 填两条教师（学院列分别填两个真实学院名）→ 上传 → 预览无红色 → 确认导入 → 学生管理 / 教师列表里能在对应学院下看到这两位教师。
5. 故意把"学院"留空一行 → 预览阶段该行标红，确认按钮被阻止。
