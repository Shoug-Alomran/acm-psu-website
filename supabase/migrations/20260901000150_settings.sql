-- ===========================================================================
-- 0002a — Configurable settings.
--
-- Anything that would otherwise be hardcoded to "2026" or to the current
-- committee lives here, so the next committee changes a value in the admin
-- portal instead of editing application code.
-- ===========================================================================

create table public.app_settings (
    key         text primary key,
    value       jsonb       not null,
    description text        not null default '',
    -- Public settings are readable by anyone (the website reads the current
    -- chapter year); private ones only by staff.
    is_public   boolean     not null default false,
    updated_by  uuid,
    updated_at  timestamptz not null default now()
);

create trigger app_settings_touch
    before update on public.app_settings
    for each row execute function public.touch_updated_at();

insert into public.app_settings (key, value, description, is_public) values
    ('current_chapter_year', '"2026"'::jsonb,
     'The academic chapter the club is currently operating as. Bump this once per year.', true),
    ('chapter_years', '["2026","2025","2024","2023","2022","2016"]'::jsonb,
     'Chapter years offered in the public roster selector, newest first.', true),
    ('applications_open', 'true'::jsonb,
     'Whether new membership applications are being accepted.', true),
    ('club_email', '"acm@psu.edu.sa"'::jsonb,
     'Contact address shown to applicants and members.', true),
    ('psu_email_domains', '["psu.edu.sa"]'::jsonb,
     'Email domains accepted as a PSU address on membership applications.', true),
    ('ai_review_enabled', 'false'::jsonb,
     'Whether the admin review pages request Cloudflare Workers AI suggestions.', false),
    ('ai_review_model', '"@cf/meta/llama-3.1-8b-instruct"'::jsonb,
     'Workers AI model used for review assistance.', false),
    ('google_sheets_enabled', 'false'::jsonb,
     'Whether the university export page offers "push to Google Sheet".', false),
    -- Public: members need it to be told the real limit before they pick a
    -- file, rather than being refused by storage after a long upload.
    ('max_upload_bytes', '26214400'::jsonb,
     'Largest accepted upload, in bytes. 25 MB by default.', true);

-- ---------------------------------------------------------------------------
-- Typed accessors, so callers never parse jsonb by hand.
-- ---------------------------------------------------------------------------
create or replace function public.setting_text(setting_key text, fallback text default null)
returns text
language sql stable security definer set search_path = public
as $$
    select coalesce((select value #>> '{}' from public.app_settings where key = setting_key), fallback);
$$;

create or replace function public.setting_bool(setting_key text, fallback boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
    select coalesce((select (value)::boolean from public.app_settings where key = setting_key), fallback);
$$;

create or replace function public.current_chapter_year()
returns text
language sql stable security definer set search_path = public
as $$ select public.setting_text('current_chapter_year', to_char(now(), 'YYYY')); $$;

comment on function public.current_chapter_year is
    'Single source of truth for "which year is it". Application code must call '
    'this rather than embedding a literal year.';
