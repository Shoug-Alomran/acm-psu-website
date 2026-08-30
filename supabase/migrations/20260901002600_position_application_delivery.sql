-- Position application delivery guarantees.
-- Safe to run even if an earlier copy of these grants/settings was applied.

grant select, insert on public.event_position_applications to authenticated;
grant select on public.event_positions to authenticated;
grant select on public.projects to authenticated;

update public.app_settings
   set value = 'true'::jsonb,
       description = 'Whether Google Sheets snapshots are refreshed by member and position-application sync functions.'
 where key = 'google_sheets_enabled';

do $$
begin
    if not has_table_privilege('authenticated', 'public.event_position_applications', 'select') then
        raise exception 'authenticated cannot read event_position_applications';
    end if;

    if not has_table_privilege('authenticated', 'public.event_position_applications', 'insert') then
        raise exception 'authenticated cannot insert event_position_applications';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'event_position_applications'
          and policyname = 'event_position_apps_select_own'
    ) then
        raise exception 'member self-read policy is missing for event_position_applications';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'event_position_applications'
          and policyname = 'event_position_apps_select_staff'
    ) then
        raise exception 'staff read policy is missing for event_position_applications';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'event_position_applications'
          and policyname = 'event_position_apps_insert_own'
    ) then
        raise exception 'member insert policy is missing for event_position_applications';
    end if;

    if coalesce((select (value)::boolean from public.app_settings where key = 'google_sheets_enabled'), false) is not true then
        raise exception 'google_sheets_enabled is not true';
    end if;
end;
$$;

notify pgrst, 'reload schema';
