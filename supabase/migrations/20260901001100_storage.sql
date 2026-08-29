-- ===========================================================================
-- 0011 — File storage.
--
-- Four buckets, separated by who is allowed to see what. The separation is the
-- point: an internal planning document and a published workshop handout must
-- never be one policy mistake apart.
--
--   public-archive    published, world-readable. Served directly.
--   internal-archive  published but members-only. Reached via signed URLs.
--   submissions       member uploads awaiting review. Owner + staff only.
--   evidence          proof attached to a contribution. Owner + staff only.
--   avatars           profile photos. Public read, owner write.
--
-- Private buckets are never public, so no private file is reachable by
-- guessing a URL. Downloads go through short-lived signed URLs minted by the
-- Supabase client only after these policies have allowed the read.
--
-- Path convention, enforced by the policies below:
--   submissions/<user-uuid>/<random>.<ext>
--   evidence/<user-uuid>/<random>.<ext>
--   avatars/<user-uuid>/<random>.<ext>
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('public-archive', 'public-archive', true, 52428800, array[
        'application/pdf',
        'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
        'text/html', 'text/plain', 'text/markdown', 'text/csv',
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.ms-excel'
    ]),
    ('internal-archive', 'internal-archive', false, 52428800, null),
    ('submissions', 'submissions', false, 26214400, array[
        'application/pdf',
        'image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'text/html', 'text/plain', 'text/markdown', 'text/csv',
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.ms-excel'
    ]),
    ('evidence', 'evidence', false, 26214400, array[
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'text/plain', 'application/zip'
    ]),
    ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Helper: does this object path start with the caller's own user id?
-- ---------------------------------------------------------------------------
create or replace function public.storage_path_is_own(object_name text)
returns boolean
language sql
stable
as $$ select (storage.foldername(object_name))[1] = auth.uid()::text; $$;

-- ---------------------------------------------------------------------------
-- public-archive
-- ---------------------------------------------------------------------------
create policy "public archive is world readable"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'public-archive');

create policy "only admins publish to the public archive"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'public-archive' and public.is_club_admin());

create policy "only admins change the public archive"
    on storage.objects for update to authenticated
    using (bucket_id = 'public-archive' and public.is_club_admin());

create policy "only admins remove from the public archive"
    on storage.objects for delete to authenticated
    using (bucket_id = 'public-archive' and public.is_club_admin());

-- ---------------------------------------------------------------------------
-- internal-archive — signed-in members and staff read; admins write.
-- ---------------------------------------------------------------------------
create policy "members read the internal archive"
    on storage.objects for select to authenticated
    using (bucket_id = 'internal-archive' and (public.is_active_member() or public.is_staff()));

create policy "only admins write the internal archive"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'internal-archive' and public.is_club_admin());

create policy "only admins update the internal archive"
    on storage.objects for update to authenticated
    using (bucket_id = 'internal-archive' and public.is_club_admin());

create policy "only admins delete from the internal archive"
    on storage.objects for delete to authenticated
    using (bucket_id = 'internal-archive' and public.is_club_admin());

-- ---------------------------------------------------------------------------
-- submissions — a member reaches only their own folder.
-- ---------------------------------------------------------------------------
create policy "members upload into their own submission folder"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'submissions'
        and public.storage_path_is_own(name)
        and public.is_active_member()
    );

create policy "members read their own submissions"
    on storage.objects for select to authenticated
    using (bucket_id = 'submissions' and (public.storage_path_is_own(name) or public.is_reviewer()));

create policy "members replace their own submissions"
    on storage.objects for update to authenticated
    using (bucket_id = 'submissions' and public.storage_path_is_own(name));

create policy "members delete their own submissions"
    on storage.objects for delete to authenticated
    using (bucket_id = 'submissions' and (public.storage_path_is_own(name) or public.is_club_admin()));

-- ---------------------------------------------------------------------------
-- evidence — same shape as submissions.
-- ---------------------------------------------------------------------------
create policy "members upload their own evidence"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'evidence'
        and public.storage_path_is_own(name)
        and public.is_active_member()
    );

create policy "members read their own evidence"
    on storage.objects for select to authenticated
    using (bucket_id = 'evidence' and (public.storage_path_is_own(name) or public.is_reviewer()));

create policy "members delete their own evidence"
    on storage.objects for delete to authenticated
    using (bucket_id = 'evidence' and (public.storage_path_is_own(name) or public.is_club_admin()));

-- ---------------------------------------------------------------------------
-- avatars
-- ---------------------------------------------------------------------------
create policy "avatars are world readable"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'avatars');

create policy "members manage their own avatar"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and public.storage_path_is_own(name));

create policy "members replace their own avatar"
    on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and public.storage_path_is_own(name));

create policy "members delete their own avatar"
    on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and (public.storage_path_is_own(name) or public.is_club_admin()));
