-- ===========================================================================
-- 0060 — Public event registrations, mirrored into the platform.
--
-- Public event signups (Programming Jam, CTF) are collected by a Google Apps
-- Script that appends a row to its own registration workbook. That workbook is
-- the intake surface and stays the place the organizers work in.
--
-- The problem this fixes: those signups existed ONLY in Google. The admin
-- "Records backup" page reads Supabase, so the one dataset most likely to be
-- needed in a hurry — who registered for the event happening this week — was
-- the one dataset the backup could not show, and a Google outage or a deleted
-- sheet took it with no second copy.
--
-- So the Apps Script now also posts each accepted registration here, and an
-- admin can import what the sheet already holds. This table is a MIRROR, not
-- a source of truth: nothing here is written back to Google, and the Apps
-- Script never reads it. A failed mirror must never fail a registration, so
-- the copy is best-effort on that side and idempotent on this one.
--
-- Columns differ completely between events and a new event must not need a
-- migration, so a registration's answers live in jsonb keyed by the exact
-- worksheet heading. `event_registration_forms` records the heading order so
-- the backup page can render a row as the same table the organizers see.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The events that accept public registration.
--
-- `headers` is the worksheet's column order, and it is what the backup page
-- draws. It must match EVENT_SHEETS in apps-script/Code.gs — the Apps Script
-- already refuses to write when its worksheet disagrees with that list, so a
-- drift here shows up as a column the page renders empty rather than as a
-- silently mangled record.
-- ---------------------------------------------------------------------------
create table public.event_registration_forms (
    event_key   text primary key,
    label       text not null,
    headers     text[] not null,
    rank        integer not null default 100,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),

    constraint event_registration_forms_key_shape
        check (event_key ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
    constraint event_registration_forms_headers_present
        check (array_length(headers, 1) between 1 and 60)
);

comment on table public.event_registration_forms is
    'Public events that accept registration, and the worksheet column order '
    'each one is recorded in. Mirrors EVENT_SHEETS in apps-script/Code.gs.';

-- ---------------------------------------------------------------------------
-- One accepted registration.
--
-- `identity_hash` is what makes the mirror safe to run twice. It is derived
-- from the submitted values with the timestamp excluded, so the live mirror
-- and a later import of the same sheet row agree that they are the same
-- registration — the Apps Script already refuses duplicate participants, so
-- two identical answer sets are the same submission rather than two people.
-- ---------------------------------------------------------------------------
create table public.event_registrations (
    id             uuid primary key default gen_random_uuid(),
    event_key      text not null references public.event_registration_forms (event_key)
                       on delete restrict,

    -- When the registration was accepted: the worksheet Timestamp on import,
    -- the moment of submission when mirrored live.
    registered_at  timestamptz not null,

    -- Heading -> submitted value, exactly as written to the worksheet cell.
    fields         jsonb not null,

    -- The front-end's correlation id, when the registration was mirrored
    -- live. Null for rows recovered from the worksheet, which carry none.
    request_id     text,

    identity_hash  text not null,

    -- 'apps_script' for a live mirror, 'sheet_import' for a recovered row.
    source         text not null,

    created_at     timestamptz not null default now(),

    constraint event_registrations_fields_object check (jsonb_typeof(fields) = 'object'),
    constraint event_registrations_request_shape
        check (request_id is null or request_id ~ '^[a-f0-9]{32}$'),
    constraint event_registrations_source_known
        check (source in ('apps_script', 'sheet_import')),
    constraint event_registrations_hash_shape check (identity_hash ~ '^[a-f0-9]{64}$'),

    -- The idempotency guarantee. Re-posting a mirror or re-running an import
    -- updates nothing and inserts nothing.
    constraint event_registrations_unique_submission unique (event_key, identity_hash)
);

create index event_registrations_event_idx
    on public.event_registrations (event_key, registered_at desc);

comment on table public.event_registrations is
    'Mirror of public event signups collected by the Apps Script registration '
    'workbook. Never written back to Google; exists so the records backup can '
    'show registrations when Google is unavailable.';

comment on column public.event_registrations.identity_hash is
    'SHA-256 over the submitted values excluding the timestamp. Makes the live '
    'mirror and a later worksheet import idempotent against each other.';

-- ---------------------------------------------------------------------------
-- Access.
--
-- Registrations carry student identifiers and phone numbers for people who
-- may not be club members and never signed into this platform, so they are
-- readable by the same audience as the rest of the records backup and by
-- nobody else. There is no anon policy and no member policy at all.
--
-- Writes have no policy either: both the live mirror and the import run in the
-- event-registration-intake Edge Function under the service role, which
-- bypasses RLS. Nothing reachable with a browser key can insert here.
-- ---------------------------------------------------------------------------
alter table public.event_registration_forms enable row level security;
alter table public.event_registrations      enable row level security;

create policy event_registration_forms_select_staff on public.event_registration_forms
    for select to authenticated
    using (public.is_club_admin() or public.is_advisory_instructor());

create policy event_registration_forms_write_admin on public.event_registration_forms
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy event_registrations_select_staff on public.event_registrations
    for select to authenticated
    using (public.is_club_admin() or public.is_advisory_instructor());

-- Correcting or removing a mirrored row stays possible for an admin; there is
-- deliberately no INSERT path outside the Edge Function.
create policy event_registrations_amend_admin on public.event_registrations
    for update to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy event_registrations_remove_admin on public.event_registrations
    for delete to authenticated using (public.is_club_admin());

-- RLS decides which rows; these grant the privilege to ask at all. Migration
-- 0017a granted the tables that existed then, so a new table states its own.
grant select, update, delete on public.event_registrations to authenticated;
grant select, insert, update, delete on public.event_registration_forms to authenticated;

-- The records sync and the intake function both read as the service role.
grant select on public.event_registration_forms to service_role;
grant select, insert on public.event_registrations to service_role;

-- ---------------------------------------------------------------------------
-- The two events currently accepting registration. Headings are copied from
-- EVENT_SHEETS in apps-script/Code.gs and must stay identical to it.
-- ---------------------------------------------------------------------------
insert into public.event_registration_forms (event_key, label, headers, rank) values
    ('ctf30', 'CTF 3.0', array[
        'Timestamp', 'Team Name',
        'Captain Name', 'Captain University ID', 'Captain University Email',
        'Captain Phone Number', 'Captain Major',
        'Member 2 Name', 'Member 2 University ID', 'Member 2 University Email', 'Member 2 Major',
        'Member 3 Name', 'Member 3 University ID', 'Member 3 University Email', 'Member 3 Major',
        'Experience Level'], 10),
    ('jam26', 'Programming Jam 2026', array[
        'Timestamp', 'Full Name', 'University ID', 'University Email',
        'Phone Number', 'Major', 'Team Name', 'Team Members'], 20);
