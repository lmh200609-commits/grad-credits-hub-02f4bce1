
-- 1. 队列表
CREATE TABLE IF NOT EXISTS public.ai_eval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued',         -- queued | processing | done | failed
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_eval_queue_due
  ON public.ai_eval_queue (next_run_at)
  WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS idx_ai_eval_queue_status
  ON public.ai_eval_queue (status);

ALTER TABLE public.ai_eval_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_eval_queue super_admin all"
  ON public.ai_eval_queue FOR ALL TO authenticated
  USING (is_super_admin((SELECT auth.uid()))) WITH CHECK (is_super_admin((SELECT auth.uid())));

CREATE TRIGGER trg_ai_eval_queue_updated_at
  BEFORE UPDATE ON public.ai_eval_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. 死信
CREATE TABLE IF NOT EXISTS public.ai_eval_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  attempts int NOT NULL,
  last_error text,
  failed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_eval_failures_app ON public.ai_eval_failures (application_id);

ALTER TABLE public.ai_eval_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_eval_failures super_admin select"
  ON public.ai_eval_failures FOR SELECT TO authenticated
  USING (is_super_admin((SELECT auth.uid())));

-- 3. 入队 trigger:申请 INSERT 或学生编辑后状态回到 pending_ai 时入队
CREATE OR REPLACE FUNCTION public.enqueue_ai_eval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending_ai' THEN
    INSERT INTO public.ai_eval_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
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
END $$;

DROP TRIGGER IF EXISTS trg_enqueue_ai_eval_ins ON public.applications;
CREATE TRIGGER trg_enqueue_ai_eval_ins
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_eval();

DROP TRIGGER IF EXISTS trg_enqueue_ai_eval_upd ON public.applications;
CREATE TRIGGER trg_enqueue_ai_eval_upd
  AFTER UPDATE OF status ON public.applications
  FOR EACH ROW
  WHEN (NEW.status = 'pending_ai' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.enqueue_ai_eval();

-- 4. worker 领任务 - SKIP LOCKED 安全并发
CREATE OR REPLACE FUNCTION public.claim_ai_eval_jobs(_limit int DEFAULT 5)
RETURNS TABLE(id uuid, application_id uuid, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text := current_user;
BEGIN
  IF _role NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.ai_eval_queue q
    WHERE q.status IN ('queued','failed')
      AND q.next_run_at <= now()
      AND q.attempts < q.max_attempts
    ORDER BY q.next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  )
  UPDATE public.ai_eval_queue q
     SET status = 'processing',
         locked_at = now(),
         attempts = q.attempts + 1,
         updated_at = now()
   FROM picked
   WHERE q.id = picked.id
   RETURNING q.id, q.application_id, q.attempts;
END $$;

-- 5. 标记完成
CREATE OR REPLACE FUNCTION public.mark_ai_eval_done(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text := current_user;
BEGIN
  IF _role NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.ai_eval_queue
     SET status='done', last_error=NULL, locked_at=NULL, updated_at=now()
   WHERE id = _id;
END $$;

-- 6. 标记失败:未达上限退避重试,达上限写入死信
CREATE OR REPLACE FUNCTION public.mark_ai_eval_failed(_id uuid, _error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text := current_user;
  _q public.ai_eval_queue;
  _backoff interval;
BEGIN
  IF _role NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO _q FROM public.ai_eval_queue WHERE id = _id;
  IF _q IS NULL THEN RETURN; END IF;

  IF _q.attempts >= _q.max_attempts THEN
    INSERT INTO public.ai_eval_failures(application_id, attempts, last_error)
    VALUES (_q.application_id, _q.attempts, _error);
    UPDATE public.ai_eval_queue
       SET status='failed', last_error=_error, locked_at=NULL, updated_at=now()
     WHERE id=_id;
  ELSE
    -- 指数退避: 30s * 2^(attempts-1)
    _backoff := make_interval(secs => 30 * pow(2, GREATEST(_q.attempts - 1, 0))::int);
    UPDATE public.ai_eval_queue
       SET status='queued',
           last_error=_error,
           locked_at=NULL,
           next_run_at = now() + _backoff,
           updated_at=now()
     WHERE id=_id;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.claim_ai_eval_jobs(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_ai_eval_done(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_ai_eval_failed(uuid, text) FROM PUBLIC, anon, authenticated;

-- 7. 把现有未处理申请补入队
INSERT INTO public.ai_eval_queue (application_id, status, next_run_at)
SELECT a.id, 'queued', now()
FROM public.applications a
WHERE a.status = 'pending_ai'
  AND NOT EXISTS (SELECT 1 FROM public.ai_eval_queue q WHERE q.application_id = a.id);
