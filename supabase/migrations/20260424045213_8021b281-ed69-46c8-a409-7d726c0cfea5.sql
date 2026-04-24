-- 1. 备份
CREATE TABLE IF NOT EXISTS public.cases_backup_20260424 AS SELECT * FROM public.cases;
CREATE TABLE IF NOT EXISTS public.rules_backup_20260424 AS SELECT * FROM public.rules;
CREATE TABLE IF NOT EXISTS public.certificate_types_backup_20260424 AS SELECT * FROM public.certificate_types;
CREATE TABLE IF NOT EXISTS public.rule_library_backup_20260424 AS SELECT * FROM public.rule_library;
CREATE TABLE IF NOT EXISTS public.keywords_backup_20260424 AS SELECT * FROM public.keywords;

-- 2. 通用清洗函数（临时）
CREATE OR REPLACE FUNCTION pg_temp.clean_time(s text) RETURNS text AS $$
  SELECT CASE WHEN s IS NULL THEN NULL ELSE
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(s,
                  '第[一二三四五六七八九十百零0-9]+(届|期|次)', '', 'g'),
                '(19|20)[0-9]{2}[-—](19|20)?[0-9]{2,4}(学年|年度)?', '', 'g'),
              '(19|20)[0-9]{2}年?', '', 'g'),
            '（[\s·•・\-－—]+', '（', 'g'),
          '[\s·•・\-－—]+）', '）', 'g'),
        '\s{2,}', ' ', 'g')
    , ' ·•・-－—')
  END;
$$ LANGUAGE sql IMMUTABLE;

-- 3. cases
UPDATE public.cases SET
  title   = pg_temp.clean_time(title),
  summary = pg_temp.clean_time(summary),
  notes   = pg_temp.clean_time(notes)
WHERE title  ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})'
   OR summary ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})'
   OR (notes IS NOT NULL AND notes ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})');

-- 4. rules
UPDATE public.rules SET
  name        = pg_temp.clean_time(name),
  description = pg_temp.clean_time(description),
  project     = pg_temp.clean_time(project),
  achievement = pg_temp.clean_time(achievement)
WHERE name ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})'
   OR (description IS NOT NULL AND description ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})')
   OR (project     IS NOT NULL AND project     ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})')
   OR (achievement IS NOT NULL AND achievement ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})');

-- 5. certificate_types：先删除清洗后会撞唯一索引 (name, category, level) 的冗余行
DELETE FROM public.certificate_types
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
             PARTITION BY pg_temp.clean_time(name),
                          COALESCE(category,''), COALESCE(level,'')
             ORDER BY occurrence_count DESC, id
           ) AS rn
    FROM public.certificate_types
  ) t WHERE rn > 1
);

UPDATE public.certificate_types SET
  name        = pg_temp.clean_time(name),
  description = pg_temp.clean_time(description)
WHERE name ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})'
   OR (description IS NOT NULL AND description ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})');

-- 6. rule_library
UPDATE public.rule_library SET
  content = pg_temp.clean_time(content)
WHERE content ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})';

-- 7. keywords：清洗后变空或重复则删除
WITH cand AS (
  SELECT id, keyword, pg_temp.clean_time(keyword) AS new_kw
  FROM public.keywords
  WHERE keyword ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})'
)
DELETE FROM public.keywords WHERE id IN (
  SELECT c.id FROM cand c
  WHERE length(c.new_kw) = 0
     OR EXISTS (SELECT 1 FROM public.keywords k2 WHERE k2.id <> c.id AND k2.keyword = c.new_kw)
);

UPDATE public.keywords SET
  keyword = pg_temp.clean_time(keyword)
WHERE keyword ~ '(第[一二三四五六七八九十百零0-9]+(届|期|次)|(19|20)[0-9]{2})';
