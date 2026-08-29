-- ===========================================================================
-- 0001a — Audit and decision history.
--
-- Future committees inherit this system without inheriting the conversations
-- that produced its data. This table is how they answer, without guessing:
--
--     Who approved this person?  Why was this application rejected?
--     Who assigned this position, and what was the previous one?
--     Who made this file public?  Who removed this admin?
--     What role did that administrator hold at the time?
--
-- Three properties make that possible, and each is enforced here rather than
-- left to the application:
--
--   1. IDENTITY SNAPSHOT. An entry stores who the actor was *organisationally
--      at that moment* — name, ACM position, admin role, chapter — alongside
--      their id. Someone who approved an application as Vice President in 2026
--      still reads as Vice President in 2026 after they become an alumnus.
--
--   2. BEFORE / AFTER. Edits carry the previous and new state plus the list of
--      fields that actually changed, so "what exactly did they change" has an
--      answer rather than an inference.
--
--   3. APPEND-ONLY. Triggers reject every UPDATE and DELETE, for every role,
--      including the table owner. See the bottom of this file.
--
-- actor_id and the related_* columns are intentionally NOT foreign keys: the
-- trail must survive the deletion of whatever it refers to.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Who acted.
--
-- 'ai_assistant' exists so an AI suggestion can be recorded as having been
-- made — but a constraint below forbids it from ever carrying a decision. The
-- assistant suggests; a named human decides, and the audit log says so.
-- ---------------------------------------------------------------------------
create type audit_actor_kind as enum ('admin', 'member', 'system', 'migration', 'ai_assistant');

-- The filter tabs on the audit page, and a coarse grouping for retention.
create type audit_category as enum (
    'membership',
    'positions',
    'events',
    'projects',
    'contributions',
    'archive',
    'requests',
    'administration',
    'exports',
    'inquiries'
);

-- What was decided, where the action was a decision at all.
create type audit_decision as enum (
    'approved',
    'rejected',
    'changes_requested',
    'interview',
    'published',
    'unpublished',
    'granted',
    'revoked',
    'created',
    'updated',
    'archived',
    'restored',
    'deleted',
    'exported',
    'noted'
);

create table public.audit_log (
    id            bigint generated always as identity primary key,

    -- ---- who, as they were at the time -----------------------------------
    actor_kind    audit_actor_kind not null default 'admin',
    actor_id      uuid,              -- relational identity; no FK on purpose
    actor_email   text,
    actor_name    text,              -- snapshot: their name then
    actor_position text,             -- snapshot: their ACM position then
    actor_role    text,              -- snapshot: their admin role then
    actor_member_no text,            -- snapshot: their archive record id then
    actor_chapter_year text,         -- snapshot: the chapter then

    -- ---- what ------------------------------------------------------------
    category      audit_category not null,
    action        text not null,     -- dotted verb, e.g. 'application.approved'
    decision      audit_decision,
    entity_type   text,              -- 'application', 'member', 'archive_item'
    entity_id     text,
    entity_label  text,              -- human-readable name at the time
    summary       text not null default '',

    -- ---- why -------------------------------------------------------------
    -- reason is the account of the decision. member_visible controls whether
    -- the person it concerns may read it; internal_note never leaves staff.
    reason         text,
    internal_note  text,
    member_visible boolean not null default false,

    -- ---- what changed ----------------------------------------------------
    before_state   jsonb,
    after_state    jsonb,
    changed_fields text[] not null default '{}',

    -- ---- context ---------------------------------------------------------
    related_project_id uuid,
    related_member_id  uuid,
    related_request_id uuid,
    metadata           jsonb not null default '{}'::jsonb,

    -- Groups every entry produced by one transaction, so a single approval
    -- that touched four tables reads as one event with its detail attached.
    correlation_id uuid,

    -- ---- system ----------------------------------------------------------
    -- Deliberately no IP address. It identifies a person's location and
    -- network, is of little use in a student club's accountability story, and
    -- would make this table far more sensitive than it needs to be. The
    -- user agent is kept only to distinguish a browser action from a script.
    user_agent    text,
    created_at    timestamptz not null default now(),

    -- The assistant advises; it never decides. Enforced, not just intended.
    constraint audit_ai_never_decides
        check (actor_kind <> 'ai_assistant' or decision is null),

    -- A member-visible entry must say who it concerns and why.
    constraint audit_member_visible_is_addressed
        check (not member_visible or related_member_id is not null)
);

create index audit_log_created_idx   on public.audit_log (created_at desc);
create index audit_log_category_idx  on public.audit_log (category, created_at desc);
create index audit_log_action_idx    on public.audit_log (action, created_at desc);
create index audit_log_decision_idx  on public.audit_log (decision, created_at desc);
create index audit_log_entity_idx    on public.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_actor_idx     on public.audit_log (actor_id, created_at desc);
create index audit_log_member_idx    on public.audit_log (related_member_id, created_at desc);
create index audit_log_project_idx   on public.audit_log (related_project_id, created_at desc);
create index audit_log_request_idx   on public.audit_log (related_request_id);
create index audit_log_correlation_idx on public.audit_log (correlation_id);

