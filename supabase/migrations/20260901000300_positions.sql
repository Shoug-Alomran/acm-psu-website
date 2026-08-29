-- ===========================================================================
-- 0003 — ACM positions and position history.
--
-- Positions are official records. A member may REQUEST one; only an admin may
-- grant one. Old positions are never overwritten — closing a position sets its
-- ended_on and a new row is opened, producing a readable progression:
--
--   Member              2024
--   Events Coordinator  2025
--   Vice President      2026
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The catalogue of positions the club offers. Editable by admins in the
-- portal, so a future committee can add roles without a migration.
-- ---------------------------------------------------------------------------
create table public.positions (
    id          uuid primary key default gen_random_uuid(),
    slug        text        not null unique,
    title       text        not null,
    title_ar    text,
    description text,
    -- Grouping for the admin UI: 'executive', 'lead', 'committee', 'general'.
    category    text        not null default 'general',
    -- Lower sorts first. Executive roles get small numbers so rosters order
    -- themselves without any hardcoded list of job titles.
    rank        integer     not null default 100,
    is_active   boolean     not null default true,
    archived_at timestamptz,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index positions_active_idx on public.positions (is_active, rank);

create trigger positions_touch
    before update on public.positions
    for each row execute function public.touch_updated_at();

comment on column public.positions.rank is
    'Display order. Executive roles use low numbers; never sort by title text.';

-- ---------------------------------------------------------------------------
-- Position history — the append-only record of who held what, when.
-- ---------------------------------------------------------------------------
create table public.position_history (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references public.app_users (id) on delete cascade,
    position_id    uuid references public.positions (id) on delete set null,
    -- The title as it was at the time. Kept even if the catalogue entry is
    -- later renamed or deleted, so history stays truthful.
    title_snapshot text not null,
    started_on     date not null,
    ended_on       date,
    chapter_year   text,
    note           text,
    granted_by     uuid references public.app_users (id),
    created_at     timestamptz not null default now(),

    constraint position_history_dates_ordered
        check (ended_on is null or ended_on >= started_on)
);

create index position_history_user_idx
    on public.position_history (user_id, started_on desc);

-- A person holds at most one open position at a time. Closing the previous one
-- is therefore a required, explicit step when granting a new one.
create unique index position_history_one_current
    on public.position_history (user_id)
    where ended_on is null;

comment on table public.position_history is
    'Append-only. To change someone''s position, close the open row and insert '
    'a new one — never UPDATE title_snapshot.';

-- ---------------------------------------------------------------------------
-- Member-initiated position change requests.
-- ---------------------------------------------------------------------------
create table public.position_change_requests (
    id                   uuid primary key default gen_random_uuid(),
    user_id              uuid not null references public.app_users (id) on delete cascade,
    -- Either pick from the catalogue, or describe a role that does not exist yet.
    requested_position_id uuid references public.positions (id) on delete set null,
    requested_title      text,
    reason               text,
    status               request_status not null default 'pending',
    -- Filled in by the admin on approval; may differ from what was requested.
    approved_position_id uuid references public.positions (id) on delete set null,
    effective_date       date,
    admin_note           text,
    decided_by           uuid references public.app_users (id),
    decided_at           timestamptz,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),

    constraint position_change_requests_target_present
        check (requested_position_id is not null or nullif(btrim(coalesce(requested_title, '')), '') is not null)
);

create index position_change_requests_status_idx
    on public.position_change_requests (status, created_at desc);

-- One open request per member keeps the queue meaningful.
create unique index position_change_requests_one_pending
    on public.position_change_requests (user_id)
    where status = 'pending';

create trigger position_change_requests_touch
    before update on public.position_change_requests
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Current position, resolved once so every query and view agrees.
-- ---------------------------------------------------------------------------
create view public.current_positions
with (security_invoker = true) as
select
    ph.user_id,
    ph.id            as position_history_id,
    ph.position_id,
    ph.title_snapshot as title,
    ph.started_on,
    ph.chapter_year,
    p.rank,
    p.category
from public.position_history ph
left join public.positions p on p.id = ph.position_id
where ph.ended_on is null;

comment on view public.current_positions is
    'One row per member with an open position. security_invoker means the '
    'caller''s RLS on position_history still applies.';

-- ---------------------------------------------------------------------------
-- Granting a position: close the old one and open a new one atomically.
-- Admin-only; used by the applications queue and the position request queue.
-- ---------------------------------------------------------------------------
create or replace function public.grant_position(
    target_user   uuid,
    new_position  uuid,
    effective_on  date default current_date,
    fallback_title text default null,
    reason        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    new_row_id     uuid;
    resolved_title text;
    previous_title text;
    -- When a parent function (an application approval, a position request)
    -- already established a context, it will write the headline entry and this
    -- one stays quiet. Called on its own, this writes its own record.
    nested boolean := public.audit_context_value('correlation') is not null;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may grant a position.'
            using errcode = '42501';
    end if;

    select title into resolved_title from public.positions where id = new_position;
    resolved_title := coalesce(resolved_title, fallback_title);

    if resolved_title is null then
        raise exception 'A position or a fallback title is required.';
    end if;

    select title_snapshot into previous_title
      from public.position_history
     where user_id = target_user and ended_on is null;

    if not nested then
        perform public.audit_context(reason, null, 'granted', true, target_user);
    end if;

    -- Close whatever is currently open. The day before the new start, so the
    -- two spans do not overlap; if they start the same day, close same-day.
    -- The old row is never rewritten beyond its end date — history is kept.
    update public.position_history
       set ended_on = greatest(started_on, effective_on - 1)
     where user_id = target_user
       and ended_on is null;

    insert into public.position_history
        (user_id, position_id, title_snapshot, started_on, chapter_year, note, granted_by)
    values (
        target_user,
        new_position,
        resolved_title,
        effective_on,
        public.current_chapter_year(),
        reason,
        auth.uid()
    )
    returning id into new_row_id;

    if not nested then
        perform public.write_audit(
            action         => 'position.granted',
            category       => 'positions',
            entity_type    => 'member',
            entity_id      => target_user::text,
            entity_label   => (select full_name from public.app_users where id = target_user),
            decision       => 'granted',
            summary        => coalesce(previous_title, 'No position') || ' → ' || resolved_title,
            reason         => reason,
            member_visible => true,
            before_state   => jsonb_build_object('position', coalesce(previous_title, 'none')),
            after_state    => jsonb_build_object('position', resolved_title,
                                                 'effective_from', effective_on),
            related_member => target_user,
            metadata       => jsonb_build_object('position_history_id', new_row_id,
                                                 'previous_preserved', true)
        );
    end if;

    return new_row_id;
end;
$$;
