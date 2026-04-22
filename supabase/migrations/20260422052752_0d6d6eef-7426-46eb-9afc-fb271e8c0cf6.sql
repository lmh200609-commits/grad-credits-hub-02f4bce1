CREATE TABLE public.keywords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  category TEXT,
  source TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT keywords_keyword_unique UNIQUE (keyword)
);

ALTER TABLE public.keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "keywords read all authenticated"
ON public.keywords
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "keywords admin manage"
ON public.keywords
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_keywords_updated_at
BEFORE UPDATE ON public.keywords
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_keywords_category ON public.keywords(category);
CREATE INDEX idx_keywords_active ON public.keywords(active);