-- ===========================================================================
-- 0061 — Registration forms belong to events, and come from templates.
--
-- Until now a public registration form existed because somebody wrote a row
-- by hand in migration 0060, with the worksheet headings typed out beside it.
-- That was fine for the two events that already existed and impossible for the
-- third: adding an event meant a migration, an Apps Script edit and a hand-made
-- worksheet, in that order, by someone who knew all three.
--
-- This migration makes a registration form something an event HAS, chosen from
-- a fixed set of shapes:
--
--   projects ──< event_registration_forms ──< event_registrations
--                        │
--                        └── one Google worksheet, named by sheet_name
--
-- WHY TEMPLATES ARE A TABLE. The column order of a registration worksheet is
-- a contract between three systems — the Apps Script that appends rows, the
-- worksheet itself, and the mirror that reads them back. Letting an admin type
-- their own headings into a form would put that contract in a text box. A
-- template is chosen by key; the headings come from here and never from the
-- browser.
--
-- WHY event_key AND sheet_name ARE SEPARATE. event_key is the stable identity
-- of the form and is what event_registrations rows point at; sheet_name is the
-- worksheet those rows are collected in. They are equal for every form that
-- exists today, and keeping them apart means a worksheet could one day be
-- renamed without orphaning the registrations already recorded against it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The shapes a registration form may take.
--
-- is_selectable separates "an admin may choose this for a new event" from
-- "this describes a form that already exists". jam26 was built before there
-- were templates and its columns match none of them; it gets a template row of
-- its own so nothing about it has to change, and that row is not offered when
-- creating an event.
-- ---------------------------------------------------------------------------
create table public.registration_templates (
    template_key  text primary key,
    label         text not null,
    description   text not null default '',
    headers       text[] not null,
    is_selectable boolean not null default true,
    rank          integer not null default 100,

    constraint registration_templates_key_shape
        check (template_key ~ '^[A-Z][A-Z0-9_]{1,40}$'),
    constraint registration_templates_headers_shape
        check (array_length(headers, 1) between 2 and 60 and headers[1] = 'Timestamp')
);

comment on table public.registration_templates is
    'Canonical column orders for public event registration worksheets. The '
    'browser chooses a template_key; headings are never sent from a browser.';

insert into public.registration_templates (template_key, label, description, headers, rank) values
    ('INDIVIDUAL', 'Individual', 'One row per person. No team fields.', array[
        'Timestamp', 'Full Name', 'University ID', 'University Email',
        'Phone Number', 'Major'], 10),

    ('TEAM_BASIC', 'Basic team', 'One row per team. The captain''s details, plus teammate emails in one cell.', array[
        'Timestamp', 'Team Name', 'Captain Name', 'Captain University ID',
        'Captain University Email', 'Captain Phone Number', 'Captain Major',
        'Team Members'], 20),

    ('TEAM_STRUCTURED_3', 'Structured 3-person team', 'One row per team, with a column for every member. Includes an experience level.', array[
        'Timestamp', 'Team Name',
        'Captain Name', 'Captain University ID', 'Captain University Email',
        'Captain Phone Number', 'Captain Major',
        'Member 2 Name', 'Member 2 University ID', 'Member 2 University Email', 'Member 2 Major',
        'Member 3 Name', 'Member 3 University ID', 'Member 3 University Email', 'Member 3 Major',
        'Experience Level'], 30);

-- jam26's actual columns. Deliberately not selectable: it is a record of what
-- one existing worksheet looks like, not a shape to build new events from.
-- Converting jam26 to TEAM_BASIC would rename live columns, so it is not done.
insert into public.registration_templates
    (template_key, label, description, headers, is_selectable, rank) values
    ('LEGACY_JAM26', 'Programming Jam 2026 (legacy)',
     'The columns the Programming Jam worksheet already uses. Kept so that form needs no change.',
     array['Timestamp', 'Full Name', 'University ID', 'University Email',
           'Phone Number', 'Major', 'Team Name', 'Team Members'],
     false, 900);

alter table public.registration_templates enable row level security;

-- Readable by the people who create events; only a migration writes them.
create policy registration_templates_select_staff on public.registration_templates
    for select to authenticated
    using (public.is_club_admin() or public.is_advisory_instructor());

grant select on public.registration_templates to authenticated;
grant select on public.registration_templates to service_role;

-- ---------------------------------------------------------------------------
-- Link a form to its event, its worksheet and its template.
--
-- Every column is added nullable, backfilled, and only then constrained, so
-- the two live forms are never momentarily invalid.
-- ---------------------------------------------------------------------------
alter table public.event_registration_forms
    add column project_id    uuid references public.projects (id) on delete restrict,
    add column sheet_name    text,
    add column template_key  text references public.registration_templates (template_key),
    add column created_by    uuid references public.app_users (id) on delete set null,
    add column updated_at    timestamptz not null default now();

