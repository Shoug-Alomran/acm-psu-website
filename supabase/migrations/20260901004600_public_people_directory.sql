-- Extend the public directory to first-class ACM instructors/staff.
-- Students still require an active/alumni membership. Instructors/staff may be
-- listed when they opt in publicly and hold a current ACM position.

create or replace view public.public_member_directory
with (security_invoker = false) as
select
    u.id as user_id,
    coalesce(nullif(p.display_name, ''), u.full_name) as name,
    coalesce(m.status, 'active'::public.membership_status) as status,
    m.member_no,
    m.chapter_year,
    m.started_on,
    p.bio,
    case when u.university_role = 'student' then p.academic_year else null end as academic_year,
    p.interests,
    p.linkedin_url,
    p.github_url,
    p.website_url,
    p.extra_links,
    p.avatar_path,
    case when u.university_role = 'student' then u.major else null end as major,
    cp.title as current_position,
    cp.rank as position_rank,
    cp.category as position_category,
    trim(both '-' from regexp_replace(lower(u.full_name), '[^a-z0-9]+', '-', 'g')) as person_slug
from public.app_users u
join public.member_profiles p on p.user_id = u.id
left join public.memberships m on m.user_id = u.id
left join public.current_positions cp on cp.user_id = u.id
where p.visibility = 'public'
  and u.account_state = 'active'
  and u.deleted_at is null
  and (
    (u.university_role = 'student' and m.status in ('active', 'alumni'))
    or
    (u.university_role in ('instructor', 'staff') and cp.user_id is not null)
  );

comment on view public.public_member_directory is
    'Public ACM people directory. Students require active/alumni membership; instructors/staff require a current ACM position. All people must explicitly opt in via profile visibility. Email and student ID are never exposed.';

grant select on public.public_member_directory to anon, authenticated;
