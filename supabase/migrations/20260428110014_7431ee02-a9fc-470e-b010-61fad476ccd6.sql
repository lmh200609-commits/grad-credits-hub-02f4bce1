-- Convert utility functions that don't need elevated privileges to SECURITY INVOKER

ALTER FUNCTION public.update_updated_at_column() SECURITY INVOKER;
ALTER FUNCTION public.normalize_keyword(text) SECURITY INVOKER;
ALTER FUNCTION public.strip_time_tokens(text) SECURITY INVOKER;

-- keywords_normalize_and_merge runs as a trigger; trigger context already runs with table owner privileges
-- when invoked, so SECURITY INVOKER is safe here.
ALTER FUNCTION public.keywords_normalize_and_merge() SECURITY INVOKER;

-- log_submission_event must remain SECURITY DEFINER because it INSERTs into submission_records
-- (which has no INSERT policy). Keep it locked down — already revoked above, re-assert:
REVOKE ALL ON FUNCTION public.log_submission_event() FROM PUBLIC, anon, authenticated;

-- handle_new_user must remain SECURITY DEFINER (auth trigger inserting into profiles).
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- applications_student_update_guard calls has_role for OTHER users (the student),
-- which requires the SECURITY DEFINER context. Keep it, but ensure no direct EXECUTE.
REVOKE ALL ON FUNCTION public.applications_student_update_guard() FROM PUBLIC, anon, authenticated;