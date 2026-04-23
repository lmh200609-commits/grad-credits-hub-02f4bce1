
-- ============ 1. 扩展 profiles 实名字段 ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS id_card text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS enrollment_year int,
  ADD COLUMN IF NOT EXISTS political_status text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS emergency_contact text,
  ADD COLUMN IF NOT EXISTS emergency_phone text;

-- ============ 2. certificate_types 字典 ============
CREATE TABLE IF NOT EXISTS public.certificate_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  level text,
  identity text,
  typical_credit numeric,
  source_rule_ids uuid[] NOT NULL DEFAULT '{}',
  source_case_ids uuid[] NOT NULL DEFAULT '{}',
  keywords text[] NOT NULL DEFAULT '{}',
  occurrence_count int NOT NULL DEFAULT 0,
  description text,
  active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certificate_types_name_cat_level_uniq UNIQUE (name, category, level)
);

ALTER TABLE public.certificate_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "certificate_types read all authenticated" ON public.certificate_types;
CREATE POLICY "certificate_types read all authenticated"
  ON public.certificate_types FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "certificate_types admin manage" ON public.certificate_types;
CREATE POLICY "certificate_types admin manage"
  ON public.certificate_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_certificate_types_updated ON public.certificate_types;
CREATE TRIGGER trg_certificate_types_updated
  BEFORE UPDATE ON public.certificate_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 3. submission_records 流水 ============
