-- Teachers can view all student profiles
CREATE POLICY "Teachers can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'teacher'));

-- Teachers can view all applications (for per-student aggregation page)
CREATE POLICY "Teachers can view all applications"
ON public.applications
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'teacher'));