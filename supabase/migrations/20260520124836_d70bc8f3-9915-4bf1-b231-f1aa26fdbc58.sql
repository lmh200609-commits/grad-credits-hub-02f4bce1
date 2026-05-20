
-- 1) Add college_id (nullable: NULL = template/总库 owned by super_admin)
ALTER TABLE public.rules    ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE CASCADE;
ALTER TABLE public.cases    ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE CASCADE;
ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rules_college    ON public.rules(college_id);
CREATE INDEX IF NOT EXISTS idx_cases_college    ON public.cases(college_id);
CREATE INDEX IF NOT EXISTS idx_keywords_college ON public.keywords(college_id);

-- 2) Existing data = template (college_id stays NULL). Now copy template -> every existing college.
-- Use a helper function to clone the template (NULL) library into a target college.
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

  -- skip if already populated (any of the three tables has rows for this college)
  SELECT EXISTS(SELECT 1 FROM public.rules    WHERE college_id = _college)
      OR EXISTS(SELECT 1 FROM public.cases    WHERE college_id = _college)
      OR EXISTS(SELECT 1 FROM public.keywords WHERE college_id = _college)
  INTO v_exists;
  IF v_exists THEN RETURN; END IF;

  -- map old rule id -> new rule id (for cases.rule_id remap)
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

-- 3) Update keywords unique constraint to be per-college (template scope uses NULL)
-- Drop old unique on (keyword) if present
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.keywords'::regclass AND contype='u'
  LOOP EXECUTE format('ALTER TABLE public.keywords DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;
DROP INDEX IF EXISTS public.keywords_keyword_key;
DROP INDEX IF EXISTS public.keywords_keyword_unique;

-- partial unique indexes: per-college and template (NULL)
CREATE UNIQUE INDEX IF NOT EXISTS keywords_college_keyword_uniq
  ON public.keywords(college_id, keyword) WHERE college_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS keywords_template_keyword_uniq
  ON public.keywords(keyword) WHERE college_id IS NULL;

-- 4) Update keywords_normalize_and_merge trigger to be per-college scope
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

-- 5) Backfill: copy template -> every existing college
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.colleges LOOP
    PERFORM public.clone_template_to_college(r.id);
  END LOOP;
END $$;

-- 6) Auto-clone trigger on new college creation
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

-- 7) RLS rewrite: read = own-college OR template (NULL) OR super_admin
--    write = admin of that college; super_admin can manage template+any college
DROP POLICY IF EXISTS "rules read all authenticated"     ON public.rules;
DROP POLICY IF EXISTS "rules admin manage"               ON public.rules;
DROP POLICY IF EXISTS "cases read all authenticated"     ON public.cases;
DROP POLICY IF EXISTS "cases admin manage"               ON public.cases;
DROP POLICY IF EXISTS "keywords read all authenticated"  ON public.keywords;
DROP POLICY IF EXISTS "keywords admin manage"            ON public.keywords;

-- rules
CREATE POLICY "rules read scoped" ON public.rules FOR SELECT TO authenticated
USING (
  is_super_admin(auth.uid())
  OR college_id IS NULL
  OR college_id = current_user_college_id()
);
CREATE POLICY "rules super_admin manage" ON public.rules FOR ALL TO authenticated
USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "rules admin manage own college" ON public.rules FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id())
WITH CHECK (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id());

-- cases
CREATE POLICY "cases read scoped" ON public.cases FOR SELECT TO authenticated
USING (
  is_super_admin(auth.uid())
  OR college_id IS NULL
  OR college_id = current_user_college_id()
);
CREATE POLICY "cases super_admin manage" ON public.cases FOR ALL TO authenticated
USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "cases admin manage own college" ON public.cases FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id())
WITH CHECK (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id());

-- keywords
CREATE POLICY "keywords read scoped" ON public.keywords FOR SELECT TO authenticated
USING (
  is_super_admin(auth.uid())
  OR college_id IS NULL
  OR college_id = current_user_college_id()
);
CREATE POLICY "keywords super_admin manage" ON public.keywords FOR ALL TO authenticated
USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "keywords admin manage own college" ON public.keywords FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id())
WITH CHECK (has_role(auth.uid(),'admin'::app_role) AND college_id = current_user_college_id());
