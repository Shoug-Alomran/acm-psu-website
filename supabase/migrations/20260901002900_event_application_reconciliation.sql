-- ===========================================================================
-- 0029 — Reconcile event assignments with member-visible applications.
--
-- An approved participation is the authoritative record that a member holds an
-- event assignment. Older/live data can contain that participation without a
-- matching event_position_applications row, which makes the member portal look
-- empty while registration logic reports that the member already has the role.
--
-- This migration repairs that split-brain state and makes registration
-- idempotent: clicking register for a position already requested/assigned
-- returns the existing application instead of surfacing a duplicate error.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Repair existing live assignments so every assignment is visible under
-- "Your requests" and exportable to the Position Applications worksheet.
-- ---------------------------------------------------------------------------
insert into public.event_position_applications (
    event_position_id,
    user_id,
    availability,
    note,
    status,
    admin_note,
    decided_by,
    decided_at,
    created_at,
    updated_at
)
select
    p.event_position_id,
    p.user_id,
    'Existing ACM assignment',
    null,
    'approved'::request_status,
    'Recovered from the verified event assignment record.',
    p.verified_by,
    coalesce(p.verified_at, p.created_at),
    p.created_at,
    now()
from public.participations p
where p.event_position_id is not null
  and p.status in ('registered', 'confirmed', 'completed')
  and not exists (
      select 1
      from public.event_position_applications a
      where a.event_position_id = p.event_position_id
        and a.user_id = p.user_id
  );

-- If both records exist but disagree, the verified assignment wins. A member
-- who currently holds the role must see an approved request, not cancelled,
-- rejected or pending.
update public.event_position_applications a
   set status = 'approved',
       admin_note = coalesce(
           a.admin_note,
           'Reconciled with the verified event assignment record.'
       ),
       decided_by = coalesce(a.decided_by, p.verified_by),
       decided_at = coalesce(a.decided_at, p.verified_at, p.created_at),
       updated_at = now()
  from public.participations p
 where p.event_position_id = a.event_position_id
   and p.user_id = a.user_id
   and p.status in ('registered', 'confirmed', 'completed')
   and a.status <> 'approved';

-- ---------------------------------------------------------------------------
-- Registration is deliberately idempotent.
--
-- Repeated clicks, stale browser state or a pre-existing verified assignment
-- must never become scary duplicate/assignment errors. If the member already
-- has a pending/approved request, return it. If the participation exists but
-- its application does not, reconstruct the application and return it.
-- ---------------------------------------------------------------------------
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
    existing_assignment public.participations%rowtype;
    application_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sign in required.' using errcode = '42501';
    end if;

    if not public.is_active_member() then
        raise exception 'Only active ACM members may register for event positions.'
            using errcode = '42501';
    end if;

    -- Existing request first. Repeating a request is a no-op, not an error.
    select *
      into existing_app
      from public.event_position_applications
     where event_position_id = p_event_position_id
       and user_id = auth.uid()
     for update;

    if existing_app.id is not null
       and existing_app.status in ('pending', 'approved') then
        return existing_app.id;
    end if;

    -- A verified assignment is stronger evidence than the application table.
    -- Recover/repair the member-visible application before considering whether
    -- the opening is currently closed.
    select *
      into existing_assignment
      from public.participations
     where event_position_id = p_event_position_id
       and user_id = auth.uid()
       and status in ('registered', 'confirmed', 'completed')
     order by created_at desc
     limit 1;

    if existing_assignment.id is not null then
        if existing_app.id is null then
            insert into public.event_position_applications (
                event_position_id,
                user_id,
                availability,
                note,
                status,
                admin_note,
                decided_by,
                decided_at
            ) values (
                p_event_position_id,
                auth.uid(),
                coalesce(nullif(btrim(p_availability), ''), 'Existing ACM assignment'),
                nullif(btrim(coalesce(p_note, '')), ''),
                'approved',
                'Recovered from the verified event assignment record.',
                existing_assignment.verified_by,
                coalesce(existing_assignment.verified_at, existing_assignment.created_at)
            )
            returning id into application_id;
        else
            update public.event_position_applications
               set availability = coalesce(
                       nullif(btrim(p_availability), ''),
                       availability,
                       'Existing ACM assignment'
                   ),
                   note = coalesce(
                       nullif(btrim(coalesce(p_note, '')), ''),
                       note
                   ),
                   status = 'approved',
                   admin_note = coalesce(
                       admin_note,
                       'Reconciled with the verified event assignment record.'
                   ),
                   decided_by = coalesce(
                       decided_by,
                       existing_assignment.verified_by
                   ),
                   decided_at = coalesce(
                       decided_at,
                       existing_assignment.verified_at,
                       existing_assignment.created_at
                   ),
                   updated_at = now()
             where id = existing_app.id
            returning id into application_id;
        end if;

        return application_id;
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
    elsif existing_app.status = 'rejected' then
        -- A rejected application can be submitted again while the opening is
        -- still open. Preserve the same row for a clean audit/history trail.
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
        return existing_app.id;
    end if;

    return application_id;
end;
$$;

revoke all on function public.register_event_position_application(uuid, text, text)
    from public, anon;
grant execute on function public.register_event_position_application(uuid, text, text)
    to authenticated;

-- Make sure the direct member query used by the current portal can always read
-- the member's own application records. RLS still limits rows to the caller.
grant select on public.event_position_applications to authenticated;
grant select on public.event_positions to authenticated;

notify pgrst, 'reload schema';
