-- 1) 重写触发器：入队后用 pg_net 立即异步唤醒 worker（fire-and-forget）
CREATE OR REPLACE FUNCTION public.enqueue_aigc_detect()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url  text := 'https://eceqokilpppnwtfzgbvq.supabase.co/functions/v1/process-aigc-queue';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZXFva2lscHBwbnd0ZnpnYnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODEyNDMsImV4cCI6MjA5MjI1NzI0M30.vnGJpYi02dCt3urwV-Ee2fbT6yct7TwnVfgfQ9by5-g';
BEGIN
  IF NEW.status = 'pending_ai'
     AND NEW.file_path IS NOT NULL
     AND NEW.aigc_status = 'pending' THEN
    INSERT INTO public.aigc_detect_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
    VALUES (NEW.id, 'queued', now(), 0, NULL, NULL)
    ON CONFLICT (application_id) DO UPDATE
      SET status = 'queued',
          next_run_at = now(),
          attempts = 0,
          last_error = NULL,
          locked_at = NULL,
          updated_at = now();

    BEGIN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey', v_anon,
          'Authorization', 'Bearer ' || v_anon
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      );
    EXCEPTION WHEN OTHERS THEN
      -- 唤醒失败不影响入队；cron 兜底会处理
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) cron 降频为每 5 分钟一次（仅作失败重试兜底）
DO $$
DECLARE v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job
   WHERE command ILIKE '%process-aigc-queue%' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '*/5 * * * *');
  END IF;
END $$;

-- 3) 让积压任务立刻可被消费（attempts 归零、next_run_at = now()）
UPDATE public.aigc_detect_queue
   SET status='queued', next_run_at=now(), attempts=0, locked_at=NULL, last_error=NULL, updated_at=now()
 WHERE status IN ('queued','failed','processing');