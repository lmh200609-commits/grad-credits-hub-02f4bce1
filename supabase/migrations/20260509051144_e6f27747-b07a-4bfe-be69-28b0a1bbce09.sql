
-- ============================================================
-- 1. user_roles UPDATE policy: prevent self-edit & restrict roles in USING
-- ============================================================
DROP POLICY IF EXISTS "user_roles college admin update" ON public.user_roles;
CREATE POLICY "user_roles college admin update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND user_id <> (SELECT auth.uid())
    AND role = ANY (ARRAY['teacher'::app_role, 'student'::app_role])
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND user_id <> (SELECT auth.uid())
    AND role = ANY (ARRAY['teacher'::app_role, 'student'::app_role])
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

-- ============================================================
-- 2. applications: trigger to lock AI/review columns from student writes
-- ============================================================
CREATE OR REPLACE FUNCTION public.applications_block_student_protected_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_student boolean;
BEGIN
  -- Bypass for service_role / non-student callers
  IF auth.uid() IS NULL OR NEW.student_id <> auth.uid() THEN
    RETURN NEW;
  END IF;
  SELECT public.has_role(auth.uid(), 'student'::app_role) INTO is_student;
  IF NOT is_student THEN
    RETURN NEW;
  END IF;

  -- Force AI / review / certificate / college / face fields to remain unchanged
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
  NEW.final_credit              := OLD.final_credit;
  NEW.final_reviewer_id         := OLD.final_reviewer_id;
  NEW.review_source             := OLD.review_source;
  NEW.certificate_no            := OLD.certificate_no;
  NEW.certificate_issued_at     := OLD.certificate_issued_at;
  NEW.college_id                := OLD.college_id;
  NEW.student_id                := OLD.student_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_block_student_protected ON public.applications;
CREATE TRIGGER trg_applications_block_student_protected
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_block_student_protected_writes();

-- ============================================================
-- 3. ai_providers: hide encrypted key columns from non-super_admin
-- ============================================================
REVOKE SELECT (api_key_encrypted, api_key_last4) ON public.ai_providers FROM authenticated, anon;
-- Note: service_role bypasses column ACLs; super-admin reads happen via edge function (service role).

-- ============================================================
-- 4. user_roles uniqueness + deterministic current_user_college_id()
-- ============================================================
-- Drop duplicates defensively (keep first by id) before adding unique
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.role = b.role
  AND a.id > b.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_role_unique'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role);
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.current_user_college_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT college_id FROM public.user_roles
  WHERE user_id = auth.uid()
    AND role IN ('admin','teacher','student')
    AND college_id IS NOT NULL
  ORDER BY (role='admin') DESC, (role='teacher') DESC, college_id ASC
  LIMIT 1;
$$;

-- ============================================================
-- 5. Tighten EXECUTE on SECURITY DEFINER functions: deny anon/public
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
                   r.proname, r.args);
  END LOOP;
END$$;
