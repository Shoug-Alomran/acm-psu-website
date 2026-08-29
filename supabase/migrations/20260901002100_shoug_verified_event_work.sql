-- Backfill Shoug Alomran's verified work from published event attribution.
-- This is record data only; the portal continues to render it generically.

do $$
declare
    shoug_id constant uuid := '621ce2ac-720d-4f8e-8189-28f56adf5a2e';
    item record;
    current_project_id uuid;
begin
    if not exists (select 1 from public.app_users where id = shoug_id) then
        raise exception 'Shoug Alomran account % was not found', shoug_id;
    end if;

    for item in
        select * from (values
            ('ctf-2-0', 'organizer',
             'CTF 2.0 liaison and event coordination',
             'Liaison',
             'Served as the ACM liaison for the joint event and supported coordination between the organizing clubs.',
             array['https://psu-ctf.shoug-tech.com/#about']::text[]),
            ('ctf-2-0', 'website-development',
             'Developed the CTF 2.0 event website',
             'Website Developer',
             'Developed the published event website used for the competition, workshops, resources, rules and event information.',
             array['https://psu-ctf.shoug-tech.com/']::text[]),
            ('ctf-2-0', 'workshop-development',
             'Developed CTF 2.0 web-security workshop content',
             'Workshop Content Author',
             'Authored the Access Control, Injection Attacks and Broken Authentication preparation modules and their practical labs.',
             array['https://psu-ctf.shoug-tech.com/#workshop']::text[]),
            ('ctf-2-0', 'workshop-presenter',
             'Presented the CTF 2.0 preparation workshop',
             'Workshop Presenter',
             'Hosted and delivered preparation workshop material for the CTF.',
             array['https://psu-ctf.shoug-tech.com/#workshop']::text[]),
            ('ai-programming-jam-2026', 'organizer',
             'Organized ACM Programming Jam 2026',
             'JAM.26 Organizer',
             'Led event planning and coordination as part of the JAM.26 organizing team.',
             array['https://ai-programming-jam.shoug-tech.com/team.html']::text[]),
            ('ai-programming-jam-2026', 'workshop-development',
             'Developed the complete JAM.26 workshop curriculum',
             'Workshop Creator',
             'Developed all three workshop days covering planning and development workflow, full-stack development and debugging, and deployment and production readiness.',
             array['https://ai-programming-jam.shoug-tech.com/team.html']::text[]),
            ('ai-programming-jam-2026', 'workshop-presenter',
             'Instructed all three JAM.26 workshop days',
             'Workshop Instructor',
             'Delivered the complete three-day preparation workshop programme for JAM.26 participants.',
             array['https://ai-programming-jam.shoug-tech.com/team.html']::text[]),
            ('ai-programming-jam-2026', 'website-development',
             'Developed the JAM.26 event website',
             'Website Developer',
             'Developed the public event website supporting registration, workshops, competition information and the organizing team.',
             array['https://ai-programming-jam.shoug-tech.com/']::text[]),
            ('ctf-3-0', 'organizer',
             'Organized ACM/CyberTech CTF 3.0',
             'CTF Organizer',
             'Leads event planning and coordination for the joint ACM/CyberTech competition.',
             array['https://ctf-psu.shoug-tech.com/organizers.html']::text[]),
            ('ctf-3-0', 'website-development',
             'Developed the CTF 3.0 competition website',
             'Website Developer',
             'Develops the public competition website and its event information systems.',
             array['https://ctf-psu.shoug-tech.com/']::text[]),
            ('ctf-3-0', 'technical-support',
             'Supported CTF 3.0 technical preparation',
             'Technical Preparation Support',
             'Supports technical preparation of the competition environment and event delivery.',
             array['https://ctf-psu.shoug-tech.com/organizers.html']::text[])
        ) as work(project_slug, type_slug, title, role_text, description, links)
    loop
        select id into current_project_id from public.projects where slug = item.project_slug;
        if current_project_id is null then
            raise exception 'Project % was not found', item.project_slug;
        end if;

        insert into public.contributions
            (user_id, project_id, type_slug, title, role_text, description, links,
             status, reviewed_at, review_note, verified_at, internal_note)
        select
            shoug_id, current_project_id, item.type_slug, item.title, item.role_text,
            item.description, item.links, 'approved', now(),
            'Verified against published event attribution.', now(),
            'System backfill from the event websites supplied by the member.'
        where not exists (
            select 1 from public.contributions c
            where c.user_id = shoug_id
              and c.project_id = current_project_id
              and c.title = item.title
              and c.deleted_at is null
        );
    end loop;

    insert into public.participations
        (user_id, project_id, role_text, status, started_on, verified_at, note)
    select shoug_id, p.id, participation.role_text,
           participation.status::public.participation_status,
           p.starts_on, now(), 'Verified from published event attribution.'
    from (values
        ('ctf-2-0', 'Liaison, Website Developer, Workshop Content Author & Workshop Presenter', 'completed'),
        ('ai-programming-jam-2026', 'Organizer, Workshop Creator, Instructor & Website Developer', 'confirmed'),
        ('ctf-3-0', 'Organizer, Website Developer & Technical Preparation Support', 'confirmed')
    ) as participation(project_slug, role_text, status)
    join public.projects p on p.slug = participation.project_slug
    where not exists (
        select 1 from public.participations existing
        where existing.user_id = shoug_id and existing.project_id = p.id
    );
end $$;
