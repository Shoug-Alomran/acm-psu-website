-- Complete the public profile contract without widening access to base tables.

create or replace view public.public_member_directory
with (security_invoker = false) as
select
    u.id                as user_id,
    coalesce(nullif(p.display_name, ''), u.full_name) as name,
    m.status,
    m.member_no,
    m.chapter_year,
    m.started_on,
    p.bio,
    p.academic_year,
    p.interests,
    p.linkedin_url,
    p.github_url,
    p.website_url,
    p.extra_links,
    p.avatar_path,
    u.major,
    cp.title            as current_position,
    cp.rank             as position_rank,
    cp.category         as position_category,
    trim(both '-' from regexp_replace(lower(u.full_name), '[^a-z0-9]+', '-', 'g'))
                         as person_slug
from public.app_users u
join public.member_profiles p on p.user_id = u.id
join public.memberships m     on m.user_id = u.id
left join public.current_positions cp on cp.user_id = u.id
where p.visibility = 'public'
  and m.status in ('active', 'alumni')
  and u.account_state = 'active'
  and u.deleted_at is null;

comment on view public.public_member_directory is
    'Public, owner-executed allow-list for opted-in active/alumni profiles. '
    'person_slug is derived from the account name, not the editable display name.';

grant select on public.public_member_directory to anon, authenticated;

-- Pronouns were never part of the product contract. Refuse to remove the
-- legacy column if a non-constraint database object unexpectedly depends on it.
do $$
declare
    dependency_count integer;
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'member_profiles'
          and column_name = 'pronouns'
    ) then
        select count(*) into dependency_count
        from pg_depend d
        join pg_attribute a
          on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'member_profiles'
          and a.attname = 'pronouns'
          and d.deptype not in ('a', 'i');

        if dependency_count > 0 then
            raise exception 'member_profiles.pronouns has % dependent object(s); inspect before dropping',
                dependency_count;
        end if;

        alter table public.member_profiles drop column pronouns;
    end if;
end $$;
