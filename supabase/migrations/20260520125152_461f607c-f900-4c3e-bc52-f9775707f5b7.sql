
-- Tighten read: non-super users see ONLY own-college data (not the template/NULL pool)
DROP POLICY IF EXISTS "rules read scoped"    ON public.rules;
DROP POLICY IF EXISTS "cases read scoped"    ON public.cases;
DROP POLICY IF EXISTS "keywords read scoped" ON public.keywords;

CREATE POLICY "rules read scoped" ON public.rules FOR SELECT TO authenticated
USING (is_super_admin(auth.uid()) OR college_id = current_user_college_id());

CREATE POLICY "cases read scoped" ON public.cases FOR SELECT TO authenticated
USING (is_super_admin(auth.uid()) OR college_id = current_user_college_id());

CREATE POLICY "keywords read scoped" ON public.keywords FOR SELECT TO authenticated
USING (is_super_admin(auth.uid()) OR college_id = current_user_college_id());