DO $$ BEGIN
  CREATE TYPE public.submission_event_type AS ENUM
    ('submitted','ai_reviewed','manual_reviewed','resubmitted','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.submission_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  student_id uuid NOT NULL,
  student_no text,
  student_name text,
  event_type public.submission_event_type NOT NULL,
  actor_id uuid,
  actor_role text,
  actor_name text,
  ai_decision text,
  ai_confidence numeric,
  ai_suggested_credit numeric,
  ai_matched_rule_id uuid,
  ai_reasoning text,
  review_decision text,
  review_credit numeric,
  review_note text,
  matched_rule_id uuid,
  file_path text,
  description_snapshot text,
  keywords_snapshot text[],
  status_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_rec_student ON public.submission_records(student_id);
CREATE INDEX IF NOT EXISTS idx_sub_rec_student_no ON public.submission_records(student_no);
CREATE INDEX IF NOT EXISTS idx_sub_rec_app ON public.submission_records(application_id);
CREATE INDEX IF NOT EXISTS idx_sub_rec_event ON public.submission_records(event_type);

ALTER TABLE public.submission_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_rec student read own" ON public.submission_records;
CREATE POLICY "sub_rec student read own"
  ON public.submission_records FOR SELECT TO authenticated
  USING (student_id = auth.uid()
         OR public.has_role(auth.uid(),'teacher'::app_role)
         OR public.has_role(auth.uid(),'admin'::app_role));

-- ============ 4. 触发器：applications 变更写流水 ============
CREATE OR REPLACE FUNCTION public.log_submission_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_no text;
  v_student_name text;
  v_event public.submission_event_type;
BEGIN
  SELECT student_no, full_name INTO v_student_no, v_student_name
  FROM public.profiles WHERE user_id = NEW.student_id LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    v_event := 'submitted';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status::text IN ('pending_review','rejected_by_ai','auto_approved') THEN
      v_event := 'ai_reviewed';
    ELSIF NEW.status::text IN ('approved','rejected') THEN
      v_event := 'manual_reviewed';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.submission_records(
    application_id, student_id, student_no, student_name,
    event_type, actor_id,
    ai_decision, ai_confidence, ai_suggested_credit, ai_matched_rule_id, ai_reasoning,
    review_decision, review_credit, review_note,
    file_path, description_snapshot, keywords_snapshot, status_snapshot
  ) VALUES (
    NEW.id, NEW.student_id, v_student_no, v_student_name,
    v_event, COALESCE(NEW.final_reviewer_id, NEW.student_id),
    CASE WHEN v_event='ai_reviewed' THEN NEW.status::text END,
    NEW.ai_confidence, NEW.ai_suggested_credit, NEW.ai_matched_rule_id, NEW.ai_reasoning,
    CASE WHEN v_event='manual_reviewed' THEN NEW.status::text END,
    CASE WHEN v_event='manual_reviewed' THEN NEW.final_credit END,
    CASE WHEN v_event='manual_reviewed' THEN NEW.final_review_note END,
    NEW.file_path, NEW.description,
    NEW.selected_keywords || NEW.custom_keywords,
    NEW.status::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_submission_log_ins ON public.applications;
CREATE TRIGGER trg_app_submission_log_ins
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.log_submission_event();

DROP TRIGGER IF EXISTS trg_app_submission_log_upd ON public.applications;
CREATE TRIGGER trg_app_submission_log_upd
  AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.log_submission_event();

-- ============ 5. submission_summary 视图 ============
CREATE OR REPLACE VIEW public.submission_summary
WITH (security_invoker = true) AS
SELECT
  a.id AS application_id,
  a.student_id,
  p.student_no,
  p.full_name AS student_name,
  p.department,
  p.class_name,
  a.status::text AS status,
  a.description,
  a.selected_keywords,
  a.custom_keywords,
  a.file_path,
  a.submitted_at,
  a.ai_confidence,
  a.ai_suggested_credit,
  a.ai_matched_rule_id,
  a.ai_reasoning,
  a.final_credit,
  a.final_reviewer_id,
  rp.full_name AS reviewer_name,
  a.final_review_note,
  a.reviewed_at,
  a.updated_at
FROM public.applications a
LEFT JOIN public.profiles p ON p.user_id = a.student_id
LEFT JOIN public.profiles rp ON rp.user_id = a.final_reviewer_id;

GRANT SELECT ON public.submission_summary TO authenticated;

-- ============ 6. refresh_certificate_types（修正版）============
CREATE OR REPLACE FUNCTION public.refresh_certificate_types()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- 删除自动生成的（带 source 的），保留管理员手动新增（source 全空）
  DELETE FROM public.certificate_types
  WHERE coalesce(array_length(source_rule_ids,1),0) > 0
     OR coalesce(array_length(source_case_ids,1),0) > 0;

  WITH r AS (
    SELECT
      COALESCE(NULLIF(trim(name),''), '未命名') AS name,
      NULLIF(trim(category),'') AS category,
      NULLIF(trim(level),'')    AS level,
      NULLIF(trim(identity),'') AS identity,
      avg(credit)::numeric AS typical_credit,
      array_agg(DISTINCT id) FILTER (WHERE id IS NOT NULL) AS rule_ids,
      array_agg(DISTINCT k) FILTER (WHERE k IS NOT NULL) AS kws
    FROM public.rules
    LEFT JOIN LATERAL unnest(coalesce(keywords,'{}'::text[])) AS k ON true
    WHERE active = true
    GROUP BY 1,2,3,4
  ),
  rc AS (
    SELECT r.*,
      (SELECT array_agg(DISTINCT cs.id)
         FROM public.cases cs
         WHERE cs.rule_id = ANY(r.rule_ids)) AS case_ids,
      (SELECT count(*)::int
         FROM public.cases cs
         WHERE cs.rule_id = ANY(r.rule_ids)) AS occ
    FROM r
  )
  INSERT INTO public.certificate_types(
    name, category, level, identity, typical_credit,
    source_rule_ids, source_case_ids, keywords, occurrence_count, last_synced_at
  )
  SELECT
    rc.name, rc.category, rc.level, rc.identity, rc.typical_credit,
    coalesce(rc.rule_ids,'{}'),
    coalesce(rc.case_ids,'{}'),
    coalesce(rc.kws,'{}'),
    coalesce(rc.occ,0),
    now()
  FROM rc
  ON CONFLICT (name, category, level) DO UPDATE SET
    typical_credit = EXCLUDED.typical_credit,
    source_rule_ids = EXCLUDED.source_rule_ids,
    source_case_ids = EXCLUDED.source_case_ids,
    keywords = EXCLUDED.keywords,
    occurrence_count = EXCLUDED.occurrence_count,
    last_synced_at = now(),
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT public.refresh_certificate_types();

-- ============ 7. 历史申请回填 submitted 流水 ============
INSERT INTO public.submission_records(
  application_id, student_id, student_no, student_name,
  event_type, actor_id, file_path, description_snapshot,
  keywords_snapshot, status_snapshot, created_at
)
SELECT
  a.id, a.student_id, p.student_no, p.full_name,
  'submitted', a.student_id, a.file_path, a.description,
  a.selected_keywords || a.custom_keywords, a.status::text, a.submitted_at
FROM public.applications a
LEFT JOIN public.profiles p ON p.user_id = a.student_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.submission_records r
  WHERE r.application_id = a.id AND r.event_type = 'submitted'
);
