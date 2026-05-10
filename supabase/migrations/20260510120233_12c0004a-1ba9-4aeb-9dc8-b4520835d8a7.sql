-- ============================================================
-- 1) STORAGE: application-files SELECT — college-scoped for staff
-- ============================================================
DROP POLICY IF EXISTS "Staff can read application files" ON storage.objects;
DROP POLICY IF EXISTS "app files student read own"      ON storage.objects;

-- Student: own folder
CREATE POLICY "app files student read own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Staff: only files whose owner belongs to the same college
CREATE POLICY "app files staff read same college"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-files'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'teacher'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id::text = (storage.foldername(name))[1]
          AND p.college_id IS NOT DISTINCT FROM public.current_user_college_id()
      )
    )
  )
);

-- ============================================================
-- 2) STORAGE: application-files UPDATE — college-scoped for staff
-- ============================================================
DROP POLICY IF EXISTS "app files update own or staff" ON storage.objects;

CREATE POLICY "app files update own or staff scoped"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'application-files'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_super_admin(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'teacher'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id::text = (storage.foldername(name))[1]
          AND p.college_id IS NOT DISTINCT FROM public.current_user_college_id()
      )
    )
  )
)
WITH CHECK (
  bucket_id = 'application-files'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_super_admin(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'teacher'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id::text = (storage.foldername(name))[1]
          AND p.college_id IS NOT DISTINCT FROM public.current_user_college_id()
      )
    )
  )
);

-- ============================================================
-- 3) STORAGE: student-photos staff SELECT — college-scoped
-- Path layout: student-photos/{user_id}/{filename}
-- ============================================================
DROP POLICY IF EXISTS "student photos: staff read" ON storage.objects;

CREATE POLICY "student photos: staff read same college"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = 'student-photos'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'teacher'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id::text = (storage.foldername(name))[2]
          AND p.college_id IS NOT DISTINCT FROM public.current_user_college_id()
      )
    )
  )
);

-- ============================================================
-- 4) has_role: prevent cross-college role enumeration by admins
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _current_role text := current_user;
  _caller_college uuid;
  _target_college uuid;
BEGIN
  -- Internal SQL contexts: trusted server roles always allowed
  IF _caller IS NULL THEN
    IF _current_role NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    );
  END IF;

  -- Self-check is always allowed
  IF _caller = _user_id THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    );
  END IF;

  -- Super admin: unrestricted
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _caller AND role = 'super_admin') THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    );
  END IF;

  -- Admins may probe only users in the same college
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _caller AND role = 'admin') THEN
    SELECT college_id INTO _caller_college
      FROM public.user_roles
     WHERE user_id = _caller AND role = 'admin' AND college_id IS NOT NULL
     LIMIT 1;
    SELECT college_id INTO _target_college
      FROM public.user_roles
     WHERE user_id = _user_id AND college_id IS NOT NULL
     ORDER BY (role='admin') DESC, (role='teacher') DESC
     LIMIT 1;

    IF _caller_college IS NULL OR _target_college IS NULL OR _caller_college <> _target_college THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    );
  END IF;

  -- All other authenticated callers cannot probe other users
  RETURN false;
END;
$function$;

-- ============================================================
-- 5) Realtime: stop broadcasting all colleges to all staff
-- (Theme/branding updates will appear on next page load.)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'colleges'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.colleges;
  END IF;
END $$;