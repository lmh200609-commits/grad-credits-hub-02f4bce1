-- 1. 清空数据
DELETE FROM public.application_reviews;
DELETE FROM public.applications;

-- 2. 先 DROP 所有依赖 project_id 的旧策略
DROP POLICY IF EXISTS "apps reviewer update" ON public.applications;
DROP POLICY IF EXISTS "apps student read own" ON public.applications;
DROP POLICY IF EXISTS "apps student insert own" ON public.applications;
DROP POLICY IF EXISTS "apps student update own pending" ON public.applications;
DROP POLICY IF EXISTS "apps student delete own pending" ON public.applications;
DROP POLICY IF EXISTS "Teachers can view all applications" ON public.applications;
DROP POLICY IF EXISTS "reviews insert by reviewer" ON public.application_reviews;
DROP POLICY IF EXISTS "reviews read related" ON public.application_reviews;

-- 3. 现在可以安全 drop 列与表
ALTER TABLE public.applications DROP COLUMN IF EXISTS project_id;
DROP TABLE IF EXISTS public.project_collaborators CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP FUNCTION IF EXISTS public.is_project_reviewer(uuid, uuid);

-- 4. 重建 applications RLS
CREATE POLICY "apps student read own"
  ON public.applications FOR SELECT TO authenticated
  USING (student_id = auth.uid()
         OR public.has_role(auth.uid(), 'teacher')
         OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "apps student insert own"
  ON public.applications FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() AND public.has_role(auth.uid(), 'student'));

CREATE POLICY "apps student update own pending"
  ON public.applications FOR UPDATE TO authenticated
  USING (student_id = auth.uid()
         AND status IN ('pending_ai','pending_review','rejected_by_ai'));

CREATE POLICY "apps reviewer update"
  ON public.applications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "apps student delete own pending"
  ON public.applications FOR DELETE TO authenticated
  USING (student_id = auth.uid() AND status = 'pending_ai');

-- 5. 重建 application_reviews RLS
CREATE POLICY "reviews insert by reviewer"
  ON public.application_reviews FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'teacher') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "reviews read related"
  ON public.application_reviews FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_reviews.application_id
        AND (a.student_id = auth.uid()
             OR public.has_role(auth.uid(), 'teacher')
             OR public.has_role(auth.uid(), 'admin'))
    )
  );