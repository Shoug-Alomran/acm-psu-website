-- Faculty advisors can manage events without receiving general club-admin access.
-- Creation automatically assigns the creator to the event as Faculty Advisor.
-- Updates/deletions remain assignment-scoped and events-only.

create or replace function public.advisor_create_event(
    event_title text,
    event_status public.project_status default 'planning',
    starts_on date default null,
    ends_on date default null,
    chapter_year text default null,
    category text default null,
    summary text default null,
    site_path text default null,
    repo_url text default null,
    visibility public.content_visibility default 'internal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    new_id uuid;
    new_slug text;
begin
    if not public.is_advisory_instructor() then
        raise exception 'Only an advisory instructor may create an event here.' using errcode = '42501';
    end if;

    if nullif(btrim(event_title), '') is null then
        raise exception 'Event title is required.';
    end if;
    if starts_on is not null and ends_on is not null and ends_on < starts_on then
        raise exception 'The event end date cannot be before the start date.';
    end if;

    new_slug := trim(both '-' from regexp_replace(lower(btrim(event_title)), '[^a-z0-9]+', '-', 'g'));
    if new_slug = '' then
        new_slug := 'event';
    end if;
    new_slug := left(new_slug, 48) || '-' || substr(gen_random_uuid()::text, 1, 8);

    insert into public.projects (
        slug, title, kind, status, starts_on, ends_on, chapter_year, category,
        summary, site_path, repo_url, visibility, created_by
    ) values (
        new_slug, btrim(event_title), 'event', event_status, starts_on, ends_on,
        nullif(btrim(chapter_year), ''), nullif(btrim(category), ''),
        nullif(btrim(summary), ''), nullif(btrim(site_path), ''),
        nullif(btrim(repo_url), ''), visibility, auth.uid()
    ) returning id into new_id;

    insert into public.project_organizers (project_id, user_id, role_text, is_lead, added_by)
    values (new_id, auth.uid(), 'Faculty Advisor', false, auth.uid())
    on conflict (project_id, user_id, role_text) do nothing;

    perform public.write_audit(
        action => 'event.advisor_created', category => 'events',
        entity_type => 'project', entity_id => new_id::text,
        entity_label => btrim(event_title), decision => 'created',
        summary => 'Faculty advisor created event "' || btrim(event_title) || '"',
        member_visible => false, related_project => new_id
    );

    return new_id;
end;
$$;

create or replace function public.advisor_update_event(
    event_id uuid,
    event_title text,
    event_status public.project_status,
    starts_on date default null,
    ends_on date default null,
    chapter_year text default null,
    category text default null,
    summary text default null,
    site_path text default null,
    repo_url text default null,
    visibility public.content_visibility default 'internal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before public.projects%rowtype;
begin
    select * into row_before from public.projects where id = event_id and deleted_at is null for update;
    if row_before.id is null then raise exception 'Event not found.'; end if;
    if row_before.kind <> 'event' then raise exception 'Advisory instructors may manage events only.' using errcode = '42501'; end if;
    if not public.advises_project(event_id) then raise exception 'You are not assigned to this event.' using errcode = '42501'; end if;
    if nullif(btrim(event_title), '') is null then raise exception 'Event title is required.'; end if;
    if starts_on is not null and ends_on is not null and ends_on < starts_on then
        raise exception 'The event end date cannot be before the start date.';
    end if;

    update public.projects set
        title = btrim(event_title), status = event_status,
        starts_on = advisor_update_event.starts_on,
        ends_on = advisor_update_event.ends_on,
        chapter_year = nullif(btrim(advisor_update_event.chapter_year), ''),
        category = nullif(btrim(advisor_update_event.category), ''),
        summary = nullif(btrim(advisor_update_event.summary), ''),
        site_path = nullif(btrim(advisor_update_event.site_path), ''),
        repo_url = nullif(btrim(advisor_update_event.repo_url), ''),
        visibility = advisor_update_event.visibility
    where id = event_id;

    perform public.write_audit(
        action => 'event.advisor_updated', category => 'events',
        entity_type => 'project', entity_id => event_id::text,
        entity_label => btrim(event_title), decision => 'updated',
        summary => 'Faculty advisor updated event "' || btrim(event_title) || '"',
        member_visible => false,
        before_state => jsonb_build_object('title', row_before.title, 'status', row_before.status, 'starts_on', row_before.starts_on, 'ends_on', row_before.ends_on),
        after_state => jsonb_build_object('title', btrim(event_title), 'status', event_status, 'starts_on', starts_on, 'ends_on', ends_on),
        related_project => event_id
    );
end;
$$;

create or replace function public.advisor_delete_event(
    event_id uuid,
    reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before public.projects%rowtype;
begin
    if nullif(btrim(reason), '') is null then raise exception 'A deletion reason is required.'; end if;
    select * into row_before from public.projects where id = event_id and deleted_at is null for update;
    if row_before.id is null then raise exception 'Event not found.'; end if;
    if row_before.kind <> 'event' then raise exception 'Advisory instructors may delete events only.' using errcode = '42501'; end if;
    if not public.advises_project(event_id) then raise exception 'You are not assigned to this event.' using errcode = '42501'; end if;

    update public.projects set deleted_at = now(), status = 'archived' where id = event_id;

    perform public.write_audit(
        action => 'event.advisor_deleted', category => 'events',
        entity_type => 'project', entity_id => event_id::text,
        entity_label => row_before.title, decision => 'deleted',
        summary => 'Faculty advisor removed event "' || row_before.title || '"',
        reason => btrim(reason), member_visible => false,
        before_state => jsonb_build_object('status', row_before.status, 'deleted_at', row_before.deleted_at),
        after_state => jsonb_build_object('status', 'archived', 'deleted_at', now()),
        related_project => event_id
    );
end;
$$;

revoke execute on function public.advisor_create_event(text, public.project_status, date, date, text, text, text, text, text, public.content_visibility) from public, anon;
revoke execute on function public.advisor_update_event(uuid, text, public.project_status, date, date, text, text, text, text, text, public.content_visibility) from public, anon;
revoke execute on function public.advisor_delete_event(uuid, text) from public, anon;
grant execute on function public.advisor_create_event(text, public.project_status, date, date, text, text, text, text, text, public.content_visibility) to authenticated;
grant execute on function public.advisor_update_event(uuid, text, public.project_status, date, date, text, text, text, text, text, public.content_visibility) to authenticated;
grant execute on function public.advisor_delete_event(uuid, text) to authenticated;
