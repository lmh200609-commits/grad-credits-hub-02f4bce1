## 三个问题修复

### 1. 错误弹窗英文化（"new row violates row-level security policy for table applications"）

**触发位置**：截图中点击「申请二次人工复核」时报错。已通过/已驳回的申请不在 `apps student update own` 的 `WITH CHECK` 白名单 (`pending_ai/pending_review/rejected_by_ai`) 内 → RLS 拒绝 → Supabase 直接抛英文消息 → 前端 `toast({ description: error.message })` 原样显示。

**修改**（前端，`src/pages/ApplicationDetail.tsx`）：

- 新增小工具 `friendlyError(err)`：
  - 命中 `row-level security` / `permission denied` → 返回「当前申请已结案或你无权发起此操作」
  - 命中 `JWT` / `expired` → 「登录已过期，请重新登录」
  - 其余按 `err.message` 原样
- `requestManualReview()` 与 `decide()` 失败分支统一走 `friendlyError`。
- 同时在按钮 disabled 条件中加上 `app.status === "approved" || app.status === "rejected"`，从源头不让点（按钮文案改为「该申请已结案，无法再次复核」），减少触发。

### 2. 复核学分输入框鼠标滚动会改值

**位置**：`src/pages/ApplicationDetail.tsx` 第 873 行
```tsx
<Input type="number" step="0.5" value={credit} ... />
```
浏览器原生 `<input type=number>` 默认允许滚轮和上下箭头修改数值。

**修改**：
- 给该 Input 加：
  - `onWheel={(e) => (e.target as HTMLInputElement).blur()}` — 滚轮触发时立刻失焦，阻断 step 变化
  - `onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}` — 禁用上下箭头微调
  - 保留 `step="0.5"` 但只允许键盘数字直接输入
- 全局排查：`rg 'type="number"'` 找出教师/管理员审核相关数字输入（如批量审核 `decideBatch` 默认学分输入、规则学分输入等），同样处理。
  - 候选文件：`src/pages/ApplicationDetail.tsx`、`src/pages/admin/ReviewHub.tsx`（若有批量学分输入）、`src/pages/admin/Rules.tsx`（规则学分）
  - 实施时只对"复核学分输入"加严格守卫，规则编辑这种偏行政场景按需酌情。

### 3. AI 助手回答中夹带英文 URL 路径，被用户视为"乱码"

**现象**（图3）：
> 点击进入不合格学生名单页：`/admin/credits?passFilter=fail`

正文中出现裸路径与英文查询参数，体验上像乱码；下方其实已有"跳转 …"按钮，路径文本是冗余的。

**修改**（`supabase/functions/staff-ai-assistant/index.ts`）：

1. **强化 system prompt**：在 `CHINESE_ONLY_RULE` 末尾增补一条：
   > 14. 当工具返回 `navigate_path` 或你已请求 `navigate_to` 时，UI 会自动渲染跳转按钮。**回答正文中严禁出现任何 URL、路径片段（包含 `/admin/...`、`/teacher/...`、`/applications/...`、`?passFilter=...` 等）和英文查询参数**。只用一句中文描述用户应做什么，例如"已为你定位到不合格学生名单，可点击下方按钮进入"。

2. **服务端兜底过滤**：在 `answer` 写回前增加 `stripPathsFromAnswer(answer)`：
   - 正则去除 `/[a-z][a-zA-Z0-9_/?=&%-]+`（裸 URL/路径片段）
   - 去除 markdown 链接 `[xxx](/...)` 中的链接，仅保留可读文本
   - 同步从 `sections` 输出里清理
3. 验证：点测"查看不合格学生"、"打开复核中心"，对话气泡不再出现路径文本，跳转按钮仍可用。

> 备注：该 edge function 修改后会自动部署。

---

### 涉及文件

- `src/pages/ApplicationDetail.tsx`（错误友好化 + 数字输入防滚轮）
- `supabase/functions/staff-ai-assistant/index.ts`（提示词 + 服务端剥离路径）
- 可能涉及：`src/pages/admin/ReviewHub.tsx` 等其他复核学分输入位（按 grep 结果决定）

### 不改

- 数据库 / RLS 策略 — 已通过/已驳回不让学生再改属于正确的安全约束，仅改前端体验。
- AI 助手的工具调用与跳转按钮逻辑保持不变。
