-- 1) 注册 AIGC 队列每分钟自动跑（仿 process-eval-queue）
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'process-aigc-queue-every-minute';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'process-aigc-queue-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://eceqokilpppnwtfzgbvq.supabase.co/functions/v1/process-aigc-queue',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZXFva2lscHBwbnd0ZnpnYnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODEyNDMsImV4cCI6MjA5MjI1NzI0M30.vnGJpYi02dCt3urwV-Ee2fbT6yct7TwnVfgfQ9by5-g","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZXFva2lscHBwbnd0ZnpnYnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODEyNDMsImV4cCI6MjA5MjI1NzI0M30.vnGJpYi02dCt3urwV-Ee2fbT6yct7TwnVfgfQ9by5-g"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- 2) 把所有历史卡在 pending 且没排队的旧申请重新塞回队列，立刻被下一分钟 cron 领取
INSERT INTO public.aigc_detect_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
SELECT a.id, 'queued', now(), 0, NULL, NULL
FROM public.applications a
WHERE a.aigc_status = 'pending'
  AND a.file_path IS NOT NULL
ON CONFLICT (application_id) DO UPDATE
  SET status = 'queued',
      next_run_at = now(),
      attempts = 0,
      last_error = NULL,
      locked_at = NULL,
      updated_at = now();

-- 3) 把因为旧解析 bug 被错判成 real / suspect 但其实可能是 AI 图的旧记录，重置以便重跑
-- 仅重置 aigc 字段，不改 status；下一轮 detect 会按新解析逻辑重新判定
UPDATE public.applications
   SET aigc_status = 'pending',
       aigc_score = NULL,
       aigc_detail = NULL,
       aigc_checked_at = NULL
 WHERE aigc_status IN ('real','suspect')
   AND file_path IS NOT NULL
   AND aigc_provider LIKE 'aliyun:%';

-- 上面 UPDATE 会触发 enqueue_aigc_detect 自动入队
