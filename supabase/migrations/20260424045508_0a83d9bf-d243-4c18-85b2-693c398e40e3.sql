-- 1. 规范化函数：去首尾空白、压缩内部空白
CREATE OR REPLACE FUNCTION public.normalize_keyword(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(btrim(regexp_replace(coalesce(s,''), '\s+', ' ', 'g')), '');
$$;

-- 2. 唯一索引（大小写敏感；中文无大小写问题）。先合并再建索引。
-- 2a. 一次性合并函数：保留每个 keyword 最早的一行，累加 usage_count，删除其余
CREATE OR REPLACE FUNCTION public.dedupe_keywords()
RETURNS TABLE(merged_count int, deleted_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merged int := 0;
  v_deleted int := 0;
BEGIN
  -- 先把所有 keyword 规范化到统一形态
  UPDATE public.keywords
  SET keyword = public.normalize_keyword(keyword)
  WHERE keyword IS DISTINCT FROM public.normalize_keyword(keyword);

  -- 删除规范化后变空的行
  DELETE FROM public.keywords WHERE keyword IS NULL OR length(keyword) = 0;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 合并同名：保留最早创建的一行，累加 usage_count
  WITH ranked AS (
    SELECT id, keyword,
           row_number() OVER (PARTITION BY keyword ORDER BY created_at, id) AS rn,
           sum(usage_count) OVER (PARTITION BY keyword) AS total_usage
    FROM public.keywords
  ),
  keepers AS (
    SELECT id, total_usage FROM ranked WHERE rn = 1
  ),
  losers AS (
    SELECT id FROM ranked WHERE rn > 1
  ),
  upd AS (
    UPDATE public.keywords k
    SET usage_count = ke.total_usage
    FROM keepers ke
    WHERE k.id = ke.id AND k.usage_count IS DISTINCT FROM ke.total_usage
    RETURNING 1
  ),
  del AS (
    DELETE FROM public.keywords WHERE id IN (SELECT id FROM losers)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM upd)::int, (SELECT count(*) FROM del)::int
  INTO v_merged, v_deleted;

  RETURN QUERY SELECT v_merged, v_deleted;
END;
$$;

-- 2b. 立即执行一次，确保当前数据满足后续唯一索引
SELECT public.dedupe_keywords();

-- 3. 加唯一索引，从根源上禁止重复
CREATE UNIQUE INDEX IF NOT EXISTS keywords_keyword_unique
  ON public.keywords (keyword);

-- 4. 触发器：在 INSERT / UPDATE 时自动规范化 + 拦截空值 + 合并同名
CREATE OR REPLACE FUNCTION public.keywords_normalize_and_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_new_kw text;
BEGIN
  v_new_kw := public.normalize_keyword(NEW.keyword);

  -- 空字符串：拒绝写入
  IF v_new_kw IS NULL THEN
    RETURN NULL;  -- 静默丢弃；如需报错改成 RAISE EXCEPTION
  END IF;

  NEW.keyword := v_new_kw;

  -- 检查是否已存在同名关键词
  SELECT id INTO v_existing_id
  FROM public.keywords
  WHERE keyword = v_new_kw
    AND (TG_OP = 'INSERT' OR id <> NEW.id)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- 已存在 → 合并 usage_count 到现有行，并阻断本次写入
    UPDATE public.keywords
    SET usage_count = usage_count + COALESCE(NEW.usage_count, 0),
        active = active OR COALESCE(NEW.active, true),
        updated_at = now()
    WHERE id = v_existing_id;

    IF TG_OP = 'UPDATE' THEN
      -- UPDATE 改名撞车：删除当前行（已合并到 existing）
      DELETE FROM public.keywords WHERE id = NEW.id;
      RETURN NULL;
    END IF;

    RETURN NULL;  -- INSERT 撞车：阻断
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keywords_normalize ON public.keywords;
CREATE TRIGGER trg_keywords_normalize
BEFORE INSERT OR UPDATE OF keyword, usage_count, active ON public.keywords
FOR EACH ROW
EXECUTE FUNCTION public.keywords_normalize_and_merge();

-- 5. 给管理员授权调用 dedupe_keywords()
REVOKE ALL ON FUNCTION public.dedupe_keywords() FROM public;
GRANT EXECUTE ON FUNCTION public.dedupe_keywords() TO authenticated;
