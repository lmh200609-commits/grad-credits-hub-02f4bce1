-- Add dedupe columns
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS file_hash text,
  ADD COLUMN IF NOT EXISTS keywords_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_applications_file_hash
  ON public.applications (file_hash) WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_student_kwfp
  ON public.applications (student_id, keywords_fingerprint)
  WHERE keywords_fingerprint IS NOT NULL;

-- Backfill keywords_fingerprint for existing rows
UPDATE public.applications a
SET keywords_fingerprint = sub.fp
FROM (
  SELECT id, string_agg(k, '|' ORDER BY k) AS fp
  FROM (
    SELECT a2.id,
           DISTINCT_K.k
    FROM public.applications a2
    CROSS JOIN LATERAL (
      SELECT DISTINCT lower(btrim(regexp_replace(x, '\s+', ' ', 'g'))) AS k
      FROM unnest(coalesce(a2.selected_keywords,'{}'::text[]) || coalesce(a2.custom_keywords,'{}'::text[])) AS x
      WHERE coalesce(btrim(x),'') <> ''
    ) DISTINCT_K
  ) t
  GROUP BY id
) sub
WHERE a.id = sub.id AND a.keywords_fingerprint IS NULL;

-- BEFORE INSERT dedupe trigger
CREATE OR REPLACE FUNCTION public.applications_dedupe_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text := current_user;
BEGIN
  -- Only enforce for actual student-submitted inserts; service roles, admins, teachers, super admins bypass.
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_role IN ('postgres','service_role','supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF public.has_role(v_caller, 'teacher'::app_role)
     OR public.has_role(v_caller, 'admin'::app_role)
     OR public.is_super_admin(v_caller) THEN
    RETURN NEW;
  END IF;

  IF NEW.file_hash IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.applications
      WHERE file_hash = NEW.file_hash AND id <> NEW.id
    ) THEN
      RAISE EXCEPTION '该图片已被提交过，请勿重复使用' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.keywords_fingerprint IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.applications
      WHERE student_id = NEW.student_id
        AND keywords_fingerprint = NEW.keywords_fingerprint
        AND status IN ('approved','auto_approved')
        AND id <> NEW.id
    ) THEN
      RAISE EXCEPTION '该关键词组合你已审核通过，无需重复提交' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_dedupe_guard ON public.applications;
CREATE TRIGGER trg_applications_dedupe_guard
  BEFORE INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.applications_dedupe_guard();

-- Patch student update guard to also preserve dedupe fingerprints
CREATE OR REPLACE FUNCTION public.applications_student_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_caller = OLD.student_id
     AND NOT public.has_role(v_caller, 'teacher'::app_role)
     AND NOT public.has_role(v_caller, 'admin'::app_role) THEN

    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'students cannot change student_id';
    END IF;

    NEW.status := OLD.status;
    NEW.ai_matched_rule_id := OLD.ai_matched_rule_id;
    NEW.ai_suggested_credit := OLD.ai_suggested_credit;
    NEW.ai_confidence := OLD.ai_confidence;
    NEW.ai_reasoning := OLD.ai_reasoning;
    NEW.ai_reasoning_short := OLD.ai_reasoning_short;
    NEW.ai_check_consistency := OLD.ai_check_consistency;
    NEW.ai_check_completeness := OLD.ai_check_completeness;
    NEW.ai_check_logic := OLD.ai_check_logic;
    NEW.ai_check_identity_match := OLD.ai_check_identity_match;
    NEW.ai_check_name_match := OLD.ai_check_name_match;
    NEW.ai_check_authenticity := OLD.ai_check_authenticity;
    NEW.ai_check_relevance := OLD.ai_check_relevance;
    NEW.ai_blank_fields := OLD.ai_blank_fields;
    NEW.ai_logic_issue := OLD.ai_logic_issue;
    NEW.ai_identity_mismatch := OLD.ai_identity_mismatch;
    NEW.ai_detected_school := OLD.ai_detected_school;
    NEW.ai_detected_student_no := OLD.ai_detected_student_no;
    NEW.ai_detected_identity := OLD.ai_detected_identity;
    NEW.ai_detected_level := OLD.ai_detected_level;
    NEW.ai_detected_achievement := OLD.ai_detected_achievement;
    NEW.ai_detected_project := OLD.ai_detected_project;
    NEW.ai_override_note := OLD.ai_override_note;
    NEW.ai_previous_snapshot := OLD.ai_previous_snapshot;
    NEW.ai_last_attempt_at := OLD.ai_last_attempt_at;
    NEW.ai_last_error := OLD.ai_last_error;

    NEW.final_credit := OLD.final_credit;
    NEW.final_review_note := OLD.final_review_note;
    NEW.final_reviewer_id := OLD.final_reviewer_id;
    NEW.review_source := OLD.review_source;
    NEW.reviewed_at := OLD.reviewed_at;

    NEW.certificate_no := OLD.certificate_no;
    NEW.certificate_issued_at := OLD.certificate_issued_at;

    NEW.face_match_status := OLD.face_match_status;
    NEW.face_match_score := OLD.face_match_score;
    NEW.face_match_note := OLD.face_match_note;
    NEW.face_checked_at := OLD.face_checked_at;

    NEW.submitted_at := OLD.submitted_at;
    NEW.created_at := OLD.created_at;

    -- Preserve dedupe fingerprints to prevent students bypassing checks
    NEW.file_hash := OLD.file_hash;
    NEW.keywords_fingerprint := OLD.keywords_fingerprint;
  END IF;

  RETURN NEW;
END;
$function$;