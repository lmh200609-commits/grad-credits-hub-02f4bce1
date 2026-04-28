
-- Ensure pgcrypto extension exists for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================
-- Table: ai_providers (encrypted API key store)
-- ============================================================
CREATE TABLE public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor text NOT NULL,
  base_url text NOT NULL,
  api_key_encrypted text NOT NULL,
  api_key_last4 text NOT NULL DEFAULT '',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_providers admin select"
  ON public.ai_providers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_providers admin insert"
  ON public.ai_providers FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_providers admin update"
  ON public.ai_providers FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_providers admin delete"
  ON public.ai_providers FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_ai_providers_updated_at
  BEFORE UPDATE ON public.ai_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Table: ai_function_bindings (function -> provider + model)
-- ============================================================
CREATE TABLE public.ai_function_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_key text UNIQUE NOT NULL,
  provider_id uuid REFERENCES public.ai_providers(id) ON DELETE RESTRICT,
  model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.ai_function_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_function_bindings admin select"
  ON public.ai_function_bindings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_function_bindings admin insert"
  ON public.ai_function_bindings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_function_bindings admin update"
  ON public.ai_function_bindings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_function_bindings admin delete"
  ON public.ai_function_bindings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_ai_function_bindings_updated_at
  BEFORE UPDATE ON public.ai_function_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the 7 known function keys with NULL provider so they appear in the UI
INSERT INTO public.ai_function_bindings (function_key, model) VALUES
  ('evaluate-application',   'qwen3-vl-32b-thinking'),
  ('ai-parse-roster',        'qwen-plus'),
  ('ai-explain-import',      'qwen-turbo'),
  ('import-assistant-chat',  'qwen-turbo'),
  ('staff-ai-assistant',     'deepseek-chat'),
  ('ask-credit-assistant',   'deepseek-chat'),
  ('polish-answer',          'deepseek-chat')
ON CONFLICT (function_key) DO NOTHING;
