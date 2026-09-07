-- ===========================================================================
-- No uploaded HTML, and no inline SVG.
--
-- public-archive is world-readable and accepted text/html and image/svg+xml;
-- submissions accepted text/html, and reviewers open those through signed URLs.
-- Both render as active content: HTML runs script, and an SVG is a document
-- that can carry <script> and event handlers.
--
-- Today those files render on the *.supabase.co origin rather than ours, so
-- the blast radius is limited. That containment is an accident of hosting, not
-- a decision: the day anything proxies storage under acm-psu.shoug-tech.com,
-- every one of these becomes same-origin XSS against a signed-in reviewer. The
-- upload side is the cheap place to close it.
--
-- SVG stays allowed on public-archive because posters and diagrams are the
-- normal case for a club archive; it is served as an attachment instead (see
-- below), so a browser saves it rather than executing it. HTML is dropped
-- outright from both buckets — a committee that needs to publish a page has
-- the repository for that, which is where site_path already points.
-- ===========================================================================

update storage.buckets
   set allowed_mime_types = array_remove(allowed_mime_types, 'text/html')
 where id in ('public-archive', 'submissions')
   and allowed_mime_types is not null;

-- Storage serves an object with the content type recorded on it, so an SVG
-- already stored as image/svg+xml would still render inline. Re-record those
-- as a generic binary type: the file is unchanged and still downloads, but no
-- browser will execute it on the way past.
update storage.objects
   set metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{mimetype}', '"application/octet-stream"'
       )
 where bucket_id = 'public-archive'
   and metadata ->> 'mimetype' = 'image/svg+xml';

-- Any HTML already uploaded before this migration gets the same treatment.
update storage.objects
   set metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{mimetype}', '"text/plain"'
       )
 where bucket_id in ('public-archive', 'submissions')
   and metadata ->> 'mimetype' = 'text/html';

-- ---------------------------------------------------------------------------
-- Hygiene: storage_path_is_own() was the one function in the schema with no
-- search_path pinned. It is security invoker, so the risk is small, but "every
-- function pins its search_path" is a property worth being able to state
-- without an exception attached to it.
--
-- Every other definer function in the schema sets `search_path = public`.
-- Postgres' documented safe pattern is `public, pg_temp`, so that the temp
-- schema is searched last rather than being reachable ahead of it; the
-- functions touched by this launch pass use that form.
-- ---------------------------------------------------------------------------
create or replace function public.storage_path_is_own(object_name text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$ select (storage.foldername(object_name))[1] = auth.uid()::text; $$;
