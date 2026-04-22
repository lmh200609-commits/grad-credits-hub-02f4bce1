CREATE POLICY "Staff can read application files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'application-files'
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))
);