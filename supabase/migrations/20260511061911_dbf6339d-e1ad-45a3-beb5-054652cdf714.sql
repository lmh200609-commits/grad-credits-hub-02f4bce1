CREATE OR REPLACE FUNCTION public.can_manage_college_badge_object(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'::public.app_role
        OR (
          ur.role = 'admin'::public.app_role
          AND ur.college_id IS NOT NULL
          AND ur.college_id::text = (storage.foldername(_object_name))[1]
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_college_badge_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_college_badge_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_college_badge_object(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_college_badge_object(text) TO supabase_storage_admin;
GRANT EXECUTE ON FUNCTION public.can_manage_college_badge_object(text) TO authenticator;

DROP POLICY IF EXISTS "college-badges admin write" ON storage.objects;
DROP POLICY IF EXISTS "college-badges admin update" ON storage.objects;
DROP POLICY IF EXISTS "college-badges admin delete" ON storage.objects;

CREATE POLICY "college-badges admin write"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'college-badges'
  AND public.can_manage_college_badge_object(name)
);

CREATE POLICY "college-badges admin update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'college-badges'
  AND public.can_manage_college_badge_object(name)
)
WITH CHECK (
  bucket_id = 'college-badges'
  AND public.can_manage_college_badge_object(name)
);

CREATE POLICY "college-badges admin delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'college-badges'
  AND public.can_manage_college_badge_object(name)
);