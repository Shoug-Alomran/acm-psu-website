-- ===========================================================================
-- 0030 — Member-facing event application state.
--
-- WHAT WAS WRONG
--
-- 1. The portal read its "Your requests" list straight off the table with a
--    PostgREST embed:
--
--        .from('event_position_applications')
--        .select('*, position:event_positions(title, project_id)')
--
--    event_position_applications.event_position_id is NOT NULL, so PostgREST
--    resolves that embed as an INNER join. event_positions is readable only to
--    an active member or staff (event_positions_select). The moment that
--    predicate does not hold — membership lapsed, the row was archived out of
--    reach, or the request ran before the membership row was visible — every
--    application row silently vanished from a 200 response. A member losing
--    sight of their own record because of a *join to metadata* is a bug: the
--    self-read policy on the application table was never the thing denying it.
--
-- 2. participations.event_position_id is nullable, and 0029's reconciliation
--    was written as `where p.event_position_id is not null`. Live assignments
--    recorded without a position id were therefore never reconciled, leaving
--    exactly the split-brain state that migration set out to remove.
--
-- WHAT THIS DOES
--
--   * my_event_position_applications() — one security-definer RPC that hands
--     a member their own applications together with the position/project
--     metadata needed to render them, no matter whether the opening is still
--     open and no matter what the member could read from the tables directly.
--     It is scoped by auth.uid() and returns nothing else about anyone else.
--   * A trigger that makes the invariant permanent: an active participation
--     tied to an event_position_id always has a matching approved application.
--   * Registration and withdrawal return a machine-readable outcome instead of
--     raising for states that are perfectly ordinary from the member's side.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The invariant, as a function so it can be reused by the trigger, the
-- backfill below and any future repair.
--
-- Runs as owner because it repairs another member's row when an admin records
-- a participation. It never reads anything the caller supplied beyond the id.
-- ---------------------------------------------------------------------------
create or replace function public.sync_application_from_participation(
    p_participation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    part public.participations%rowtype;
begin
    select * into part
      from public.participations
     where id = p_participation_id;

    if not found or part.event_position_id is null then
        return;
    end if;

    if part.status in ('registered', 'confirmed', 'completed') then
        insert into public.event_position_applications (
            event_position_id, user_id, availability, note, status,
            admin_note, decided_by, decided_at, created_at, updated_at
        ) values (
            part.event_position_id,
            part.user_id,
            'Existing ACM assignment',
            null,
            'approved',
            'Recovered from the verified event assignment record.',
            part.verified_by,
            coalesce(part.verified_at, part.created_at),
            part.created_at,
            now()
        )
        on conflict (event_position_id, user_id) do update
           set status = 'approved',
               admin_note = coalesce(
                   event_position_applications.admin_note,
                   'Reconciled with the verified event assignment record.'
               ),
               decided_by = coalesce(
                   event_position_applications.decided_by,
                   part.verified_by
               ),
               decided_at = coalesce(
                   event_position_applications.decided_at,
                   part.verified_at,
                   part.created_at
               ),
               updated_at = now()
         where event_position_applications.status <> 'approved';

    elsif part.status = 'withdrawn' then
        -- A withdrawn assignment must not keep reading as approved. Rejected
        -- applications are an admin decision and are left alone.
        update public.event_position_applications
           set status = 'cancelled',
               updated_at = now()
         where event_position_id = part.event_position_id
           and user_id = part.user_id
           and status = 'approved';
    end if;
end;
$$;

comment on function public.sync_application_from_participation(uuid) is
    'Keeps the member-visible application in step with the verified assignment: '
    'an active participation on an event position always resolves to approved, '
    'a withdrawn one releases the approval.';

revoke all on function public.sync_application_from_participation(uuid) from public, anon, authenticated;


create or replace function public.participations_sync_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.sync_application_from_participation(new.id);
    return new;
end;
$$;

drop trigger if exists participations_sync_application on public.participations;

create trigger participations_sync_application
    after insert or update of status, event_position_id, verified_at, verified_by
    on public.participations
    for each row execute function public.participations_sync_application();


-- ---------------------------------------------------------------------------
-- Backfill. Unlike 0029 this is driven by the same function the trigger uses,
-- so the repaired state and the enforced state cannot drift apart.
-- ---------------------------------------------------------------------------
do $$
declare
    part_id uuid;
begin
    for part_id in
        select id from public.participations where event_position_id is not null
    loop
        perform public.sync_application_from_participation(part_id);
    end loop;
end;
$$;


-- ---------------------------------------------------------------------------
-- What a member is allowed to see about their own requests.
--
-- Security definer because the point is to defeat the metadata join problem
-- described at the top: the member must be able to read the title of a closed
-- position they applied to. The WHERE clause is this function's authorization
-- and it is `user_id = auth.uid()`, nothing wider. Only the member's own
-- application, plus the position title, project title and start date needed to
-- label it, ever leaves this function. No other applicant, no capacity detail
-- that is not already in event_position_availability, no admin-internal field.
-- ---------------------------------------------------------------------------
create or replace function public.my_event_position_applications()
returns table (
    id                     uuid,
    event_position_id      uuid,
    status                 text,
    availability           text,
    note                   text,
    admin_note             text,
    created_at             timestamptz,
    updated_at             timestamptz,
    decided_at             timestamptz,
    position_title         text,
    position_is_open       boolean,
    position_closes_on     date,
    project_id             uuid,
    project_title          text,
    project_starts_on      date,
    has_active_assignment  boolean,
    can_unregister         boolean,
    unregister_block       text
)
language sql
stable
security definer
set search_path = public
as $$
    select
        a.id,
        a.event_position_id,
        a.status::text,
        a.availability,
        a.note,
        a.admin_note,
        a.created_at,
        a.updated_at,
        a.decided_at,
        coalesce(ep.title, 'Event position'),
        coalesce(ep.is_open, false),
        ep.closes_on,
        ep.project_id,
        coalesce(pr.title, 'ACM event'),
        pr.starts_on,
        part.id is not null,
        a.status in ('pending', 'approved')
            and (
                pr.starts_on is null
                or now() < (pr.starts_on::timestamp at time zone 'Asia/Riyadh')
                           - interval '72 hours'
            ),
        case
            when a.status not in ('pending', 'approved') then null
            when pr.starts_on is null then null
            when now() >= (pr.starts_on::timestamp at time zone 'Asia/Riyadh')
                          - interval '72 hours'
                then 'window_closed'::text
            else null::text
        end
    from public.event_position_applications a
    left join public.event_positions ep on ep.id = a.event_position_id
    left join public.projects pr on pr.id = ep.project_id
    left join lateral (
        select p.id
          from public.participations p
         where p.user_id = a.user_id
           and p.event_position_id = a.event_position_id
           and p.status in ('registered', 'confirmed', 'completed')
         limit 1
    ) part on true
    where a.user_id = auth.uid()
      and auth.uid() is not null
    order by a.created_at desc;
$$;

comment on function public.my_event_position_applications() is
    'The signed-in member''s own event-position requests with the position and '
    'project labels needed to display them, including closed openings. Scoped '
    'to auth.uid(); returns no other member''s data.';

revoke all on function public.my_event_position_applications() from public, anon;
grant execute on function public.my_event_position_applications() to authenticated;


-- ---------------------------------------------------------------------------
-- Registration.
--
-- Every state a member can legitimately be in is an outcome, not an error.
-- Exceptions are reserved for the cases where the member genuinely may not
-- proceed: not signed in, not an active member, or bad input.
--
--   created   a new pending request was stored
--   reopened  a cancelled/rejected request was reused
--   pending   a pending request already existed
--   approved  the member already holds this position
--   closed    the opening is no longer accepting requests
--   full      every opening is taken
-- ---------------------------------------------------------------------------
drop function if exists public.register_event_position_application(uuid, text, text);

create function public.register_event_position_application(
    p_event_position_id uuid,
    p_availability text,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    pos record;
    existing_app public.event_position_applications%rowtype;
    assignment public.participations%rowtype;
    application_id uuid;
    approved_count integer;
begin
    if auth.uid() is null then
        raise exception 'Sign in required.' using errcode = '42501';
    end if;

    if not public.is_active_member() then
        raise exception 'Only active ACM members may register for event positions.'
            using errcode = '42501';
    end if;

    select * into existing_app
      from public.event_position_applications
     where event_position_id = p_event_position_id
       and user_id = auth.uid()
     for update;

    -- A verified assignment outranks the application table. Repair first so a
    -- member who already holds the role is told exactly that, in a state the
    -- portal can render, rather than being handed a duplicate-key error.
    select * into assignment
      from public.participations
     where event_position_id = p_event_position_id
       and user_id = auth.uid()
       and status in ('registered', 'confirmed', 'completed')
     order by created_at desc
     limit 1;

    if assignment.id is not null then
        perform public.sync_application_from_participation(assignment.id);

        select id into application_id
          from public.event_position_applications
         where event_position_id = p_event_position_id
           and user_id = auth.uid();

        return jsonb_build_object(
            'outcome', 'approved',
            'status', 'approved',
            'application_id', application_id
        );
    end if;

    if existing_app.id is not null and existing_app.status = 'pending' then
        return jsonb_build_object(
            'outcome', 'pending',
            'status', 'pending',
            'application_id', existing_app.id
        );
    end if;

    if existing_app.id is not null and existing_app.status = 'approved' then
        return jsonb_build_object(
            'outcome', 'approved',
            'status', 'approved',
            'application_id', existing_app.id
        );
    end if;

    if nullif(btrim(coalesce(p_availability, '')), '') is null then
        raise exception 'Tell the organisers when you are available.'
            using errcode = '22023';
    end if;

    if char_length(p_availability) > 500 then
        raise exception 'Availability must be 500 characters or fewer.'
            using errcode = '22023';
    end if;

    if p_note is not null and char_length(p_note) > 800 then
        raise exception 'Note must be 800 characters or fewer.'
            using errcode = '22023';
    end if;

    select ep.id, ep.title, ep.is_open, ep.closes_on, ep.project_id, ep.openings
      into pos
      from public.event_positions ep
     where ep.id = p_event_position_id
     for update;

    if not found then
        return jsonb_build_object(
            'outcome', 'closed',
            'status', coalesce(existing_app.status::text, 'none'),
            'application_id', existing_app.id
        );
    end if;

    if not pos.is_open
       or (pos.closes_on is not null and pos.closes_on < current_date) then
        return jsonb_build_object(
            'outcome', 'closed',
            'status', coalesce(existing_app.status::text, 'none'),
            'application_id', existing_app.id
        );
    end if;

    -- Capacity is checked with the position row locked so two members cannot
    -- both take the last opening.
    select count(*) into approved_count
      from public.event_position_applications
     where event_position_id = p_event_position_id
       and status = 'approved';

    if approved_count >= pos.openings then
        return jsonb_build_object(
            'outcome', 'full',
            'status', coalesce(existing_app.status::text, 'none'),
            'application_id', existing_app.id
        );
    end if;

    if existing_app.id is null then
        insert into public.event_position_applications (
            event_position_id, user_id, availability, note, status
        ) values (
            p_event_position_id,
            auth.uid(),
            btrim(p_availability),
            nullif(btrim(coalesce(p_note, '')), ''),
            'pending'
        )
        returning id into application_id;

        return jsonb_build_object(
            'outcome', 'created',
            'status', 'pending',
            'application_id', application_id
        );
    end if;

    -- Cancelled or rejected: reuse the row so the member/position record stays
    -- unique and the history stays on one audit trail.
    update public.event_position_applications
       set availability = btrim(p_availability),
           note = nullif(btrim(coalesce(p_note, '')), ''),
           status = 'pending',
           admin_note = null,
           decided_by = null,
           decided_at = null,
           created_at = now(),
           updated_at = now()
     where id = existing_app.id
    returning id into application_id;

    return jsonb_build_object(
        'outcome', 'reopened',
        'status', 'pending',
        'application_id', application_id
    );
end;
$$;

comment on function public.register_event_position_application(uuid, text, text) is
    'Registers the signed-in active member for one event position and returns '
    'the resulting state as jsonb. Repeating a request, already holding the '
    'role, a closed opening and a full opening are outcomes, not errors.';

revoke all on function public.register_event_position_application(uuid, text, text)
    from public, anon;
grant execute on function public.register_event_position_application(uuid, text, text)
    to authenticated;


-- ---------------------------------------------------------------------------
-- Withdrawal.
--
--   cancelled       the request is now cancelled
--   already_closed  it was not pending or approved to begin with
--   window_closed   inside the 72-hour cutoff; an organiser must do it
-- ---------------------------------------------------------------------------
drop function if exists public.unregister_event_position_application(uuid);

create function public.unregister_event_position_application(
    p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    req record;
    deadline timestamptz;
begin
    if auth.uid() is null then
        raise exception 'Sign in required.' using errcode = '42501';
    end if;

    select a.id, a.user_id, a.status, a.event_position_id,
           ep.project_id, pr.starts_on
      into req
      from public.event_position_applications a
      left join public.event_positions ep on ep.id = a.event_position_id
      left join public.projects pr on pr.id = ep.project_id
     where a.id = p_application_id
     for update of a;

    if not found then
        raise exception 'Application not found.';
    end if;

    -- Ownership comes from auth.uid(), never from anything the browser sent.
    if req.user_id <> auth.uid() then
        raise exception 'You can only unregister your own application.'
            using errcode = '42501';
    end if;

    if req.status not in ('pending', 'approved') then
        return jsonb_build_object('outcome', 'already_closed', 'status', req.status::text);
    end if;

    -- Projects hold a calendar start date, so the boundary is midnight at the
    -- start of that date in Riyadh. No start date means no meaningful cutoff.
    if req.starts_on is not null then
        deadline := (req.starts_on::timestamp at time zone 'Asia/Riyadh')
                    - interval '72 hours';

        if now() >= deadline then
            return jsonb_build_object(
                'outcome', 'window_closed',
                'status', req.status::text,
                'deadline', deadline
            );
        end if;
    end if;

    update public.event_position_applications
       set status = 'cancelled',
           updated_at = now()
     where id = req.id;

    -- Releasing the approval has to release the assignment too, or capacity
    -- and the member's verified record disagree. The trigger above would
    -- otherwise restore the approval on the next participation write.
    update public.participations
       set status = 'withdrawn',
           updated_at = now()
     where user_id = auth.uid()
       and event_position_id = req.event_position_id
       and status <> 'withdrawn';

    return jsonb_build_object('outcome', 'cancelled', 'status', 'cancelled');
end;
$$;

comment on function public.unregister_event_position_application(uuid) is
    'Withdraws the signed-in member''s own pending or approved event-position '
    'request until 72 hours before the project start date. Rows are cancelled, '
    'never deleted, and any approved participation is marked withdrawn.';

revoke all on function public.unregister_event_position_application(uuid)
    from public, anon;
grant execute on function public.unregister_event_position_application(uuid)
    to authenticated;


-- ---------------------------------------------------------------------------
-- Approval, corrected.
--
-- The participation upsert conflicts on (user_id, project_id, role_text) and
-- did not carry event_position_id into the update branch. A pre-existing
-- participation recorded without a position id therefore stayed unlinked after
-- approval — which is precisely how an assignment ends up invisible to the
-- position-scoped queries the portal runs. Everything else here is unchanged.
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
        raise exception 'Only a club admin may assign event positions.'
            using errcode = '42501';
    end if;

    select * into req from public.event_position_applications where id = request_id;
    if not found then
        raise exception 'Request not found.';
    end if;

    select * into pos from public.event_positions where id = req.event_position_id for update;
    if not found then
        raise exception 'That event position no longer exists.';
    end if;

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

    insert into public.participations
        (user_id, project_id, event_position_id, role_text, status, verified_at, verified_by)
    values
        (req.user_id, pos.project_id, pos.id, pos.title, 'confirmed', now(), auth.uid())
    on conflict (user_id, project_id, role_text) do update
        set event_position_id = excluded.event_position_id,
            status = 'confirmed',
            verified_at = now(),
            verified_by = auth.uid();

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

revoke all on function public.approve_event_position_application(uuid, text)
    from public, anon;
grant execute on function public.approve_event_position_application(uuid, text)
    to authenticated;


-- ---------------------------------------------------------------------------
-- Rejection and admin cancellation, as an RPC.
--
-- The admin UI previously wrote status = 'rejected' straight onto the table.
-- That left an active participation behind whenever the member had already
-- been approved, recreating the same contradiction from the other direction:
-- the assignment says assigned, the request says rejected. Releasing the role
-- and recording the decision belong in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.decide_event_position_application(
    p_application_id uuid,
    p_status text,
    p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    req record;
    -- audit_decision has no 'cancelled'; an admin cancellation is a revocation.
    decision_value audit_decision;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may decide event positions.'
            using errcode = '42501';
    end if;

    if p_status not in ('rejected', 'cancelled') then
        raise exception 'Use approve_event_position_application to approve.'
            using errcode = '22023';
    end if;

    decision_value := case p_status
        when 'rejected' then 'rejected'::audit_decision
        else 'revoked'::audit_decision
    end;

    select a.id, a.user_id, a.status, a.event_position_id, ep.title, ep.project_id
      into req
      from public.event_position_applications a
      left join public.event_positions ep on ep.id = a.event_position_id
     where a.id = p_application_id
     for update of a;

    if not found then
        raise exception 'Request not found.';
    end if;

    perform public.audit_context(p_reason, null, decision_value, true, req.user_id);

    update public.event_position_applications
       set status = p_status::request_status,
           admin_note = p_reason,
           decided_by = auth.uid(),
           decided_at = now(),
           updated_at = now()
     where id = p_application_id;

    -- Releasing the request must release the assignment and the capacity.
    update public.participations
       set status = 'withdrawn',
           updated_at = now()
     where user_id = req.user_id
       and event_position_id = req.event_position_id
       and status <> 'withdrawn';

    perform public.write_audit(
        action          => 'event_position.' || p_status,
        category        => 'events',
        entity_type     => 'event_position_application',
        entity_id       => p_application_id::text,
        entity_label    => coalesce(req.title, 'Event position'),
        decision        => decision_value,
        summary         => 'Request ' || p_status,
        reason          => p_reason,
        member_visible  => true,
        before_state    => jsonb_build_object('status', req.status),
        after_state     => jsonb_build_object('status', p_status),
        related_project => req.project_id,
        related_member  => req.user_id,
        related_request => p_application_id
    );
end;
$$;

comment on function public.decide_event_position_application(uuid, text, text) is
    'Club-admin rejection or cancellation of an event-position request. Marks '
    'any matching participation withdrawn so capacity and the member record '
    'stay in step with the decision.';

revoke all on function public.decide_event_position_application(uuid, text, text)
    from public, anon;
grant execute on function public.decide_event_position_application(uuid, text, text)
    to authenticated;


-- ---------------------------------------------------------------------------
-- Assertions. A forward migration that silently half-applies is worse than one
-- that fails, so check the things the portal now depends on.
-- ---------------------------------------------------------------------------
do $$
begin
    if not has_function_privilege(
        'authenticated',
        'public.my_event_position_applications()',
        'execute'
    ) then
        raise exception 'authenticated cannot execute my_event_position_applications';
    end if;

    if has_function_privilege(
        'anon',
        'public.my_event_position_applications()',
        'execute'
    ) then
        raise exception 'anon can still execute my_event_position_applications';
    end if;

    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.participations'::regclass
          and tgname = 'participations_sync_application'
    ) then
        raise exception 'the participation/application invariant trigger is missing';
    end if;

    if not (select relrowsecurity from pg_class
             where oid = 'public.event_position_applications'::regclass) then
        raise exception 'RLS was disabled on event_position_applications';
    end if;

    if exists (
        select 1
        from public.participations p
        where p.event_position_id is not null
          and p.status in ('registered', 'confirmed', 'completed')
          and not exists (
              select 1 from public.event_position_applications a
              where a.event_position_id = p.event_position_id
                and a.user_id = p.user_id
                and a.status = 'approved'
          )
    ) then
        raise exception
            'an active assignment still has no approved member-visible request';
    end if;
end;
$$;

notify pgrst, 'reload schema';
