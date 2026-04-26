## 用户提出的三个问题

1. **学生主动申请的人工复核** 与 **AI 自己拿不准触发的人工复核** 在系统里都是 `pending_review`，教师无法一眼分辨；
2. AI **拒绝** / **不确定 review** / **学生申诉的人工复核** 三种情况，置信度展示混在一起，看不出区别；
3. 教师/管理员端看到的 AI 结果（`ai_reasoning` 长文）夹杂英文（null、SCI、AI 等），并且没有把四项核验拆成结构化中文呈现，不够"详细"。

## 修复方案（一次解决三件事）

### A. 区分"复核来源"——加一个枚举字段，而不是新增状态

避免动核心 `application_status` 枚举（涉及大量表/RLS/UI），而是在 `applications` 加一个轻量字段：

```sql
ALTER TABLE public.applications
  ADD COLUMN review_source text
  CHECK (review_source IN ('ai_uncertain','student_appeal','reviewer_recall'));
```

含义：
- `ai_uncertain`：AI 自己不确定，主动转人工（`evaluate-application` 写入）
- `student_appeal`：AI 已驳回 / 已通过后，学生主动点"申请人工复核"（`requestManualReview` 写入）
- `reviewer_recall`：教师/管理员把已结案重新打回（保留扩展位）

写入位置：
- `supabase/functions/evaluate-application/index.ts`：当 `nextStatus = "pending_review"` 时同时 `review_source: "ai_uncertain"`
- `src/pages/ApplicationDetail.tsx` 的 `requestManualReview()`：写 `review_source: "student_appeal"`

UI 区分：
- `ApplicationDetail` 顶部 badge 旁、`Reviews` 列表行内、`ReviewHub` 子计数都加一个小徽章：
  - 🟡「AI 转人工」= `ai_uncertain`
  - 🟠「学生申诉」= `student_appeal`
- `Reviews.tsx` 的"待复核"Tab 顶部加两个筛选 chip：「全部待复核 / AI 转人工 / 学生申诉」。

### B. 置信度展示分场景区分

服务端置信度规则（在 `evaluate-application` 的 normalize 阶段就保证）：

| 场景 | recommendation | confidence 区间 | 展示方式 |
|---|---|---|---|
| 4 项核验全部 OK，材料明确通过 | approve | 0.85–0.98 | 绿色「系统高置信通过 92%」 |
| 任一核验失败 / 明显造假 | reject | 0.85–0.98 | 红色「系统高置信驳回 92%」 |
| 模糊 / 缺附件 / 同名等无法判断 | review | **0.40–0.70** | 灰色「系统低置信，转人工 55%」 |
| 学生申诉触发的人工复核 | — | **不显示 AI 置信度**，单独标「学生申诉，无 AI 置信度」 |

服务端硬约束（防止再出现"review + 90%"自相矛盾）：
- 只要任一核验项 false → 强制 `recommendation = "reject"`，`confidence = max(原值, 0.9)`；
- `recommendation === "review"` → `confidence = min(原值, 0.7)`；
- approve 时附件不是图片 → 降级为 review，`confidence ≤ 0.65`。

前端 `ApplicationDetail` / `SubmissionRecords` / `Reviews` 的置信度位置都按上表的颜色 + 文案展示，避免单纯一个百分比让人误解。

### C. 让 AI 结果"全中文 + 结构化 + 详细"

#### C1. 持久化结构化字段（不再只存一段长文）

```sql
ALTER TABLE public.applications
  ADD COLUMN ai_check_consistency  boolean,
  ADD COLUMN ai_check_relevance    boolean,
  ADD COLUMN ai_check_authenticity boolean,
  ADD COLUMN ai_check_name_match   boolean,
  ADD COLUMN ai_detected_project     text,
  ADD COLUMN ai_detected_achievement text,
  ADD COLUMN ai_detected_level       text,
  ADD COLUMN ai_detected_identity    text,
  ADD COLUMN ai_override_note        text;  -- 服务端硬覆盖时写明原因
```

