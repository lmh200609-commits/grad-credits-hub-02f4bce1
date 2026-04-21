
-- 1) Harden has_role: when auth.uid() IS NULL, only allow trusted internal roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _current_role text := current_user;
BEGIN
  IF _caller IS NULL THEN
    -- Only trusted internal contexts may probe arbitrary users
    IF _current_role NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RETURN false;
    END IF;
  ELSIF _caller <> _user_id THEN
    -- Authenticated callers may only check their own role unless they are admin
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _caller AND role = 'admin'
    ) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
END;
$function$;

-- 2) Add WITH CHECK to reviewer update policy so student_id cannot be reassigned
DROP POLICY IF EXISTS "apps reviewer update" ON public.applications;

CREATE POLICY "apps reviewer update"
ON public.applications
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'teacher'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  (has_role(auth.uid(), 'teacher'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  AND student_id = (SELECT a.student_id FROM public.applications a WHERE a.id = applications.id)
);
