-- ===========================================================================
-- 0002 — Identity, membership, and role-based access control.
--
-- Deliberate split:
--   app_users        one row per sign-in identity (mirrors auth.users)
--   member_profiles  MEMBER-controlled facts. The member edits these freely.
--   memberships      ACM-controlled facts. Only admins may write these.
--
-- Keeping the two apart is what makes the security model simple: members get
-- an UPDATE policy on member_profiles and no UPDATE policy at all on
-- memberships, so "members control who they are, ACM verifies what they did"
-- is enforced by the database rather than by the user interface.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app_users — one row per account.
-- ---------------------------------------------------------------------------
create table public.app_users (
    id            uuid primary key references auth.users (id) on delete cascade,
    email         citext      not null unique,
    full_name     text        not null default '',
    student_id    text,
    major         text,
    account_state account_state not null default 'active',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    deleted_at    timestamptz,

    constraint app_users_student_id_format
        check (student_id is null or student_id ~ '^[0-9]{6,12}$')
);

-- A PSU student ID identifies exactly one person, but only among live rows so
-- that a soft-deleted account does not block a genuine re-registration.
create unique index app_users_student_id_key
    on public.app_users (student_id)
    where student_id is not null and deleted_at is null;

create index app_users_account_state_idx on public.app_users (account_state);

create trigger app_users_touch
    before update on public.app_users
    for each row execute function public.touch_updated_at();

comment on table public.app_users is
    'Sign-in identities. Mirrors auth.users so the rest of the schema can use '
    'ordinary foreign keys and joins.';

-- ---------------------------------------------------------------------------
-- member_profiles — everything the member owns and may change at will.
-- ---------------------------------------------------------------------------
create table public.member_profiles (
    user_id        uuid primary key references public.app_users (id) on delete cascade,
    bio            text        not null default '',
    academic_year  text,
    interests      text[]      not null default '{}',
    linkedin_url   text,
    github_url     text,
    website_url    text,
    -- Free-form extra professional links: [{"label": "...", "url": "..."}]
    extra_links    jsonb       not null default '[]'::jsonb,
    avatar_path    text,
    visibility     profile_visibility not null default 'private',
    display_name   text,
    pronouns       text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    constraint member_profiles_bio_length     check (char_length(bio) <= 5000),
    constraint member_profiles_extra_links_is_array check (jsonb_typeof(extra_links) = 'array'),
    constraint member_profiles_link_count     check (jsonb_array_length(extra_links) <= 10),
    constraint member_profiles_linkedin_url   check (linkedin_url is null or linkedin_url ~* '^https://'),
    constraint member_profiles_github_url     check (github_url   is null or github_url   ~* '^https://'),
    constraint member_profiles_website_url    check (website_url  is null or website_url  ~* '^https?://')
);

create trigger member_profiles_touch
    before update on public.member_profiles
    for each row execute function public.touch_updated_at();

comment on table public.member_profiles is
    'MEMBER-CONTROLLED profile fields. Safe for a member to edit without review.';

-- ---------------------------------------------------------------------------
-- memberships — ACM-controlled standing. Admin write only.
-- ---------------------------------------------------------------------------
create table public.memberships (
    user_id       uuid primary key references public.app_users (id) on delete cascade,
    status        membership_status not null default 'applicant',
    started_on    date,
    ended_on      date,
    member_no     text,           -- archive-style identifier, e.g. 0x14
    chapter_year  text,           -- academic year the member joined, e.g. '2026'
    approved_by   uuid references public.app_users (id),
    approved_at   timestamptz,
    internal_note text,           -- admin eyes only
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint memberships_dates_ordered
        check (ended_on is null or started_on is null or ended_on >= started_on)
);

create index memberships_status_idx on public.memberships (status);

create trigger memberships_touch
    before update on public.memberships
    for each row execute function public.touch_updated_at();

comment on table public.memberships is
    'ACM-CONTROLLED membership standing. Members have no UPDATE policy here.';

-- Status is official history, so every transition is recorded rather than
-- overwritten. memberships.status is the current value; this is the trail.
create table public.membership_status_history (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.app_users (id) on delete cascade,
    from_status  membership_status,
    to_status    membership_status not null,
    reason       text,
    changed_by   uuid references public.app_users (id),
    changed_at   timestamptz not null default now()
);

create index membership_status_history_user_idx
    on public.membership_status_history (user_id, changed_at desc);

