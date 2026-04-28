-- 1) Column-level restriction for students updating their own applications
CREATE OR REPLACE FUNCTION public.applications_student_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- Only enforce for the student themselves; teachers/admins bypass
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_caller = OLD.student_id
     AND NOT public.has_role(v_caller, 'teacher'::app_role)
     AND NOT public.has_role(v_caller, 'admin'::app_role) THEN

    -- Disallow changing student_id
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'students cannot change student_id';
    END IF;

    -- Force-preserve all sensitive/server-managed fields
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_student_update_guard ON public.applications;
CREATE TRIGGER trg_applications_student_update_guard
BEFORE UPDATE ON public.applications
FOR EACH ROW
EXECUTE FUNCTION public.applications_student_update_guard();

-- 2) Lock down SECURITY DEFINER functions: revoke from PUBLIC/anon/authenticated,
--    grant only to roles that should call them. has_role stays callable by signed-in users.
REVOKE ALL ON FUNCTION public.ai_decrypt_provider_key(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_decrypt_provider_key(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.ai_encrypt_api_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_encrypt_api_key(text, text) TO service_role, authenticated;
-- ^ admins call this from the client; the function itself enforces admin check.

REVOKE ALL ON FUNCTION public.gen_certificate_no(uuid) FROM PUBLIC, anon;
-- keep authenticated EXECUTE: the function internally checks caller is the owner / teacher / admin.

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_submission_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.keywords_normalize_and_merge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
-- These are only invoked by triggers / auth hooks; no direct caller needs EXECUTE.

REVOKE ALL ON FUNCTION public.refresh_certificate_types() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_certificate_types() TO service_role;

REVOKE ALL ON FUNCTION public.dedupe_keywords() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dedupe_keywords() TO service_role;

-- has_role is intentionally callable by authenticated users (self-check); keep as-is but ensure anon cannot call.
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;