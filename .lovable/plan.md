## 三个问题修复

### 1. 教师/管理员重复点击「通过/驳回」会写入多条复核记录

**现象**：在 `src/pages/ApplicationDetail.tsx` 的 `decide()` 中，按钮无 loading 状态、无幂等校验，快速连击会向 `application_reviews` 插入多条相同记录（截图所见 6 条「教师复核 已通过 学分5.5 SB」）。`applications.status/final_credit` 仅以最后一次为准，所以总学分正确，但审核记录列表视觉污染。

**修改**（仅前端，业务逻辑不变）：

- 增加 `submitting` state；进入 `decide()` 时若 `submitting===true` 直接 return；`finally` 中复位。
- 增加幂等门：进入 `decide()` 先重新查一次 `applications` 当前 `status`，若已是 `approved` / `rejected`（且本人是 `final_reviewer_id`，30 秒内）则提示「已处理，无需重复操作」并 return。
- 「通过」「驳回」「转人工」按钮加 `disabled={submitting}` 与「处理中…」文案。
- `requestManualReview()` 同样加 `submitting` 守卫，避免学生端连点。

### 2. 学生「我的档案 → 基本信息」不允许修改（证件照仍可修改）

**修改**：`src/pages/student/MyProfile.tsx`

- 「基本信息」卡片所有 `<Field>` 改为只读展示（`<Input value=... disabled />`）。
- 移除「保存」按钮与 `save()` 调用。
- **证件照卡片保持可上传/更换**（学生可能传错，需自助修正）。
- 顶部 `CardDescription` 文案调整为「基本信息由学校统一维护，如有错误请联系辅导员；证件照可自行更换」。

### 3. 学生「我的档案」缺少修改密码入口

**修改**：在 `src/pages/student/MyProfile.tsx` 增加「修改密码」卡片：

- 字段：新密码、确认新密码（最少 6 位，两次一致校验）。
- 按钮 `提交` → 调用 `supabase.auth.updateUser({ password })`。
- 成功 toast「密码已更新」并清空字段；失败显示错误。
- 提交期间按钮 disabled，避免连点。

> 注：Supabase 的 `updateUser` 不要求输入旧密码（依赖当前 session）。本次按最简实现。

---

### 技术细节

- 全部为前端改动，无需迁移、无需触发器。
- 复核按钮防抖通过 React state 实现；配合现有 `application_reviews` realtime 订阅会自然刷新去重 UI。
- 基本信息字段（姓名/学号/院系/专业/班级/身份证/手机号/性别/民族/政治面貌/出生日期/入学年份/辅导员/公寓/宿舍/床号）一律 disabled；证件照仍可上传。

### 涉及文件

- `src/pages/ApplicationDetail.tsx`
- `src/pages/student/MyProfile.tsx`
