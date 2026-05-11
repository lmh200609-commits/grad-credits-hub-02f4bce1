-- Allow any authenticated actor to view audit logs they themselves produced.
-- Super-admins keep their full-table SELECT via the existing policy.
CREATE POLICY "audit_logs view own actions"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (actor_id = (SELECT auth.uid()));