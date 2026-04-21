-- Allow teachers and admins to view all user_roles so teacher dashboards can filter students.
CREATE POLICY "Teachers can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'teacher'));
