-- 给 rules 增加四维结构化字段（保留 keywords 兼容旧数据）
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS project text,
  ADD COLUMN IF NOT EXISTS achievement text,
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS identity text;

CREATE INDEX IF NOT EXISTS idx_rules_dims ON public.rules (project, achievement, level, identity) WHERE active = true;

-- applications 增加自定义关键词
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS custom_keywords text[] NOT NULL DEFAULT '{}';