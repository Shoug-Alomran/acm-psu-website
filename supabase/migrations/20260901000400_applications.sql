-- ===========================================================================
-- 0004 — Membership applications.
--
-- The application stays deliberately short. It asks who you are and what you
-- want to learn — never what you already know. Nothing here is a technical
-- screening question, and no field is scored.
-- ===========================================================================

create table public.applications (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references public.app_users (id) on delete cascade,

    -- Captured as submitted, so the application remains a faithful record even
    -- if the person later edits their profile.
    full_name      text not null,
    student_id     text not null,
    psu_email      citext not null,
    major          text not null,
    academic_year  text not null,
    interests      text[] not null default '{}',
    goal_text      text,                 -- optional: what they want to gain

    status         application_status not null default 'submitted',
    chapter_year   text not null default public.current_chapter_year(),

    -- Admin decision fields.
    reviewed_by            uuid references public.app_users (id),
    reviewed_at            timestamptz,
    decision_note          text,          -- shown to the applicant
    approved_position_id   uuid references public.positions (id) on delete set null,
    membership_start_date  date,
    internal_note          text,          -- never shown to the applicant

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    constraint applications_student_id_format check (student_id ~ '^[0-9]{6,12}$'),
    constraint applications_goal_length       check (goal_text is null or char_length(goal_text) <= 1500),
    constraint applications_interests_present check (array_length(interests, 1) >= 1)
);

-- One live application per person. Re-applying after a rejection is allowed.
create unique index applications_one_open
    on public.applications (user_id)
    where status in ('submitted', 'interview');

create index applications_status_idx  on public.applications (status, created_at desc);
create index applications_chapter_idx on public.applications (chapter_year);

create trigger applications_touch
    before update on public.applications
    for each row execute function public.touch_updated_at();

comment on table public.applications is
    'Membership applications. Do not add technical-screening fields here — '
    'membership is not a competitive technical application.';

-- ---------------------------------------------------------------------------
-- Internal interview notes. Admin-only, and kept out of the applications table
-- so that no policy mistake can ever expose them alongside applicant-readable
-- columns.
-- ---------------------------------------------------------------------------
create table public.application_notes (
    id             uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.applications (id) on delete cascade,
    author_id      uuid references public.app_users (id),
    body           text not null,
    created_at     timestamptz not null default now()
);

create index application_notes_application_idx
    on public.application_notes (application_id, created_at);

comment on table public.application_notes is
    'Interview notes. Staff-only by RLS; applicants can never read this table.';

