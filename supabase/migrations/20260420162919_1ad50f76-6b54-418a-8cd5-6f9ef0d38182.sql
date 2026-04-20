-- 1. 申请状态枚举
CREATE TYPE public.application_status AS ENUM (
  'pending_ai',
  'auto_approved',
  'pending_review',
  'rejected_by_ai',
  'approved',
  'rejected'
);

CREATE TYPE public.review_action AS ENUM (
  'ai_evaluation',
  'teacher_review',
  'admin_review'
);

-- 2. 规则库
CREATE TABLE public.rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  credit NUMERIC(5,2) NOT NULL DEFAULT 0,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rules_active ON public.rules(active);
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_rules_updated_at
BEFORE UPDATE ON public.rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. 案例库
CREATE TABLE public.cases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  rule_id UUID REFERENCES public.rules(id) ON DELETE SET NULL,
  awarded_credit NUMERIC(5,2),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_cases_updated_at
BEFORE UPDATE ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. 项目
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_ids UUID[] NOT NULL DEFAULT '{}',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_active ON public.projects(active);
CREATE INDEX idx_projects_created_by ON public.projects(created_by);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. 协作教师
CREATE TABLE public.project_collaborators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX idx_collab_user ON public.project_collaborators(user_id);
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- 5b. 安全函数：是否项目审核人（创建者 / 协作者 / 管理员）
CREATE OR REPLACE FUNCTION public.is_project_reviewer(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND created_by = _user_id)
    OR EXISTS (SELECT 1 FROM public.project_collaborators WHERE project_id = _project_id AND user_id = _user_id);
$$;

-- 6. 申请
CREATE TABLE public.applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  selected_keywords TEXT[] NOT NULL DEFAULT '{}',
  file_path TEXT,
  status public.application_status NOT NULL DEFAULT 'pending_ai',
  ai_matched_rule_id UUID REFERENCES public.rules(id) ON DELETE SET NULL,
  ai_suggested_credit NUMERIC(5,2),
  ai_confidence NUMERIC(4,3),
  ai_reasoning TEXT,
  final_credit NUMERIC(5,2),
  final_reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  final_review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_apps_project ON public.applications(project_id);
CREATE INDEX idx_apps_student ON public.applications(student_id);
CREATE INDEX idx_apps_status ON public.applications(status);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_applications_updated_at
BEFORE UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. 审核记录
CREATE TABLE public.application_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action public.review_action NOT NULL,
  decision public.application_status NOT NULL,
  credit NUMERIC(5,2),
  confidence NUMERIC(4,3),
  matched_rule_id UUID REFERENCES public.rules(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_app ON public.application_reviews(application_id);
ALTER TABLE public.application_reviews ENABLE ROW LEVEL SECURITY;

-- ============= RLS =============

-- rules
CREATE POLICY "rules read all authenticated"
ON public.rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "rules admin manage"
ON public.rules FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- cases
CREATE POLICY "cases read all authenticated"
ON public.cases FOR SELECT TO authenticated USING (true);
CREATE POLICY "cases admin manage"
ON public.cases FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- projects: 全员可读激活项目；管理员可读全部；创建者+协作者+管理员可改
CREATE POLICY "projects read active"
ON public.projects FOR SELECT TO authenticated
USING (
  active = true
  OR created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.project_collaborators c WHERE c.project_id = projects.id AND c.user_id = auth.uid())
);
CREATE POLICY "projects insert by teacher or admin"
ON public.projects FOR INSERT TO authenticated
WITH CHECK (
  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'teacher'))
  AND created_by = auth.uid()
);
CREATE POLICY "projects update by reviewer"
ON public.projects FOR UPDATE TO authenticated
USING (public.is_project_reviewer(id, auth.uid()));
CREATE POLICY "projects delete by creator or admin"
ON public.projects FOR DELETE TO authenticated
USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- project_collaborators
CREATE POLICY "collab read self or reviewer"
ON public.project_collaborators FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_project_reviewer(project_id, auth.uid()));
CREATE POLICY "collab manage by creator or admin"
ON public.project_collaborators FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
);

-- applications
CREATE POLICY "apps student read own"
ON public.applications FOR SELECT TO authenticated
USING (student_id = auth.uid() OR public.is_project_reviewer(project_id, auth.uid()));
CREATE POLICY "apps student insert own"
ON public.applications FOR INSERT TO authenticated
WITH CHECK (student_id = auth.uid() AND public.has_role(auth.uid(), 'student'));
CREATE POLICY "apps student update own pending"
ON public.applications FOR UPDATE TO authenticated
USING (student_id = auth.uid() AND status IN ('pending_ai','pending_review','rejected_by_ai'));
CREATE POLICY "apps reviewer update"
ON public.applications FOR UPDATE TO authenticated
USING (public.is_project_reviewer(project_id, auth.uid()));
CREATE POLICY "apps student delete own pending"
ON public.applications FOR DELETE TO authenticated
USING (student_id = auth.uid() AND status = 'pending_ai');

-- reviews
CREATE POLICY "reviews read related"
ON public.application_reviews FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.id = application_id
      AND (a.student_id = auth.uid() OR public.is_project_reviewer(a.project_id, auth.uid()))
  )
);
CREATE POLICY "reviews insert by reviewer"
ON public.application_reviews FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.id = application_id
      AND public.is_project_reviewer(a.project_id, auth.uid())
  )
);

-- ============= Storage =============
INSERT INTO storage.buckets (id, name, public)
VALUES ('application-files', 'application-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "app files student upload own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
CREATE POLICY "app files student read own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-files'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'teacher')
  )
);
CREATE POLICY "app files student delete own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);