-- The worksheet each existing form already writes to is its own key.
update public.event_registration_forms set sheet_name = event_key;

-- ctf30's headings are TEAM_STRUCTURED_3 exactly; jam26's are their own shape.
-- Matched on the stored headers rather than on the key, so a workbook that has
-- drifted is left unmatched and visible rather than silently relabelled.
update public.event_registration_forms f
   set template_key = t.template_key
  from public.registration_templates t
 where f.template_key is null
   and f.headers = t.headers;

do $$
declare
    unmatched text;
begin
    select string_agg(event_key, ', ') into unmatched
      from public.event_registration_forms where template_key is null;
    if unmatched is not null then
        raise exception
            'Registration forms whose columns match no template: %. Add a template row '
            'describing them before applying this migration.', unmatched;
    end if;
end $$;

-- Best-effort link to the event each form belongs to. A form with no matching
-- project stays unlinked rather than guessing: project_id is nullable for
-- exactly this reason, and the admin UI can attach it later.
update public.event_registration_forms f
   set project_id = p.id
  from public.projects p
 where f.project_id is null
   and p.deleted_at is null
   and p.kind = 'event'
   and (
        (f.event_key = 'ctf30' and p.slug like 'ctf-3%')
     or (f.event_key = 'jam26' and (p.slug like '%programming-jam%' or p.slug like '%ai-programming-jam%'))
   );

alter table public.event_registration_forms
    alter column sheet_name set not null,
    alter column template_key set not null;

alter table public.event_registration_forms
    add constraint event_registration_forms_sheet_shape
        check (sheet_name ~ '^[a-z][a-z0-9_-]{2,40}$'),

    -- One worksheet is one form. Two forms writing the same tab would mean two
    -- events sharing a registration list.
    add constraint event_registration_forms_sheet_unique unique (sheet_name),

    -- A registration worksheet must never be named after a canonical mirror
    -- tab: the snapshot sync clears those every refresh. The writer refuses
    -- them too (CANONICAL_TABS in _shared/google_sheets.ts); this is the same
    -- rule stated where the name is stored.
    add constraint event_registration_forms_not_canonical
        check (lower(sheet_name) not in (
            'people', 'membership applications', 'members', 'club positions',
            'opportunity positions', 'position applications', 'event participation',
            'contributions', 'inquiries', 'university export log'));

-- One registration form per event. Unlinked legacy rows are exempt.
create unique index event_registration_forms_project_idx
    on public.event_registration_forms (project_id)
    where project_id is not null;

create trigger event_registration_forms_touch
    before update on public.event_registration_forms
    for each row execute function public.touch_updated_at();

comment on column public.event_registration_forms.sheet_name is
    'The worksheet in the ACM PSU — Club Records workbook that this form is '
    'collected in. Equal to event_key for every form created so far; separate '
    'so a worksheet could be renamed without orphaning its registrations.';

comment on column public.event_registration_forms.is_active is
    'Whether registration is open. Closing a form never deletes its worksheet '
    'or its recorded registrations.';

-- ---------------------------------------------------------------------------
-- Is this form locked?
--
-- Once a single registration has been recorded, the template and the worksheet
-- name are settled facts: the columns describe rows that already exist, and
-- renaming the tab would leave those rows pointing at a worksheet that is no
-- longer being written. The provisioning function refuses both changes and
-- uses this to say so.
-- ---------------------------------------------------------------------------
create or replace function public.registration_form_locked(form_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.event_registrations r where r.event_key = form_key
    );
$$;

comment on function public.registration_form_locked is
    'True once a form has recorded a registration, after which its template '
    'and worksheet name may no longer change.';

revoke execute on function public.registration_form_locked(text) from public, anon;
grant execute on function public.registration_form_locked(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who may provision registration for an event.
--
-- Club admins may do it for any event. An advisory instructor may do it only
-- for an event they are assigned to organise — the same rule that governs
-- every other advisor action. Reviewers and members hold neither, so they get
-- false and the Edge Function refuses them.
-- ---------------------------------------------------------------------------
create or replace function public.may_provision_registration(target_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select public.is_club_admin() or public.advises_project(target_project);
$$;

comment on function public.may_provision_registration is
    'Club admins for any event; advisory instructors only for events they are '
    'assigned to organise.';

revoke execute on function public.may_provision_registration(uuid) from public, anon;
grant execute on function public.may_provision_registration(uuid) to authenticated, service_role;

-- The provisioning Edge Function writes as the service role after checking the
-- caller against may_provision_registration().
grant insert, update on public.event_registration_forms to service_role;
