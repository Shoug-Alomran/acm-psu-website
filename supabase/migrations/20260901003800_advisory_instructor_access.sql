-- Assignment-scoped access for faculty advisors and workshop instructors.
-- The enum value is committed by the preceding migration before it is used.

create or replace function public.is_advisory_instructor()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.has_admin_role('advisory_instructor'); $$;

create or replace function public.advises_project(target_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select public.is_advisory_instructor() and exists (
        select 1 from public.project_organizers po
        where po.project_id = target_project and po.user_id = auth.uid()
    );
$$;

comment on function public.advises_project is
    'True only when the signed-in advisory instructor is explicitly assigned as a project organizer.';

create policy projects_select_assigned_advisor on public.projects
    for select to authenticated
    using (deleted_at is null and public.advises_project(id));

create policy participations_select_assigned_advisor on public.participations
    for select to authenticated
    using (public.advises_project(project_id));

create policy contributions_select_assigned_advisor on public.contributions
    for select to authenticated
    using (project_id is not null and public.advises_project(project_id));

create policy contribution_evidence_select_assigned_advisor on public.contribution_evidence
    for select to authenticated
    using (exists (
        select 1 from public.contributions c
        where c.id = contribution_id
          and c.project_id is not null
          and public.advises_project(c.project_id)
    ));

create policy app_users_select_assigned_advisor on public.app_users
    for select to authenticated
    using (
        public.is_advisory_instructor() and exists (
            select 1 from public.participations pa
            where pa.user_id = id and public.advises_project(pa.project_id)
        )
    );

create or replace function public.advisor_set_participation_status(
    participation_id uuid,
    new_status participation_status,
    reason text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    row_before public.participations%rowtype;
    project_name text;
begin
    select * into row_before from public.participations
     where id = participation_id for update;
    if row_before.id is null then raise exception 'Participation not found.'; end if;
    if not public.advises_project(row_before.project_id) then
        raise exception 'You are not assigned to this project.' using errcode = '42501';
    end if;
    if new_status not in ('confirmed', 'completed', 'withdrawn', 'no_show') then
        raise exception 'Unsupported participation status.';
    end if;
    select title into project_name from public.projects where id = row_before.project_id;
    update public.participations
       set status = new_status,
           verified_at = case when new_status in ('confirmed', 'completed') then now() else null end,
           verified_by = auth.uid(),
           note = coalesce(nullif(btrim(reason), ''), note)
     where id = participation_id;
    perform public.write_audit(
        action => 'participation.advisor_updated', category => 'events',
        entity_type => 'participation', entity_id => participation_id::text,
        entity_label => project_name, decision => 'updated',
        summary => 'Participation marked ' || replace(new_status::text, '_', ' '),
        reason => reason, member_visible => true,
        before_state => jsonb_build_object('status', row_before.status),
        after_state => jsonb_build_object('status', new_status),
        related_project => row_before.project_id, related_member => row_before.user_id
    );
end;
$$;

create or replace function public.advisor_verify_contribution(
    contribution_id uuid,
    reason text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    row_before public.contributions%rowtype;
begin
    select * into row_before from public.contributions
     where id = contribution_id for update;
    if row_before.id is null then raise exception 'Contribution not found.'; end if;
    if row_before.project_id is null or not public.advises_project(row_before.project_id) then
        raise exception 'You are not assigned to this contribution project.' using errcode = '42501';
    end if;
    if row_before.status <> 'submitted' then
        raise exception 'Only submitted contributions can be verified here.';
    end if;
    update public.contributions
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_note = nullif(btrim(reason), ''), verified_at = now()
     where id = contribution_id;
    perform public.write_audit(
        action => 'contribution.advisor_verified', category => 'contributions',
        entity_type => 'contribution', entity_id => contribution_id::text,
        entity_label => row_before.title, decision => 'approved',
        summary => 'Verified "' || row_before.title || '"', reason => reason,
        member_visible => true,
        before_state => jsonb_build_object('status', row_before.status),
        after_state => jsonb_build_object('status', 'approved'),
        related_project => row_before.project_id, related_member => row_before.user_id
    );
end;
$$;

revoke execute on function public.advisor_set_participation_status(uuid, participation_status, text) from public, anon;
revoke execute on function public.advisor_verify_contribution(uuid, text) from public, anon;
grant execute on function public.advisor_set_participation_status(uuid, participation_status, text) to authenticated;
grant execute on function public.advisor_verify_contribution(uuid, text) to authenticated;
