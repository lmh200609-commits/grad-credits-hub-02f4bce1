
CREATE OR REPLACE FUNCTION public.strip_time_tokens(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  r text := coalesce(s, '');
BEGIN
  IF r = '' THEN RETURN ''; END IF;
  r := regexp_replace(r, '（[\s0-9年月日赛季\-~—]+）', '', 'g');
  r := regexp_replace(r, '\([\s0-9年月日赛季\-~—]+\)', '', 'g');
  r := regexp_replace(r, '（\s*）', '', 'g');
  r := regexp_replace(r, '\(\s*\)', '', 'g');
  r := regexp_replace(r, '20[0-9]{2}\s*[-~—]\s*20[0-9]{2}\s*(赛季|年)?', '', 'g');
  r := regexp_replace(r, '20[0-9]{2}\s*(赛季|年度|年)', '', 'g');
  r := regexp_replace(r, '(?<![0-9])20[0-9]{2}(?![0-9])', '', 'g');
  r := regexp_replace(r, '第[一二三四五六七八九十百零0-9]+(届|次|期|赛季)', '', 'g');
  r := regexp_replace(r, '\s+', ' ', 'g');
  r := regexp_replace(r, '^[\s,，、:：;；\-]+', '', 'g');
  r := regexp_replace(r, '[\s,，、:：;；\-]+$', '', 'g');
  r := btrim(r);
  RETURN r;
END;
$$;

ALTER TABLE public.keywords DISABLE TRIGGER USER;

-- 第1步：在 UPDATE 之前，预先解决会触发唯一冲突的行
-- 对于每个清理后的目标 keyword 值，如果会撞车（存在多行映射到同一目标，或目标已被另一行占用），
-- 仅保留 created_at 最早的一行作为"赢家"，把其他行的 usage_count 累加到它，并删除其他行。
WITH stripped AS (
  SELECT id, keyword AS old_kw,
         public.strip_time_tokens(keyword) AS new_kw,
         usage_count, created_at
  FROM public.keywords
),
-- 标识需要清理的目标 new_kw
groups AS (
  SELECT new_kw,
         array_agg(id ORDER BY created_at, id) AS ids,
         sum(usage_count) AS total_usage
  FROM stripped
  WHERE new_kw IS NOT NULL AND length(new_kw) > 0
  GROUP BY new_kw
  HAVING count(*) > 1
),
winners AS (
  SELECT new_kw, ids[1] AS keep_id, total_usage
  FROM groups
),
upd_winner AS (
  UPDATE public.keywords k
  SET usage_count = w.total_usage, updated_at = now()
  FROM winners w
  WHERE k.id = w.keep_id
  RETURNING k.id
),
del_losers AS (
  DELETE FROM public.keywords
  WHERE id IN (
    SELECT unnest(ids[2:array_length(ids,1)])
    FROM groups
  )
  RETURNING id
)
SELECT (SELECT count(*) FROM upd_winner) AS merged, (SELECT count(*) FROM del_losers) AS deleted;

-- 第2步：现在每个 new_kw 至多对应一行，可以安全 UPDATE
UPDATE public.keywords
SET keyword = public.strip_time_tokens(keyword), updated_at = now()
WHERE keyword IS DISTINCT FROM public.strip_time_tokens(keyword);

-- 第3步：删除变空的关键词
DELETE FROM public.keywords WHERE keyword IS NULL OR length(btrim(keyword)) = 0;

ALTER TABLE public.keywords ENABLE TRIGGER USER;

-- 规则库
UPDATE public.rules
SET name = public.strip_time_tokens(name), updated_at = now()
WHERE name IS DISTINCT FROM public.strip_time_tokens(name);

UPDATE public.rules
SET keywords = COALESCE((
  SELECT array_agg(DISTINCT v ORDER BY v)
  FROM (SELECT public.strip_time_tokens(k) AS v FROM unnest(keywords) k) t
  WHERE v IS NOT NULL AND length(v) > 0
), '{}'::text[]),
updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM unnest(keywords) k
  WHERE k IS DISTINCT FROM public.strip_time_tokens(k)
);

-- 案例库
UPDATE public.cases
SET title = public.strip_time_tokens(title), updated_at = now()
WHERE title IS DISTINCT FROM public.strip_time_tokens(title);

UPDATE public.cases
SET summary = public.strip_time_tokens(summary), updated_at = now()
WHERE summary IS DISTINCT FROM public.strip_time_tokens(summary);

-- 证书类型
UPDATE public.certificate_types
SET name = public.strip_time_tokens(name), updated_at = now()
WHERE name IS DISTINCT FROM public.strip_time_tokens(name);

UPDATE public.certificate_types
SET keywords = COALESCE((
  SELECT array_agg(DISTINCT v ORDER BY v)
  FROM (SELECT public.strip_time_tokens(k) AS v FROM unnest(keywords) k) t
  WHERE v IS NOT NULL AND length(v) > 0
), '{}'::text[]),
updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM unnest(keywords) k
  WHERE k IS DISTINCT FROM public.strip_time_tokens(k)
);

-- 学生申请历史快照
UPDATE public.applications
SET selected_keywords = COALESCE((
  SELECT array_agg(DISTINCT v)
  FROM (SELECT public.strip_time_tokens(k) AS v FROM unnest(selected_keywords) k) t
  WHERE v IS NOT NULL AND length(v) > 0
), '{}'::text[])
WHERE EXISTS (
  SELECT 1 FROM unnest(selected_keywords) k
  WHERE k IS DISTINCT FROM public.strip_time_tokens(k)
);

UPDATE public.applications
SET custom_keywords = COALESCE((
  SELECT array_agg(DISTINCT v)
  FROM (SELECT public.strip_time_tokens(k) AS v FROM unnest(custom_keywords) k) t
  WHERE v IS NOT NULL AND length(v) > 0
), '{}'::text[])
WHERE EXISTS (
  SELECT 1 FROM unnest(custom_keywords) k
  WHERE k IS DISTINCT FROM public.strip_time_tokens(k)
);
