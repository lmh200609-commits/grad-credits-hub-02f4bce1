
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ai_intended_auto_approve boolean NOT NULL DEFAULT false;

-- Drop old wiring
DROP TRIGGER IF EXISTS trg_enqueue_aigc_detect ON public.applications;
DROP TRIGGER IF EXISTS enqueue_aigc_detect ON public.applications;
DROP TRIGGER IF EXISTS trg_enqueue_ai_eval_after_aigc ON public.applications;
DROP TRIGGER IF EXISTS enqueue_ai_eval_after_aigc ON public.applications;
DROP TRIGGER IF EXISTS trg_enqueue_ai_eval ON public.applications;
DROP TRIGGER IF EXISTS enqueue_ai_eval ON public.applications;

DROP FUNCTION IF EXISTS public.enqueue_ai_eval_after_aigc() CASCADE;

-- AI eval enqueue: fire on insert when status='pending_ai', no AIGC dependency
CREATE OR REPLACE FUNCTION public.enqueue_ai_eval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'pending_ai' THEN
    INSERT INTO public.ai_eval_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
    VALUES (NEW.id, 'queued', now(), 0, NULL, NULL)
    ON CONFLICT (application_id) DO UPDATE
      SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_enqueue_ai_eval
AFTER INSERT ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_eval();

-- New: enqueue AIGC after AI evaluation finishes (and did not outright reject)
CREATE OR REPLACE FUNCTION public.enqueue_aigc_detect_after_eval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url  text := 'https://eceqokilpppnwtfzgbvq.supabase.co/functions/v1/process-aigc-queue';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZXFva2lscHBwbnd0ZnpnYnZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODEyNDMsImV4cCI6MjA5MjI1NzI0M30.vnGJpYi02dCt3urwV-Ee2fbT6yct7TwnVfgfQ9by5-g';
  v_eval_just_finished boolean;
BEGIN
  -- Detect "AI evaluation just wrote a result"
  v_eval_just_finished :=
       (NEW.ai_last_attempt_at IS NOT NULL AND OLD.ai_last_attempt_at IS DISTINCT FROM NEW.ai_last_attempt_at)
    OR (OLD.status = 'pending_ai' AND NEW.status <> 'pending_ai');

  IF v_eval_just_finished
     AND NEW.status <> 'rejected_by_ai'
     AND NEW.aigc_status = 'pending'
     AND NEW.file_path IS NOT NULL
     AND NEW.file_path ~* '\.(png|jpe?g|webp|gif|bmp)$' THEN

    INSERT INTO public.aigc_detect_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
    VALUES (NEW.id, 'queued', now(), 0, NULL, NULL)
    ON CONFLICT (application_id) DO UPDATE
      SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();

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
      NULL;
    END;
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_enqueue_aigc_detect_after_eval
AFTER UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.enqueue_aigc_detect_after_eval();

-- Drop the legacy on-insert AIGC enqueue function (no longer referenced)
DROP FUNCTION IF EXISTS public.enqueue_aigc_detect() CASCADE;
