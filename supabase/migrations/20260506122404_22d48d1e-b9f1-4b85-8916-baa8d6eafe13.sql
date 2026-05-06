
DO $$
DECLARE
  v_uid uuid := '3a49e97f-635e-488f-806b-a08e0ea6f04c';
BEGIN
  UPDATE auth.users
  SET email = '13647488835@admin.local',
      encrypted_password = extensions.crypt('87654321', extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = v_uid;

  UPDATE public.profiles
  SET email = '13647488835@admin.local'
  WHERE user_id = v_uid;
END $$;
