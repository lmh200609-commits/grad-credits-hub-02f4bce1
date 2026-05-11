-- Rewrite college-badges storage policies to inline the role check (no SECURITY DEFINER func dependency)
DROP POLICY IF EXISTS "college-badges admin write" ON storage.objects;
DROP POLICY IF EXISTS "college-badges admin update" ON storage.objects;
DROP POLICY IF EXISTS "college-badges admin delete" ON storage.objects;
DROP POLICY IF EXISTS "college-badges public read" ON storage.objects;

CREATE POLICY "college-badges public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'college-badges');

CREATE POLICY "college-badges admin write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'college-badges'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'::public.app_role
        OR (ur.role = 'admin'::public.app_role
            AND ur.college_id IS NOT NULL
            AND ur.college_id::text = (storage.foldername(name))[1])
      )
  )
);

CREATE POLICY "college-badges admin update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'college-badges'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'::public.app_role
        OR (ur.role = 'admin'::public.app_role
            AND ur.college_id IS NOT NULL
            AND ur.college_id::text = (storage.foldername(name))[1])
      )
  )
)
WITH CHECK (
  bucket_id = 'college-badges'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'::public.app_role
        OR (ur.role = 'admin'::public.app_role
            AND ur.college_id IS NOT NULL
            AND ur.college_id::text = (storage.foldername(name))[1])
      )
  )
);

CREATE POLICY "college-badges admin delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'college-badges'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'::public.app_role
        OR (ur.role = 'admin'::public.app_role
            AND ur.college_id IS NOT NULL
            AND ur.college_id::text = (storage.foldername(name))[1])
      )
  )
);

-- Ensure user_roles is readable inside storage.objects RLS evaluation by authenticated role
GRANT SELECT ON public.user_roles TO authenticated;