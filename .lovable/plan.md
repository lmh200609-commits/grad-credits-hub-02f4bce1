## 问题诊断

**1. 超级管理员被识别成"教师"**
`src/components/StaffAiAssistant.tsx` 里：
```ts
const role = hasRole("admin") ? "admin" : "teacher";
```
super_admin 不持有 `admin` 角色，所以被回退为 `teacher`，发到 `staff-ai-assistant` 的 `body.role` 也是 `teacher`，因此 AI 回答"教师身份"。

**2. AI 助手不知道"我是谁"**
- `staff-ai-assistant` 边缘函数完全没有读取调用者 JWT，也没有加载调用者档案，系统提示词里只有一行"当前用户角色：xxx"，没有姓名/学号/学院/部门。
- `ask-credit-assistant` 虽然能解析 JWT，但只在 `isPersonalQuery()` 命中"我的xxx"等关键词时才注入身份；"我是谁 / 我叫什么 / 我学号多少 / 我哪个学院"等不会触发，所以学生端也答不出来。

---

## 修复方案

### A. 前端：正确传递角色 — `src/components/StaffAiAssistant.tsx`
- 从 `useAuth()` 解构 `isSuperAdmin`。
- 角色判定改为：`isSuperAdmin ? "super_admin" : hasRole("admin") ? "admin" : "teacher"`。
- 头部 chip 文案也同步显示「超级管理员 / 管理员 / 教师」。

### B. `staff-ai-assistant` 边缘函数注入"我是谁"上下文
- 解析 `Authorization` Bearer JWT，拿到 `user_id`（沿用 ask-credit-assistant 里 `auth.getClaims` 写法）。
- 用 service role client 拉取：
  - `profiles`：full_name / email / department / class_name / college_id
  - `user_roles`：该用户全部角色 + college_id
  - `colleges`：根据 college_id 拿 name / short_name
- 把上述信息拼成一段 system 消息追加到 `convo`（位于 SYSTEM_PROMPT 之后），格式如：
  ```
  ===== 当前登录用户 =====
  姓名：张三 | 邮箱：xxx | 角色：超级管理员 | 所属学院：（全校）
  ```
- SYSTEM_PROMPT 行为约束新增一条：「当用户问『我是谁/我叫什么/我什么角色/我哪个学院』时，必须基于上面『当前登录用户』段落如实回答，不得说不知道。」
- 角色枚举扩展 `super_admin`，`super_admin` 视为可访问全部页面。

### C. `ask-credit-assistant` 边缘函数对学生端做同样注入
- 现已解析 `myUserId`，把"加载 profile + college"提到 `isPersonalQuery` 判断之前，无条件注入一段 `===== 当前登录学生 =====` system 消息（含姓名/学号/学院/班级/专业）。
- SYSTEM_PROMPT 增加一条：「问『我是谁/我叫什么/我学号/我哪个学院/我哪个班』时，基于『当前登录学生』段落如实回答。」
- 保留原有 `mySummary`（学分汇总）逻辑不变。

### D. 不改动
- 数据库结构、RLS、其他边缘函数、UI 布局、其他文案。

---

## 验证步骤
1. 用超级管理员登录 → 打开工作助手 → 问"我是谁" → 应回答姓名 + 超级管理员。
2. 学院管理员登录 → 问"我是哪个学院的" → 回答具体学院名 + 管理员。
3. 教师登录 → 问"我是谁" → 回答姓名 + 教师 + 学院。
4. 学生登录 → 问"我是谁 / 我学号是多少 / 我哪个班" → 回答 profile 真实信息。