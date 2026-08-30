-- ---------------------------------------------------------------------------
-- 0040 — Allow the server-side club records exporter to read its source data.
--
-- RLS bypass via service_role does not replace ordinary SQL privileges. This
-- project uses explicit grants, so the Edge Function's service-role client
-- must still have SELECT on each table used to build the private workbook.
-- These grants are server-side only; anon/authenticated privileges are
-- unchanged.
-- ---------------------------------------------------------------------------

grant usage on schema public to service_role;

grant select on public.app_settings to service_role;
grant select on public.app_users to service_role;
grant select on public.member_profiles to service_role;
grant select on public.memberships to service_role;
grant select on public.position_history to service_role;
grant select on public.positions to service_role;
grant select on public.admin_assignments to service_role;
grant select on public.project_organizers to service_role;
grant select on public.projects to service_role;
grant select on public.event_positions to service_role;
grant select on public.event_position_applications to service_role;
grant select on public.participations to service_role;
grant select on public.contributions to service_role;
grant select on public.contribution_types to service_role;
grant select on public.inquiries to service_role;
grant select on public.university_exports to service_role;

notify pgrst, 'reload schema';
