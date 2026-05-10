## 现状结论

这两条提交不是前端显示问题，也不是没有进入队列：

- `applications` 中两条记录仍是 `pending_ai`。
- `aigc_status` 已经是 `real`，说明 AI 生图鉴别已经完成。
- `ai_eval_queue` 中两条记录已经入队，状态为 `queued`。
- 数据库定时任务 `process-eval-queue-every-minute` 每分钟都在执行。
- 但 `net._http_response` 显示每次调用 `process-eval-queue` 都返回 `403 Forbidden`，所以队列没有被消费，两条记录就一直停在“系统核验中”。

## 修复计划

1. 修复 `process-eval-queue` 的定时任务鉴权
   - 当前 cron 通过 `current_setting('app.settings.service_role_key', true)` 拼接 Authorization。
   - 这个配置值为空或不可用，导致函数收到的 Authorization 不包含真正的 service role key。
   - 改成使用数据库 Vault 中的 Supabase service role secret，或采用项目已有可用的安全调用方式，确保 cron 能合法调用 `process-eval-queue`。

2. 保持队列安全
   - 不把 service role key 暴露到前端。
   - 不降低 `process-eval-queue` 的鉴权要求。
   - 只允许服务端定时任务或 service role 调用队列处理函数。

3. 让已卡住的两条继续处理
   - 修复 cron 后，现有 `ai_eval_queue` 中的两条 `queued` 记录会在下一次定时任务自动被领取。
   - 如有必要，可手动触发一次 `process-eval-queue` 验证它们能从 `pending_ai` 变为 `auto_approved` / `pending_review` / `rejected_by_ai`。

4. 增加可排查性
   - 在队列 worker 日志中输出本次 claimed 数量和每条处理结果。
   - 以后如果再次卡住，可以直接从函数日志判断是“未取到任务”“AI评估失败”还是“鉴权失败”。

## 需要改动

- 新增/调整一条数据库 migration：修复 `process-eval-queue-every-minute` 的 cron 调用鉴权。
- 小幅编辑 `supabase/functions/process-eval-queue/index.ts`：补充关键日志，不改变业务判定逻辑。

## 验证方式

- 查看 `net._http_response` 不再返回 `403 Forbidden`。
- 查看 `process-eval-queue` 日志出现 claimed 记录。
- 查询这两条申请不再停留在 `pending_ai`，队列状态变为 `done` 或失败信息明确写入。