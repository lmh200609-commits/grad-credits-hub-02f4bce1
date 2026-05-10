-- ============ AIGC 鉴别节点 ============
-- 1) applications 新增 5 列
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS aigc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS aigc_score numeric(4,3),
  ADD COLUMN IF NOT EXISTS aigc_detail jsonb,
  ADD COLUMN IF NOT EXISTS aigc_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS aigc_provider text;

-- 2) 队列表（结构对齐 ai_eval_queue）
CREATE TABLE IF NOT EXISTS public.aigc_detect_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aigc_detect_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "aigc_detect_queue super_admin all" ON public.aigc_detect_queue;
CREATE POLICY "aigc_detect_queue super_admin all" ON public.aigc_detect_queue
  FOR ALL TO authenticated
  USING (is_super_admin((SELECT auth.uid())))
  WITH CHECK (is_super_admin((SELECT auth.uid())));

CREATE TABLE IF NOT EXISTS public.aigc_detect_failures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id uuid NOT NULL,
  attempts integer NOT NULL,
  last_error text,
  failed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aigc_detect_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "aigc_detect_failures super_admin select" ON public.aigc_detect_failures;
CREATE POLICY "aigc_detect_failures super_admin select" ON public.aigc_detect_failures
  FOR SELECT TO authenticated
  USING (is_super_admin((SELECT auth.uid())));

-- 3) 入队触发器
CREATE OR REPLACE FUNCTION public.enqueue_aigc_detect()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 仅有图片附件且首次进入 pending_ai 时入队
  IF NEW.status = 'pending_ai' AND NEW.file_path IS NOT NULL AND NEW.aigc_status = 'pending' THEN
    INSERT INTO public.aigc_detect_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
    VALUES (NEW.id, 'queued', now(), 0, NULL, NULL)
    ON CONFLICT (application_id) DO UPDATE
      SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enqueue_aigc_detect ON public.applications;
CREATE TRIGGER trg_enqueue_aigc_detect
AFTER INSERT ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.enqueue_aigc_detect();

-- 4) 改造 enqueue_ai_eval：仅当 AIGC 不是 fake/pending 时进队
CREATE OR REPLACE FUNCTION public.enqueue_ai_eval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending_ai'
     AND NEW.aigc_status IN ('real','suspect','skipped','error') THEN
    INSERT INTO public.ai_eval_queue (application_id, status, next_run_at, attempts, last_error, locked_at)
    VALUES (NEW.id, 'queued', now(), 0, NULL, NULL)
    ON CONFLICT (application_id) DO UPDATE
      SET status='queued', next_run_at=now(), attempts=0, last_error=NULL, locked_at=NULL, updated_at=now();
  END IF;
  RETURN NEW;
END $$;

