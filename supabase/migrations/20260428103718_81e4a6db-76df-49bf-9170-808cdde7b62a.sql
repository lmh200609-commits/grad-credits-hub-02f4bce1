
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS face_match_status text
    CHECK (face_match_status IN ('unknown','no_face','match','mismatch','error')),
  ADD COLUMN IF NOT EXISTS face_match_score numeric,
  ADD COLUMN IF NOT EXISTS face_match_note text,
  ADD COLUMN IF NOT EXISTS face_checked_at timestamptz;
