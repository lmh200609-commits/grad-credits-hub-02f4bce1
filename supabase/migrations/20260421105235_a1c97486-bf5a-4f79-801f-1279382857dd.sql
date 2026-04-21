DELETE FROM auth.users WHERE id IN (
  SELECT user_id FROM public.profiles WHERE student_no LIKE 'TEST2026%'
);