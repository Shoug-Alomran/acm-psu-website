-- Keep the admin-triggered Members export consistent with the automatic
-- Members worksheet sync: this is the private people directory for all live
-- accounts, including faculty and staff without student membership records.
drop function public.export_members();

create function public.export_members()
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
     where public.is_club_admin()
       and u.deleted_at is null
     order by u.full_name;
$$;

revoke execute on function public.export_members() from anon;
grant execute on function public.export_members() to authenticated;