-- Free-text search across the fields someone would actually type.
create index audit_log_search_idx on public.audit_log
    using gin (to_tsvector('simple',
        coalesce(actor_name, '') || ' ' || coalesce(entity_label, '') || ' ' ||
        coalesce(summary, '') || ' ' || coalesce(reason, '') || ' ' || action));

comment on table public.audit_log is
    'Append-only record of significant administrative actions and decisions. '
    'UPDATE and DELETE are rejected by trigger for every role, including the '
    'table owner. public.write_audit() is the only supported way to add a row.';

comment on column public.audit_log.actor_position is
    'The actor''s ACM position AT THE TIME. Never resolve an old entry against '
    'a current profile — that is the whole point of this column.';

comment on column public.audit_log.member_visible is
    'When true, the person named in related_member_id may read this entry''s '
    'reason through public.my_decision_history. internal_note is never exposed '
    'by that view regardless.';

-- ---------------------------------------------------------------------------
-- Never store a credential in an audit entry.
--
-- Metadata is assembled by callers, and a caller can be careless. This strips
-- anything whose key looks like a secret before it is written, so a mistake
-- upstream cannot turn the audit log into a place secrets accumulate.
-- ---------------------------------------------------------------------------
create or replace function public.scrub_sensitive(payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
    result jsonb := '{}'::jsonb;
    item   record;
begin
    if payload is null or jsonb_typeof(payload) <> 'object' then
        return coalesce(payload, '{}'::jsonb);
    end if;

    for item in select key, value from jsonb_each(payload) loop
        if item.key ~* '(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|authorization|session|jwt|cookie|otp|signature)' then
            result := result || jsonb_build_object(item.key, '[redacted]');
        elsif jsonb_typeof(item.value) = 'object' then
            result := result || jsonb_build_object(item.key, public.scrub_sensitive(item.value));
        else
            result := result || jsonb_build_object(item.key, item.value);
        end if;
    end loop;

    return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Which keys differ between two states. Powers the "Position: Member →
-- Events Coordinator" rendering, so nobody has to read raw JSON.
-- ---------------------------------------------------------------------------
create or replace function public.jsonb_changed_fields(before_state jsonb, after_state jsonb)
returns text[]
language sql
immutable
as $$
    select coalesce(array_agg(key order by key), '{}')
    from (
        select key
        from jsonb_each(coalesce(after_state, '{}'::jsonb))
        where before_state is null
           or (before_state -> key) is distinct from (after_state -> key)
        union
        select key
        from jsonb_each(coalesce(before_state, '{}'::jsonb))
        where after_state is null or not (after_state ? key)
    ) diff
    -- Bookkeeping columns change on every write and say nothing useful.
    where key not in ('updated_at', 'created_at');
$$;

-- ---------------------------------------------------------------------------
-- The actor's organisational identity, resolved once, at write time.
-- ---------------------------------------------------------------------------
create or replace function public.audit_actor_snapshot(target uuid)
returns table (
    email        text,
    full_name    text,
    position_title text,
    admin_role   text,
    member_no    text,
    chapter_year text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    -- plpgsql rather than SQL on purpose: this function is created before the
    -- tables it reads, and only a plpgsql body defers name resolution to call
    -- time. Keeping it here lets every later migration audit freely.
    return query
    select
        u.email::text,
        u.full_name,
        cp.title,
        -- Highest role held, so an entry reads with the authority the person
        -- actually had rather than whichever grant sorted first.
        (select a.role::text
           from public.admin_assignments a
          where a.user_id = u.id and a.revoked_at is null
          order by case a.role
                     when 'super_admin' then 1
                     when 'club_admin'  then 2
                     when 'reviewer'    then 3
                   end
          limit 1),
        m.member_no,
        coalesce(m.chapter_year, public.current_chapter_year())
    from public.app_users u
    left join public.memberships m      on m.user_id = u.id
    left join public.current_positions cp on cp.user_id = u.id
    where u.id = target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transaction-scoped decision context.
--
-- A privileged function calls this first; the row triggers installed in a
-- later migration then attach the same reason, decision and correlation id to
-- every change the transaction makes. That is how one approval produces one
-- coherent story instead of four disconnected rows.
--
-- `true` on set_config makes each value local to the transaction, so nothing
-- leaks into the next request on a pooled connection.
-- ---------------------------------------------------------------------------
create or replace function public.audit_context(
    reason         text default null,
    internal_note  text default null,
    decision       audit_decision default null,
    member_visible boolean default false,
    member         uuid default null
)
returns uuid
language plpgsql
as $$
declare
    correlation uuid := gen_random_uuid();
begin
    perform set_config('acm.audit_correlation', correlation::text, true);
    perform set_config('acm.audit_reason', coalesce(reason, ''), true);
    perform set_config('acm.audit_internal', coalesce(internal_note, ''), true);
    perform set_config('acm.audit_decision', coalesce(decision::text, ''), true);
    perform set_config('acm.audit_member_visible', case when member_visible then 'on' else '' end, true);
    perform set_config('acm.audit_member', coalesce(member::text, ''), true);
    return correlation;
end;
$$;

/* Reads a context value, returning NULL rather than an empty string. */
create or replace function public.audit_context_value(name text)
returns text
language sql
stable
as $$ select nullif(current_setting('acm.audit_' || name, true), ''); $$;

-- ---------------------------------------------------------------------------
-- require_reason — the guard for consequential actions.
--
-- Used by every function that rejects, revokes, deletes, withdraws, changes an
-- admin role, or overrides an already-verified record. A future committee
-- reading "REJECTED" with no explanation learns nothing, which defeats the
-- purpose of keeping the record at all.
-- ---------------------------------------------------------------------------
create or replace function public.require_reason(reason text, what text)
returns text
language plpgsql
immutable
as $$
begin
    if reason is null or char_length(btrim(reason)) < 8 then
        raise exception
            'A reason is required to % — future committees need to know why. '
            'Please write at least a short sentence.', what
            using errcode = '23514';
    end if;
    return btrim(reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- write_audit — the only supported way to add an entry.
--
-- SECURITY DEFINER so RLS-restricted callers can append without being granted
-- INSERT on the table. Named parameters throughout: this signature is long by
-- necessity, and positional calls would be unreadable at the call sites.
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
    action         text,
    category       audit_category,
    entity_type    text default null,
    entity_id      text default null,
    entity_label   text default null,
    decision       audit_decision default null,
    summary        text default '',
    reason         text default null,
    internal_note  text default null,
    member_visible boolean default false,
    before_state   jsonb default null,
    after_state    jsonb default null,
    changed_fields text[] default null,
    related_project uuid default null,
    related_member  uuid default null,
    related_request uuid default null,
    metadata       jsonb default '{}'::jsonb,
    actor_kind     audit_actor_kind default 'admin'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
    snapshot record;
    entry_id bigint;
    resolved_member uuid := coalesce(related_member,
                                     public.audit_context_value('member')::uuid);
begin
    select * into snapshot from public.audit_actor_snapshot(auth.uid());

    insert into public.audit_log (
        actor_kind, actor_id, actor_email, actor_name, actor_position,
        actor_role, actor_member_no, actor_chapter_year,
        category, action, decision, entity_type, entity_id, entity_label, summary,
        reason, internal_note, member_visible,
        before_state, after_state, changed_fields,
        related_project_id, related_member_id, related_request_id,
        metadata, correlation_id
    )
    values (
        actor_kind,
        auth.uid(),
        snapshot.email,
        snapshot.full_name,
        snapshot.position_title,
        snapshot.admin_role,
        snapshot.member_no,
        snapshot.chapter_year,
        category,
        action,
        coalesce(decision, public.audit_context_value('decision')::audit_decision),
        entity_type,
        entity_id,
        entity_label,
        summary,
        coalesce(reason, public.audit_context_value('reason')),
        coalesce(internal_note, public.audit_context_value('internal')),
        -- A member-visible entry has to name the member it concerns.
        (member_visible or public.audit_context_value('member_visible') is not null)
            and resolved_member is not null,
        public.scrub_sensitive(before_state),
        public.scrub_sensitive(after_state),
        coalesce(changed_fields,
                 public.jsonb_changed_fields(before_state, after_state)),
        related_project,
        resolved_member,
        related_request,
        public.scrub_sensitive(metadata),
        coalesce(public.audit_context_value('correlation')::uuid, gen_random_uuid())
    )
    returning id into entry_id;

    return entry_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Immutability.
--
-- RLS alone is not enough: a table's owner bypasses its policies, so "no
-- UPDATE policy" would still leave the owner able to rewrite history. These
-- triggers reject the statement itself, which applies to every role. Removing
-- them requires DDL access to the database, which is exactly the level at
-- which such a change should be visible.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
    raise exception
        'The audit log is append-only. Entries cannot be % once written.',
        lower(tg_op)
        using errcode = '42501',
              hint = 'Record a correcting entry instead of altering history.';
end;
$$;

create trigger audit_log_no_update
    before update on public.audit_log
    for each row execute function public.audit_log_is_append_only();

create trigger audit_log_no_delete
    before delete on public.audit_log
    for each row execute function public.audit_log_is_append_only();

-- Belt as well as braces: no client role is granted the privilege either.
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

grant execute on function public.write_audit(
    text, audit_category, text, text, text, audit_decision, text, text, text,
    boolean, jsonb, jsonb, text[], uuid, uuid, uuid, jsonb, audit_actor_kind
) to authenticated;
