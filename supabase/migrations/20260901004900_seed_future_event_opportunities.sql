-- Seed practical member-facing event roles for the currently scheduled ACM events.
-- Idempotent by (project, case-insensitive title) so later pushes are safe.

with role_seed(project_slug,title,description,openings) as (values
('ai-programming-jam-2026','Workshop Assistant','Support workshop delivery, help participants follow the exercises, and direct questions to the presenter when needed.',3),
('ai-programming-jam-2026','Technical Support','Help with setup, connectivity, development tools, and basic troubleshooting during the Programming Jam.',2),
('ai-programming-jam-2026','Event Operations','Help with room setup, timing, participant flow, materials, and general event-day coordination.',3),
('ai-programming-jam-2026','Registration & Participant Support','Welcome participants, help with check-in, answer logistics questions, and direct people to the correct rooms or activities.',3),
('acm-club-hackathon-261','Workshop Assistant','Support preparation sessions and help participants follow workshop exercises and instructions.',3),
('acm-club-hackathon-261','Technical Support','Help teams with setup, connectivity, development tools, and event-day technical issues.',3),
('acm-club-hackathon-261','Event Operations','Help run the hackathon floor, timing, room setup, supplies, transitions, and general coordination.',4),
('acm-club-hackathon-261','Registration & Participant Support','Handle check-in, participant questions, directions, and general team support during the event.',3),
('acm-club-hackathon-261','Media & Documentation','Capture approved event photos, key moments, results, and material needed for the ACM archive and recap.',2),
('ctf-3-0','CTF Floor Support','Help teams with event logistics, rules questions, room flow, and escalation to technical organizers during the competition.',4),
('ctf-3-0','Technical Support','Support competition setup, connectivity, participant access, and basic troubleshooting during the CTF.',3),
('ctf-3-0','Challenge Tester','Test challenge instructions and participant flow before the event and report confusing steps or technical issues to organizers.',2),
('ctf-3-0','Registration & Participant Support','Support check-in, participant questions, directions, and competition-day logistics.',3),
('ctf-3-0','Media & Documentation','Capture approved event material, results, and documentation for the ACM/CyberTech archive and recap.',2)
)
insert into public.event_positions(project_id,title,description,openings,is_open,closes_on)
select p.id,s.title,s.description,s.openings,true,(p.starts_on - 12)
from role_seed s
join public.projects p on p.slug=s.project_slug
where p.deleted_at is null
  and not exists (
    select 1 from public.event_positions ep
    where ep.project_id=p.id and lower(ep.title)=lower(s.title)
  );
