
CREATE TABLE IF NOT EXISTS public.colleges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  short_name text,
  system_title text NOT NULL DEFAULT '学分认证系统',
  badge_url text,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_colleges_updated_at ON public.colleges;
CREATE TRIGGER trg_colleges_updated_at
  BEFORE UPDATE ON public.colleges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE SET NULL;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE SET NULL;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_college ON public.profiles(college_id);
CREATE INDEX IF NOT EXISTS idx_applications_college ON public.applications(college_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_college ON public.user_roles(college_id);

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_college_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT college_id FROM public.user_roles
  WHERE user_id = auth.uid() AND role IN ('admin','teacher','student')
  ORDER BY (role='admin') DESC, (role='teacher') DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_college_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_college_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.applications_set_college()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.college_id IS NULL THEN
    SELECT college_id INTO NEW.college_id
    FROM public.profiles WHERE user_id = NEW.student_id LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_set_college ON public.applications;
CREATE TRIGGER trg_applications_set_college
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_set_college();

CREATE POLICY "colleges read all authenticated"
  ON public.colleges FOR SELECT TO authenticated USING (true);

CREATE POLICY "colleges super_admin manage"
  ON public.colleges FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "colleges admin update own"
  ON public.colleges FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND id = public.current_user_college_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND id = public.current_user_college_id());

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Teachers can view all profiles" ON public.profiles;

CREATE POLICY "profiles super_admin all"
  ON public.profiles FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "profiles college admin select"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         AND college_id IS NOT DISTINCT FROM public.current_user_college_id());

CREATE POLICY "profiles college admin insert"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
              AND college_id IS NOT DISTINCT FROM public.current_user_college_id());

CREATE POLICY "profiles college admin update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         AND college_id IS NOT DISTINCT FROM public.current_user_college_id());

CREATE POLICY "profiles college admin delete"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         AND college_id IS NOT DISTINCT FROM public.current_user_college_id());

CREATE POLICY "profiles college teacher select"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'teacher'::app_role)
         AND college_id IS NOT DISTINCT FROM public.current_user_college_id());

DROP POLICY IF EXISTS "apps student read own" ON public.applications;
DROP POLICY IF EXISTS "apps reviewer update" ON public.applications;

CREATE POLICY "apps read scoped"
  ON public.applications FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR ((public.has_role(auth.uid(), 'teacher'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
        AND college_id IS NOT DISTINCT FROM public.current_user_college_id())
  );

CREATE POLICY "apps reviewer update scoped"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR ((public.has_role(auth.uid(), 'teacher'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
        AND college_id IS NOT DISTINCT FROM public.current_user_college_id())
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR ((public.has_role(auth.uid(), 'teacher'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
        AND college_id IS NOT DISTINCT FROM public.current_user_college_id())
  );

DROP POLICY IF EXISTS "sub_rec student read own" ON public.submission_records;
CREATE POLICY "sub_rec read scoped"
  ON public.submission_records FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR ((public.has_role(auth.uid(), 'teacher'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
        AND EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.id = submission_records.application_id
          AND a.college_id IS NOT DISTINCT FROM public.current_user_college_id()
        ))
  );

DROP POLICY IF EXISTS "reviews read related" ON public.application_reviews;
CREATE POLICY "reviews read scoped"
  ON public.application_reviews FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_reviews.application_id
      AND (
        a.student_id = auth.uid()
        OR public.is_super_admin(auth.uid())
        OR ((public.has_role(auth.uid(), 'teacher'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
            AND a.college_id IS NOT DISTINCT FROM public.current_user_college_id())
      )
    )
  );

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "audit_logs super_admin view"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

CREATE POLICY "user_roles super_admin all"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "user_roles college admin insert"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND role IN ('teacher','student')
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

CREATE POLICY "user_roles college admin update"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND role IN ('teacher','student')
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

CREATE POLICY "user_roles college admin delete"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND role IN ('teacher','student')
    AND college_id IS NOT DISTINCT FROM public.current_user_college_id()
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('college-badges', 'college-badges', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "college-badges public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'college-badges');

CREATE POLICY "college-badges admin write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'college-badges'
    AND (
      public.is_super_admin(auth.uid())
      OR (public.has_role(auth.uid(), 'admin'::app_role)
          AND (storage.foldername(name))[1] = public.current_user_college_id()::text)
    )
  );

CREATE POLICY "college-badges admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'college-badges'
    AND (
      public.is_super_admin(auth.uid())
      OR (public.has_role(auth.uid(), 'admin'::app_role)
          AND (storage.foldername(name))[1] = public.current_user_college_id()::text)
    )
  );

CREATE POLICY "college-badges admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'college-badges'
    AND (
      public.is_super_admin(auth.uid())
      OR (public.has_role(auth.uid(), 'admin'::app_role)
          AND (storage.foldername(name))[1] = public.current_user_college_id()::text)
    )
  );

INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT user_id, 'super_admin'::app_role
FROM public.user_roles
WHERE role = 'admin'
ON CONFLICT DO NOTHING;
