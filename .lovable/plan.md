## 目标

AI 评估通过（即 `nextStatus !== 'rejected_by_ai'` 且文件是图片）后，**同步立刻**触发 AIGC 检测，而不是等数据库触发器经 pg_net 异步推送 `process-aigc-queue`（存在调度延迟）。

## 现状

1. `evaluate-application` 写入 AI 评估结果后直接返回。
2. DB 触发器 `enqueue_aigc_detect_after_eval` 监听 `ai_last_attempt_at` 变化，入队 `aigc_detect_queue` 并通过 `net.http_post` 触发 `process-aigc-queue`。
3. `pg_net` 是异步队列，可能延迟数秒甚至更久；用户感知"AIGC 拖延"。

## 改动

### `supabase/functions/evaluate-application/index.ts`

在 614 行 `update applications` **成功之后**、`return json(...)` **之前**，追加直连唤起：

```ts
const shouldTriggerAigc =
  nextStatus !== "rejected_by_ai" &&
  app.file_path &&
  /\.(png|jpe?g|webp|gif|bmp)$/i.test(app.file_path) &&
  app.aigc_status === "pending";

if (shouldTriggerAigc) {
  // 直连 aigc-detect，按 application_id 立刻执行；不阻塞响应
  const url = `${supabaseUrl}/functions/v1/aigc-detect`;
  const p = fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({ application_id }),
  }).catch((e) => console.error("[evaluate-application] inline aigc-detect failed:", e));
  // 让后台请求继续运行，但不让 evaluate 响应等它
  // @ts-ignore Deno EdgeRuntime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(p);
  }
}
```

`supabaseUrl` / `serviceKey` 在文件顶部已经从 env 读取（与现有 admin client 共用），如未读取则补一行 `Deno.env.get` 即可。

### 数据库触发器

保留 `enqueue_aigc_detect_after_eval` 作为兜底（队列入队 + pg_net 调度）。即使 inline fetch 失败，触发器仍会保证最终执行。`aigc-detect` 内部对同一 application_id 是幂等的（先看 `aigc_status`），所以重复触发安全。

### `aigc-detect` 幂等性确认

需要确认 `aigc-detect` 入口在 `aigc_status !== 'pending'` 时直接 no-op 返回，避免 inline fetch 与队列 worker 同时执行重复检测。如当前未做，需要在函数最前面加一段防重入：

```ts
const { data: row } = await admin
  .from("applications").select("aigc_status").eq("id", application_id).maybeSingle();
if (row && row.aigc_status !== "pending") {
  return json({ skipped: true, reason: "already_processed" });
}
```

## 涉及文件

- `supabase/functions/evaluate-application/index.ts`（新增 inline 唤起）
- `supabase/functions/aigc-detect/index.ts`（确认/补齐幂等保护）

## 不改动

- 触发器 SQL 保持不变（兜底）。
- 前端无需修改：`pending_review` 阶段已统一显示"复核中"，AIGC 完成后再翻盘 `auto_approved`。
