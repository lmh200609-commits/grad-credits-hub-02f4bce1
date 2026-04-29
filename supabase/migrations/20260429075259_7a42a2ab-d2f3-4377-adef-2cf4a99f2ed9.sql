ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ethnicity text,
  ADD COLUMN IF NOT EXISTS advisor text,
  ADD COLUMN IF NOT EXISTS apartment_no text,
  ADD COLUMN IF NOT EXISTS dorm_room text,
  ADD COLUMN IF NOT EXISTS bed_no text;