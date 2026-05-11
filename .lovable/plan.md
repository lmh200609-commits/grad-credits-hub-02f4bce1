## 你的建议非常合理

每分钟轮询确实是「兜底」方案，不是最优解。提交即触发更及时、更省资源。但两者其实**应该并存**，原因如下：

### 为什么要保留 cron 兜底
- **失败重试**：阿里云接口偶发超时/限流，失败任务的 `next_run_at` 会被推到 30s/60s/120s 后，需要有人按时唤醒它。
- **历史积压**：当前队列里就有 3 条卡住的任务，没有 cron 永远跑不掉。
- **触发器调用 HTTP 失败时的兜底**：如果提交瞬间 edge function 冷启动失败、网络抖动，cron 下一分钟会补上。

业界标准做法就是「**实时触发为主 + 低频 cron 兜底**」。

## 修复方案

### 1. 修 `process-aigc-queue` 鉴权（必须）
当前 cron 因为鉴权 403 完全没在跑，所以队列堆积。改成与 `process-eval-queue` 一致：接受任意合法 Supabase JWT。**这一步不可省**，否则失败重试和历史积压无人处理。

### 2. 新增「提交即触发」（核心改进）
在数据库触发器 `enqueue_aigc_detect` 之外，额外用 `pg_net.http_post` **异步**调用 `process-aigc-queue`，让队列在入队后毫秒级被消费，无需等下一分钟。

做法：把现有的 `enqueue_aigc_detect` 触发器函数尾部追加一次 `net.http_post(...)`（fire-and-forget，不阻塞用户提交）。`pg_net` 已经在用，无需新装扩展。

效果：学生点「提交」→ 数据库触发器入队 + 立即唤醒 worker → 几秒内出鉴别结果。

### 3. cron 频率降低（可选优化）
既然实时触发已覆盖 99% 场景，可以把 `process-aigc-queue` 的 cron 从「每 1 分钟」改为「每 5 分钟」，仅作失败重试兜底，进一步减少无意义调用。`process-eval-queue` 同理可调，但本次只动 AIGC 的，避免影响面扩大。

### 4. 立即清空当前积压
部署完手动调用一次，把 3 条 queued 任务跑掉。

## 技术细节

改动：
- `supabase/functions/process-aigc-queue/index.ts`：放宽鉴权（约 10 行）。
- 新建 migration：重写 `public.enqueue_aigc_detect()` 函数，在 `INSERT INTO aigc_detect_queue ...` 之后追加一段 `PERFORM net.http_post(...)` 异步唤醒 worker；同步把 `process-aigc-queue` cron 改为 `*/5 * * * *`（用 insert 工具执行 `cron.unschedule` + `cron.schedule`，因为含密钥不进迁移）。
- 不动前端、不动其他 edge function。

## 你需要确认的

1. 是否同意「实时触发 + 5 分钟兜底 cron」这个组合？还是你希望**完全去掉 cron**？（不建议，会丢失重试能力）
2. 是否同时给 `process-eval-queue` 也加上「提交即触发」？（当前 AI 评估走的也是 cron，存在同样的延迟问题）
