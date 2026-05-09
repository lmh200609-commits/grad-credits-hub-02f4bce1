CREATE OR REPLACE FUNCTION public.normalize_college_name(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(coalesce(s,''), '[与和&\s院]', '', 'g'));
$$;

WITH match AS (
  SELECT p.user_id, c.id AS cid
  FROM public.profiles p
  JOIN public.colleges c
    ON public.normalize_college_name(p.department) = public.normalize_college_name(c.name)
  WHERE p.college_id IS NULL AND p.department IS NOT NULL
)
UPDATE public.profiles p
SET college_id = m.cid
FROM match m
WHERE p.user_id = m.user_id;

UPDATE public.user_roles ur
SET college_id = p.college_id
FROM public.profiles p
WHERE ur.user_id = p.user_id
  AND ur.college_id IS NULL
  AND p.college_id IS NOT NULL
  AND ur.role IN ('student','teacher','admin');