-- ---------------------------------------------------------------------------
-- Approving an applicant.
--
-- One transaction does all four things the workflow promises: sets the status,
-- creates the membership, generates the profile, and opens the first position
-- — and writes the audit entry. Exposed as an RPC so the browser cannot
-- perform any step piecemeal, and so an approval can never exist without a
-- record of who made it and why. If any part fails, none of it happened.
-- ---------------------------------------------------------------------------
create or replace function public.approve_application(
    application uuid,
    position_id uuid default null,
    start_date  date default current_date,
    reason      text default null,
    internal    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    app       record;
    before_js jsonb;
    position_title text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may approve applications.' using errcode = '42501';
    end if;

    select * into app from public.applications where id = application for update;
    if app is null then
        raise exception 'Application not found.';
    end if;
    if app.status = 'approved' then
        raise exception 'This application has already been approved.';
    end if;

    before_js := jsonb_build_object('status', app.status);

    -- Everything below shares this reason, decision and correlation id.
    perform public.audit_context(reason, internal, 'approved', true, app.user_id);

    update public.applications
       set status                = 'approved',
           reviewed_by           = auth.uid(),
           reviewed_at           = now(),
           decision_note         = reason,
           internal_note         = coalesce(internal, internal_note),
           approved_position_id  = position_id,
           membership_start_date = start_date
     where id = application;

    -- 1 & 2. Active membership.
    insert into public.memberships
        (user_id, status, started_on, chapter_year, approved_by, approved_at)
    values
        (app.user_id, 'active', start_date, app.chapter_year, auth.uid(), now())
    on conflict (user_id) do update
        set status      = 'active',
            started_on  = coalesce(memberships.started_on, excluded.started_on),
            ended_on    = null,
            approved_by = excluded.approved_by,
            approved_at = excluded.approved_at;

    -- 3. Carry across what the applicant already told us, so their profile is
    --    generated rather than re-typed.
    update public.app_users
       set student_id = coalesce(student_id, app.student_id),
           major      = coalesce(major, app.major),
           full_name  = case when full_name = '' then app.full_name else full_name end
     where id = app.user_id;

    insert into public.member_profiles (user_id, academic_year, interests)
    values (app.user_id, app.academic_year, app.interests)
    on conflict (user_id) do update
        set academic_year = coalesce(member_profiles.academic_year, excluded.academic_year),
            interests     = case when member_profiles.interests = '{}'
                                 then excluded.interests
                                 else member_profiles.interests end;

    -- 4. First position in their history.
    if position_id is not null then
        select title into position_title from public.positions where id = position_id;
        perform public.grant_position(app.user_id, position_id, start_date, null,
                                      'Granted on membership approval');
    end if;

    perform public.write_audit(
        action         => 'application.approved',
        category       => 'membership',
        entity_type    => 'application',
        entity_id      => application::text,
        entity_label   => app.full_name,
        decision       => 'approved',
        summary        => app.full_name || ' approved as a member'
                          || coalesce(' — ' || position_title, ''),
        reason         => reason,
        internal_note  => internal,
        member_visible => true,
        before_state   => before_js,
        after_state    => jsonb_build_object(
                            'status', 'approved',
                            'membership_status', 'active',
                            'position', coalesce(position_title, 'none'),
                            'start_date', start_date),
        related_member => app.user_id,
        metadata       => jsonb_build_object('student_id', app.student_id,
                                             'chapter_year', app.chapter_year)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Declining an applicant. A reason is required: "REJECTED" with no
-- explanation tells a future committee nothing, and the applicant deserves an
-- answer they can act on.
-- ---------------------------------------------------------------------------
create or replace function public.reject_application(
    application uuid,
    reason      text default null,
    internal    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    app       record;
    given     text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may reject applications.' using errcode = '42501';
    end if;

    given := public.require_reason(reason, 'decline an application');

    select * into app from public.applications where id = application for update;
    if app is null then
        raise exception 'Application not found.';
    end if;

    perform public.audit_context(given, internal, 'rejected', true, app.user_id);

    update public.applications
       set status        = 'rejected',
           reviewed_by   = auth.uid(),
           reviewed_at   = now(),
           decision_note = given,
           internal_note = coalesce(internal, internal_note)
     where id = application;

    -- The account stays usable; only the membership standing is set.
    insert into public.memberships (user_id, status)
    values (app.user_id, 'rejected')
    on conflict (user_id) do update set status = 'rejected';

    perform public.write_audit(
        action         => 'application.rejected',
        category       => 'membership',
        entity_type    => 'application',
        entity_id      => application::text,
        entity_label   => app.full_name,
        decision       => 'rejected',
        summary        => app.full_name || ' was not accepted this cycle',
        reason         => given,
        internal_note  => internal,
        member_visible => true,
        before_state   => jsonb_build_object('status', app.status),
        after_state    => jsonb_build_object('status', 'rejected'),
        related_member => app.user_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Marking an applicant for interview. An RPC rather than a direct UPDATE so
-- the step appears on the application's activity trail like every other one.
-- ---------------------------------------------------------------------------
create or replace function public.mark_application_for_interview(
    application uuid,
    reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    app record;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may schedule interviews.' using errcode = '42501';
    end if;

    select * into app from public.applications where id = application for update;
    if app is null then
        raise exception 'Application not found.';
    end if;

    perform public.audit_context(reason, null, 'interview', true, app.user_id);

    update public.applications set status = 'interview' where id = application;

    perform public.write_audit(
        action         => 'application.interview',
        category       => 'membership',
        entity_type    => 'application',
        entity_id      => application::text,
        entity_label   => app.full_name,
        decision       => 'interview',
        summary        => app.full_name || ' marked for interview',
        reason         => reason,
        member_visible => true,
        before_state   => jsonb_build_object('status', app.status),
        after_state    => jsonb_build_object('status', 'interview'),
        related_member => app.user_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Interview notes. The note body itself is never copied into the audit log —
-- it lives in application_notes, which applicants have no read path to. The
-- audit entry records only that a note was added, and by whom.
-- ---------------------------------------------------------------------------
create or replace function public.add_application_note(
    application uuid,
    body        text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    app     record;
    note_id uuid;
begin
    if not public.is_staff() then
        raise exception 'Only staff may add interview notes.' using errcode = '42501';
    end if;
    if body is null or btrim(body) = '' then
        raise exception 'An interview note cannot be empty.';
    end if;

    select * into app from public.applications where id = application;
    if app is null then
        raise exception 'Application not found.';
    end if;

    insert into public.application_notes (application_id, author_id, body)
    values (application, auth.uid(), btrim(body))
    returning id into note_id;

    perform public.write_audit(
        action       => 'application.note_added',
        category     => 'membership',
        entity_type  => 'application',
        entity_id    => application::text,
        entity_label => app.full_name,
        decision     => 'noted',
        summary      => 'Interview note added',
        related_member => app.user_id
    );

    return note_id;
end;
$$;
