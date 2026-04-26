ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ai_check_identity_match  boolean,
  ADD COLUMN IF NOT EXISTS ai_check_logic           boolean,
  ADD COLUMN IF NOT EXISTS ai_check_completeness    boolean,
  ADD COLUMN IF NOT EXISTS ai_identity_mismatch     text,
  ADD COLUMN IF NOT EXISTS ai_logic_issue           text,
  ADD COLUMN IF NOT EXISTS ai_blank_fields          text,
  ADD COLUMN IF NOT EXISTS ai_detected_student_no   text,
  ADD COLUMN IF NOT EXISTS ai_detected_school       text;