-- The private Members worksheet is the chapter's people directory, not only a
-- list of approved student memberships. Include every live account so faculty
-- advisors and other non-student affiliates are visible too. Student-only
-- columns remain null for people to whom they do not apply.
-- PostgreSQL cannot replace a function when its OUT row gains a column.
drop function public.export_members_for_sheet_sync();

create function public.export_members_for_sheet_sync()
returns table (
    full_name text,
    university_role text,
    student_id text,
    psu_email text,
    major text,
    academic_year text,
    position_title text,
    membership_status text,
    join_date date
)
language sql
stable
security definer
set search_path = public
as $$
    select u.full_name,
           u.university_role,
           u.student_id,
           u.email::text,
           u.major,
           p.academic_year,
           cp.title,
           m.status::text,
           m.started_on
      from public.app_users u
      left join public.memberships m on m.user_id = u.id
      left join public.member_profiles p on p.user_id = u.id
      left join public.current_positions cp on cp.user_id = u.id
     where u.deleted_at is null
     order by u.full_name;
$$;

revoke all on function public.export_members_for_sheet_sync() from public, anon, authenticated;
grant execute on function public.export_members_for_sheet_sync() to service_role;
