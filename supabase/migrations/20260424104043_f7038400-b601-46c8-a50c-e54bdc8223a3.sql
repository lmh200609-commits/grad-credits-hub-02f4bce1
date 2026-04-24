DROP POLICY IF EXISTS "apps student update own pending" ON public.applications;

CREATE POLICY "apps student update own"
ON public.applications FOR UPDATE TO authenticated
USING (student_id = auth.uid())
WITH CHECK (
  student_id = auth.uid()
  AND status IN ('pending_ai','pending_review','rejected_by_ai')
);