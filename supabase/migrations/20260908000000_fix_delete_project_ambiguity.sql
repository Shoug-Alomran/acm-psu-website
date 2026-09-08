-- ===========================================================================
-- 0065 — admin_delete_project: qualify the ambiguous column reference.
--
-- The function takes a parameter named project_id, and
-- event_registration_forms also has a project_id column. In
--
--     where project_id = admin_delete_project.project_id
--
-- the right-hand side is qualified but the left is not, so plpgsql cannot tell
-- whether the bare name is the column or the parameter and raises
-- "column reference \"project_id\" is ambiguous" (42702) at runtime. PostgREST
-- returns that as a 400, so every attempt to remove a project failed with the
-- reason recorded nowhere the admin could see it.
--
-- The right-hand side of every other comparison in 0064 is qualified against a
-- column name that is not also a parameter (id, deleted_at), which is why this
-- was the only statement that failed — and why it failed at runtime rather
-- than when the function was created. plpgsql resolves identifiers when the
-- statement first executes, so a create-time check cannot catch it.
--
-- Fixed by aliasing the table, which makes both sides unambiguous by
-- construction rather than by choosing names that happen not to collide.
-- admin_restore_project and advisor_delete_event are unaffected: neither has a
-- parameter whose name matches a column they reference bare.
-- ===========================================================================

create or replace function public.admin_delete_project(
    project_id uuid,
    reason text
)
returns void
language plpgsql
security definer
set search_path = public
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

    select * into row_before from public.projects p
     where p.id = admin_delete_project.project_id and p.deleted_at is null
       for update;
    if row_before.id is null then
        raise exception 'Project not found, or it has already been removed.';
    end if;

    update public.projects p
       set deleted_at = now(), status = 'archived'
     where p.id = admin_delete_project.project_id;

    -- A removed event must stop accepting registrations. The form is closed,
    -- never deleted: its worksheet and every registration recorded against it
    -- stay exactly as they are, and restoring the project can reopen it.
    update public.event_registration_forms f
       set is_active = false
     where f.project_id = admin_delete_project.project_id
       and f.is_active
    returning f.event_key into closed_form;

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
