ALTER TABLE public.colleges REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.colleges;