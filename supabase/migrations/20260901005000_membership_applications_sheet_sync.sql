-- ---------------------------------------------------------------------------
-- 0050 — Let the club records exporter read membership applications.
--
-- Membership applications were the one intake record missing from the private
-- workbook: "Position Applications" mirrors event_position_applications, which
-- is a different thing entirely (applying for a role on an event, not applying
-- to join the club). Admins had no mirrored record of who had asked to join.
--
-- As with migration 0040, RLS bypass via service_role does not replace
-- ordinary SQL privileges, so the Edge Function's service-role client needs an
-- explicit SELECT. This is server-side only; anon/authenticated privileges are
-- unchanged, and the applicant-facing policies on this table are untouched.
--
-- Note that public.application_notes is deliberately NOT granted here.
-- Those notes are kept out of the workbook on purpose — see migration 0004.
-- ---------------------------------------------------------------------------

grant select on public.applications to service_role;

notify pgrst, 'reload schema';
