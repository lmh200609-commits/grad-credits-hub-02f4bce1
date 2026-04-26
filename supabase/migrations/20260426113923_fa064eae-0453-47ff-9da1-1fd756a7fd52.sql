ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS review_source text,
  ADD COLUMN IF NOT EXISTS ai_check_consistency  boolean,
  ADD COLUMN IF NOT EXISTS ai_check_relevance    boolean,
  ADD COLUMN IF NOT EXISTS ai_check_authenticity boolean,
  ADD COLUMN IF NOT EXISTS ai_check_name_match   boolean,
  ADD COLUMN IF NOT EXISTS ai_detected_project     text,
  ADD COLUMN IF NOT EXISTS ai_detected_achievement text,
  ADD COLUMN IF NOT EXISTS ai_detected_level       text,
  ADD COLUMN IF NOT EXISTS ai_detected_identity    text,
  ADD COLUMN IF NOT EXISTS ai_override_note        text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_review_source_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_review_source_check
      CHECK (review_source IS NULL OR review_source IN ('ai_uncertain','student_appeal','reviewer_recall'));
  END IF;
END $$;