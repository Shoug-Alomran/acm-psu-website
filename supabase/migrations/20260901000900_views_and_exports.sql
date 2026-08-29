-- ===========================================================================
-- 0009 — Derived views and the university export ledger.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Member statistics. Every dashboard number is computed here from stored rows,
-- so no displayed count can drift away from the records behind it.
-- ---------------------------------------------------------------------------
create view public.member_stats
with (security_invoker = true) as
select
    u.id as user_id,
    (select count(*) from public.participations p
      where p.user_id = u.id and p.verified_at is not null)                as events_count,
    (select count(distinct c.project_id) from public.contributions c
      where c.user_id = u.id and c.status = 'approved'
        and c.project_id is not null and c.deleted_at is null)             as projects_count,
    (select count(*) from public.contributions c
      where c.user_id = u.id and c.status = 'approved' and c.deleted_at is null
        and c.type_slug in ('workshop-development', 'workshop-presenter'))  as workshops_count,
    (select count(*) from public.contributions c
      where c.user_id = u.id and c.status = 'approved' and c.deleted_at is null)
                                                                           as verified_contributions,
    (select count(*) from public.archive_submissions s
      where s.submitted_by = u.id)                                         as submissions_count,
    (select count(*) from public.position_history ph
      where ph.user_id = u.id)                                             as positions_held
from public.app_users u;

comment on view public.member_stats is
    'Dashboard counters. Only add a column here if it can be derived from '
    'stored records — never surface a number the archive cannot justify.';

-- ---------------------------------------------------------------------------
-- The public roster. This is what the website reads.
--
-- A member appears here only when all of the following hold: they chose to be
-- public, their membership is a standing worth showing, and their account is
-- live. The filtering happens in the view, not in the browser.
-- ---------------------------------------------------------------------------
create view public.public_member_directory
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
    cp.category         as position_category
from public.app_users u
join public.member_profiles p on p.user_id = u.id
join public.memberships m     on m.user_id = u.id
left join public.current_positions cp on cp.user_id = u.id
where p.visibility = 'public'
  and m.status in ('active', 'alumni')
  and u.account_state = 'active'
  and u.deleted_at is null;

comment on view public.public_member_directory is
    'security_invoker = false on purpose: this view IS the public contract. It '
    'exposes only opted-in members and deliberately omits email and student ID.';

-- The public roster carries no contact details. Confirm that by construction:
-- if someone later adds u.email or u.student_id here, this comment and the
-- grant below are the reminder that it becomes world-readable.
grant select on public.public_member_directory to anon, authenticated;

-- Public position history for people who are publicly listed.
--
-- This view runs as owner and has no WHERE clause of its own. THE INNER JOIN
-- IS THE GUARD: a row survives only if that person is in
-- public_member_directory, which already requires visibility = 'public', an
-- active or alumni membership, and a live account. Replace that join with a
-- LEFT JOIN and every member's position history becomes world-readable.
--
-- Columns are titles and dates only — no email, no student ID.
create view public.public_position_history
with (security_invoker = false) as
select
    ph.user_id,
    ph.title_snapshot as title,
    ph.started_on,
    ph.ended_on,
    ph.chapter_year
from public.position_history ph
join public.public_member_directory d on d.user_id = ph.user_id;

grant select on public.public_position_history to anon, authenticated;

-- ---------------------------------------------------------------------------
-- University records.
--
-- These views are the ONLY shape in which member data leaves the platform for
-- the university. They carry what the university asks for and nothing else:
-- no bio, no GitHub, no LinkedIn, no portfolio, no privacy preference.
--
-- They are NOT granted to anon or authenticated. Access is via RLS-protected
-- security-definer functions below, which check for an admin first.
-- ---------------------------------------------------------------------------
create or replace function public.export_members()
returns table (
    full_name        text,
    student_id       text,
    psu_email        text,
    major            text,
    academic_year    text,
    position_title   text,
    membership_status text,
    join_date        date
)
language sql
stable
security definer
set search_path = public
as $$
    select
        u.full_name,
        u.student_id,
        u.email::text,
        u.major,
        p.academic_year,
        cp.title,
        m.status::text,
        m.started_on
    from public.app_users u
    join public.memberships m on m.user_id = u.id
    left join public.member_profiles p on p.user_id = u.id
    left join public.current_positions cp on cp.user_id = u.id
    where public.is_club_admin()          -- no admin, no rows
      and u.deleted_at is null
      and m.status <> 'applicant'
    order by u.full_name;
$$;

create or replace function public.export_event_participation()
returns table (
    student_id     text,
    member_name    text,
    event_title    text,
    role_text      text,
    status         text,
    participated_on date
)
language sql
stable
security definer
set search_path = public
as $$
    select
        u.student_id,
        u.full_name,
        pr.title,
        pa.role_text,
        pa.status::text,
        coalesce(pa.started_on, pr.starts_on)
    from public.participations pa
    join public.app_users u on u.id = pa.user_id
    join public.projects pr on pr.id = pa.project_id
    where public.is_club_admin()
      and u.deleted_at is null
    order by pr.starts_on desc nulls last, u.full_name;
$$;

create or replace function public.export_contributions()
returns table (
    student_id      text,
    member_name     text,
    project_title   text,
    contribution    text,
    contribution_type text,
    occurred_on     date,
    verification    text
)
language sql
stable
security definer
set search_path = public
as $$
    select
        u.student_id,
        u.full_name,
        pr.title,
        c.title,
        ct.label,
        c.occurred_on,
        c.status::text
    from public.contributions c
    join public.app_users u on u.id = c.user_id
    left join public.projects pr on pr.id = c.project_id
    left join public.contribution_types ct on ct.slug = c.type_slug
    where public.is_club_admin()
      and c.deleted_at is null
      and u.deleted_at is null
    order by c.occurred_on desc nulls last, u.full_name;
$$;

revoke execute on function public.export_members()            from anon;
revoke execute on function public.export_event_participation() from anon;
revoke execute on function public.export_contributions()      from anon;

-- ---------------------------------------------------------------------------
-- A record of every export that was generated, because handing student data to
-- the university is exactly the kind of action a successor needs to be able to
-- account for.
-- ---------------------------------------------------------------------------
create table public.university_exports (
    id            uuid primary key default gen_random_uuid(),
    dataset       text not null,          -- 'members' | 'participation' | 'contributions'
    format        text not null,          -- 'csv' | 'xlsx' | 'google_sheet'
    row_count     integer not null default 0,
    destination   text,                   -- sheet URL, when pushed to Google
    params        jsonb not null default '{}'::jsonb,
    generated_by  uuid references public.app_users (id),
    created_at    timestamptz not null default now()
);

create index university_exports_created_idx on public.university_exports (created_at desc);
