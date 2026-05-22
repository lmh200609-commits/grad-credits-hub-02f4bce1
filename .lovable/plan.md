# 后端数据库更新方案

## 背景

服务器版本停留在 2026-05-20 20:31（CST，对应 12:31 UTC）之前。检查 `supabase/migrations/` 后确认，此时间点之后仅有两个迁移文件：

1. `20260520124836_*.sql`（12:48 UTC ≈ 20:48 CST）—— 规则库/案例库/关键词三表的"总库 + 学院分库"分级改造（加 `college_id`、模板克隆函数、新建学院触发器、唯一索引、RLS 重写）
2. `20260520125152_*.sql`（12:51 UTC ≈ 20:51 CST）—— 收紧读策略：非超管只能看到自己学院数据，不再能看到 NULL 模板池

5月21–22日仅有前端改动（审计日志显示、关键词状态横排、AppLayout 等），无新增数据库迁移。

## 操作步骤

打开你自托管 Supabase 的 SQL Editor → New Query → 粘贴下方完整 SQL → Run。脚本全部使用 `IF EXISTS / IF NOT EXISTS / OR REPLACE`，可重复执行，幂等安全。

```sql
-- =====================================================================
-- 1) 规则/案例/关键词 增加 college_id（NULL = 总库模板）
-- =====================================================================
ALTER TABLE public.rules    ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE CASCADE;
ALTER TABLE public.cases    ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE CASCADE;
ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rules_college    ON public.rules(college_id);
CREATE INDEX IF NOT EXISTS idx_cases_college    ON public.cases(college_id);
CREATE INDEX IF NOT EXISTS idx_keywords_college ON public.keywords(college_id);

-- =====================================================================
-- 2) 模板克隆函数：把 college_id IS NULL 的总库克隆到指定学院
-- =====================================================================
CREATE OR REPLACE FUNCTION public.clone_template_to_college(_college uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF _college IS NULL THEN RETURN; END IF;

  SELECT EXISTS(SELECT 1 FROM public.rules    WHERE college_id = _college)
      OR EXISTS(SELECT 1 FROM public.cases    WHERE college_id = _college)
      OR EXISTS(SELECT 1 FROM public.keywords WHERE college_id = _college)
  INTO v_exists;
  IF v_exists THEN RETURN; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rule_map(old_id uuid, new_id uuid) ON COMMIT DROP;
  TRUNCATE _rule_map;

  WITH ins AS (
    INSERT INTO public.rules(
      college_id, name, category, identity, level, achievement, project,
      description, credit, keywords, active, created_by
    )
    SELECT _college, name, category, identity, level, achievement, project,
           description, credit, keywords, active, created_by
    FROM public.rules
    WHERE college_id IS NULL
    RETURNING id, name, coalesce(category,'') AS c, coalesce(identity,'') AS i,
              coalesce(level,'') AS l, coalesce(achievement,'') AS a, coalesce(project,'') AS p, credit
  ),
  src AS (
    SELECT id AS old_id, name, coalesce(category,'') AS c, coalesce(identity,'') AS i,
           coalesce(level,'') AS l, coalesce(achievement,'') AS a, coalesce(project,'') AS p, credit,
           row_number() OVER (PARTITION BY name, coalesce(category,''), coalesce(identity,''),
                              coalesce(level,''), coalesce(achievement,''), coalesce(project,''), credit
                              ORDER BY id) AS rn
    FROM public.rules WHERE college_id IS NULL
  ),
  dst AS (
    SELECT id AS new_id, name, c, i, l, a, p, credit,
           row_number() OVER (PARTITION BY name, c, i, l, a, p, credit ORDER BY id) AS rn
    FROM ins
  )
  INSERT INTO _rule_map(old_id, new_id)
  SELECT s.old_id, d.new_id
  FROM src s JOIN dst d
    ON s.name=d.name AND s.c=d.c AND s.i=d.i AND s.l=d.l AND s.a=d.a AND s.p=d.p AND s.credit=d.credit AND s.rn=d.rn;

  INSERT INTO public.cases(college_id, title, summary, rule_id, awarded_credit, notes, created_by)
  SELECT _college, c.title, c.summary, m.new_id, c.awarded_credit, c.notes, c.created_by
  FROM public.cases c
  LEFT JOIN _rule_map m ON m.old_id = c.rule_id
  WHERE c.college_id IS NULL;

  INSERT INTO public.keywords(college_id, keyword, category, source, usage_count, active, created_by)
  SELECT _college, keyword, category, source, usage_count, active, created_by
  FROM public.keywords
  WHERE college_id IS NULL
  ON CONFLICT DO NOTHING;
END $$;

-- =====================================================================
-- 3) keywords 唯一约束改为「按学院」分区
-- =====================================================================
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.keywords'::regclass AND contype='u'
  LOOP EXECUTE format('ALTER TABLE public.keywords DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;
DROP INDEX IF EXISTS public.keywords_keyword_key;
DROP INDEX IF EXISTS public.keywords_keyword_unique;

CREATE UNIQUE INDEX IF NOT EXISTS keywords_college_keyword_uniq
  ON public.keywords(college_id, keyword) WHERE college_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS keywords_template_keyword_uniq
  ON public.keywords(keyword) WHERE college_id IS NULL;

-- =====================================================================
-- 4) keywords 归一化合并触发函数：按学院作用域
-- =====================================================================
CREATE OR REPLACE FUNCTION public.keywords_normalize_and_merge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_new_kw text;
BEGIN
  v_new_kw := public.normalize_keyword(NEW.keyword);
  IF v_new_kw IS NULL THEN RETURN NULL; END IF;
  NEW.keyword := v_new_kw;

  SELECT id INTO v_existing_id
  FROM public.keywords
  WHERE keyword = v_new_kw
    AND college_id IS NOT DISTINCT FROM NEW.college_id
    AND (TG_OP = 'INSERT' OR id <> NEW.id)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.keywords
      SET usage_count = usage_count + COALESCE(NEW.usage_count,0),
          active = active OR COALESCE(NEW.active,true),
          updated_at = now()
    WHERE id = v_existing_id;
    IF TG_OP = 'UPDATE' THEN DELETE FROM public.keywords WHERE id = NEW.id; END IF;
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- 5) 回填：把总库克隆到所有现有学院
-- =====================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.colleges LOOP
    PERFORM public.clone_template_to_college(r.id);
  END LOOP;
END $$;

-- =====================================================================
-- 6) 新建学院自动克隆触发器
-- =====================================================================
CREATE OR REPLACE FUNCTION public.colleges_seed_libraries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.clone_template_to_college(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_colleges_seed_libraries ON public.colleges;
CREATE TRIGGER trg_colleges_seed_libraries
AFTER INSERT ON public.colleges
FOR EACH ROW EXECUTE FUNCTION public.colleges_seed_libraries();

-- =====================================================================
-- 7) RLS 重写：读 = 本学院（或超管）；写 = 本学院 admin 或超管
--    （已合并第二次迁移的"非超管不可见 NULL 模板"收紧策略）
-- =====================================================================
DROP POLICY IF EXISTS "rules read all authenticated"     ON public.rules;
DROP POLICY IF EXISTS "rules admin manage"               ON public.rules;
DROP POLICY IF EXISTS "rules read scoped"                ON public.rules;
DROP POLICY IF EXISTS "rules super_admin manage"         ON public.rules;
DROP POLICY IF EXISTS "rules admin manage own college"   ON public.rules;

DROP POLICY IF EXISTS "cases read all authenticated"     ON public.cases;
DROP POLICY IF EXISTS "cases admin manage"               ON public.cases;
DROP POLICY IF EXISTS "cases read scoped"                ON public.cases;
DROP POLICY IF EXISTS "cases super_admin manage"         ON public.cases;
DROP POLICY IF EXISTS "cases admin manage own college"   ON public.cases;

DROP POLICY IF EXISTS "keywords read all authenticated"  ON public.keywords;
DROP POLICY IF EXISTS "keywords admin manage"            ON public.keywords;
DROP POLICY IF EXISTS "keywords read scoped"             ON public.keywords;
DROP POLICY IF EXISTS "keywords super_admin manage"      ON public.keywords;
DROP POLICY IF EXISTS "keywords admin manage own college" ON public.keywords;

CREATE POLICY "rules read scoped" ON public.rules FOR SELECT TO authenticated
USING (is_super_admin(auth.uid()) OR college_id = current_user_college_id());
CREATE POLICY "rules super_admin manage" ON public.rules FOR ALL TO authenticated
USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "rules admin manage own college" ON public.rules FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id())
WITH CHECK (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id());

CREATE POLICY "cases read scoped" ON public.cases FOR SELECT TO authenticated
USING (is_super_admin(auth.uid()) OR college_id = current_user_college_id());
CREATE POLICY "cases super_admin manage" ON public.cases FOR ALL TO authenticated
USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "cases admin manage own college" ON public.cases FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id())
WITH CHECK (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id());

CREATE POLICY "keywords read scoped" ON public.keywords FOR SELECT TO authenticated
USING (is_super_admin(auth.uid()) OR college_id = current_user_college_id());
CREATE POLICY "keywords super_admin manage" ON public.keywords FOR ALL TO authenticated
USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "keywords admin manage own college" ON public.keywords FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id())
WITH CHECK (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id());
```

## 前端

前端无需我做改动 —— 你按计划在新 GitHub 仓库 `npm run build` 出 `dist/` 后上传到自托管服务器即可。前端会读取 `.env`（`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PROJECT_ID`），确保打包前 `.env` 指向的是你自托管 Supabase 实例。

## 注意事项

- 执行前建议先在 Supabase Dashboard 备份 `rules / cases / keywords` 三张表（导出 CSV 或 `pg_dump`）。
- 脚本第 5 步会为现有每个学院克隆一份模板数据；若某学院已有数据，会自动跳过，不会重复写入。
- Edge Functions（`audit-log` 等）会随项目自动部署，无需手工操作；若你的自托管也跑 Edge Functions，则需要将 `supabase/functions/` 目录一并部署。
