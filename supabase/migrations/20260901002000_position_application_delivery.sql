-- ===========================================================================
-- 0020 — Position application delivery guarantees.
--
-- Members must be able to submit and read their own event-position requests,
-- staff must be able to see them immediately in the admin queue, and the
-- Google Sheets snapshot must be enabled for the application-sync function.
-- RLS remains the authorization boundary for the rows themselves.
-- ===========================================================================

-- Explicit capabilities for this flow. These are intentionally narrow and
-- pair with the existing RLS policies in 0010.
grant select, insert on public.event_position_applications to authenticated;
grant select on public.event_positions to authenticated;
grant select on public.projects to authenticated;

-- The application sync function treats this setting as its feature switch.
-- The Google credentials remain Edge Function secrets; enabling this setting
-- does not expose or move them into the database or browser.
update public.app_settings
   set value = 'true'::jsonb,
       description = 'Whether Google Sheets snapshots are refreshed by member and position-application sync functions.'
 where key = 'google_sheets_enabled';

-- Verify that the database side of the member/admin application flow is
-- actually usable after this migration.
do $$
begin
    if not has_table_privilege(
        'authenticated',
        'public.event_position_applications',
        'select'
    ) then
        raise exception 'authenticated cannot read event_position_applications';
    end if;

    if not has_table_privilege(
        'authenticated',
        'public.event_position_applications',
        'insert'
    ) then
        raise exception 'authenticated cannot insert event_position_applications';
    end if;

    if not exists (
        select 1
          from pg_policies
         where schemaname = 'public'
           and tablename = 'event_position_applications'
           and policyname = 'event_position_apps_select_own'
    ) then
        raise exception 'member self-read policy is missing for event_position_applications';
    end if;

    if not exists (
        select 1
          from pg_policies
         where schemaname = 'public'
           and tablename = 'event_position_applications'
           and policyname = 'event_position_apps_select_staff'
    ) then
        raise exception 'staff read policy is missing for event_position_applications';
    end if;

    if not exists (
        select 1
          from pg_policies
         where schemaname = 'public'
           and tablename = 'event_position_applications'
           and policyname = 'event_position_apps_insert_own'
    ) then
        raise exception 'member insert policy is missing for event_position_applications';
    end if;

    if coalesce(
        (select (value)::boolean
           from public.app_settings
          where key = 'google_sheets_enabled'),
        false
    ) is not true then
        raise exception 'google_sheets_enabled is not true';
    end if;
end;
$$;
