INSERT INTO public.keywords (keyword, source, active)
SELECT k, 'rules_sync', true FROM (
  SELECT DISTINCT public.normalize_keyword(unnest(keywords)) AS k FROM public.rules WHERE active = true
  UNION
  SELECT DISTINCT public.normalize_keyword(unnest(keywords)) AS k FROM public.certificate_types WHERE active = true
) t
WHERE k IS NOT NULL AND length(k) > 0
  AND NOT EXISTS (SELECT 1 FROM public.keywords kw WHERE kw.keyword = t.k);