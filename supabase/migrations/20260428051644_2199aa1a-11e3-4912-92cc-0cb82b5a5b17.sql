
-- Encrypt: callable by admins only. Returns encrypted text and last 4 chars.
CREATE OR REPLACE FUNCTION public.ai_encrypt_api_key(_plain text, _secret text)
RETURNS table(encrypted text, last4 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
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
$$;

REVOKE ALL ON FUNCTION public.ai_encrypt_api_key(text, text) FROM PUBLIC, anon;

-- Decrypt: callable only with a valid secret AND only from service contexts.
-- We additionally lock execution to service_role / postgres roles.
CREATE OR REPLACE FUNCTION public.ai_decrypt_provider_key(_provider_id uuid, _secret text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _enc text;
  _role text := current_user;
BEGIN
  IF _role NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT api_key_encrypted INTO _enc
  FROM public.ai_providers WHERE id = _provider_id;
  IF _enc IS NULL THEN RETURN NULL; END IF;
  RETURN extensions.pgp_sym_decrypt(decode(_enc, 'base64')::bytea, _secret);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_decrypt_provider_key(uuid, text) FROM PUBLIC, anon, authenticated;
