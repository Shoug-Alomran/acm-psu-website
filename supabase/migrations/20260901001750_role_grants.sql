-- ===========================================================================
-- 0017a — Role privileges.
--
-- Row level security decides WHICH ROWS a caller may see. It does not grant
-- the SQL privilege to touch the table at all. Both are required, and this
-- schema had only the first: every policy was correct and every request came
-- back `42501 permission denied`, because the tables were never granted to
-- `anon` or `authenticated`.
--
-- Older Supabase projects ship default privileges that hand those roles broad
-- access to anything created in `public`, which is why this is easy to miss.
-- Newer projects — this one included — do not. Relying on that implicit
-- behaviour was the mistake; the grants belong in the schema, stated, where
-- they can be read alongside the policies that constrain them.
--
-- The shape:
--   anon           SELECT, and only on the tables that carry an anon policy.
--   authenticated  full DML on base tables — RLS is what decides the outcome.
--   neither        DML on views, or any write to audit_log.
--
-- Granting DML broadly to `authenticated` is safe precisely because RLS is
-- enabled on all 31 tables (migration 0016 fails deployment otherwise): with
-- no matching policy, a privilege grants nothing.
-- ===========================================================================

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- anon — read-only, and only where an anon SELECT policy already exists.
--
-- This list is deliberately explicit rather than a loop. A table becomes
-- publicly readable because someone decided it should be, and that decision
-- should be visible here next to the policy that allows it.
-- ---------------------------------------------------------------------------
grant select on
    public.app_settings,               -- is_public rows only, per policy
    public.positions,
    public.projects,                   -- visibility = 'public' rows only
    public.project_organizers,
    public.contribution_types,
    public.archive_categories,
    public.archive_folders,            -- visibility = 'public' rows only
    public.archive_items,              -- visibility = 'public' rows only
    public.archive_item_contributors,
    public.inquiry_categories          -- needed to render the contact form
to anon;

-- ---------------------------------------------------------------------------
-- authenticated — DML on base tables only. Never on views: several of them are
-- simple enough for PostgreSQL to treat as auto-updatable, and because they
-- run as their owner a DELETE through one would bypass the very RLS the view
-- exists to apply. Views get SELECT and nothing else.
-- ---------------------------------------------------------------------------
do $$
declare
    relation record;
begin
    for relation in
        select c.relname
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'r'          -- ordinary tables only
         order by c.relname
    loop
        execute format(
            'grant select, insert, update, delete on public.%I to authenticated',
            relation.relname);
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views.
--
-- current_positions is security_invoker = true, so the caller's own RLS on
-- position_history still applies and granting SELECT gives away nothing: an
-- anonymous caller matches no policy there and sees no rows. It has to be
-- granted anyway, because public_member_directory reads it — and a nested
-- invoker view re-asserts caller permissions even from inside an owner-run
-- view, which is what was breaking the public roster.
-- ---------------------------------------------------------------------------
grant select on
    public.current_positions,
    public.public_member_directory,
    public.public_position_history
to anon, authenticated;

grant select on
    public.member_stats,
    public.my_decision_history,
    public.my_inquiries
to authenticated;

-- Capacity counts are for members and staff. This view runs as its owner, so
-- its WHERE clause is its authorization and anon must not hold SELECT at all.
grant select on public.event_position_availability to authenticated;
revoke all on public.event_position_availability from anon;

-- ---------------------------------------------------------------------------
-- The audit log stays append-only. Re-stated after the blanket grant above,
-- because that loop would otherwise have handed it back.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Prove the result, rather than assuming the grants landed.
-- ---------------------------------------------------------------------------
do $$
declare
    missing text;
begin
    -- Anonymous visitors must be able to read what the public site renders.
    select string_agg(t, ', ') into missing
      from unnest(array[
        'app_settings', 'positions', 'projects', 'contribution_types',
        'archive_categories', 'archive_folders', 'archive_items',
        'inquiry_categories'
      ]) as t
     where not has_table_privilege('anon', 'public.' || t, 'select');
    if missing is not null then
        raise exception 'anon still cannot read: %', missing;
    end if;

    if not has_table_privilege('anon', 'public.public_member_directory', 'select')
       or not has_table_privilege('anon', 'public.current_positions', 'select') then
        raise exception 'anon cannot read the public roster views';
    end if;

    -- ...and must not be able to read or write anything else.
    if has_table_privilege('anon', 'public.inquiries', 'select') then
        raise exception 'anon can read the inquiry queue';
    end if;
    if has_table_privilege('anon', 'public.audit_log', 'select') then
        raise exception 'anon can read the audit log';
    end if;
    if has_table_privilege('anon', 'public.event_position_availability', 'select') then
        raise exception 'anon can read event capacity';
    end if;
    if has_table_privilege('anon', 'public.app_users', 'select') then
        raise exception 'anon can read accounts';
    end if;

    -- Members must be able to do their own work; RLS decides the rows.
    select string_agg(t, ', ') into missing
      from unnest(array[
        'contributions', 'archive_submissions', 'member_requests',
        'position_change_requests', 'event_position_applications',
        'member_profiles', 'applications'
      ]) as t
     where not has_table_privilege('authenticated', 'public.' || t, 'insert');
    if missing is not null then
        raise exception 'authenticated cannot insert into: %', missing;
    end if;

    if not has_table_privilege('authenticated', 'public.member_stats', 'select') then
        raise exception 'members cannot read their own statistics';
    end if;
    if not has_table_privilege('authenticated', 'public.my_inquiries', 'select') then
        raise exception 'members cannot read their own inquiries';
    end if;

    -- The audit log stays append-only for everyone.
    if has_table_privilege('authenticated', 'public.audit_log', 'insert')
       or has_table_privilege('authenticated', 'public.audit_log', 'update')
       or has_table_privilege('authenticated', 'public.audit_log', 'delete') then
        raise exception 'the audit log is writable through a table privilege';
    end if;

    -- No DML on views, where an auto-updatable one would bypass RLS.
    if has_table_privilege('authenticated', 'public.my_inquiries', 'delete')
       or has_table_privilege('authenticated', 'public.my_decision_history', 'delete') then
        raise exception 'views are writable — an auto-updatable view would bypass RLS';
    end if;

    raise notice
        'verified: anon reads the public site, members hold DML on their own '
        'tables, the audit log stays append-only, and no view is writable';
end;
$$;
