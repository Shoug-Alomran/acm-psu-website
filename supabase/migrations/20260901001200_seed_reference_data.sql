-- ===========================================================================
-- 0012 — Seed data.
--
-- Two jobs:
--   1. A starting catalogue of ACM positions, which admins then edit.
--   2. Migrating what the website already publishes into the database, so the
--      archive starts populated rather than empty. Files that are already
--      committed to the repository are recorded with site_path — the archive
--      links to the file where it already lives instead of re-uploading it.
--
-- Everything here is idempotent (on conflict do nothing), so re-running a
-- migration set against an existing database will not duplicate rows.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Positions. Ranks leave gaps so a future committee can slot new roles in
-- without renumbering the whole list.
-- ---------------------------------------------------------------------------
insert into public.positions (slug, title, title_ar, category, rank, description) values
    ('president',           'President',                'رئيس النادي',        'executive',  10, 'Leads the chapter and represents it to the university.'),
    ('vice-president',      'Vice President',           'نائب الرئيس',        'executive',  20, 'Deputises for the president and coordinates initiatives.'),
    ('secretary',           'Secretary',                'أمين السر',          'executive',  30, 'Keeps records, minutes and official correspondence.'),
    ('treasurer',           'Treasurer',                'أمين الصندوق',       'executive',  40, 'Manages budget and reimbursements.'),
    ('events-coordinator',  'Events Coordinator',       'منسق الفعاليات',     'lead',       50, 'Plans and runs chapter events.'),
    ('cybersecurity-lead',  'Cybersecurity Lead',       'قائد الأمن السيبراني','lead',       60, 'Leads CTF and security programming.'),
    ('web-development-lead','Web Development Lead',     'قائد تطوير الويب',   'lead',       70, 'Owns the website and digital archive.'),
    ('media-lead',          'Media Lead',               'قائد الإعلام',       'lead',       80, 'Design, photography and communications.'),
    ('workshop-lead',       'Workshop Lead',            'قائد الورش',         'lead',       90, 'Develops and delivers workshop material.'),
    ('committee-member',    'Committee Member',         'عضو اللجنة',         'committee', 100, 'Serves on an organising committee.'),
    ('member',              'Member',                   'عضو',                'general',   200, 'General assembly member.'),
    ('volunteer',           'Volunteer',                'متطوع',              'general',   210, 'Helps on specific events.'),
    ('faculty-advisor',     'Faculty Advisor',          'المشرف الأكاديمي',   'executive',   5, 'Faculty oversight of the chapter.')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Projects already published on the site.
--
-- site_path points at the hand-authored page. The database archive supplements
-- those pages; it does not replace them, so nothing currently live breaks.
-- ---------------------------------------------------------------------------
insert into public.projects
    (slug, title, kind, status, category, summary, starts_on, chapter_year,
     site_path, repo_url, visibility, sort_index)
values
    ('ai-programming-jam-2026', 'ACM Programming Jam 2026', 'event', 'active', 'jam',
     'Three-day AI-assisted build sprint with a workshop programme and a judged final.',
     date '2026-09-19', '2026',
     '/projects/programming-jams/ai-programming-jam-26/',
     'https://github.com/Shoug-Alomran/acm-programming-jam-2026', 'public', 10),

    ('ctf-3-0', 'ACM/CyberTech CTF 3.0', 'event', 'active', 'ctf',
     'Third edition of the joint capture-the-flag competition, with a preparatory workshop series.',
     date '2026-10-24', '2026',
     '/projects/ctfs/ctf-3.0/',
     'https://github.com/Shoug-Alomran/ACM-CTF-3.0', 'public', 20),

    ('ctf-2-0', 'CTF 2.0', 'event', 'completed', 'ctf',
     'Second capture-the-flag competition. Results verified and archived, workshop series published.',
     date '2026-04-20', '2026',
     '/projects/ctfs/ctf-2.0/',
     'https://github.com/Shoug-Alomran/psu-ctf2-web', 'public', 30)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- CTF 2.0 archive, migrated from projects/ctfs/ctf-2.0/archive-manifest.js.
--
-- The manifest stays in the repository so the existing static archive page
-- keeps working with no JavaScript changes; these rows make the same material
-- searchable across projects and manageable from the admin portal.
-- ---------------------------------------------------------------------------
do $$
declare
    project     uuid;
    results_dir uuid;
    shops_dir   uuid;
    module_dir  uuid;
    module      record;
