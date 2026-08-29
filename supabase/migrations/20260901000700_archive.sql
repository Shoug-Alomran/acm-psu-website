-- ===========================================================================
-- 0007 — The digital archive.
--
-- The public site already ships a hand-written archive manifest per project
-- (projects/*/archive-manifest.js). This schema is the same shape, promoted to
-- a database: folders nest, items live in folders, everything carries a
-- section, a description, a date and a visibility. Migration 0011 loads the
-- existing manifests so nothing already published is lost.
--
-- Members never write to archive_items. They write to archive_submissions,
-- and an admin publishes an item from the submission.
-- ===========================================================================

create table public.archive_categories (
    slug      text primary key,
    label     text not null,
    label_ar  text,
    rank      integer not null default 100,
    is_active boolean not null default true
);

insert into public.archive_categories (slug, label, rank) values
    ('workshop-material',  'Workshop Material',  10),
    ('website',            'Website',            20),
    ('planning-document',  'Planning Document',  30),
    ('proposal',           'Proposal',           40),
    ('rules',              'Rules',              50),
    ('registration',       'Registration',       60),
    ('judging',            'Judging',            70),
    ('presentation',       'Presentation',       80),
    ('poster',             'Poster',             90),
    ('branding',           'Branding',          100),
    ('photography',        'Photography',       110),
    ('results',            'Results',           120),
    ('source-code',        'Source Code',       130),
    ('report',             'Report',            140),
    ('other',              'Other',             999);

-- ---------------------------------------------------------------------------
-- Folders. Self-referencing, so nesting is unlimited.
-- ---------------------------------------------------------------------------
create table public.archive_folders (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid references public.projects (id) on delete cascade,
    parent_id   uuid references public.archive_folders (id) on delete cascade,
    name        text not null,
    slug        text not null,
    -- The workspace tab this belongs under: overview, files, website,
    -- workshops, documents, media, branding, results, organizers.
    section     text not null default 'files',
    description text,
    visibility  content_visibility not null default 'internal',
    sort_index  integer not null default 100,
    created_by  uuid references public.app_users (id),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    deleted_at  timestamptz
);

-- Sibling folders need distinct slugs; NULL parent means project root.
create unique index archive_folders_sibling_slug
    on public.archive_folders (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
    where deleted_at is null;

create index archive_folders_parent_idx on public.archive_folders (parent_id);

create trigger archive_folders_touch
    before update on public.archive_folders
    for each row execute function public.touch_updated_at();

-- Guard against a folder being made its own ancestor, which would make the
-- breadcrumb walk in the browser loop forever.
create or replace function public.check_archive_folder_cycle()
returns trigger
language plpgsql
as $$
declare
    cursor_id uuid := new.parent_id;
    hops      integer := 0;
begin
    while cursor_id is not null loop
        if cursor_id = new.id then
            raise exception 'A folder cannot be placed inside itself.';
        end if;
        hops := hops + 1;
        if hops > 50 then
            raise exception 'Archive folder nesting is too deep (limit 50).';
        end if;
        select parent_id into cursor_id from public.archive_folders where id = cursor_id;
    end loop;
    return new;
end;
$$;

create trigger archive_folders_no_cycles
    before insert or update of parent_id on public.archive_folders
    for each row execute function public.check_archive_folder_cycle();

-- ---------------------------------------------------------------------------
-- Items: a stored file, an external link, or an embedded page.
-- ---------------------------------------------------------------------------
create table public.archive_items (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid references public.projects (id) on delete cascade,
    folder_id    uuid references public.archive_folders (id) on delete set null,

    name         text not null,
    kind         archive_item_kind not null default 'file',
    category     text references public.archive_categories (slug),
    section      text not null default 'files',
    description  text,
    -- Human label such as 'PDF handout' or 'Archived HTML presentation'.
    kind_label   text,
    format       text,            -- 'PDF', 'PPTX', 'ZIP', ...
    size_label   text,            -- '8 pages', '12 slides' — as in the manifests
    state        text,            -- 'Published', 'Verified', 'Noindex archive'

    -- Exactly one destination. site_path covers material already committed to
    -- the repository; storage_path covers uploads; external_url covers links.
    storage_bucket text,
    storage_path   text,
    site_path      text,
    external_url   text,

    mime_type    text,
    size_bytes   bigint,
    tags         text[] not null default '{}',
    occurred_on  date,

    visibility   content_visibility not null default 'internal',
    is_featured  boolean not null default false,
    sort_index   integer not null default 100,

    created_by   uuid references public.app_users (id),
    published_by uuid references public.app_users (id),
    published_at timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    deleted_at   timestamptz,

    constraint archive_items_has_destination
        check (storage_path is not null or site_path is not null or external_url is not null),
    -- A publicly visible item must not point into a private bucket. Without
    -- this, publishing could leave the row public while the file itself stayed
    -- unreadable in `submissions` — visible in listings, broken on click.
    constraint archive_items_public_files_are_public
        check (visibility <> 'public'
               or storage_bucket is null
               or storage_bucket = 'public-archive')
);

create index archive_items_project_idx    on public.archive_items (project_id) where deleted_at is null;
create index archive_items_folder_idx     on public.archive_items (folder_id)  where deleted_at is null;
create index archive_items_visibility_idx on public.archive_items (visibility) where deleted_at is null;
create index archive_items_featured_idx   on public.archive_items (is_featured) where is_featured and deleted_at is null;
create index archive_items_tags_idx       on public.archive_items using gin (tags);

-- Free-text search across the fields a person would actually type.
create index archive_items_search_idx on public.archive_items
    using gin (to_tsvector('simple',
        coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(kind_label, '')));

create trigger archive_items_touch
    before update on public.archive_items
    for each row execute function public.touch_updated_at();

-- Who made it. Supports people who were never platform accounts (name only).
create table public.archive_item_contributors (
    id         uuid primary key default gen_random_uuid(),
    item_id    uuid not null references public.archive_items (id) on delete cascade,
    user_id    uuid references public.app_users (id) on delete set null,
    name_text  text,
    role_text  text,
    created_at timestamptz not null default now(),

    constraint archive_item_contributors_identified
        check (user_id is not null or nullif(btrim(coalesce(name_text, '')), '') is not null)
);

create index archive_item_contributors_item_idx on public.archive_item_contributors (item_id);
create index archive_item_contributors_user_idx on public.archive_item_contributors (user_id);

-- ---------------------------------------------------------------------------
-- Member submissions. Nothing here is public until an admin publishes it.
-- ---------------------------------------------------------------------------
create table public.archive_submissions (
    id            uuid primary key default gen_random_uuid(),
    submitted_by  uuid not null references public.app_users (id) on delete cascade,
    project_id    uuid references public.projects (id) on delete set null,
    folder_id     uuid references public.archive_folders (id) on delete set null,

    title         text not null,
    category      text references public.archive_categories (slug),
    description   text,
    occurred_on   date,
    notes         text,

    storage_bucket text,
    storage_path   text,
    external_url   text,
    file_name      text,
    mime_type      text,
    size_bytes     bigint,

    contributor_names text[] not null default '{}',
    contributor_ids   uuid[] not null default '{}',

    suggested_visibility content_visibility not null default 'internal',

    status        review_status not null default 'submitted',
    reviewed_by   uuid references public.app_users (id),
    reviewed_at   timestamptz,
    review_note   text,
    internal_note text,
    published_item_id uuid references public.archive_items (id) on delete set null,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint archive_submissions_has_content
        check (storage_path is not null or external_url is not null),
    constraint archive_submissions_title_length
        check (char_length(btrim(title)) between 3 and 200)
);

create index archive_submissions_status_idx on public.archive_submissions (status, created_at desc);
create index archive_submissions_user_idx   on public.archive_submissions (submitted_by, status);

create trigger archive_submissions_touch
    before update on public.archive_submissions
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- AI review assistance.
--
-- Stored separately and never merged into the submission automatically. The
-- suggestions are advisory input for a human reviewer; the admin decides.
-- ---------------------------------------------------------------------------
create table public.archive_submission_ai (
    submission_id uuid primary key references public.archive_submissions (id) on delete cascade,
    model         text not null,
    suggestions   jsonb not null default '{}'::jsonb,
    flags         jsonb not null default '[]'::jsonb,
    raw_response  text,
    generated_by  uuid references public.app_users (id),
    generated_at  timestamptz not null default now(),
    error         text
);

comment on table public.archive_submission_ai is
    'Advisory only. No process may read this table to make an approval '
    'decision — publishing always goes through publish_archive_submission(), '
    'which requires an authenticated admin.';

-- ---------------------------------------------------------------------------
-- Publishing a submission.
--
-- The single supported path from a submission to a published archive item, so
-- nothing can appear publicly without an admin acting and without that action
-- being recorded. The audit entry keeps what the member submitted alongside
-- what the admin published, which is how "the metadata was changed during
-- review" becomes an answerable question.
--
-- ai_accepted is passed by the review page when the admin took one or more of
-- the assistant's suggestions. It is recorded as context on the ADMIN's
-- decision — the assistant is never the deciding party.
-- ---------------------------------------------------------------------------
create or replace function public.publish_archive_submission(
    submission_id     uuid,
    final_title       text default null,
    final_category    text default null,
    final_description text default null,
    final_folder      uuid default null,
    final_project     uuid default null,
    final_visibility  content_visibility default null,
    final_section     text default null,
    reason            text default null,
    -- Where the admin console has already copied the file to. Buckets are a
    -- Storage concern, so the move happens before this is called and the
    -- resulting location is passed in.
    final_bucket      text default null,
    final_path        text default null,
    ai_accepted       text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    sub        record;
    item_id    uuid;
    bucket     text;
    path       text;
    visibility content_visibility;
    title      text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may publish to the archive.'
            using errcode = '42501';
    end if;

    select * into sub from public.archive_submissions where id = submission_id for update;
    if sub is null then
        raise exception 'Submission not found.';
    end if;
    if sub.published_item_id is not null then
        raise exception 'This submission has already been published.';
    end if;

    bucket     := coalesce(final_bucket, sub.storage_bucket);
    path       := coalesce(final_path, sub.storage_path);
    visibility := coalesce(final_visibility, sub.suggested_visibility);
    title      := coalesce(nullif(btrim(final_title), ''), sub.title);

    -- Refuse rather than publish a public row whose file nobody can open.
    if visibility = 'public' and path is not null and bucket <> 'public-archive' then
        raise exception
            'A public archive item must have its file in the public-archive bucket. '
            'The admin console copies it there before publishing.';
    end if;

    -- Publishing something publicly that the member asked to keep internal is
    -- an override of their judgement about their own material.
    if visibility = 'public' and sub.suggested_visibility = 'internal' then
        reason := public.require_reason(reason,
            'publish publicly something the member submitted as internal');
    end if;

    perform public.audit_context(reason, null, 'published', true, sub.submitted_by);

    insert into public.archive_items (
        project_id, folder_id, name, kind, category, section, description,
        storage_bucket, storage_path, external_url,
        mime_type, size_bytes, occurred_on, visibility, state,
        created_by, published_by, published_at
    ) values (
        coalesce(final_project, sub.project_id),
        coalesce(final_folder, sub.folder_id),
        title,
        case when sub.external_url is not null then 'link'::archive_item_kind
             else 'file'::archive_item_kind end,
        coalesce(final_category, sub.category),
        coalesce(final_section, 'files'),
        coalesce(final_description, sub.description),
        bucket, path, sub.external_url,
        sub.mime_type, sub.size_bytes, sub.occurred_on,
        visibility,
        'Published',
        sub.submitted_by, auth.uid(), now()
    )
    returning id into item_id;

    -- Credit the submitter plus anyone else they named.
    insert into public.archive_item_contributors (item_id, user_id)
    values (item_id, sub.submitted_by);

    insert into public.archive_item_contributors (item_id, name_text)
    select item_id, name_text
      from unnest(sub.contributor_names) as name_text
     where btrim(name_text) <> '';

    insert into public.archive_item_contributors (item_id, user_id)
    select item_id, contributor
      from unnest(sub.contributor_ids) as contributor
     where contributor <> sub.submitted_by;

    update public.archive_submissions
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_note = reason, published_item_id = item_id
     where id = submission_id;

    perform public.write_audit(
        action          => 'archive.published',
        category        => 'archive',
        entity_type     => 'archive_item',
        entity_id       => item_id::text,
        entity_label    => title,
        decision        => 'published',
        summary         => 'Published "' || title || '" as ' || visibility::text,
        reason          => reason,
        member_visible  => true,
        before_state    => jsonb_build_object(
                             'title', sub.title,
                             'category', sub.category,
                             'description', sub.description,
                             'visibility', sub.suggested_visibility,
                             'status', sub.status),
        after_state     => jsonb_build_object(
                             'title', title,
                             'category', coalesce(final_category, sub.category),
                             'description', coalesce(final_description, sub.description),
                             'visibility', visibility,
                             'status', 'approved'),
        related_project => coalesce(final_project, sub.project_id),
        related_member  => sub.submitted_by,
        related_request => submission_id,
        metadata        => jsonb_build_object(
                             'submission_id', submission_id,
                             -- Attribution, not authority: the admin above is
                             -- the one accountable for this decision.
                             'ai_suggestions_accepted', coalesce(ai_accepted, '{}'),
                             'ai_assisted', ai_accepted is not null
                                            and array_length(ai_accepted, 1) > 0)
    );

    return item_id;
end;
$$;

create or replace function public.decide_archive_submission(
    submission_id uuid,
    decision      review_status,
    reason        text default null,
    internal      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    sub   record;
    given text;
begin
    if not public.is_reviewer() then
        raise exception 'Only a reviewer may review archive submissions.'
            using errcode = '42501';
    end if;
    if decision not in ('rejected', 'changes_requested') then
        raise exception 'Use publish_archive_submission() to approve.';
    end if;

    given := public.require_reason(reason,
        case when decision = 'rejected' then 'decline an archive submission'
             else 'ask for changes to an archive submission' end);

    select * into sub from public.archive_submissions where id = submission_id for update;
    if sub is null then
        raise exception 'Submission not found.';
    end if;

    perform public.audit_context(given, internal, decision::text::audit_decision,
                                 true, sub.submitted_by);

    update public.archive_submissions
       set status = decision, reviewed_by = auth.uid(), reviewed_at = now(),
           review_note = given, internal_note = coalesce(internal, internal_note)
     where id = submission_id;

    perform public.write_audit(
        action          => 'archive_submission.' || decision::text,
        category        => 'archive',
        entity_type     => 'archive_submission',
        entity_id       => submission_id::text,
        entity_label    => sub.title,
        decision        => decision::text::audit_decision,
        summary         => case when decision = 'rejected'
                                then 'Declined "' || sub.title || '"'
                                else 'Changes requested on "' || sub.title || '"' end,
        reason          => given,
        internal_note   => internal,
        member_visible  => true,
        before_state    => jsonb_build_object('status', sub.status),
        after_state     => jsonb_build_object('status', decision),
        related_project => sub.project_id,
        related_member  => sub.submitted_by,
        related_request => submission_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- The lifecycle of a published item.
--
-- Changing what the public can see, moving something, or removing it are all
-- named actions with mandatory reasons, rather than quiet column edits. These
-- are the actions a future committee is most likely to have to account for.
-- ---------------------------------------------------------------------------
create or replace function public.set_archive_item_visibility(
    item_id       uuid,
    new_visibility content_visibility,
    reason        text,
    new_bucket    text default null,
    new_path      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    item  record;
    given text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may change archive visibility.'
            using errcode = '42501';
    end if;

    given := public.require_reason(reason, 'change what the public can see');

    select * into item from public.archive_items where id = item_id for update;
    if item is null then
        raise exception 'Archive item not found.';
    end if;
    if item.visibility = new_visibility then
        raise exception 'That item is already %.', new_visibility;
    end if;

    perform public.audit_context(given, null,
        (case when new_visibility = 'public' then 'published' else 'unpublished' end)::audit_decision,
        false, null);

    update public.archive_items
       set visibility     = new_visibility,
           storage_bucket = coalesce(new_bucket, storage_bucket),
           storage_path   = coalesce(new_path, storage_path),
           published_by   = auth.uid(),
           published_at   = case when new_visibility = 'public' then now() else published_at end
     where id = item_id;

    perform public.write_audit(
        action          => case when new_visibility = 'public'
                                then 'archive.made_public' else 'archive.made_internal' end,
        category        => 'archive',
        entity_type     => 'archive_item',
        entity_id       => item_id::text,
        entity_label    => item.name,
        decision        => (case when new_visibility = 'public'
                                 then 'published' else 'unpublished' end)::audit_decision,
        summary         => '"' || item.name || '" is now ' || new_visibility::text,
        reason          => given,
        before_state    => jsonb_build_object('visibility', item.visibility,
                                              'storage_bucket', item.storage_bucket),
        after_state     => jsonb_build_object('visibility', new_visibility,
                                              'storage_bucket', coalesce(new_bucket, item.storage_bucket)),
        related_project => item.project_id
    );
end;
$$;

create or replace function public.move_archive_item(
    item_id     uuid,
    new_folder  uuid default null,
    new_project uuid default null,
    new_section text default null,
    reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    item      record;
    old_folder text;
    new_name  text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may move archive items.' using errcode = '42501';
    end if;

    select * into item from public.archive_items where id = item_id for update;
    if item is null then
        raise exception 'Archive item not found.';
    end if;

    select name into old_folder from public.archive_folders where id = item.folder_id;
    select name into new_name   from public.archive_folders where id = new_folder;

    perform public.audit_context(reason, null, 'updated', false, null);

    update public.archive_items
       set folder_id  = coalesce(new_folder, folder_id),
           project_id = coalesce(new_project, project_id),
           section    = coalesce(new_section, section)
     where id = item_id;

    perform public.write_audit(
        action          => 'archive.moved',
        category        => 'archive',
        entity_type     => 'archive_item',
        entity_id       => item_id::text,
        entity_label    => item.name,
        decision        => 'updated',
        summary         => 'Moved "' || item.name || '"'
                           || coalesce(' to ' || new_name, ''),
        reason          => reason,
        before_state    => jsonb_build_object('folder', coalesce(old_folder, 'root'),
                                              'section', item.section),
        after_state     => jsonb_build_object('folder', coalesce(new_name, 'root'),
                                              'section', coalesce(new_section, item.section)),
        related_project => coalesce(new_project, item.project_id)
    );
end;
$$;

-- Soft deletion: the row survives so the audit trail still resolves to
-- something, and a mistaken removal is recoverable.
create or replace function public.delete_archive_item(
    item_id uuid,
    reason  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    item  record;
    given text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may remove archive items.' using errcode = '42501';
    end if;

    given := public.require_reason(reason, 'remove an item from the archive');

    select * into item from public.archive_items where id = item_id for update;
    if item is null then
        raise exception 'Archive item not found.';
    end if;

    perform public.audit_context(given, null, 'deleted', false, null);

    update public.archive_items set deleted_at = now() where id = item_id;

    perform public.write_audit(
        action          => 'archive.deleted',
        category        => 'archive',
        entity_type     => 'archive_item',
        entity_id       => item_id::text,
        entity_label    => item.name,
        decision        => 'deleted',
        summary         => 'Removed "' || item.name || '" from the archive',
        reason          => given,
        before_state    => jsonb_build_object('deleted', false,
                                              'visibility', item.visibility),
        after_state     => jsonb_build_object('deleted', true),
        related_project => item.project_id,
        metadata        => jsonb_build_object('soft_delete', true,
                                              'recoverable', true)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Recording that the assistant offered suggestions.
--
-- actor_kind 'ai_assistant' can never carry a decision — the audit_log
-- constraint enforces that. This entry exists so the trail shows what was
-- suggested, separately from what a named human then decided.
-- ---------------------------------------------------------------------------
create or replace function public.record_ai_suggestion(
    submission_id uuid,
    model         text,
    suggestion_summary text,
    flags         jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    sub record;
begin
    if not public.is_reviewer() then
        raise exception 'Only a reviewer may run the review assistant.'
            using errcode = '42501';
    end if;

    select * into sub from public.archive_submissions where id = submission_id;
    if sub is null then return; end if;

    perform public.write_audit(
        action       => 'archive.ai_suggested',
        category     => 'archive',
        entity_type  => 'archive_submission',
        entity_id    => submission_id::text,
        entity_label => sub.title,
        summary      => suggestion_summary,
        metadata     => jsonb_build_object('model', model, 'flags', flags),
        actor_kind   => 'ai_assistant'
    );
end;
$$;
