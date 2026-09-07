-- ===========================================================================
-- PSU AI Hackathon 2.0 — the term 252 edition, now published on the site.
--
-- The event ran 12 April – 2 May 2026 (second semester 2025–2026, term 252)
-- and its page has just been added at
-- /projects/hackathons/psu-ai-hackathon-2.0/. This records it in
-- public.projects so it appears in the database-backed archive and admin
-- console alongside CTF 2.0, rather than existing only as a static page.
--
-- Note this is NOT acm-club-hackathon-261 (20260901003200_hackathon_project.sql).
-- That row is the planned term 261 club hackathon and stays internal; this one
-- is a completed, public event.
--
-- chapter_year follows the existing rows' convention of a calendar year rather
-- than a term code; the term is stated in the summary where it is readable.
-- ===========================================================================

insert into public.projects
    (slug, title, kind, status, category, summary, starts_on, ends_on,
     chapter_year, site_path, visibility, sort_index)
values
    ('psu-ai-hackathon-2-0',
     'PSU AI Hackathon 2.0',
     'event',
     'completed',
     'hackathon',
     'Term 252 hackathon uniting current students with Alumni and COOP students, '
     'under the patronage of the Dean of CCIS. Four AI themes, a four-stage '
     'format from proposal screening to a jury pitch, and over SAR 9,000 in prizes.',
     date '2026-04-12',
     date '2026-05-02',
     '2026',
     '/projects/hackathons/psu-ai-hackathon-2.0/',
     'public',
     40)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
    p public.projects%rowtype;
begin
    select * into p from public.projects where slug = 'psu-ai-hackathon-2-0';

    if not found then
        raise exception 'psu-ai-hackathon-2-0 was not created';
    end if;

    if p.deleted_at is not null then
        raise exception 'psu-ai-hackathon-2-0 is soft-deleted';
    end if;

    -- A completed event that is still linked from projects.html must keep a
    -- site_path, or the archive loses the page it is describing.
    if p.site_path is null then
        raise exception 'psu-ai-hackathon-2-0 has no site_path';
    end if;
end;
$$;

notify pgrst, 'reload schema';