begin
    select id into project from public.projects where slug = 'ctf-2-0';
    if project is null then return; end if;

    -- Skip entirely if this project already has archive rows.
    if exists (select 1 from public.archive_folders where project_id = project) then
        return;
    end if;

    insert into public.archive_folders (project_id, name, slug, section, description, visibility, sort_index)
    values (project, 'Results', 'results', 'results',
            'Privacy-safe report and archived results presentation.', 'public', 10)
    returning id into results_dir;

    insert into public.archive_folders (project_id, name, slug, section, description, visibility, sort_index)
    values (project, 'Workshop Content', 'workshops', 'workshops',
            'CyberTech Club CTF workshop series and supporting content.', 'public', 20)
    returning id into shops_dir;

    insert into public.archive_items
        (project_id, folder_id, name, kind, category, section, description,
         kind_label, format, size_label, state, site_path, visibility, occurred_on, published_at)
    values
        (project, results_dir, 'Public Competition Report', 'file', 'results', 'results',
         'Competition metrics, challenge analysis, and final standings with personal details removed.',
         'Privacy-safe PDF', 'PDF', '9 pages', 'Verified public edition',
         '/assets/reports/public/ctf-2-results-report-public.pdf', 'public', date '2026-08-29', now()),
        (project, results_dir, 'Results Presentation', 'file', 'results', 'results',
         'Interactive results deck preserved for event history; excluded from search indexing because it contains participant names.',
         'Archived HTML presentation', 'HTML', '6 slides', 'Noindex archive',
         '/projects/ctfs/ctf-2.0/results/presentation/', 'public', date '2026-08-29', now());

    for module in
        select * from (values
            ('01 — Recon & Web Proxies',            'module-01-recon-web-proxies',            10, date '2026-04-20', true,  true),
            ('02 — Access Control',                 'module-02-access-control',               20, date '2026-04-20', true,  false),
            ('03 — Injection Attacks',              'module-03-injection-attacks',            30, date '2026-04-21', false, false),
            ('04 — Broken Authentication',          'module-04-broken-authentication',        40, date '2026-04-22', true,  false),
            ('05 — API Exploitation & File Attacks','module-05-api-exploitation-file-attacks',50, date '2026-04-22', false, false)
        ) as t(name, dir, ord, day, has_cheat, has_slides)
    loop
        insert into public.archive_folders
            (project_id, parent_id, name, slug, section, visibility, sort_index)
        values (project, shops_dir, module.name, module.dir, 'workshops', 'public', module.ord)
        returning id into module_dir;

        insert into public.archive_items
            (project_id, folder_id, name, kind, category, section, description,
             kind_label, format, size_label, state, site_path, visibility, occurred_on, published_at)
        values (project, module_dir, 'Participant Handout', 'file', 'workshop-material', 'workshops',
                'Workshop handout for ' || module.name || '.',
                'PDF handout', 'PDF', '8 pages', 'Published',
                '/projects/ctfs/ctf-2.0/workshops/' || module.dir || '/participant-handout.pdf',
                'public', module.day, now());

        if module.has_slides then
            insert into public.archive_items
                (project_id, folder_id, name, kind, category, section, description,
                 kind_label, format, size_label, state, site_path, visibility, occurred_on, published_at)
            values (project, module_dir, 'Slide Deck', 'file', 'presentation', 'workshops',
                    'Presentation deck for ' || module.name || '.',
                    'PDF slides', 'PDF', '12 slides', 'Published',
                    '/projects/ctfs/ctf-2.0/workshops/' || module.dir || '/slide-deck.pdf',
                    'public', module.day, now());
        end if;

        if module.has_cheat then
            insert into public.archive_items
                (project_id, folder_id, name, kind, category, section, description,
                 kind_label, format, size_label, state, site_path, visibility, occurred_on, published_at)
            values (project, module_dir, 'Cheat Sheet', 'file', 'workshop-material', 'workshops',
                    'Quick-reference sheet for ' || module.name || '.',
                    'PDF cheat sheet', 'PDF', '1 page', 'Published',
                    '/projects/ctfs/ctf-2.0/workshops/' || module.dir || '/cheat-sheet.pdf',
                    'public', module.day, now());
        end if;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI Programming Jam 2026 workshop archive.
-- ---------------------------------------------------------------------------
do $$
declare
    project uuid;
    shops   uuid;
    day     record;
begin
    select id into project from public.projects where slug = 'ai-programming-jam-2026';
    if project is null then return; end if;
    if exists (select 1 from public.archive_folders where project_id = project) then return; end if;

    insert into public.archive_folders (project_id, name, slug, section, description, visibility, sort_index)
    values (project, 'Workshop Programme', 'workshop-content', 'workshops',
            'Three-day workshop programme: lessons, handouts and templates.', 'public', 10)
    returning id into shops;

    for day in
        select * from (values
            ('Day 1 — Planning & Development Workflow',        'day-1-planning-development-workflow',        'day-1', 10),
            ('Day 2 — Full-Stack Development & Debugging',     'day-2-full-stack-development-debugging',     'day-2', 20),
            ('Day 3 — Deployment, Discovery & Optimization',   'day-3-deployment-discovery-optimization',    'day-3', 30)
        ) as t(name, page, handout, ord)
    loop
        insert into public.archive_items
            (project_id, folder_id, name, kind, category, section, description,
             kind_label, format, state, site_path, visibility, sort_index, published_at)
        values (project, shops, day.name, 'file', 'workshop-material', 'workshops',
                'Full lesson page for ' || day.name || '.',
                'Workshop lesson', 'HTML', 'Published',
                '/projects/programming-jams/ai-programming-jam-26/workshop-content/' || day.page || '.html',
                'public', day.ord, now());

        insert into public.archive_items
            (project_id, folder_id, name, kind, category, section, description,
             kind_label, format, state, site_path, visibility, sort_index, published_at)
        values (project, shops, day.name || ' — Handout', 'file', 'workshop-material', 'workshops',
                'Printable participant handout.',
                'PDF handout', 'PDF', 'Published',
                '/projects/programming-jams/ai-programming-jam-26/workshop-content/handouts/' || day.handout || '-handout.pdf',
                'public', day.ord + 1, now());
    end loop;
end;
$$;
