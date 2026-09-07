-- ===========================================================================
-- The private workbook id leaves the public bundles.
--
-- The Google workbook id was a literal in three files under platform/pages/,
-- so `npm run build` copied it into assets/js/app/*.js, which GitHub Pages
-- serves to anyone. It is not a credential — the workbook's own sharing rules
-- still apply — but it names the single file holding every student ID the club
-- keeps. One accidental "anyone with the link" turns a private document into a
-- published one, and the id being in circulation is what makes that mistake
-- expensive rather than harmless.
--
-- It moves into app_settings, which means first fixing how app_settings is
-- read: setting_text() and setting_bool() are security definer, and Postgres
-- grants EXECUTE on a new function to PUBLIC by default. Between them, any
-- caller holding the anon key could read *any* setting, is_public or not,
-- straight past the app_settings policies. Today that exposes three feature
-- flags and matters little. Storing anything worth protecting there without
-- closing it first would be building on the hole.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Typed accessors honour is_public
-- ---------------------------------------------------------------------------

-- Who may read a setting that is not marked public. Advisory instructors are
-- included because the club records workbook link is on their workspace page;
-- is_staff() does not cover them (it is is_reviewer()), so saying so here is
-- the difference between a working page and a silent fallback.
create or replace function public.can_read_private_settings()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select public.is_staff() or public.is_club_admin() or public.is_advisory_instructor();
$$;

comment on function public.can_read_private_settings() is
    'Who may read an app_settings row with is_public = false through the '
    'typed accessors. Mirrors the table policies rather than widening them.';

create or replace function public.setting_text(setting_key text, fallback text default null)
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
    select coalesce((
        select value #>> '{}' from public.app_settings
         where key = setting_key
           and (is_public or public.can_read_private_settings())
    ), fallback);
$$;

create or replace function public.setting_bool(setting_key text, fallback boolean default false)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
    select coalesce((
        select (value)::boolean from public.app_settings
         where key = setting_key
           and (is_public or public.can_read_private_settings())
    ), fallback);
$$;

comment on function public.setting_text(text, text) is
    'Reads one setting. A row with is_public = false is returned only to a '
    'caller who could already select it from app_settings directly; everyone '
    'else gets the fallback, exactly as if the key did not exist.';

-- These are security definer, so the default PUBLIC grant would have let the
-- checks above be reached by any role at all. State the audience instead.
revoke execute on function public.setting_text(text, text) from public;
revoke execute on function public.setting_bool(text, boolean) from public;
grant execute on function public.setting_text(text, text) to anon, authenticated, service_role;
grant execute on function public.setting_bool(text, boolean) to anon, authenticated, service_role;

-- current_chapter_year() calls setting_text on a public key, so it is
-- unaffected; it is re-granted here only because it shares the same default.
revoke execute on function public.current_chapter_year() from public;
grant execute on function public.current_chapter_year() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The workbook link itself
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description, is_public) values
    ('club_records_workbook_url',
     '"https://docs.google.com/spreadsheets/d/1WtNGmVYO8hk_w3I37n1T6wS9_z_dTyTPW4fTHZ4lW3s/edit"'::jsonb,
     'Private Google workbook mirroring club records. Read by the admin and '
     'advisor pages; deliberately not public, so it stays out of the shipped '
     'JavaScript bundles.',
     false)
on conflict (key) do update
    set description = excluded.description,
        is_public   = excluded.is_public;
