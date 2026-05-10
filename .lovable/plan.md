## 问题诊断

**问题 1：明明是 AI 图，系统却显示"真实拍摄 0.0%"**

不是"传给阿里云的是一串代码"——阿里云后台截图（图3）能看到我们传过去的 `图片URL` 完全正常，是 Supabase 签名 URL，阿里云也成功拉取并识别成了"高风险 risk_aigc / risk_edit"。

真正的 bug 在 `supabase/functions/aigc-detect/index.ts` 的 `parseAliyunResult()`：阿里云 `aigcDetector_ultra` 返回的标签实际叫 `risk_aigc` / `risk_edit` / `nonLabel`，但代码里写的是：

```ts
if (/^(ai|aigc|fake|generated|...)/.test(label))
```

`risk_aigc` 不以 `ai|aigc|fake` 开头 → 命中分始终 = 0 → 永远判成 `real`。同时也没有读阿里云顶层返回的 `RiskLevel`（"高风险"/"无风险"），白白扔掉了最直接的判定信号。

**问题 2：每次都要手动点"处理队列"才会跑 AI 鉴别**

数据库触发器其实已经在每次学生提交时自动把任务塞进 `aigc_detect_queue`（迁移 `20260510114509`），但消费这个队列的 `process-aigc-queue` 函数 **从来没被注册成 pg_cron 定时任务**。对比 `process-eval-queue` 是每分钟跑一次（迁移 `20260510131543`），AIGC 队列就只能靠管理员去 `/admin/aigc` 页面手动点按钮触发。

## 修复方案

### A. 修正阿里云返回解析（`supabase/functions/aigc-detect/index.ts`）

重写 `parseAliyunResult()`：

1. 标签匹配扩展为 `/^(risk_aigc|risk_edit|ai|aigc|fake|generated|sd|midjourney|seedream|flux|kling)/`，把 `risk_aigc` / `risk_edit` 都当作 AI 生成的强证据。
2. 增加顶层 `RiskLevel` 兜底：`high` → 至少 0.9，`medium` → 至少 0.6，`low` → 至少 0.3，避免极端情况下数组解析不到东西时全部判成真实。
3. `suspected_models` 从 `Description` / `SubLabels` 里提取常见模型名（Midjourney / SD / Flux / 豆包 Seedream / 通义万相 / 可灵 / Sora 等），写到 `aigc_detail.suspected_models`，方便审核员看。

不动签名、不动请求体、不动 imageUrl 流程——阿里云那边证明拉图本身是好的。

### B. 让 AIGC 队列自动跑（新建一条迁移）

仿照 `process-eval-queue` 的 cron，新增 pg_cron 任务，每分钟调用一次 `process-aigc-queue`：

```sql
SELECT cron.schedule(
  'process-aigc-queue-every-minute',
  '* * * * *',
  $$ SELECT net.http_post(
       url:='https://eceqokilpppnwtfzgbvq.supabase.co/functions/v1/process-aigc-queue',
       headers:='{"Content-Type":"application/json","Authorization":"Bearer <anon-key>"}'::jsonb,
       body:='{}'::jsonb
     ); $$
);
```

并把当前所有卡在 `aigc_status='pending'` 的旧申请重新塞回队列一次（`next_run_at = now()`），让定时任务下一分钟就把历史欠账消化掉。

### C. 验证

- 手动 curl `aigc-detect` 一条已知是 AI 生成的旧申请，确认命中分 ≥ 0.9、`aigc_status=fake`、`suspected_models` 里有具体模型名。
- 提交一条新申请，等 1 分钟内 `aigc_status` 自动从 `pending` → `real/suspect/fake`，无需人工点按钮。
- 确认 `数据看板` / `复核中心` 的"系统核验中"数量会随之自动下降，与"待教师复核"保持一致。

## 不在范围内

- 不动 `evaluate-application`、不动学分评估逻辑。
- 不动前端 `AigcDetectAlert` / `AigcAdmin` UI（手动按钮保留作应急用）。
- 不调整学院端 `suspect` / `fake` 阈值，仍走 `colleges.theme.aigc` 配置。
