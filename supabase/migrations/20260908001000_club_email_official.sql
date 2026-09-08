-- ===========================================================================
-- 0067 — club_email: point it at the chapter's real mailbox.
--
-- The chapter's contact address is acmchapter@psu.edu.sa. The seed in 0002a
-- (settings) used acm@psu.edu.sa, a placeholder for a mailbox the chapter does
-- not hold — inquiry replies, the disabled-account page and the applicant
-- status page all quote this value, so pointing them at a mailbox nobody reads
-- means those replies never arrive.
--
-- Seeded rows are editable from the admin settings page, so this only moves the
-- default: a value the committee has already changed by hand is left alone.
-- ===========================================================================

update public.app_settings
   set value = '"acmchapter@psu.edu.sa"'::jsonb
 where key = 'club_email'
   and value = '"acm@psu.edu.sa"'::jsonb;
