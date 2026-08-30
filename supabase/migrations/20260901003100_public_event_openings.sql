-- ===========================================================================
-- 0031 — One authoritative registration path.
--
-- The public positions page registered members through Apps Script into a
-- Google Sheets "Position Signups" tab. Supabase never saw those rows, so the
-- club had two independent registration records that could not agree: a member
-- could hold a place on the public page and not exist in the portal, and the
-- portal could approve someone the spreadsheet thought was still waitlisted.
--
-- From here the only path is:
--
--   event_positions -> event_position_applications -> admin decision
--                   -> participations -> Position Applications snapshot
--
-- This migration gives the public website a read-only, public-safe view of the
-- open roles so it can keep its page without owning any registration state,
-- and brings the one known spreadsheet signup across explicitly.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- What an anonymous visitor may see about an open role.
--
-- event_position_availability CANNOT be used here. It is granted to
-- authenticated only and its WHERE clause is `is_active_member() or
-- is_staff()`, which is exactly right for the portal and wrong for the public
-- site: it exposes roles on INTERNAL projects to any signed-in member. A
-- separate view is the safe answer, not a loosened grant on that one.
--
-- WHY IT RUNS AS OWNER, AGAIN. The counts below are taken across every
-- applicant. Under security_invoker = true an anonymous visitor's RLS on
-- event_position_applications returns no rows at all, so every role would read
-- as completely empty and "FILLED" would never appear.
--
-- THE WHERE CLAUSE IS THEREFORE THIS VIEW'S AUTHORIZATION, and it is stricter
-- than any policy it replaces: the project must be public and live, and the
-- role must be open and not past its closing date. An internal project's
-- staffing is not reachable here at any time.
--
-- Only aggregates cross the boundary from event_position_applications:
-- count(a.id), never a.user_id, a.availability, a.note or a.admin_note. If you
-- add a column here, ask whether it is an aggregate. If it names a person, it
-- does not belong.
-- ---------------------------------------------------------------------------
create or replace view public.public_event_openings
with (security_invoker = false) as
select
    ep.id                as event_position_id,
    ep.title,
    ep.description,
    ep.openings,
    ep.closes_on,
    count(a.id) filter (where a.status = 'approved')                        as filled,
    greatest(ep.openings - count(a.id) filter (where a.status = 'approved'), 0)
                                                                           as remaining,
    pr.id                as project_id,
    pr.slug              as project_slug,
    pr.title             as project_title,
    pr.summary           as project_summary,
    pr.starts_on         as project_starts_on,
    pr.site_path         as project_site_path
from public.event_positions ep
join public.projects pr on pr.id = ep.project_id
left join public.event_position_applications a on a.event_position_id = ep.id
where pr.visibility = 'public'
  and pr.deleted_at is null
  and ep.is_open
  and (ep.closes_on is null or ep.closes_on >= current_date)
group by ep.id, pr.id;

comment on view public.public_event_openings is
    'Public-safe open event roles: public live projects only, aggregate '
    'capacity counts only, no applicant identity or application content. '
    'Registration is not possible from here — it requires a signed-in member '
    'and goes through register_event_position_application().';

revoke all on public.public_event_openings from public;
grant select on public.public_event_openings to anon, authenticated;


-- ---------------------------------------------------------------------------
-- The Workshop Presenter role, as a real Supabase record.
--
-- Created only if it is genuinely absent. Matching is by project and title so
-- re-running this cannot produce a second copy of the same role.
-- ---------------------------------------------------------------------------
do $$
declare
    jam_id      uuid;
    position_id uuid;
    shoug_id constant uuid := '621ce2ac-720d-4f8e-8189-28f56adf5a2e';
    assignment  public.participations%rowtype;
    existing_app public.event_position_applications%rowtype;
