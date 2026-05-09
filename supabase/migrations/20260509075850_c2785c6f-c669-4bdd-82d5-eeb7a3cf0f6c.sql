-- Restrict ai_providers and ai_function_bindings to super_admin only
DROP POLICY IF EXISTS "ai_providers admin delete" ON public.ai_providers;
DROP POLICY IF EXISTS "ai_providers admin insert" ON public.ai_providers;
DROP POLICY IF EXISTS "ai_providers admin select" ON public.ai_providers;
DROP POLICY IF EXISTS "ai_providers admin update" ON public.ai_providers;

CREATE POLICY "ai_providers super_admin all"
ON public.ai_providers
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "ai_function_bindings admin delete" ON public.ai_function_bindings;
DROP POLICY IF EXISTS "ai_function_bindings admin insert" ON public.ai_function_bindings;
DROP POLICY IF EXISTS "ai_function_bindings admin select" ON public.ai_function_bindings;
DROP POLICY IF EXISTS "ai_function_bindings admin update" ON public.ai_function_bindings;

CREATE POLICY "ai_function_bindings super_admin all"
ON public.ai_function_bindings
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));