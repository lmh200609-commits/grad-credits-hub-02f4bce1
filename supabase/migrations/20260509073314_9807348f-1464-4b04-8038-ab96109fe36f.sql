create or replace function public.get_student_credit_ranking()
returns table (
  user_id uuid,
  full_name text,
  student_no text,
  department text,
  major text,
  class_name text,
  college_id uuid,
  approved_count bigint,
  total_credit numeric,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select
      auth.uid() as uid,
      public.is_super_admin(auth.uid()) as is_super,
      public.has_role(auth.uid(), 'admin'::app_role) as is_admin,
      public.has_role(auth.uid(), 'teacher'::app_role) as is_teacher,
      public.current_user_college_id() as cid
  ),
  students as (
    select p.user_id, p.full_name, p.student_no, p.department,
           p.major, p.class_name, p.college_id
    from public.profiles p
    join public.user_roles ur
      on ur.user_id = p.user_id and ur.role = 'student'::app_role
    cross join caller c
    where
      c.is_super
      or ((c.is_admin or c.is_teacher) and p.college_id is not distinct from c.cid)
  ),
  agg as (
    select a.student_id,
           count(*)::bigint as approved_count,
           coalesce(sum(coalesce(a.final_credit, a.ai_suggested_credit, 0)), 0)::numeric as total_credit
    from public.applications a
    where a.status in ('approved'::application_status, 'auto_approved'::application_status)
    group by a.student_id
  )
  select
    s.user_id,
    s.full_name,
    s.student_no,
    s.department,
    s.major,
    s.class_name,
    s.college_id,
    coalesce(g.approved_count, 0) as approved_count,
    coalesce(g.total_credit, 0)::numeric as total_credit,
    rank() over (order by coalesce(g.total_credit, 0) desc) as rank
  from students s
  left join agg g on g.student_id = s.user_id
  order by rank asc, s.full_name asc;
$$;

grant execute on function public.get_student_credit_ranking() to authenticated;