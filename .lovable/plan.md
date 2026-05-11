## 目标

把审查流程从「先 AIGC 鉴别 → 再 AI 评估」改成「**先 AI 评估 → 仅当 AI 评估未驳回时才跑 AIGC 鉴别**」。同时：

- AIGC 拥有"一票否决"权：判定为 AI 生成图（fake）→ 强制 `rejected_by_ai`。
- 在 AIGC 仍在排队/进行中时，前端不揭晓 `auto_approved`，统一显示为"复核中"，等 AIGC 完成再公布最终结论。

## 新流程

```text
学生提交材料
        │
        ▼
   [系统 AI 评估]   ← 仅看材料/关键词/姓名/身份/逻辑等，不掺入 AIGC 信号
        │
        ├─ 驳回 → status=rejected_by_ai，终止，不跑 AIGC，节省额度
        │
        └─ 通过 / 待复核
                │ 写入 ai_* 字段，但 status 暂存为 pending_review
                │ （不允许在 AIGC 完成前进入 auto_approved）
                ▼
           [AIGC 鉴别]   ← 一票否决
                │
                ├─ fake     → 覆盖为 rejected_by_ai
                ├─ suspect  → 保持 pending_review
                └─ real / skipped / error → 若 AI 评估本意是 auto_approve 且高置信，
                                            此时才提升为 auto_approved
```

## 改动点

### 1. 数据库触发器（新建迁移）

- **`enqueue_aigc_detect`**：从 INSERT 触发器中移除（提交时不再立刻入 AIGC 队列）。
- **`enqueue_ai_eval_after_aigc`**：删除，不再以 AIGC 完成作为 AI 评估的前置。
- **`enqueue_ai_eval`**：修改为只要 `status='pending_ai'` 就入队，提交时立刻把 AI 评估排队。
- **新增 `enqueue_aigc_detect_after_eval`**：在 `applications` UPDATE 触发；当 AI 评估写完结果（`ai_last_attempt_at` 由 NULL 变为非 NULL，或 `status` 从 `pending_ai` 变为 `pending_review`）、`status` 不是 `rejected_by_ai`、`aigc_status='pending'`、`file_path` 是图片时，把任务入 `aigc_detect_queue` 并 `pg_net` 唤醒 `process-aigc-queue`。

### 2. `evaluate-application` Edge Function

- 删除 106–122 行的"AIGC 前置同步触发"逻辑。
- 删除所有读取 `aigc_status / aigc_score` 影响 prompt 与 `nextStatus` 的代码（`aigcSuspect` 分支、`aigcExtraPrompt`、attachmentNote 中的 AIGC 表述）。AI 评估完全不感知 AIGC。
- **`nextStatus` 计算调整**：原本写 `auto_approved` 的分支，先把 `_intended_auto_approve` 信号写入临时列（见下），但实际落库 `status='pending_review'`，避免在 AIGC 出结果前出现"已通过"。
- 仍保留：开始时若 `app.status === 'rejected_by_ai'` 直接返回。

### 3. `aigc-detect` Edge Function

- **fake**：把 `status` 强制覆盖为 `rejected_by_ai`，`ai_reasoning` 末尾追加「AIGC 一票否决：检测为 AI 生成图（概率 X%）」，`ai_check_authenticity=false`。
- **suspect**：保持 `pending_review`，`ai_reasoning` 末尾追加「AIGC 鉴别：疑似 AI 生成（概率 X%），已转人工复核」。不再尝试自动通过。
- **real / skipped / error**：若 `ai_intended_auto_approve=true` 且当前 `status='pending_review'`，提升为 `auto_approved` 并按 evaluate-application 的逻辑落实学分（写 `final_credit = ai_suggested_credit`、`reviewed_at=now()`、`review_source='ai'`）；否则保持 `pending_review`。
- 都要写 `aigc_*` 字段（不变）。

### 4. 数据库 schema 微调（同迁移）

- `applications` 新增字段 `ai_intended_auto_approve boolean default false`，由 evaluate-application 在"本应自动通过但需等 AIGC"时置 true。AIGC 完成后由 aigc-detect 决定是否兑现。
- 兼容老数据：所有历史申请该字段为 false，不影响。

### 5. 前端

无需改动。前端原本就根据 `status` 显示，AIGC 完成前为 `pending_review`（"待复核"），完成后再变成 `auto_approved` 或 `rejected_by_ai`，体验自然。

## 影响

- **省额度**：AI 评估直接驳回的申请不再调用阿里云 AIGC 接口。
- **不"先甜后苦"**：用户不会在 AIGC 出结果前看到"已通过"再被翻盘；统一以"复核中 → 通过/驳回"的顺序揭晓。
- **AIGC 一票否决**：AI 评估通过的图片若被判定 AI 生成，仍会被驳回。
- **教师视角**：详情页 reasoning 里同时能看到 AI 评估结论 + AIGC 追加说明。