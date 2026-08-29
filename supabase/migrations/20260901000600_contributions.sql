-- ===========================================================================
-- 0006 — Verified contributions.
--
-- A member describes what they did; an admin verifies it. Only verification
-- turns a claim into part of the official ACM record, which is what makes the
-- record worth anything to the student afterwards.
-- ===========================================================================

-- A table rather than an enum: committees will invent new kinds of work, and
-- adding a row must not require a migration.
create table public.contribution_types (
    slug       text primary key,
    label      text not null,
    label_ar   text,
    rank       integer not null default 100,
    is_active  boolean not null default true
);

insert into public.contribution_types (slug, label, rank) values
    ('organizer',              'Organizer',              10),
    ('website-development',    'Website Development',    20),
    ('workshop-development',   'Workshop Development',   30),
    ('workshop-presenter',     'Workshop Presenter',     40),
    ('technical-support',      'Technical Support',      50),
    ('competition-operations', 'Competition Operations', 60),
    ('cybersecurity',          'Cybersecurity',          70),
    ('programming',            'Programming',            80),
    ('design-media',           'Design / Media',         90),
    ('registration',           'Registration',          100),
    ('event-operations',       'Event Operations',      110),
    ('project-contribution',   'Project Contribution',  120),
    ('other',                  'Other',                 999);

create table public.contributions (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.app_users (id) on delete cascade,
    project_id   uuid references public.projects (id) on delete set null,
    type_slug    text not null references public.contribution_types (slug),

    title        text not null,
    role_text    text,
    description  text,
    occurred_on  date,
    links        text[] not null default '{}',
    member_note  text,

    status       review_status not null default 'submitted',

    -- Admin review. review_note is shown to the member; internal_note is not.
    reviewed_by   uuid references public.app_users (id),
    reviewed_at   timestamptz,
    review_note   text,
    internal_note text,
    verified_at   timestamptz,

    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    deleted_at   timestamptz,

    constraint contributions_title_length check (char_length(btrim(title)) between 3 and 200),
    constraint contributions_links_count  check (coalesce(array_length(links, 1), 0) <= 10)
);

create index contributions_user_idx    on public.contributions (user_id, status);
create index contributions_status_idx  on public.contributions (status, created_at desc);
create index contributions_project_idx on public.contributions (project_id);

create trigger contributions_touch
    before update on public.contributions
    for each row execute function public.touch_updated_at();

comment on column public.contributions.status is
    'draft/submitted/changes_requested are the member''s to edit. Once approved '
    'the row is an official record and the member''s UPDATE policy no longer '
    'matches it.';

-- Evidence: a file in private storage, or an external link.
create table public.contribution_evidence (
    id              uuid primary key default gen_random_uuid(),
    contribution_id uuid not null references public.contributions (id) on delete cascade,
    storage_bucket  text,
    storage_path    text,
    external_url    text,
    file_name       text,
    mime_type       text,
    size_bytes      bigint,
    created_at      timestamptz not null default now(),

    constraint contribution_evidence_has_target
        check (storage_path is not null or external_url is not null)
);

create index contribution_evidence_contribution_idx
    on public.contribution_evidence (contribution_id);

