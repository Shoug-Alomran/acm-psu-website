-- ===========================================================================
-- 0064 — Deleting a project or event from the admin console.
--
-- A faculty advisor could already remove an event they organise
-- (advisor_delete_event, migration 0047). A club admin could not remove
-- anything: the only way to retire a project was to set its status to
-- 'archived', which leaves it in every list and says nothing about why.
--
-- WHY THIS IS A FUNCTION AND NOT AN UPDATE. A club admin already has DML on
-- projects, so the row could be updated directly. What that route cannot do is
-- record the reason, and a project removed with no explanation is exactly the
-- record a committee needs a year later. It also cannot close the event's
-- registration form in the same transaction, which is the part that would be
-- forgotten by hand.
--
-- WHY IT IS A SOFT DELETE. deleted_at, never DELETE. The archive items,
-- participations, contributions and registrations attached to a project are
-- people's records of work they did; a hard delete would take them with it.
-- Removing a project hides it, and admin_restore_project() brings it back.
-- ===========================================================================

create or replace function public.admin_delete_project(
    project_id uuid,
    reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    row_before public.projects%rowtype;
    closed_form text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may remove a project.' using errcode = '42501';
    end if;
    if nullif(btrim(reason), '') is null then
        raise exception 'A reason is required so the record says why this was removed.';
    end if;

    select * into row_before from public.projects
     where id = admin_delete_project.project_id and deleted_at is null
       for update;
    if row_before.id is null then
        raise exception 'Project not found, or it has already been removed.';
    end if;

    update public.projects
       set deleted_at = now(), status = 'archived'
     where id = admin_delete_project.project_id;

    -- A removed event must stop accepting registrations. The form is closed,
    -- never deleted: its worksheet and every registration recorded against it
    -- stay exactly as they are, and restoring the project can reopen it.
    update public.event_registration_forms
       set is_active = false
     where project_id = admin_delete_project.project_id
       and is_active
    returning event_key into closed_form;

    perform public.write_audit(
        action => 'project.deleted', category => 'events',
        entity_type => 'project', entity_id => admin_delete_project.project_id::text,
        entity_label => row_before.title, decision => 'deleted',
        summary => 'Removed ' || row_before.kind || ' "' || row_before.title || '"' ||
            coalesce(' and closed its registration form (' || closed_form || ')', ''),
        reason => btrim(reason), member_visible => false,
        before_state => jsonb_build_object(
            'status', row_before.status, 'deleted_at', row_before.deleted_at,
            'visibility', row_before.visibility),
        after_state => jsonb_build_object(
            'status', 'archived', 'deleted_at', now(),
            'registration_closed', closed_form),
        related_project => admin_delete_project.project_id
    );
end;
$$;

comment on function public.admin_delete_project is
    'Soft-removes a project or event and closes its registration form. Nothing '
    'attached to the project is deleted; admin_restore_project() reverses it.';

-- ---------------------------------------------------------------------------
-- Undo.
--
-- The status is deliberately left as 'archived' rather than guessed back to
-- what it was: the row does not record its previous status, and an admin
-- setting it themselves is better than this inventing one. Registration is
-- likewise left closed — reopening it is a decision, not a consequence.
-- ---------------------------------------------------------------------------
create or replace function public.admin_restore_project(project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    row_before public.projects%rowtype;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may restore a project.' using errcode = '42501';
    end if;

    select * into row_before from public.projects
     where id = admin_restore_project.project_id and deleted_at is not null
       for update;
    if row_before.id is null then
        raise exception 'No removed project with that id.';
    end if;

    update public.projects set deleted_at = null
     where id = admin_restore_project.project_id;

    perform public.write_audit(
        action => 'project.restored', category => 'events',
        entity_type => 'project', entity_id => admin_restore_project.project_id::text,
        entity_label => row_before.title, decision => 'restored',
        summary => 'Restored ' || row_before.kind || ' "' || row_before.title ||
            '". It is archived and its registration form is still closed.',
        member_visible => false,
        before_state => jsonb_build_object('deleted_at', row_before.deleted_at),
        after_state => jsonb_build_object('deleted_at', null, 'status', row_before.status),
        related_project => admin_restore_project.project_id
    );
end;
$$;

comment on function public.admin_restore_project is
    'Reverses admin_delete_project(). The project returns archived, with its '
    'registration form still closed — both are decisions for an admin to make.';

revoke execute on function public.admin_delete_project(uuid, text) from public, anon;
revoke execute on function public.admin_restore_project(uuid) from public, anon;
grant execute on function public.admin_delete_project(uuid, text) to authenticated;
grant execute on function public.admin_restore_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The advisor path does the same thing.
--
-- advisor_delete_event (migration 0047) predates registration forms, so an
-- event removed by a faculty advisor kept accepting signups. Same rule as
-- above: the form is closed, nothing attached to it is deleted.
-- ---------------------------------------------------------------------------
create or replace function public.advisor_delete_event(
    event_id uuid,
    reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    row_before public.projects%rowtype;
    closed_form text;
begin
    if nullif(btrim(reason), '') is null then raise exception 'A deletion reason is required.'; end if;
    select * into row_before from public.projects where id = event_id and deleted_at is null for update;
    if row_before.id is null then raise exception 'Event not found.'; end if;
    if row_before.kind <> 'event' then raise exception 'Advisory instructors may delete events only.' using errcode = '42501'; end if;
    if not public.advises_project(event_id) then raise exception 'You are not assigned to this event.' using errcode = '42501'; end if;

    update public.projects set deleted_at = now(), status = 'archived' where id = event_id;

    update public.event_registration_forms
       set is_active = false
     where project_id = advisor_delete_event.event_id
       and is_active
    returning event_key into closed_form;

    perform public.write_audit(
        action => 'event.advisor_deleted', category => 'events',
        entity_type => 'project', entity_id => event_id::text,
        entity_label => row_before.title, decision => 'deleted',
        summary => 'Faculty advisor removed event "' || row_before.title || '"' ||
            coalesce(' and closed its registration form (' || closed_form || ')', ''),
        reason => btrim(reason), member_visible => false,
        before_state => jsonb_build_object('status', row_before.status, 'deleted_at', row_before.deleted_at),
        after_state => jsonb_build_object('status', 'archived', 'deleted_at', now(),
            'registration_closed', closed_form),
        related_project => event_id
    );
end;
$$;
