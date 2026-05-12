DROP POLICY IF EXISTS "college-badges authenticated read" ON storage.objects;
CREATE POLICY "college-badges authenticated read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'college-badges');