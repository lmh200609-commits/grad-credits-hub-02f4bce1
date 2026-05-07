
-- 1) Remove sensitive tables from realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;
ALTER PUBLICATION supabase_realtime DROP TABLE public.submission_records;
ALTER PUBLICATION supabase_realtime DROP TABLE public.application_reviews;

-- 2) Explicit deny policies on submission_records (writes only via SECURITY DEFINER trigger)
CREATE POLICY "sub_rec deny client insert" ON public.submission_records
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "sub_rec deny client update" ON public.submission_records
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "sub_rec deny client delete" ON public.submission_records
  FOR DELETE TO authenticated USING (false);

-- 3) Explicit deny update/delete on application_reviews
CREATE POLICY "reviews deny update" ON public.application_reviews
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "reviews deny delete" ON public.application_reviews
  FOR DELETE TO authenticated USING (false);