create or replace function public.record_membership_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        insert into public.membership_status_history (user_id, from_status, to_status, changed_by)
        values (new.user_id, null, new.status, auth.uid());
    elsif new.status is distinct from old.status then
        insert into public.membership_status_history (user_id, from_status, to_status, changed_by)
        values (new.user_id, old.status, new.status, auth.uid());
    end if;
    return new;
end;
$$;

create trigger memberships_status_history
    after insert or update of status on public.memberships
    for each row execute function public.record_membership_status_change();

-- ---------------------------------------------------------------------------
-- Admin roles.
--
-- Roles are assignments with a grant/revoke trail, not a boolean column, so
-- leadership handover is a normal recorded action and the audit log can show
-- who granted what to whom.
-- ---------------------------------------------------------------------------
create table public.admin_assignments (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.app_users (id) on delete cascade,
    role       admin_role not null,
    granted_by uuid references public.app_users (id),
    granted_at timestamptz not null default now(),
    revoked_by uuid references public.app_users (id),
    revoked_at timestamptz,
    note       text
);

create unique index admin_assignments_active_key
    on public.admin_assignments (user_id, role)
    where revoked_at is null;

create index admin_assignments_user_idx on public.admin_assignments (user_id);

comment on table public.admin_assignments is
    'Role grants. Revoking sets revoked_at; rows are never deleted so the '
    'handover history stays intact.';

-- ---------------------------------------------------------------------------
-- Authorization helpers.
--
-- Every one of these is SECURITY DEFINER with a pinned search_path. That is
-- required: policies on admin_assignments call them, and a plain function
-- would re-enter that table's own policies and recurse.
-- ---------------------------------------------------------------------------

create or replace function public.has_admin_role(required admin_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_assignments a
        join public.app_users u on u.id = a.user_id
        where a.user_id = auth.uid()
          and a.role = required
          and a.revoked_at is null
          and u.account_state = 'active'
          and u.deleted_at is null
    );
$$;

-- Super admin implies club admin implies reviewer. Encoding the hierarchy once
-- here keeps every policy in the schema down to a single function call.
create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.has_admin_role('super_admin'); $$;

create or replace function public.is_club_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.has_admin_role('super_admin') or public.has_admin_role('club_admin'); $$;

create or replace function public.is_reviewer()
returns boolean
language sql stable security definer set search_path = public
as $$
    select public.has_admin_role('super_admin')
        or public.has_admin_role('club_admin')
        or public.has_admin_role('reviewer');
$$;

-- "Any staff member at all" — used for read access to internal material.
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_reviewer(); $$;

create or replace function public.is_active_member()
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.memberships m
        join public.app_users u on u.id = m.user_id
        where m.user_id = auth.uid()
          and m.status in ('active', 'alumni')
          and u.account_state = 'active'
          and u.deleted_at is null
    );
$$;

comment on function public.is_reviewer is
    'True for reviewer, club_admin and super_admin. Roles are hierarchical.';

-- ---------------------------------------------------------------------------
-- Account provisioning.
--
-- Supabase creates auth.users; this mirrors it into app_users and gives the
-- person an empty profile so the portal never has to special-case a missing
-- row. Membership is NOT created here — that only happens on approval.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.app_users (id, email, full_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', '')
    )
    on conflict (id) do nothing;

    insert into public.member_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- First-run bootstrap.
--
-- Chicken-and-egg: only a super admin can grant super admin. This grants the
-- first one and then refuses to run ever again, so it cannot be used later to
-- escalate. Run it once from the Supabase SQL editor — see docs/SETUP.md.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_super_admin(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    target_id uuid;
begin
    if exists (select 1 from public.admin_assignments
               where role = 'super_admin' and revoked_at is null) then
        raise exception
            'A super admin already exists. Grant further roles from the admin portal.';
    end if;

    select id into target_id from public.app_users where email = target_email::citext;

    if target_id is null then
        raise exception
            'No account found for %. Sign up on the website first, then re-run this.',
            target_email;
    end if;

    insert into public.admin_assignments (user_id, role, note)
    values (target_id, 'super_admin', 'Initial bootstrap grant');

    return 'super_admin granted to ' || target_email;
end;
$$;

-- Reachable only with the service role / SQL editor, never from the browser.
revoke execute on function public.bootstrap_super_admin(text) from public, anon, authenticated;
