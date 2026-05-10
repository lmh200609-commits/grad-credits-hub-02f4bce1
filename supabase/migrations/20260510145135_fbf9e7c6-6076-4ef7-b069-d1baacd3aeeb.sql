-- Ensure AIGC jobs are automatically queued when students submit image applications
CREATE OR REPLACE FUNCTION public.enqueue_aigc_detect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Queue image-backed applications whenever they enter pending AI review and AIGC is still pending.
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_aigc_detect ON public.applications;
CREATE TRIGGER trg_enqueue_aigc_detect
AFTER INSERT OR UPDATE OF status, file_path, aigc_status ON public.applications
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_aigc_detect();

-- Requeue current pending image applications so the automatic worker can process them without manual clicking.
INSERT INTO public.aigc_detect_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
SELECT a.id, 'queued', now(), 0, NULL, NULL
FROM public.applications a
WHERE a.status = 'pending_ai'
  AND a.file_path IS NOT NULL
  AND a.aigc_status = 'pending'
ON CONFLICT (application_id) DO UPDATE
  SET status = 'queued',
      next_run_at = now(),
      attempts = 0,
      last_error = NULL,
      locked_at = NULL,
      updated_at = now();