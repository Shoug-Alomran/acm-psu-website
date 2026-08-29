-- ===========================================================================
-- 0001 — Foundations: extensions, shared enums, utility triggers.
--
-- Naming conventions used throughout this schema:
--   *_id          foreign key
--   *_on          date        (calendar day, no time — membership starts, etc.)
--   *_at          timestamptz (an instant — created_at, reviewed_at, ...)
--   deleted_at    soft deletion; NULL means live. Never hard-delete records
--                 that form part of the club's official history.
-- ===========================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email

-- ---------------------------------------------------------------------------
-- Lifecycle enums
-- ---------------------------------------------------------------------------

-- Applicant -> Active Member -> Alumni / Withdrawn, plus the side states.
create type membership_status as enum (
    'applicant',
    'active',
    'alumni',
    'withdrawn',
    'inactive',
    'rejected'
);

-- Whether the person can sign in at all. Independent of membership_status:
-- an alumnus keeps a usable account, a disabled account cannot sign in.
create type account_state as enum ('active', 'disabled');

create type application_status as enum (
    'submitted',
    'interview',
    'approved',
    'rejected',
    'withdrawn'
);

-- Shared by every "member asks, admin decides" workflow.
create type review_status as enum (
    'draft',
    'submitted',
    'changes_requested',
    'approved',
    'rejected'
);

create type request_status as enum (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);

create type admin_role as enum (
    'super_admin',   -- full control, including managing other admins
    'club_admin',    -- everything operational; cannot manage admins or settings
    'reviewer'       -- review queues only
);

create type profile_visibility as enum ('public', 'private');

-- Public = anyone; internal = signed-in members and admins only.
create type content_visibility as enum ('public', 'internal');

create type project_kind as enum ('event', 'project', 'workshop_series', 'initiative');

create type project_status as enum ('planning', 'active', 'completed', 'archived');

create type participation_status as enum ('registered', 'confirmed', 'completed', 'withdrawn', 'no_show');

create type member_request_kind as enum (
    'withdrawal',
    'profile_removal',
    'account_deletion',
    'data_export',
    'other'
);

create type archive_item_kind as enum ('file', 'link', 'embed');

-- ---------------------------------------------------------------------------
-- Reference lists that admins can extend without a migration live in tables
-- (positions, archive categories, contribution types). Only the values that
-- application logic actually branches on are enums.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

comment on function public.touch_updated_at is
    'Row trigger: keeps updated_at accurate without trusting the client.';
