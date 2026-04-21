DROP POLICY IF EXISTS "apps student update own pending" ON public.applications;

CREATE POLICY "apps student update own pending"
ON public.applications
FOR UPDATE
TO authenticated
USING (
  student_id = auth.uid()
  AND status = ANY (ARRAY['pending_ai'::application_status, 'pending_review'::application_status, 'rejected_by_ai'::application_status])
)
WITH CHECK (
  student_id = auth.uid()
  AND status = ANY (ARRAY['pending_ai'::application_status, 'pending_review'::application_status, 'rejected_by_ai'::application_status])
);