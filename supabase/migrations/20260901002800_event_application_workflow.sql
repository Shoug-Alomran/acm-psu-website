-- ===========================================================================
-- 0028 — Reliable event-position registration and member withdrawal.
--
-- Registration and withdrawal are workflow operations, not raw table edits.
-- Keeping them in database functions means the browser cannot report success
-- unless Supabase actually committed the application, and the 72-hour rule is
-- enforced identically for every client.
-- ===========================================================================

create or replace function public.register_event_position_application(
    p_event_position_id uuid,
    p_availability text,
    p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    pos record;
    existing_app public.event_position_applications%rowtype;
    application_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sign in required.' using errcode = '42501';
    end if;

    if not public.is_active_member() then
        raise exception 'Only active ACM members may register for event positions.' using errcode = '42501';
    end if;

    if nullif(btrim(coalesce(p_availability, '')), '') is null then
        raise exception 'Tell the organisers when you are available.' using errcode = '22023';
    end if;

    if char_length(p_availability) > 500 then
        raise exception 'Availability must be 500 characters or fewer.' using errcode = '22023';
    end if;

    if p_note is not null and char_length(p_note) > 800 then
        raise exception 'Note must be 800 characters or fewer.' using errcode = '22023';
    end if;

    select ep.id, ep.title, ep.is_open, ep.closes_on, ep.project_id
      into pos
      from public.event_positions ep
     where ep.id = p_event_position_id
     for update;

    if pos is null then
        raise exception 'That event position no longer exists.';
    end if;

    if not pos.is_open then
        raise exception 'That event position is closed.';
    end if;

    if pos.closes_on is not null and pos.closes_on < current_date then
        raise exception 'Registration for that event position has closed.';
    end if;

    select *
      into existing_app
      from public.event_position_applications
     where event_position_id = p_event_position_id
       and user_id = auth.uid()
     for update;

    if existing_app.id is null then
        insert into public.event_position_applications (
            event_position_id,
            user_id,
            availability,
            note,
            status
        ) values (
            p_event_position_id,
            auth.uid(),
            btrim(p_availability),
            nullif(btrim(coalesce(p_note, '')), ''),
            'pending'
        )
        returning id into application_id;
    elsif existing_app.status = 'cancelled' then
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
    else
        raise exception 'You already have an application for this position.' using errcode = '23505';
    end if;

    return application_id;
end;
$$;

comment on function public.register_event_position_application(uuid, text, text) is
    'Creates or reopens the signed-in active member''s application for one event position. Cancelled applications are reused so the unique member/position record remains stable.';

revoke all on function public.register_event_position_application(uuid, text, text) from public, anon;
grant execute on function public.register_event_position_application(uuid, text, text) to authenticated;


create or replace function public.unregister_event_position_application(
    p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    req record;
    withdrawal_deadline timestamptz;
begin
    if auth.uid() is null then
        raise exception 'Sign in required.' using errcode = '42501';
    end if;

    select
        a.id,
        a.user_id,
        a.status,
        a.event_position_id,
        ep.project_id,
        ep.title,
        p.starts_on
      into req
      from public.event_position_applications a
      join public.event_positions ep on ep.id = a.event_position_id
      join public.projects p on p.id = ep.project_id
     where a.id = p_application_id
     for update of a;

    if req is null then
        raise exception 'Application not found.';
    end if;

    if req.user_id <> auth.uid() then
        raise exception 'You can only unregister your own application.' using errcode = '42501';
    end if;

    if req.status not in ('pending', 'approved') then
        raise exception 'This application can no longer be unregistered.';
    end if;

    -- projects currently store a calendar start date rather than an event start
    -- time. Treat midnight at the start of that date in Riyadh as the boundary.
    -- If a project has no start date, there is no meaningful 72-hour cutoff and
    -- withdrawal remains available until an admin closes the workflow.
    if req.starts_on is not null then
        withdrawal_deadline :=
            (req.starts_on::timestamp at time zone 'Asia/Riyadh') - interval '72 hours';

        if now() >= withdrawal_deadline then
            raise exception 'Online unregistration closes 72 hours before the event starts. Contact an organiser for help.';
        end if;
    end if;

    update public.event_position_applications
       set status = 'cancelled',
           updated_at = now()
     where id = req.id;

    -- Approval creates a verified participation row. Withdrawing must release
    -- that assignment as well so the member record and role capacity agree.
    update public.participations
       set status = 'withdrawn',
           updated_at = now()
     where user_id = auth.uid()
       and project_id = req.project_id
       and event_position_id = req.event_position_id
       and status <> 'withdrawn';
end;
$$;

comment on function public.unregister_event_position_application(uuid) is
    'Lets a member withdraw their own pending or approved event-position application until 72 hours before the project start date. Approved participation is marked withdrawn rather than deleted.';

revoke all on function public.unregister_event_position_application(uuid) from public, anon;
grant execute on function public.unregister_event_position_application(uuid) to authenticated;

notify pgrst, 'reload schema';
