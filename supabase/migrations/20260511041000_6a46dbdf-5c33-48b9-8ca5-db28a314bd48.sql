CREATE OR REPLACE FUNCTION public.enqueue_aigc_detect()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url text;
  v_anon text;
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

    -- 立即异步唤醒 worker（fire-and-forget，不阻塞用户提交）
    BEGIN
      SELECT decrypted_secret INTO v_url   FROM vault.decrypted_secrets WHERE name = 'aigc_worker_url'  LIMIT 1;
      SELECT decrypted_secret INTO v_anon  FROM vault.decrypted_secrets WHERE name = 'aigc_worker_anon' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_url := NULL; v_anon := NULL;
    END;

    IF v_url IS NOT NULL AND v_anon IS NOT NULL THEN
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
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;