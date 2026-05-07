
-- 1) Stop public listing of college-badges bucket; public file URLs still work.
DROP POLICY IF EXISTS "college-badges public read" ON storage.objects;

-- 2) Lock down SECURITY DEFINER helpers that should never be called directly by clients.
REVOKE EXECUTE ON FUNCTION public.ai_encrypt_api_key(text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.ai_decrypt_provider_key(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_ai_eval_jobs(integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.mark_ai_eval_done(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.mark_ai_eval_failed(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.refresh_certificate_types() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.dedupe_keywords() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.gen_certificate_no(uuid) FROM anon, public;
-- gen_certificate_no remains callable by `authenticated` (students invoke it for their own approved app).
