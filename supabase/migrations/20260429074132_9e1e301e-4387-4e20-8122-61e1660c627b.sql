-- Delete all non-admin users (students + teachers test accounts)
DELETE FROM auth.users
WHERE id IN (
  SELECT u.id
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id AND ur.role = 'admin'
  )
);