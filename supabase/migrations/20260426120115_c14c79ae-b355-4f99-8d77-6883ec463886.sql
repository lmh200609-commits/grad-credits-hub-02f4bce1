ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ai_last_error        text,
  ADD COLUMN IF NOT EXISTS ai_last_attempt_at   timestamptz,
  ADD COLUMN IF NOT EXISTS ai_previous_snapshot jsonb;