`evaluate-application` 在写 `applications` 时把 AI tool-call 的 4 个布尔 + 4 个 detected 字段一并落库，并在被服务端 normalize 强制改判时写 `ai_override_note`（例如：「AI 给出 review 但一致性=false，已强制改判为驳回」）。

#### C2. Prompt 收紧 + 中文化输出

在 `supabase/functions/evaluate-application/index.ts` 的 systemPrompt 里追加硬约束：
- "所有字段、reasoning、reasoning_short **必须使用简体中文**，禁止出现 null、SCI、ACM 等英文/缩写；如必须引用英文术语，请加中文解释。无法识别就写「未识别」而不是 null。"
- "review 表示不确定，confidence 不得 ≥ 0.8；能给出 ≥0.85 的把握必须选 approve / reject。"
- "任一核验项 false → 必须 reject，confidence ≥ 0.85。"

服务端兜底：把 detected_* 与 reasoning 中的 `"null"` / `null` 字面量替换为 `"未识别"`；把 `"SCI"` `"ACM"` 等保留但加括号中文（仅做轻量字符串处理）。

#### C3. 教师/管理员端"系统核验结果"卡片改版（`src/pages/ApplicationDetail.tsx`）

把现在那段灰底长文 `ai_reasoning`，重构成一张结构化卡：

```
系统核验结果                          [系统高置信驳回 92%]

四项核验
  ✓ 材料一致性     与所选关键词一致
  ✗ 图片相关性     图片为风景，与"学科竞赛"不相关
  ✓ 真实性         未发现篡改或 AI 生成痕迹
  — 姓名匹配       图片中未出现姓名，无法判断

图片实际识别
  项目大类：学科竞赛
  成果细类：未识别
  级别：    省级三等奖
  身份：    未识别

服务端复核备注（如有）
  AI 给出 review 但一致性=false，已强制改判为驳回。

详细理由
  （ai_reasoning 中文长文）
```

`SubmissionRecords.tsx`、`Reviews.tsx` 列表里的"AI 简短理由"也优先用 `ai_reasoning_short`（已经更短更中文）。

### D. 涉及文件汇总

- 迁移：新增 1 个 migration 加上 `review_source` + 4 布尔 + 4 detected + `ai_override_note` 字段（无需改枚举）
- `supabase/functions/evaluate-application/index.ts`：prompt 收紧、normalize 后处理、写入新字段、写 `review_source='ai_uncertain'`
- `supabase/functions/ai-eval-stress-test/index.ts`：同步 prompt（中文/置信度规则）保证压测口径一致
- `src/integrations/supabase/types.ts`：自动同步（不手改）
- `src/pages/ApplicationDetail.tsx`：
  - "系统核验结果"卡片改成结构化展示
  - `requestManualReview` 写 `review_source='student_appeal'`
  - 顶部加来源徽章
- `src/pages/Reviews.tsx`：加来源筛选 chip + 行内来源徽章
- `src/pages/admin/ReviewHub.tsx`：拆分 `pending_review` 计数为 AI 转人工 / 学生申诉 两个子卡
- `src/pages/SubmissionRecords.tsx`：AI 卡片同步成结构化展示，置信度按颜色分级

## 验收

1. 用 `ai-eval-stress-test` 跑一遍：所有有明显问题的用例（C2/C3/C5/C7）→ `rejected_by_ai`，置信度 ≥ 90%；模糊/同名/无附件（C6/C8/C9/C10）→ `pending_review` + `review_source='ai_uncertain'`，置信度 ≤ 70%。
2. 学生在已驳回页点"申请人工复核" → `pending_review` + `review_source='student_appeal'` + 教师列表标「学生申诉」徽章 + 不显示 AI 置信度。
3. 教师打开任一申请详情 → "系统核验结果"四项核验、检测属性、强制改判备注、详细理由分块展示，无 `null`/英文裸词。
