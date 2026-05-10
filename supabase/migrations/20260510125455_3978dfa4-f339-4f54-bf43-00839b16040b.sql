CREATE OR REPLACE FUNCTION public.enqueue_ai_eval_after_aigc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'pending_ai'
     AND NEW.aigc_status IN ('real','suspect','skipped','error')
     AND (OLD.aigc_status IS DISTINCT FROM NEW.aigc_status) THEN
    INSERT INTO public.ai_eval_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
    VALUES (NEW.id, 'queued', now(), 0, NULL, NULL)
    ON CONFLICT (application_id) DO UPDATE
      SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enqueue_ai_eval_after_aigc ON public.applications;
CREATE TRIGGER trg_enqueue_ai_eval_after_aigc
  AFTER UPDATE OF aigc_status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_eval_after_aigc();

-- 回填：将已完成 AIGC 鉴别但未入评估队列的旧申请补入队
INSERT INTO public.ai_eval_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
SELECT a.id, 'queued', now(), 0, NULL, NULL
  FROM public.applications a
 WHERE a.status = 'pending_ai'
   AND a.aigc_status IN ('real','suspect','skipped','error')
   AND NOT EXISTS (SELECT 1 FROM public.ai_eval_queue q WHERE q.application_id = a.id)
ON CONFLICT (application_id) DO UPDATE
  SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();