
-- =========================================================
-- Phase 1: indexes, pg_trgm, RLS auth.uid() wrapping, cleanup
-- =========================================================

-- 1) Extension for fuzzy search on student_no / full_name
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) Indexes (IF NOT EXISTS so re-runs are safe)
-- applications
CREATE INDEX IF NOT EXISTS idx_apps_college_status_submitted
  ON public.applications (college_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_student_submitted
  ON public.applications (student_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_pending_review
  ON public.applications (college_id, submitted_at DESC)
  WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_apps_pending_ai
  ON public.applications (submitted_at DESC)
  WHERE status = 'pending_ai';

-- user_roles
CREATE INDEX IF NOT EXISTS idx_user_roles_college_role
  ON public.user_roles (college_id, role);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
  ON public.user_roles (user_id, role);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_student
  ON public.user_roles (role)
  WHERE role = 'student';

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_college_name
  ON public.profiles (college_id, full_name);
CREATE INDEX IF NOT EXISTS idx_profiles_student_no_trgm
  ON public.profiles USING gin (student_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
  ON public.profiles USING gin (full_name gin_trgm_ops);

-- submission_records
CREATE INDEX IF NOT EXISTS idx_sub_rec_student_created
  ON public.submission_records (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_rec_created
  ON public.submission_records (created_at DESC);

-- audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.audit_logs (action, created_at DESC);

-- application_reviews
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON public.application_reviews (reviewer_id, created_at DESC);

-- 3) Drop legacy backup tables (data already in *_backup_20260424 → can be exported externally if needed; superseded)
DROP TABLE IF EXISTS public.cases_backup_20260424 CASCADE;
DROP TABLE IF EXISTS public.certificate_types_backup_20260424 CASCADE;
DROP TABLE IF EXISTS public.keywords_backup_20260424 CASCADE;
DROP TABLE IF EXISTS public.rules_backup_20260424 CASCADE;
DROP TABLE IF EXISTS public.rule_library_backup_20260424 CASCADE;

-- 4) Rewrite RLS policies: wrap auth.uid() in (SELECT auth.uid()) so
--    Postgres treats it as a stable scalar (init-plan once per query
--    instead of once per row). This is the official Supabase perf pattern.

-- profiles
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- applications
DROP POLICY IF EXISTS "apps read scoped" ON public.applications;
CREATE POLICY "apps read scoped" ON public.applications
  FOR SELECT TO authenticated
  USING (
    (student_id = (SELECT auth.uid()))
    OR public.is_super_admin((SELECT auth.uid()))
    OR (
      (public.has_role((SELECT auth.uid()), 'teacher'::app_role)
        OR public.has_role((SELECT auth.uid()), 'admin'::app_role))
      AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
    )
  );

DROP POLICY IF EXISTS "apps reviewer update scoped" ON public.applications;
CREATE POLICY "apps reviewer update scoped" ON public.applications
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin((SELECT auth.uid()))
    OR (
      (public.has_role((SELECT auth.uid()), 'teacher'::app_role)
        OR public.has_role((SELECT auth.uid()), 'admin'::app_role))
      AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
    )
  )
  WITH CHECK (
    public.is_super_admin((SELECT auth.uid()))
    OR (
      (public.has_role((SELECT auth.uid()), 'teacher'::app_role)
        OR public.has_role((SELECT auth.uid()), 'admin'::app_role))
      AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
    )
  );

DROP POLICY IF EXISTS "apps student delete own pending" ON public.applications;
CREATE POLICY "apps student delete own pending" ON public.applications
  FOR DELETE TO authenticated
  USING (student_id = (SELECT auth.uid()) AND status = 'pending_ai'::application_status);

DROP POLICY IF EXISTS "apps student insert own" ON public.applications;
CREATE POLICY "apps student insert own" ON public.applications
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = (SELECT auth.uid())
    AND public.has_role((SELECT auth.uid()), 'student'::app_role)
  );

DROP POLICY IF EXISTS "apps student update own" ON public.applications;
CREATE POLICY "apps student update own" ON public.applications
  FOR UPDATE TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (
    student_id = (SELECT auth.uid())
    AND status = ANY (ARRAY['pending_ai'::application_status, 'pending_review'::application_status, 'rejected_by_ai'::application_status])
  );

-- application_reviews
DROP POLICY IF EXISTS "reviews insert by reviewer" ON public.application_reviews;
CREATE POLICY "reviews insert by reviewer" ON public.application_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'teacher'::app_role)
    OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "reviews read scoped" ON public.application_reviews;
CREATE POLICY "reviews read scoped" ON public.application_reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_reviews.application_id
        AND (
          a.student_id = (SELECT auth.uid())
          OR public.is_super_admin((SELECT auth.uid()))
          OR (
            (public.has_role((SELECT auth.uid()), 'teacher'::app_role)
              OR public.has_role((SELECT auth.uid()), 'admin'::app_role))
            AND a.college_id IS NOT DISTINCT FROM public.current_user_college_id()
          )
        )
    )
  );

-- submission_records
DROP POLICY IF EXISTS "sub_rec read scoped" ON public.submission_records;
CREATE POLICY "sub_rec read scoped" ON public.submission_records
  FOR SELECT TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR public.is_super_admin((SELECT auth.uid()))
    OR (
      (public.has_role((SELECT auth.uid()), 'teacher'::app_role)
        OR public.has_role((SELECT auth.uid()), 'admin'::app_role))
      AND EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.id = submission_records.application_id
          AND a.college_id IS NOT DISTINCT FROM public.current_user_college_id()
      )
    )
  );

-- user_roles
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Teachers can view all roles" ON public.user_roles;
CREATE POLICY "Teachers can view all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'teacher'::app_role));

DROP POLICY IF EXISTS "user_roles college admin delete" ON public.user_roles;
CREATE POLICY "user_roles college admin delete" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND role = ANY (ARRAY['teacher'::app_role, 'student'::app_role])
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "user_roles college admin insert" ON public.user_roles;
CREATE POLICY "user_roles college admin insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND role = ANY (ARRAY['teacher'::app_role, 'student'::app_role])
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "user_roles college admin update" ON public.user_roles;
CREATE POLICY "user_roles college admin update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND role = ANY (ARRAY['teacher'::app_role, 'student'::app_role])
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "user_roles super_admin all" ON public.user_roles;
CREATE POLICY "user_roles super_admin all" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())))
  WITH CHECK (public.is_super_admin((SELECT auth.uid())));

-- profiles college admin/teacher policies
DROP POLICY IF EXISTS "profiles college admin select" ON public.profiles;
CREATE POLICY "profiles college admin select" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "profiles college admin insert" ON public.profiles;
CREATE POLICY "profiles college admin insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "profiles college admin update" ON public.profiles;
CREATE POLICY "profiles college admin update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "profiles college admin delete" ON public.profiles;
CREATE POLICY "profiles college admin delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "profiles college teacher select" ON public.profiles;
CREATE POLICY "profiles college teacher select" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'teacher'::app_role)
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

DROP POLICY IF EXISTS "profiles super_admin all" ON public.profiles;
CREATE POLICY "profiles super_admin all" ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())))
  WITH CHECK (public.is_super_admin((SELECT auth.uid())));

-- 5) Refresh planner stats so new indexes are picked immediately
ANALYZE public.applications;
ANALYZE public.profiles;
ANALYZE public.user_roles;
ANALYZE public.submission_records;
ANALYZE public.audit_logs;
ANALYZE public.application_reviews;
