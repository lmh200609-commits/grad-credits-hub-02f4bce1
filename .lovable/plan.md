## 问题诊断

### 1. "置信度"语义误解
当前 `ai_confidence` 表示**AI 对自己判定结果的把握程度**（不是"材料可信度"）：
- "通过 90%" = 90% 确定该通过
- "驳回 90%" = 90% 确定该驳回 ← 用户误读为"材料 90% 可信却被拒"

由于这个误解，"置信度 45% → 上调到 90%" 的逻辑也显得反直觉。实际服务端逻辑是：当核验项失败、AI 却给出低置信度（如 45% review）时，系统强制改判为驳回，并把"判定的把握程度"对齐到 90%（因为系统 100% 确定该驳回）—— 数学上合理，但叫"置信度"+"上调"非常具有误导性。

### 2. "乱码"
`supabase/functions/evaluate-application/index.ts` line 477：
```
`AI 原判定为「${orig}」，但核验项「…」未通过，已强制改判为「驳回」。`
```
`orig` 是英文枚举（`approve` / `review` / `reject`），直接拼到中文句子里，渲染出「review」「approve」这种"中英混排"，被误认为乱码。

## 改造方案

### A. 重命名概念，消除歧义（前端 + 后端文案）

把 `ai_confidence` 在 UI 上一律改称 **「判定确信度」**，并在徽章右侧加 `(?)` tooltip：
> "AI / 系统对最终判定（通过 / 驳回 / 需复核）的把握程度，不代表材料本身的真实性概率。"

`src/components/AiVerdictCard.tsx` 中 `ConfidenceBadge` 文案：
- `auto_approved`：系统强通过 90%
- `rejected_by_ai`：系统强驳回 90%
- `pending_review`：系统不确定，转人工 45%
- 其它：判定确信度 90%

`src/pages/admin/ReviewHub.tsx` / `src/pages/Reviews.tsx` 表头 "置信度" → "判定确信度"。
`src/pages/ApplicationDetail.tsx` 审核记录行 "置信度 90%" → "判定确信度 90%"。

### B. 重写 override 说明，避免"上调"

`supabase/functions/evaluate-application/index.ts` 第 472–505 行的 `overrideNotes`：

| 原文案 | 新文案 |
| --- | --- |
| `AI 原判定为「review」，但核验项「…」未通过，已强制改判为「驳回」。` | `AI 原判定为「需人工复核」，但核验项「…」明确未通过，系统已改判为「驳回」。` |
| `AI 置信度 45% 与"明确不通过"不一致，已上调至 90%。` | `（判定确信度按系统改判后的"明确驳回"重置为 90%。）` |
| `AI 给出"需人工复核"但置信度 88% 偏高，已下调至 70%（不确定不应高置信）。` | `AI 给出"需人工复核"但确信度 88% 偏高（不确定本不应高确信），系统已校正为 70%。` |
| `无可视觉核验的图片附件，已由「通过」降级为「需人工复核」。` | 不变 |

`orig` 用映射表转中文（approve→通过，reject→驳回，review→需人工复核）。

### C. 回填历史 `application_reviews.reasoning`

通过 migration 用 `REPLACE` 把历史记录中残留的英文枚举与旧"上调"措辞替换为新中文文案：

```sql
UPDATE public.application_reviews
SET reasoning = regexp_replace(
  regexp_replace(
    regexp_replace(reasoning, '「review」',  '「需人工复核」', 'g'),
    '「approve」', '「通过」',     'g'),
  '「reject」',  '「驳回」',     'g')
WHERE reasoning ~ '「(review|approve|reject)」';

UPDATE public.application_reviews
SET reasoning = regexp_replace(
  reasoning,
  'AI 置信度 (\d+)% 与"明确不通过"不一致，已上调至 90%。',
  '（判定确信度按系统改判后的"明确驳回"重置为 90%。）',
  'g')
WHERE reasoning LIKE '%已上调至 90%%';

UPDATE public.application_reviews
SET reasoning = regexp_replace(
  reasoning,
  'AI 给出"需人工复核"但置信度 (\d+)% 偏高，已下调至 70%（不确定不应高置信）。',
  'AI 给出"需人工复核"但确信度 \1% 偏高（不确定本不应高确信），系统已校正为 70%。',
  'g')
WHERE reasoning LIKE '%已下调至 70%%';
```

数值字段 `confidence` 不动（"上调到 90%"在数据上是正确的——只是文案吓人）。

### D. 不改的部分

- 数据库列名 `ai_confidence` / `confidence` 保持不变（仅 UI 标签变化），避免破坏 types.ts、edge functions、其他报表。
- 服务端的 0.85 / 0.7 / 0.4 阈值与"无附件降级"等业务规则保持不变。
- 学生端可见文案（reasoning_short）不改，本来就不暴露置信度。

## 涉及文件

- `supabase/functions/evaluate-application/index.ts` —— override notes 中文化 + `orig` 枚举映射
- `src/components/AiVerdictCard.tsx` —— 徽章文案 + tooltip
- `src/pages/admin/ReviewHub.tsx` —— 表头文案
- `src/pages/Reviews.tsx` —— 表头文案
- `src/pages/ApplicationDetail.tsx` —— "置信度 X%" 文案
- 新建 migration —— 回填历史 `application_reviews.reasoning`
