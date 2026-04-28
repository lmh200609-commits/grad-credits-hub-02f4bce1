-- 1. profiles 新增字段
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS school text DEFAULT '长春财经学院',
  ADD COLUMN IF NOT EXISTS photo_url text;

-- 把现有 NULL 学校回填为默认值
UPDATE public.profiles SET school = '长春财经学院' WHERE school IS NULL;

-- 2. applications 新增字段
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS certificate_no text UNIQUE,
  ADD COLUMN IF NOT EXISTS certificate_issued_at timestamptz;

-- 3. 证书编号生成函数（security definer，内部校验权限）
CREATE OR REPLACE FUNCTION public.gen_certificate_no(_app_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year text := to_char(now(), 'YYYY');
  v_seq int;
  v_no text;
  v_student uuid;
  v_status text;
  v_caller uuid := auth.uid();
BEGIN
  SELECT student_id, status::text, certificate_no
    INTO v_student, v_status, v_no
  FROM public.applications WHERE id = _app_id;

  IF v_student IS NULL THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  IF v_caller IS NULL
     OR (v_caller <> v_student
         AND NOT public.has_role(v_caller, 'teacher'::app_role)
         AND NOT public.has_role(v_caller, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_no IS NOT NULL THEN
    RETURN v_no;
  END IF;

  IF v_status NOT IN ('approved', 'auto_approved') THEN
    RAISE EXCEPTION 'application not approved';
  END IF;

  SELECT count(*) + 1 INTO v_seq
  FROM public.applications
  WHERE certificate_no LIKE v_year || '-%';

  v_no := v_year || '-' || lpad(v_seq::text, 4, '0');

  UPDATE public.applications
     SET certificate_no = v_no,
         certificate_issued_at = now()
   WHERE id = _app_id;

  RETURN v_no;
END;
$$;

-- 4. Storage 策略：student-photos/{user_id}.xxx 子目录
DROP POLICY IF EXISTS "student photos: owner read"   ON storage.objects;
DROP POLICY IF EXISTS "student photos: owner write"  ON storage.objects;
DROP POLICY IF EXISTS "student photos: owner update" ON storage.objects;
DROP POLICY IF EXISTS "student photos: staff read"   ON storage.objects;

CREATE POLICY "student photos: owner read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = 'student-photos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "student photos: owner write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = 'student-photos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "student photos: owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = 'student-photos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "student photos: staff read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = 'student-photos'
  AND (public.has_role(auth.uid(), 'teacher'::app_role)
       OR public.has_role(auth.uid(), 'admin'::app_role))
);