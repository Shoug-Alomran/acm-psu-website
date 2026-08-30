-- ===========================================================================
-- 0032 — The ACM Club Hackathon project.
--
-- The retired Positions spreadsheet carried nine HACK26-* roles under a
-- project name that has no row in public.projects, so those roles had nothing
-- to attach to. This creates it.
--
-- Only the fields that were actually specified are set. summary, description,
-- category, ends_on, site_path, external_url, repo_url and cover_path are left
-- null on purpose: a plausible-looking summary invented here would be
-- indistinguishable from one an organiser wrote, and the public project pages
-- read these columns directly.
--
-- NOTE ON VISIBILITY. This project is 'internal', which is deliberate and has
-- a visible consequence: its event roles will NOT appear on the public
-- positions page, because public_event_openings requires
-- `pr.visibility = 'public'`. Active members will see them in the portal via
-- event_position_availability. Change the project to 'public' when the
-- hackathon is announced and its roles appear on the public page with no
-- further migration.
-- ===========================================================================

insert into public.projects
    (slug, title, kind, status, starts_on, chapter_year, visibility, sort_index)
values
    ('acm-club-hackathon-261',
     'ACM Club Hackathon — Term 261',
     'event',
     'planning',
     date '2026-10-24',
     '2026',
     'internal',
     20)
on conflict (slug) do nothing;

do $$
declare
    project_id uuid;
    project_row public.projects%rowtype;
begin
    select * into project_row
      from public.projects
     where slug = 'acm-club-hackathon-261';

    if not found then
        raise exception 'acm-club-hackathon-261 was not created';
    end if;

    project_id := project_row.id;

    -- `on conflict do nothing` above means a pre-existing row is left exactly
    -- as it is. Say so rather than letting a silent no-op look like a write.
    if project_row.created_at < now() - interval '1 minute' then
        raise notice
            'Project acm-club-hackathon-261 already existed (%); left unchanged.',
            project_id;
    else
        raise notice 'Created project acm-club-hackathon-261 (%)', project_id;
    end if;

    if project_row.title <> 'ACM Club Hackathon — Term 261' then
        raise warning
            'acm-club-hackathon-261 has title "%", not the requested one.',
            project_row.title;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
    p public.projects%rowtype;
begin
    select * into p from public.projects where slug = 'acm-club-hackathon-261';

    if not found then
        raise exception 'The hackathon project is missing';
    end if;

    if p.deleted_at is not null then
        raise exception 'The hackathon project is soft-deleted';
    end if;

    -- An internal project must not be reachable from the public opening view.
    if exists (
        select 1 from public.public_event_openings where project_id = p.id
    ) then
        raise exception
            'An internal project is exposed through public_event_openings';
    end if;
end;
$$;

notify pgrst, 'reload schema';