begin
    select id into jam_id
      from public.projects
     where slug = 'ai-programming-jam-2026'
       and deleted_at is null;

    if jam_id is null then
        raise exception 'Project ai-programming-jam-2026 was not found';
    end if;

    select id into position_id
      from public.event_positions
     where project_id = jam_id
       and lower(btrim(title)) = 'workshop presenter';

    if position_id is null then
        insert into public.event_positions
            (project_id, title, description, openings, is_open, closes_on)
        values (
            jam_id,
            'Workshop Presenter',
            'Teach one preparation session and help members apply the workflow '
            || 'during guided practice. Slides and curriculum are provided; '
            || 'presenters deliver approved material rather than authoring it.',
            2,
            true,
            date '2026-09-07'
        )
        returning id into position_id;

        raise notice 'Created event position Workshop Presenter (%)', position_id;
    else
        raise notice 'Event position Workshop Presenter already existed (%)', position_id;
    end if;

    -- -----------------------------------------------------------------------
    -- The spreadsheet-only signup, brought across.
    --
    -- Deliberately 'pending'. A signup on the old public page was a request,
    -- not a decision, and nothing in the Google Sheet constitutes an ACM
    -- approval. The one exception is a genuine verified participation already
    -- tied to THIS EXACT position — that is a real prior decision, and the
    -- 0030 invariant would resolve it to approved anyway, so honour it here
    -- rather than writing a contradiction and letting a trigger correct it.
    -- -----------------------------------------------------------------------
    if not exists (select 1 from public.app_users where id = shoug_id) then
        raise exception 'Member account % was not found', shoug_id;
    end if;

    select * into assignment
      from public.participations
     where user_id = shoug_id
       and event_position_id = position_id
       and status in ('registered', 'confirmed', 'completed')
     limit 1;

    select * into existing_app
      from public.event_position_applications
     where user_id = shoug_id
       and event_position_id = position_id;

    if existing_app.id is not null then
        raise notice
            'Application already existed for Workshop Presenter (% / status %)',
            existing_app.id, existing_app.status;
    elsif assignment.id is not null then
        -- A real approved assignment exists on this exact position.
        perform public.sync_application_from_participation(assignment.id);
        raise notice 'Imported signup as approved from the verified assignment record.';
    else
        insert into public.event_position_applications
            (event_position_id, user_id, availability, note, status, admin_note)
        values (
            position_id,
            shoug_id,
            'Available for the rehearsal and the assigned session.',
            'Imported from the retired public Position Signups worksheet.',
            'pending',
            'Migrated from the legacy Google Sheets signup on 2026-08-30. '
            || 'Awaiting an organiser decision — the spreadsheet row was never '
            || 'an ACM approval.'
        );

        raise notice 'Imported the legacy signup as a pending request.';
    end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
    position_id uuid;
    visible integer;
begin
    select ep.id into position_id
      from public.event_positions ep
      join public.projects pr on pr.id = ep.project_id
     where pr.slug = 'ai-programming-jam-2026'
       and lower(btrim(ep.title)) = 'workshop presenter';

    if position_id is null then
        raise exception 'Workshop Presenter was not created';
    end if;

    if (select openings from public.event_positions where id = position_id) <> 2 then
        raise exception 'Workshop Presenter should have 2 openings';
    end if;

    if not exists (
        select 1 from public.event_position_applications
        where user_id = '621ce2ac-720d-4f8e-8189-28f56adf5a2e'
          and event_position_id = position_id
    ) then
        raise exception 'The imported Workshop Presenter application is missing';
    end if;

    if (select count(*) from public.event_position_applications
         where user_id = '621ce2ac-720d-4f8e-8189-28f56adf5a2e'
           and event_position_id = position_id) <> 1 then
        raise exception 'Duplicate applications were created for Workshop Presenter';
    end if;

    -- The public view must be readable anonymously and must not leak internal
    -- projects or any applicant identity.
    if not has_table_privilege('anon', 'public.public_event_openings', 'select') then
        raise exception 'anon cannot read public_event_openings';
    end if;

    if has_table_privilege('anon', 'public.event_position_applications', 'insert') then
        raise exception 'anon can still insert event_position_applications';
    end if;

    if has_table_privilege('anon', 'public.event_position_applications', 'select') then
        raise exception 'anon can still read event_position_applications';
    end if;

    select count(*) into visible
      from public.public_event_openings o
      join public.projects pr on pr.id = o.project_id
     where pr.visibility <> 'public' or pr.deleted_at is not null;

    if visible > 0 then
        raise exception 'public_event_openings exposes % non-public project row(s)', visible;
    end if;

    if strpos(pg_get_viewdef('public.public_event_openings'::regclass), 'user_id') > 0 then
        raise exception 'public_event_openings references applicant identity';
    end if;
end;
$$;

notify pgrst, 'reload schema';
