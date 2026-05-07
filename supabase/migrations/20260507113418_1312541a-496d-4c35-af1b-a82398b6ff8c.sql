
-- ============ submission_windows ============
CREATE TABLE public.submission_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  report_generated_at timestamptz,
  report_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_windows_time_chk CHECK (ends_at > starts_at)
);

CREATE INDEX idx_submission_windows_college ON public.submission_windows(college_id, active, starts_at, ends_at);

ALTER TABLE public.submission_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sw read all authenticated"
  ON public.submission_windows FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "sw college admin manage"
  ON public.submission_windows FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) AND college_id = current_user_college_id())
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND college_id = current_user_college_id());

CREATE POLICY "sw super_admin manage"
  ON public.submission_windows FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE TRIGGER trg_submission_windows_updated
  BEFORE UPDATE ON public.submission_windows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ submission_window_reports ============
CREATE TABLE public.submission_window_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid NOT NULL REFERENCES public.submission_windows(id) ON DELETE CASCADE,
  college_id uuid NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_path text,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_swr_window ON public.submission_window_reports(window_id, generated_at DESC);

ALTER TABLE public.submission_window_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swr college admin select"
  ON public.submission_window_reports FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) AND college_id = current_user_college_id());

CREATE POLICY "swr college admin insert"
  ON public.submission_window_reports FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND college_id = current_user_college_id());

CREATE POLICY "swr super_admin all"
  ON public.submission_window_reports FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- ============ 辅助函数 ============
CREATE OR REPLACE FUNCTION public.is_submission_open(_college uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.submission_windows
    WHERE college_id = _college
      AND active = true
      AND now() BETWEEN starts_at AND ends_at
  );
$$;

CREATE OR REPLACE FUNCTION public.current_open_window(_college uuid)
RETURNS TABLE(id uuid, name text, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, starts_at, ends_at
  FROM public.submission_windows
  WHERE college_id = _college
    AND active = true
    AND now() BETWEEN starts_at AND ends_at
  ORDER BY ends_at ASC
  LIMIT 1;
$$;

-- ============ 提交拦截触发器 ============
CREATE OR REPLACE FUNCTION public.enforce_submission_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_college uuid;
BEGIN
  -- 服务端 / 教师 / 管理员 / 超管 不受限
  IF v_caller IS NULL
     OR has_role(v_caller, 'teacher'::app_role)
     OR has_role(v_caller, 'admin'::app_role)
     OR is_super_admin(v_caller) THEN
    RETURN NEW;
  END IF;

  v_college := NEW.college_id;
  IF v_college IS NULL THEN
    SELECT college_id INTO v_college FROM public.profiles WHERE user_id = NEW.student_id LIMIT 1;
  END IF;

  IF v_college IS NULL THEN
    RAISE EXCEPTION '未配置所属学院，无法提交' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_submission_open(v_college) THEN
    RAISE EXCEPTION '当前不在开放提交时间内，请联系管理员' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- 注意：现有 applications_set_college 也是 BEFORE INSERT，先让它跑设好 college_id
CREATE TRIGGER trg_enforce_submission_window
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_submission_window();
