DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'process-eval-queue-every-minute';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'process-eval-queue-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://eceqokilpppnwtfzgbvq.supabase.co/functions/v1/process-eval-queue',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZXFva2lscHBwbnd0ZnpnYnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODEyNDMsImV4cCI6MjA5MjI1NzI0M30.vnGJpYi02dCt3urwV-Ee2fbT6yct7TwnVfgfQ9by5-g',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZXFva2lscHBwbnd0ZnpnYnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODEyNDMsImV4cCI6MjA5MjI1NzI0M30.vnGJpYi02dCt3urwV-Ee2fbT6yct7TwnVfgfQ9by5-g'
    ),
    body := jsonb_build_object('batch',5,'concurrency',5),
    timeout_milliseconds := 55000
  );
  $$
);

-- 让卡住的两条立刻被下一次 cron 领取
UPDATE public.ai_eval_queue
   SET status = 'queued', next_run_at = now(), locked_at = NULL, last_error = NULL
 WHERE status IN ('queued','failed','processing')
   AND application_id IN (
     SELECT id FROM public.applications WHERE status = 'pending_ai'
   );