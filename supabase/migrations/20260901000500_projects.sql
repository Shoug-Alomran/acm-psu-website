-- ===========================================================================
-- 0005 — Projects, events, and event opportunities.
--
-- Design note: the requirements list Project and Event as separate entities.
-- In practice every ACM initiative is both — CTF 2.0 is an event that produced
-- a workshop archive; the website is a project with organizers. Two tables
-- would mean duplicating organizers, archive folders, participation and
-- opportunities on both sides. So there is ONE table with a `kind` column.
-- Anything that needs "events only" filters on kind = 'event'.
-- ===========================================================================

create table public.projects (
    id           uuid primary key default gen_random_uuid(),
    slug         text not null unique,
    title        text not null,
    title_ar     text,
    kind         project_kind   not null default 'event',
    status       project_status not null default 'planning',
    summary      text,
    description  text,
    starts_on    date,
    ends_on      date,
    chapter_year text,
    -- Where the public site already has a hand-built page for this project.
    site_path    text,
    external_url text,
    repo_url     text,
    cover_path   text,
    visibility   content_visibility not null default 'internal',
    sort_index   integer not null default 100,
    -- Free-form categorisation matching the public filter tabs.
    category     text,
    created_by   uuid references public.app_users (id),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    deleted_at   timestamptz,

    constraint projects_dates_ordered check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index projects_visibility_idx on public.projects (visibility, status) where deleted_at is null;
create index projects_chapter_idx    on public.projects (chapter_year);

create trigger projects_touch
    before update on public.projects
    for each row execute function public.touch_updated_at();

comment on column public.projects.site_path is
    'Path to a hand-authored page on the public site, e.g. /ctf-project.html. '
    'Lets the database-backed archive link to pages that predate it.';

-- ---------------------------------------------------------------------------
-- Who ran it. Official record — admin-managed.
-- ---------------------------------------------------------------------------
create table public.project_organizers (
    id         uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id    uuid not null references public.app_users (id) on delete cascade,
    role_text  text not null default 'Organizer',
    is_lead    boolean not null default false,
    added_by   uuid references public.app_users (id),
    created_at timestamptz not null default now(),

    unique (project_id, user_id, role_text)
);

create index project_organizers_user_idx on public.project_organizers (user_id);

-- ---------------------------------------------------------------------------
-- Event opportunities — open roles members can put their name forward for.
--
-- This is the mechanism that makes opportunity visible to everyone rather than
-- circulating privately, which is the whole point of the platform.
-- ---------------------------------------------------------------------------
create table public.event_positions (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects (id) on delete cascade,
    title       text not null,               -- 'Workshop Assistant'
    description text,
    openings    integer not null default 1,
    is_open     boolean not null default true,
    closes_on   date,
    created_by  uuid references public.app_users (id),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint event_positions_openings_positive check (openings > 0)
);

create index event_positions_project_idx on public.event_positions (project_id, is_open);

create trigger event_positions_touch
    before update on public.event_positions
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A member registering interest. Kept to the minimum a decision needs.
-- ---------------------------------------------------------------------------
create table public.event_position_applications (
    id                uuid primary key default gen_random_uuid(),
    event_position_id uuid not null references public.event_positions (id) on delete cascade,
    user_id           uuid not null references public.app_users (id) on delete cascade,
    availability      text,
    note              text,
    status            request_status not null default 'pending',
    admin_note        text,
    decided_by        uuid references public.app_users (id),
    decided_at        timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    unique (event_position_id, user_id),
    constraint event_position_applications_note_length
        check (note is null or char_length(note) <= 800)
);

create index event_position_applications_status_idx
    on public.event_position_applications (status, created_at);

create trigger event_position_applications_touch
    before update on public.event_position_applications
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Participation — the verified record of who actually took part.
-- ---------------------------------------------------------------------------
create table public.participations (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references public.app_users (id) on delete cascade,
    project_id        uuid not null references public.projects (id) on delete cascade,
    event_position_id uuid references public.event_positions (id) on delete set null,
    role_text         text not null default 'Participant',
    status            participation_status not null default 'confirmed',
    started_on        date,
    ended_on          date,
    note              text,
    -- Verified means an admin has confirmed it counts on the official record.
    verified_at       timestamptz,
    verified_by       uuid references public.app_users (id),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    unique (user_id, project_id, role_text)
);

create index participations_user_idx    on public.participations (user_id);
create index participations_project_idx on public.participations (project_id);

create trigger participations_touch
    before update on public.participations
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Live count of accepted people per opening, so the portal can show
-- "3 of 4 filled" without the browser counting rows it may not be able to see.
-- ---------------------------------------------------------------------------
-- Capacity, counted across everyone, shown only to people entitled to see it.
--
-- WHY IT RUNS AS OWNER. A member's RLS on event_position_applications
-- restricts them to their own rows. Under security_invoker = true the counts
-- below would be computed over that member's own applications only, so every
-- role would read as completely open, "FULL" would never appear, and members
-- would register for positions already filled — discovering it only when an
-- admin's approval failed.
--
-- WHAT THAT COSTS, AND HOW IT IS PAID. Running as owner means the underlying
-- policies no longer gate this view, so THE WHERE CLAUSE BELOW IS THIS VIEW'S
-- AUTHORIZATION. It repeats the predicate from the event_positions SELECT
-- policy, so the rows a caller sees here are exactly the rows they could see
-- on the table itself. Without it, Supabase's default privileges would let an
-- anonymous visitor enumerate every event role — including unannounced ones on
-- internal projects — together with its staffing.
--
-- Only aggregates cross the boundary from event_position_applications:
-- count(a.id), never a.user_id, a.availability, a.note or a.admin_note. No
-- applicant identity, email, student ID or application content is reachable
-- through this view.
--
-- If you add a column here, ask first whether it is an aggregate. If it names
-- a person, it does not belong.
create view public.event_position_availability
with (security_invoker = false) as
select
    ep.id            as event_position_id,
    ep.project_id,
    ep.title,
    ep.description,
    ep.openings,
    ep.is_open,
    ep.closes_on,
    count(a.id) filter (where a.status = 'approved') as filled,
    greatest(ep.openings - count(a.id) filter (where a.status = 'approved'), 0) as remaining,
    count(a.id) filter (where a.status = 'pending')  as pending
from public.event_positions ep
left join public.event_position_applications a on a.event_position_id = ep.id
where public.is_active_member() or public.is_staff()
group by ep.id;

-- Belt as well as braces: no anonymous role should hold SELECT here at all.
revoke all on public.event_position_availability from anon;
grant select on public.event_position_availability to authenticated;

-- ---------------------------------------------------------------------------
-- Approving an event-position application.
--
-- Capacity is checked inside the transaction with the row locked, so two
-- admins approving simultaneously cannot overfill a role.
-- ---------------------------------------------------------------------------
create or replace function public.approve_event_position_application(
    request_id uuid,
    reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    req      record;
    pos      record;
    accepted integer;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may assign event positions.' using errcode = '42501';
    end if;

    select * into req from public.event_position_applications where id = request_id;
    if req is null then
        raise exception 'Request not found.';
    end if;

    select * into pos from public.event_positions where id = req.event_position_id for update;

    select count(*) into accepted
      from public.event_position_applications
     where event_position_id = req.event_position_id
       and status = 'approved'
       and id <> request_id;

    if accepted >= pos.openings then
        raise exception 'All % opening(s) for "%" are already filled.',
            pos.openings, pos.title;
    end if;

    perform public.audit_context(reason, null, 'approved', true, req.user_id);

    update public.event_position_applications
       set status = 'approved', admin_note = reason,
           decided_by = auth.uid(), decided_at = now()
     where id = request_id;

    -- Approved involvement becomes part of the member's verified record.
    insert into public.participations
        (user_id, project_id, event_position_id, role_text, status, verified_at, verified_by)
    values
        (req.user_id, pos.project_id, pos.id, pos.title, 'confirmed', now(), auth.uid())
    on conflict (user_id, project_id, role_text) do update
        set status = 'confirmed', verified_at = now(), verified_by = auth.uid();

    perform public.write_audit(
        action          => 'event_position.approved',
        category        => 'events',
        entity_type     => 'event_position_application',
        entity_id       => request_id::text,
        entity_label    => pos.title,
        decision        => 'approved',
        summary         => 'Assigned to ' || pos.title,
        reason          => reason,
        member_visible  => true,
        before_state    => jsonb_build_object('status', req.status),
        after_state     => jsonb_build_object('status', 'approved',
                                              'role', pos.title),
        related_project => pos.project_id,
        related_member  => req.user_id,
        related_request => request_id
    );
end;
$$;
