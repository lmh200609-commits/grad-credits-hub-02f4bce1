DROP POLICY IF EXISTS "college-badges admin write" ON storage.objects;
DROP POLICY IF EXISTS "college-badges admin update" ON storage.objects;
DROP POLICY IF EXISTS "college-badges admin delete" ON storage.objects;

CREATE POLICY "college-badges admin write" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'college-badges'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'
        OR (ur.role = 'admin'
            AND ur.college_id IS NOT NULL
            AND ur.college_id::text = (storage.foldername(name))[1])
      )
  )
);

CREATE POLICY "college-badges admin update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'college-badges'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'
        OR (ur.role = 'admin'
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
        ur.role = 'super_admin'
        OR (ur.role = 'admin'
            AND ur.college_id IS NOT NULL
            AND ur.college_id::text = (storage.foldername(name))[1])
      )
  )
);

CREATE POLICY "college-badges admin delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'college-badges'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.role = 'super_admin'
        OR (ur.role = 'admin'
            AND ur.college_id IS NOT NULL
            AND ur.college_id::text = (storage.foldername(name))[1])
      )
  )
);