-- ---------------------------------------------------------------------------
-- Verification.
--
-- Admins may correct the wording while approving ("edit and approve") — the
-- common case is real work described vaguely, and declining that would be the
-- wrong answer. The audit entry keeps both the submitted text and the edited
-- text, so a future committee can see exactly what a reviewer changed.
-- ---------------------------------------------------------------------------
create or replace function public.verify_contribution(
    contribution_id uuid,
    new_title       text default null,
    new_type        text default null,
    new_role        text default null,
    new_description text default null,
    new_project     uuid default null,
    reason          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
    row_after  record;
begin
    if not public.is_reviewer() then
        raise exception 'Only a reviewer may verify contributions.' using errcode = '42501';
    end if;

    select * into row_before from public.contributions
     where id = contribution_id for update;
    if row_before is null then
        raise exception 'Contribution not found.';
    end if;

    -- Re-verifying something already verified is an override, and overrides
    -- have to be explained.
    if row_before.status = 'approved' then
        reason := public.require_reason(reason, 'change an already-verified contribution');
    end if;

    perform public.audit_context(reason, null, 'approved', true, row_before.user_id);

    update public.contributions
       set title       = coalesce(nullif(btrim(new_title), ''), title),
           type_slug   = coalesce(new_type, type_slug),
           role_text   = coalesce(new_role, role_text),
           description = coalesce(new_description, description),
           project_id  = coalesce(new_project, project_id),
           status      = 'approved',
           reviewed_by = auth.uid(),
           reviewed_at = now(),
           review_note = reason,
           verified_at = now()
     where id = contribution_id
     returning * into row_after;

    perform public.write_audit(
        action          => 'contribution.verified',
        category        => 'contributions',
        entity_type     => 'contribution',
        entity_id       => contribution_id::text,
        entity_label    => row_after.title,
        decision        => 'approved',
        summary         => 'Verified "' || row_after.title || '"',
        reason          => reason,
        member_visible  => true,
        before_state    => jsonb_build_object(
                             'status', row_before.status,
                             'title', row_before.title,
                             'type', row_before.type_slug,
                             'role', row_before.role_text,
                             'description', row_before.description),
        after_state     => jsonb_build_object(
                             'status', row_after.status,
                             'title', row_after.title,
                             'type', row_after.type_slug,
                             'role', row_after.role_text,
                             'description', row_after.description),
        related_project => row_after.project_id,
        related_member  => row_after.user_id
    );
end;
$$;

create or replace function public.decide_contribution(
    contribution_id uuid,
    decision        review_status,
    reason          text default null,
    internal        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
    given      text;
begin
    if not public.is_reviewer() then
        raise exception 'Only a reviewer may review contributions.' using errcode = '42501';
    end if;
    if decision not in ('rejected', 'changes_requested') then
        raise exception 'Use verify_contribution() to approve.';
    end if;

    -- Both outcomes ask something of the member, so both need an explanation.
    given := public.require_reason(reason,
        case when decision = 'rejected' then 'decline a contribution'
             else 'ask for changes to a contribution' end);

    select * into row_before from public.contributions
     where id = contribution_id for update;
    if row_before is null then
        raise exception 'Contribution not found.';
    end if;

    perform public.audit_context(given, internal, decision::text::audit_decision,
                                 true, row_before.user_id);

    update public.contributions
       set status        = decision,
           reviewed_by   = auth.uid(),
           reviewed_at   = now(),
           review_note   = given,
           internal_note = coalesce(internal, internal_note),
           verified_at   = null
     where id = contribution_id;

    perform public.write_audit(
        action          => 'contribution.' || decision::text,
        category        => 'contributions',
        entity_type     => 'contribution',
        entity_id       => contribution_id::text,
        entity_label    => row_before.title,
        decision        => decision::text::audit_decision,
        summary         => case when decision = 'rejected'
                                then 'Declined "' || row_before.title || '"'
                                else 'Changes requested on "' || row_before.title || '"' end,
        reason          => given,
        internal_note   => internal,
        member_visible  => true,
        before_state    => jsonb_build_object('status', row_before.status,
                                              'verified', row_before.verified_at is not null),
        after_state     => jsonb_build_object('status', decision, 'verified', false),
        related_project => row_before.project_id,
        related_member  => row_before.user_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Revoking a verification.
--
-- Taking something off someone's permanent record is among the most
-- consequential things an admin can do here, so it is a named action with a
-- mandatory reason rather than a quiet status edit.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_contribution_verification(
    contribution_id uuid,
    reason          text,
    internal        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
    given      text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may revoke a verification.'
            using errcode = '42501';
    end if;

    given := public.require_reason(reason, 'revoke a verified contribution');

    select * into row_before from public.contributions
     where id = contribution_id for update;
    if row_before is null then
        raise exception 'Contribution not found.';
    end if;
    if row_before.status <> 'approved' then
        raise exception 'That contribution is not currently verified.';
    end if;

    perform public.audit_context(given, internal, 'revoked', true, row_before.user_id);

    update public.contributions
       set status        = 'changes_requested',
           verified_at   = null,
           reviewed_by   = auth.uid(),
           reviewed_at   = now(),
           review_note   = given,
           internal_note = coalesce(internal, internal_note)
     where id = contribution_id;

    perform public.write_audit(
        action          => 'contribution.verification_revoked',
        category        => 'contributions',
        entity_type     => 'contribution',
        entity_id       => contribution_id::text,
        entity_label    => row_before.title,
        decision        => 'revoked',
        summary         => 'Verification revoked on "' || row_before.title || '"',
        reason          => given,
        internal_note   => internal,
        member_visible  => true,
        before_state    => jsonb_build_object('status', 'approved', 'verified', true),
        after_state     => jsonb_build_object('status', 'changes_requested', 'verified', false),
        related_project => row_before.project_id,
        related_member  => row_before.user_id
    );
end;
$$;
