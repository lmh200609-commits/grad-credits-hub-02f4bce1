CREATE OR REPLACE FUNCTION public.dashboard_stats(_college uuid DEFAULT NULL::uuid, _pass_threshold numeric DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kpi jsonb;
  v_status jsonb;
  v_pass jsonb;
  v_trend jsonb;
  v_dept jsonb;
  v_rule_count int;
  v_student_count int;
  v_teacher_count int;
BEGIN
  WITH a AS (
    SELECT status, final_credit, ai_suggested_credit
    FROM public.applications
    WHERE _college IS NULL OR college_id = _college
  )
  SELECT jsonb_build_object(
    'total', count(*)::int,
    'approved', count(*) FILTER (WHERE status IN ('approved','auto_approved'))::int,
    'pending', count(*) FILTER (WHERE status IN ('pending_ai','pending_review'))::int,
    'pending_ai', count(*) FILTER (WHERE status = 'pending_ai')::int,
    'pending_review', count(*) FILTER (WHERE status = 'pending_review')::int,
    'rejected', count(*) FILTER (WHERE status IN ('rejected','rejected_by_ai'))::int,
    'total_credit', coalesce(sum(coalesce(final_credit, ai_suggested_credit, 0))
                             FILTER (WHERE status IN ('approved','auto_approved')), 0)
  )
  INTO v_kpi FROM a;

  WITH a AS (
    SELECT status::text AS s
    FROM public.applications
    WHERE _college IS NULL OR college_id = _college
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', label, 'value', cnt) ORDER BY label), '[]'::jsonb)
  INTO v_status
  FROM (
    SELECT
      CASE s
        WHEN 'auto_approved' THEN '系统初审通过'
        WHEN 'rejected_by_ai' THEN '系统未通过'
        WHEN 'pending_review' THEN '待教师复核'
        WHEN 'approved' THEN '人工已通过'
        WHEN 'rejected' THEN '人工已驳回'
        WHEN 'pending_ai' THEN '系统核验中'
        ELSE s
      END AS label,
      count(*)::int AS cnt
    FROM a
    GROUP BY s
  ) t
  WHERE cnt > 0;

  WITH students AS (
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'student'
      AND (_college IS NULL OR ur.college_id = _college)
  ),
  credits AS (
    SELECT s.user_id,
      coalesce(sum(coalesce(a.final_credit, a.ai_suggested_credit, 0))
               FILTER (WHERE a.status IN ('approved','auto_approved')), 0) AS c
    FROM students s
    LEFT JOIN public.applications a
      ON a.student_id = s.user_id
     AND (_college IS NULL OR a.college_id = _college)
    GROUP BY s.user_id
  )
  SELECT jsonb_build_object(
    'pass', count(*) FILTER (WHERE c >= _pass_threshold)::int,
    'fail', count(*) FILTER (WHERE c < _pass_threshold)::int,
    'total', count(*)::int
  )
  INTO v_pass FROM credits;

  WITH days AS (
    SELECT generate_series(
      (now()::date - INTERVAL '13 day')::date,
      now()::date,
      '1 day'
    )::date AS d
  ),
  a AS (
    SELECT submitted_at::date AS d
    FROM public.applications
    WHERE submitted_at >= now() - INTERVAL '14 day'
      AND (_college IS NULL OR college_id = _college)
  )
  SELECT jsonb_agg(jsonb_build_object('date', to_char(days.d, 'MM-DD'), 'count', coalesce(c, 0)) ORDER BY days.d)
  INTO v_trend
  FROM days
  LEFT JOIN (SELECT d, count(*)::int AS c FROM a GROUP BY d) t ON t.d = days.d;

  WITH s AS (
    SELECT coalesce(NULLIF(p.department, ''), '未填写') AS dept
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id
    WHERE ur.role = 'student'
      AND (_college IS NULL OR ur.college_id = _college)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', dept, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb)
  INTO v_dept
  FROM (SELECT dept, count(*)::int AS cnt FROM s GROUP BY dept) t;

  SELECT count(*)::int INTO v_rule_count FROM public.rules WHERE active = true;
  SELECT count(*)::int INTO v_student_count
  FROM public.user_roles
  WHERE role = 'student' AND (_college IS NULL OR college_id = _college);
  SELECT count(*)::int INTO v_teacher_count
  FROM public.user_roles
  WHERE role = 'teacher' AND (_college IS NULL OR college_id = _college);

  RETURN jsonb_build_object(
    'kpi', v_kpi,
    'status', v_status,
    'pass', v_pass,
    'trend', v_trend,
    'dept', v_dept,
    'rule_count', v_rule_count,
    'student_count', v_student_count,
    'teacher_count', v_teacher_count
  );
END $function$;