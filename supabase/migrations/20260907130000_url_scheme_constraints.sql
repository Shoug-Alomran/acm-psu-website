-- ===========================================================================
-- Only http(s) may be stored in a URL column.
--
-- Escaping a stored link does nothing to a `javascript:` scheme: HTML entity
-- encoding leaves the browser a perfectly good script URL. Three of the named
-- link columns already carried a '^https?://' check; the rest did not, and
-- member_profiles.extra_links — free-form JSON a member can PATCH straight
-- into PostgREST under member_profiles_update_self — had no constraint on the
-- values inside it at all. A public profile is rendered into an href on
-- team.html, so that was a stored XSS path onto the public site.
--
-- The render paths now call safeHref() (platform/lib/format.ts, mirrored in
-- the standalone scripts under assets/js/). This file is the other half: the
-- helper protects rows already stored, these constraints stop new ones. Both
-- are needed — neither alone closes it.
--
-- Existing rows are cleaned first so the constraints cannot fail on deploy.
-- Anything that is not http(s) is discarded rather than rewritten: guessing a
-- scheme for a link somebody typed wrong is how you invent a destination.
-- ===========================================================================

-- A single definition of "safe to put in an href", so the constraints below
-- and any future column agree by construction rather than by copy-paste.
create or replace function public.is_web_url(value text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
    -- Leading whitespace and control characters are ignored by URL parsers, so
    -- they are stripped before the scheme is tested rather than being allowed
    -- to push the value past a '^' anchor. This is an allow-list: anything that
    -- is not literally http:// or https:// after that is rejected, so a control
    -- character buried further in ('java\tscript:...') simply fails to match.
    select value is null
        or regexp_replace(value, '^[[:space:][:cntrl:]]+', '') ~* '^https?://[^[:space:]]';
$$;

comment on function public.is_web_url(text) is
    'True when a stored link is null or an http(s) URL. The single source of '
    'truth for every URL check constraint; mirrors safeHref() in the browser.';

-- Same rule for a column that holds several links rather than one.
create or replace function public.links_are_safe(links text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
    select coalesce(bool_and(public.is_web_url(link)), true)
      from unnest(coalesce(links, '{}'::text[])) as link;
$$;

comment on function public.links_are_safe(text[]) is
    'True when every element of a text[] link column is an http(s) URL. An '
    'empty array passes; so does a null one.';

-- ---------------------------------------------------------------------------
-- Named URL columns
-- ---------------------------------------------------------------------------
update public.member_profiles
   set website_url = null
 where not public.is_web_url(website_url);

update public.instructor_profiles set faculty_page_url = null where not public.is_web_url(faculty_page_url);

-- contributions keeps its destinations in `links text[]`, not a single column,
-- and admin-contributions.ts renders each element straight into an href. The
-- array needs the same guarantee one column would get, element by element.
update public.contributions
   set links = coalesce((
           select array_agg(link)
             from unnest(links) as link
            where public.is_web_url(link)
       ), '{}'::text[])
 where not public.links_are_safe(links);

-- archive_items, archive_submissions and contribution_evidence each require
-- *some* destination, so clearing a bad external_url on a row that has no file
-- would trip that rule instead. Only rows with another destination are cleared;
-- a row whose sole destination is an unsafe link is deleted, because there is
-- nothing left of it to keep and it is not a record of anything real.
update public.archive_items
   set external_url = null
 where not public.is_web_url(external_url)
   and (storage_path is not null or site_path is not null);

update public.archive_submissions
   set external_url = null
 where not public.is_web_url(external_url)
   and storage_path is not null;

update public.contribution_evidence
   set external_url = null
 where not public.is_web_url(external_url)
   and storage_path is not null;

-- Whatever is left has an unsafe link as its only destination, so there is no
-- version of the row that both keeps its meaning and passes the constraint.
-- Those are removed — but the audit log gets the full row first. A migration
-- that deletes something silently is worse than the row it deleted, and this
-- is the one table in the schema whose job is to remember.
do $$
declare
    doomed record;
begin
    for doomed in
        select 'archive_items' as source, id::text as row_id, external_url, to_jsonb(t) as row
          from public.archive_items t where not public.is_web_url(external_url)
        union all
        select 'archive_submissions', id::text, external_url, to_jsonb(t)
          from public.archive_submissions t where not public.is_web_url(external_url)
        union all
        select 'contribution_evidence', id::text, external_url, to_jsonb(t)
          from public.contribution_evidence t where not public.is_web_url(external_url)
    loop
        perform public.write_audit(
            action       => 'record.removed_unsafe_url',
            category     => 'archive',
            entity_type  => doomed.source,
            entity_id    => doomed.row_id,
            entity_label => doomed.source || ' ' || doomed.row_id,
            summary      => 'Removed during the URL scheme migration: its only destination '
                            || 'was a link that is not http(s), so it could not be kept.',
            before_state => doomed.row,
            metadata     => jsonb_build_object('rejected_url', doomed.external_url),
            actor_kind   => 'migration'
        );
    end loop;
end;
$$;

delete from public.archive_items        where not public.is_web_url(external_url);
delete from public.archive_submissions  where not public.is_web_url(external_url);
delete from public.contribution_evidence where not public.is_web_url(external_url);

update public.projects set external_url     = null where not public.is_web_url(external_url);
update public.projects set repo_url         = null where not public.is_web_url(repo_url);
update public.projects set registration_url = null where not public.is_web_url(registration_url);

alter table public.member_profiles
    drop constraint if exists member_profiles_website_url,
    add  constraint member_profiles_website_url check (public.is_web_url(website_url));

alter table public.contributions
    drop constraint if exists contributions_links_scheme,
    add  constraint contributions_links_scheme check (public.links_are_safe(links));

alter table public.contribution_evidence
    drop constraint if exists contribution_evidence_external_url_scheme,
    add  constraint contribution_evidence_external_url_scheme check (public.is_web_url(external_url));

alter table public.archive_items
    drop constraint if exists archive_items_external_url_scheme,
    add  constraint archive_items_external_url_scheme check (public.is_web_url(external_url));

alter table public.archive_submissions
    drop constraint if exists archive_submissions_external_url_scheme,
    add  constraint archive_submissions_external_url_scheme check (public.is_web_url(external_url));

alter table public.instructor_profiles
    drop constraint if exists instructor_profiles_faculty_page_url_scheme,
    add  constraint instructor_profiles_faculty_page_url_scheme
         check (public.is_web_url(faculty_page_url));

alter table public.projects
    drop constraint if exists projects_external_url_scheme,
    add  constraint projects_external_url_scheme check (public.is_web_url(external_url)),
    drop constraint if exists projects_repo_url_scheme,
    add  constraint projects_repo_url_scheme check (public.is_web_url(repo_url)),
    drop constraint if exists projects_registration_url_scheme,
    add  constraint projects_registration_url_scheme check (public.is_web_url(registration_url));

-- ---------------------------------------------------------------------------
-- member_profiles.extra_links — [{"label": "...", "url": "..."}]
-- ---------------------------------------------------------------------------

-- Every element must be an object carrying a string label and a safe url. The
-- shape is checked as well as the scheme: without it, an element could be a
-- bare string or an array and the url test would never look at it.
create or replace function public.extra_links_are_safe(links jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
    select coalesce(bool_and(
               jsonb_typeof(link) = 'object'
           and jsonb_typeof(link -> 'label') = 'string'
           and jsonb_typeof(link -> 'url') = 'string'
           and public.is_web_url(link ->> 'url')
           ), true)
      from jsonb_array_elements(coalesce(links, '[]'::jsonb)) as link;
$$;

comment on function public.extra_links_are_safe(jsonb) is
    'True when every member_profiles.extra_links entry is {label, url} with an '
    'http(s) url. Public profiles render these into an href.';

-- Drop links already stored that would not survive the constraint.
update public.member_profiles
   set extra_links = coalesce((
           select jsonb_agg(link)
             from jsonb_array_elements(extra_links) as link
            where jsonb_typeof(link) = 'object'
              and jsonb_typeof(link -> 'label') = 'string'
              and jsonb_typeof(link -> 'url') = 'string'
              and public.is_web_url(link ->> 'url')
       ), '[]'::jsonb)
 where not public.extra_links_are_safe(extra_links);

alter table public.member_profiles
    drop constraint if exists member_profiles_extra_links_safe,
    add  constraint member_profiles_extra_links_safe
         check (public.extra_links_are_safe(extra_links));