-- 5) RPC: claim / mark done / mark failed
CREATE OR REPLACE FUNCTION public.claim_aigc_jobs(_limit integer DEFAULT 5)
RETURNS TABLE(id uuid, application_id uuid, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text := current_user;
BEGIN
  IF _role NOT IN ('postgres','service_role','supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM public.aigc_detect_queue q
    WHERE q.status IN ('queued','failed')
      AND q.next_run_at <= now()
      AND q.attempts < q.max_attempts
    ORDER BY q.next_run_at
    FOR UPDATE SKIP LOCKED LIMIT _limit
  )
  UPDATE public.aigc_detect_queue q
     SET status='processing', locked_at=now(), attempts=q.attempts+1, updated_at=now()
   FROM picked WHERE q.id = picked.id
   RETURNING q.id, q.application_id, q.attempts;
END $$;

CREATE OR REPLACE FUNCTION public.mark_aigc_done(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text := current_user;
BEGIN
  IF _role NOT IN ('postgres','service_role','supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.aigc_detect_queue
     SET status='done', last_error=NULL, locked_at=NULL, updated_at=now()
   WHERE id=_id;
END $$;

CREATE OR REPLACE FUNCTION public.mark_aigc_failed(_id uuid, _error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text := current_user; _q public.aigc_detect_queue; _backoff interval;
BEGIN
  IF _role NOT IN ('postgres','service_role','supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO _q FROM public.aigc_detect_queue WHERE id=_id;
  IF _q IS NULL THEN RETURN; END IF;
  IF _q.attempts >= _q.max_attempts THEN
    INSERT INTO public.aigc_detect_failures(application_id, attempts, last_error)
    VALUES (_q.application_id, _q.attempts, _error);
    UPDATE public.aigc_detect_queue
       SET status='failed', last_error=_error, locked_at=NULL, updated_at=now()
     WHERE id=_id;
  ELSE
    _backoff := make_interval(secs => 30 * pow(2, GREATEST(_q.attempts - 1, 0))::int);
    UPDATE public.aigc_detect_queue
       SET status='queued', last_error=_error, locked_at=NULL,
           next_run_at = now() + _backoff, updated_at=now()
     WHERE id=_id;
  END IF;
END $$;

-- 6) 扩展学生写保护触发器：把 aigc_* 字段加入禁止写白名单
CREATE OR REPLACE FUNCTION public.applications_block_student_protected_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_student boolean;
BEGIN
  IF auth.uid() IS NULL OR NEW.student_id <> auth.uid() THEN RETURN NEW; END IF;
  SELECT public.has_role(auth.uid(), 'student'::app_role) INTO is_student;
  IF NOT is_student THEN RETURN NEW; END IF;

  NEW.ai_reasoning              := OLD.ai_reasoning;
  NEW.ai_reasoning_short        := OLD.ai_reasoning_short;
  NEW.ai_confidence             := OLD.ai_confidence;
  NEW.ai_suggested_credit       := OLD.ai_suggested_credit;
  NEW.ai_matched_rule_id        := OLD.ai_matched_rule_id;
  NEW.ai_check_consistency      := OLD.ai_check_consistency;
  NEW.ai_check_relevance        := OLD.ai_check_relevance;
  NEW.ai_check_authenticity     := OLD.ai_check_authenticity;
  NEW.ai_check_name_match       := OLD.ai_check_name_match;
  NEW.ai_check_completeness     := OLD.ai_check_completeness;
  NEW.ai_check_logic            := OLD.ai_check_logic;
  NEW.ai_check_identity_match   := OLD.ai_check_identity_match;
  NEW.ai_detected_project       := OLD.ai_detected_project;
  NEW.ai_detected_achievement   := OLD.ai_detected_achievement;
  NEW.ai_detected_school        := OLD.ai_detected_school;
  NEW.ai_detected_student_no    := OLD.ai_detected_student_no;
  NEW.ai_detected_identity      := OLD.ai_detected_identity;
  NEW.ai_detected_level         := OLD.ai_detected_level;
  NEW.ai_blank_fields           := OLD.ai_blank_fields;
  NEW.ai_logic_issue            := OLD.ai_logic_issue;
  NEW.ai_identity_mismatch      := OLD.ai_identity_mismatch;
  NEW.ai_override_note          := OLD.ai_override_note;
  NEW.ai_previous_snapshot      := OLD.ai_previous_snapshot;
  NEW.ai_last_attempt_at        := OLD.ai_last_attempt_at;
  NEW.ai_last_error             := OLD.ai_last_error;
  NEW.face_match_score          := OLD.face_match_score;
  NEW.face_match_status         := OLD.face_match_status;
  NEW.face_match_note           := OLD.face_match_note;
  NEW.face_checked_at           := OLD.face_checked_at;
  NEW.aigc_status               := OLD.aigc_status;
  NEW.aigc_score                := OLD.aigc_score;
  NEW.aigc_detail               := OLD.aigc_detail;
  NEW.aigc_checked_at           := OLD.aigc_checked_at;
  NEW.aigc_provider             := OLD.aigc_provider;
  NEW.final_credit              := OLD.final_credit;
  NEW.final_reviewer_id         := OLD.final_reviewer_id;
  NEW.review_source             := OLD.review_source;
  NEW.certificate_no            := OLD.certificate_no;
  NEW.certificate_issued_at     := OLD.certificate_issued_at;
  NEW.college_id                := OLD.college_id;
  NEW.student_id                := OLD.student_id;
  RETURN NEW;
END $$;

-- 7) 把已存在的 pending_ai 申请补入 AIGC 队列（方便老数据走一遍）
INSERT INTO public.aigc_detect_queue (application_id, status, next_run_at)
SELECT id, 'queued', now()
FROM public.applications
WHERE status = 'pending_ai' AND file_path IS NOT NULL AND aigc_status = 'pending'
ON CONFLICT (application_id) DO NOTHING;