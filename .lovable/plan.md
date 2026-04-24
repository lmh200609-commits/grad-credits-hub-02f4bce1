## 需求拆解

1. **AI 初审不通过直接告知学生**：学生端不再脱敏 `rejected_by_ai`，显示"系统未通过"+**简短理由**；并提供"申请人工复核"按钮。
2. **AI 理由分长短两版**：
   - **学生端**：只看简短重点（一句话，≤60 字）。
   - **教师/管理员端**：保留完整 `ai_reasoning`，包含一致性、相关性、真实性、姓名匹配、识别细节、结论等全部内容。
3. **AI 终态不再需要教师二次确认**：`auto_approved` / `rejected_by_ai` 都是最终结果。教师/管理员端不强制处理每条；仅当学生主动转人工时才进入"待复核"。
4. **教师/管理员仅"自主复核"权**：保留随时查看任意申请，但默认 Tab 为"待复核"。
5. **二次人工复核醒目标记**：申请已存在 teacher/admin 复核记录后再次进入 `pending_review` 时，在审核列表行 + 详情顶部用红色 Badge 标注"⚠ 第 N 次人工复核（学生再次申诉）"。
6. **学生侧审核记录统一显示"教师复核"**：`teacher_review` 与 `admin_review` 在学生视角都渲染为"教师复核"。
7. **我的申请新增"申请名字"列**：以 `custom_keywords[0]` → `selected_keywords` 拼接 → 截断 `description` 为后备，例："英语四级"、"第二课堂"。
8. **驳回的最终学分=0**：`rejected` / `rejected_by_ai` 在列表/详情显示 `0`（仅显示层处理，不改库）。

## 技术实现

### 数据库

**新增字段** `applications.ai_reasoning_short text`（可空），保存 AI 给学生看的一句话简版理由。
- 通过迁移工具添加，无 RLS 改动。
- 不删除 `ai_reasoning`（教师/管理员仍读它）。

### Edge Function

**`supabase/functions/evaluate-application/index.ts`**
- AI tool schema 增加 `reasoning_short: string`（≤60 字，结论导向，给学生看）。
- system prompt 追加要求：同时输出 `reasoning`（详细，给教师）和 `reasoning_short`（一句话，重点是为什么不通过/通过，给学生）。
- `applications.update` 同时写入 `ai_reasoning_short`。

### 学生端

**`src/components/StatusBadge.tsx`**
- 学生 MAP：`rejected_by_ai` → "系统未通过"（danger 样式）；`auto_approved` → "已通过"（success 样式）；其余仍为"审核中"。

**`src/pages/student/MyApplications.tsx`**
- `select` 增加 `custom_keywords, selected_keywords, ai_reasoning_short`。
- 新增"申请名字"列：`getAppTitle(row)` = `custom_keywords[0]` ?? `selected_keywords.join(" · ")` ?? `description.slice(0,20)`。
- "最终学分"列：`rejected` / `rejected_by_ai` → 显示 `0`。

**`src/pages/ApplicationDetail.tsx`**（学生视角）
- 当 `status === "rejected_by_ai"`：显示红色卡片，标题"系统未通过"，正文使用 `ai_reasoning_short`（无则降级为 `ai_reasoning` 截前 60 字），并提供"申请人工复核"按钮（复用 `requestManualReview`，对学生开放）。
- 若已有教师/管理员 review 记录后申请重新回到 `pending_review`，按钮文案改为"申请二次人工复核"。
- 审核记录中 `admin_review` 在学生 audience 渲染为"教师复核"。
- 学生最终学分显示：`rejected*` → `0`。
- 学生看不到 `ai_reasoning`（详细版）卡片。

### 教师 / 管理员端

**`src/pages/Reviews.tsx`**
- 默认 Tab 改为 `pending_review`。
- 批量取出当前页申请的 `application_reviews`（仅 `teacher_review`/`admin_review`）做计数；若 `pending_review` 行的人工复核次数 ≥ 1，显示 `<Badge variant="destructive">⚠ 第 N 次复核</Badge>`（N = 已有人工复核数 + 1）。
- 列表中 `rejected*` 行的"建议学分"列显示 `0`。

**`src/pages/ApplicationDetail.tsx`**（教师/管理员视角）
- 顶部状态徽章旁：若属于二次及以上复核，显示红色 Badge"⚠ 第 N 次人工复核（学生再次申诉）"。
- "系统核验结果"卡片继续展示完整 `ai_reasoning`（不改）。
- 复核操作不变。

## 不做的事

- 不修改 `rejected_by_ai` 的 `final_credit` 数据（仍为 `null`），仅显示层处理为 0。
- 不重命名 `admin_review` 数据，仅学生端渲染时改字。
- 不引入新 status 枚举值。
