ALTER TABLE public.cases_backup_20260424 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules_backup_20260424 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_types_backup_20260424 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_library_backup_20260424 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keywords_backup_20260424 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read cases backup" ON public.cases_backup_20260424
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins read rules backup" ON public.rules_backup_20260424
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins read cert backup" ON public.certificate_types_backup_20260424
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins read rule_lib backup" ON public.rule_library_backup_20260424
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins read keywords backup" ON public.keywords_backup_20260424
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));