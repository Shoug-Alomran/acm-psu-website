-- Record the canonical public event-site URLs for the two upcoming events.
--
-- The homepage runtime resolves an event's public link as
--   external_url -> site_path -> projects.html
-- for the Upcoming Events card, the Selected Work "Event Site" anchor, and the
-- JSON-LD Event entries. external_url was never populated, so all three fell
-- back to the on-site archive path and the structured-data sync replaced the
-- correct hand-authored event-site URLs with internal archive paths.
--
-- These URLs are the canonical event sites already published in index.html;
-- they are the parent sites of the registration pages recorded in
-- 20260901005400 and 20260901005500. Only rows that have no external_url are
-- touched, so an admin-set value is never overwritten.

update public.projects
set external_url = 'https://ai-programming-jam.shoug-tech.com/'
where slug = 'ai-programming-jam-2026'
  and external_url is null;

update public.projects
set external_url = 'https://ctf-psu.shoug-tech.com/'
where slug = 'ctf-3-0'
  and external_url is null;
