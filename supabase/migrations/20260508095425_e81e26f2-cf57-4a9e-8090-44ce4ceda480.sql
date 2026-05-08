CREATE EXTENSION IF NOT EXISTS pg_net;

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
      'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('batch',5,'concurrency',5),
    timeout_milliseconds := 55000
  );
  $$
);