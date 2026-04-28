CREATE OR REPLACE FUNCTION public.ai_encrypt_api_key(_plain text, _secret text)
 RETURNS TABLE(encrypted text, last4 text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _role text := current_user;
BEGIN
  -- Allow trusted server roles (edge functions using service role) OR admin users.
  IF _role NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;
  IF _plain IS NULL OR length(_plain) = 0 THEN
    RAISE EXCEPTION 'empty key';
  END IF;
  IF _secret IS NULL OR length(_secret) < 8 THEN
    RAISE EXCEPTION 'weak secret';
  END IF;
  RETURN QUERY SELECT
    encode(extensions.pgp_sym_encrypt(_plain, _secret), 'base64')::text,
    right(_plain, 4);
END;
$function$;