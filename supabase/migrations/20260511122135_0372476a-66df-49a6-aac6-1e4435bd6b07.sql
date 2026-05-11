
-- 1. Tighten student upload policy on application-files: prevent path traversal by requiring a single
--    folder segment (= caller uid) and a non-empty filename without any '/'.
DROP POLICY IF EXISTS "app files student upload own" ON storage.objects;
CREATE POLICY "app files student upload own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = (auth.uid())::text
  AND array_length(storage.foldername(name), 1) = 1
  AND position('/' in storage.filename(name)) = 0
  AND length(coalesce(storage.filename(name), '')) > 0
);

DROP POLICY IF EXISTS "app files student delete own" ON storage.objects;
CREATE POLICY "app files student delete own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'application-files'
  AND (storage.foldername(name))[1] = (auth.uid())::text
  AND array_length(storage.foldername(name), 1) = 1
);

-- 2. Realtime: scope staff subscriptions to applications:<student_id> only when the student belongs
--    to the same college as the staff caller; super_admin keeps full access.
DROP POLICY IF EXISTS "realtime authenticated read scoped" ON realtime.messages;
CREATE POLICY "realtime authenticated read scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- owner of the topic
  ((realtime.topic() LIKE 'applications:%') AND split_part(realtime.topic(), ':', 2) = (auth.uid())::text)
  OR public.is_super_admin(auth.uid())
  OR (
    (public.has_role(auth.uid(), 'teacher'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role))
    AND realtime.topic() LIKE 'applications:%'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id::text = split_part(realtime.topic(), ':', 2)
        AND ur.role = 'student'::public.app_role
        AND NOT (ur.college_id IS DISTINCT FROM public.current_user_college_id())
    )
  )
  OR (
    -- non-application topics (other channels) still permitted for staff (legacy behavior preserved)
    (realtime.topic() NOT LIKE 'applications:%')
    AND (public.has_role(auth.uid(), 'teacher'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.is_super_admin(auth.uid()))
  )
);

-- 3. Drop the broad "public read" policy on the college-badges bucket so anonymous clients
--    can no longer list files. Public file URLs (/storage/v1/object/public/college-badges/<file>)
--    still work because public-bucket downloads bypass RLS.
DROP POLICY IF EXISTS "college-badges public read" ON storage.objects;

-- 4. Revoke EXECUTE on SECURITY DEFINER functions from anon (and public) where they are not
--    intended to be called by unauthenticated clients. Authenticated role keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.can_manage_college_badge_object(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_aigc_jobs(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_aigc_detect_after_eval() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_credit_ranking() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_aigc_done(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_aigc_failed(uuid, text) FROM PUBLIC, anon;
