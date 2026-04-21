-- 1. application-files: add UPDATE policy
CREATE POLICY "app files update own or staff"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'application-files'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
)
WITH CHECK (
  bucket_id = 'application-files'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

-- 2. Realtime channel authorization
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "realtime authenticated read scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'teacher'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    -- students: only their own application topics, e.g. topic = 'applications:<uid>'
    realtime.topic() LIKE 'applications:%'
    AND split_part(realtime.topic(), ':', 2) = auth.uid()::text
  )
);

CREATE POLICY "realtime authenticated write scoped"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'teacher'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    realtime.topic() LIKE 'applications:%'
    AND split_part(realtime.topic(), ':', 2) = auth.uid()::text
  )
);

-- 3. Restrict has_role to self-or-admin to prevent role enumeration
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow internal SQL contexts (e.g. RLS policy evaluation) where auth.uid() may be null OR equals target
  -- Block authenticated callers from probing OTHER users' roles
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = auth.uid() AND role = 'admin'
     )
  THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
END;
$function$;