-- ===========================================================================
-- 0018 — Capability repairs.
--
-- Three defects where the security model was correct but the resulting system
-- stopped ordinary people doing things they are entitled to do. The original
-- migrations carry the same corrections so a fresh database is born right;
-- this forward migration repairs a database that already applied them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Event capacity was computed through the caller's own row filter.
--
-- event_position_availability ran with security_invoker = true, so a member's
-- RLS on event_position_applications limited the aggregates to that member's
-- own rows. Every opening therefore read as fully available, "FULL" never
-- appeared, and a member could register for a role that was already filled —
-- learning about it only when an admin's approval failed on the capacity
-- check. The view returns counts and no personal data, so evaluating it as the
-- owner is safe and is the only way for the numbers to be true.
-- ---------------------------------------------------------------------------
-- Evaluating as owner is what makes the counts truthful. It also removes the
-- underlying policies from the path, so the view needs an authorization
-- predicate of its own — otherwise Supabase's default privileges would let an
-- anonymous visitor enumerate every event role, including unannounced ones on
-- internal projects, with its staffing. The WHERE clause repeats the
-- event_positions SELECT policy, so callers see exactly the rows they could
-- see on the table itself. Only aggregates cross from
-- event_position_applications; no applicant identity is reachable.
create or replace view public.event_position_availability
with (security_invoker = false) as
select
    ep.id            as event_position_id,
    ep.project_id,
    ep.title,
    ep.description,
    ep.openings,
    ep.is_open,
    ep.closes_on,
    count(a.id) filter (where a.status = 'approved') as filled,
    greatest(ep.openings - count(a.id) filter (where a.status = 'approved'), 0) as remaining,
    count(a.id) filter (where a.status = 'pending')  as pending
from public.event_positions ep
left join public.event_position_applications a on a.event_position_id = ep.id
where public.is_active_member() or public.is_staff()
group by ep.id;

revoke all on public.event_position_availability from anon;
grant select on public.event_position_availability to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Members could not read the upload limit they are held to.
--
-- max_upload_bytes was staff-only, so the portal silently fell back to its
-- compiled-in default. If a committee lowered the limit, members would be told
-- one number and refused by storage at another, after waiting for the upload.
-- The value is not sensitive.
-- ---------------------------------------------------------------------------
update public.app_settings
   set is_public = true,
       description = 'Largest accepted upload, in bytes. 25 MB by default.'
 where key = 'max_upload_bytes';

-- ---------------------------------------------------------------------------
-- 3. A signed-in sender's inquiry was audited twice.
--
-- submit_inquiry() writes a rich 'inquiry.submitted' entry, but did not
-- establish an audit context, so the inquiries row trigger also fired and
-- added a generic 'inquiry.created'. Anonymous submissions were unaffected —
-- the trigger skips when auth.uid() is null — which is precisely why this hid
-- until a member used the form.
--
-- Rebuilt from the live catalog so the fix applies without restating a long
-- function body that the source migration already carries.
-- ---------------------------------------------------------------------------
do $$
declare
    target regprocedure :=
        'public.submit_inquiry(text,text,text,text,text,text,text)'::regprocedure;
    definition text;
    anchor text := '    insert into public.inquiries (';
begin
    select pg_get_functiondef(target) into definition;

    if position('audit_context' in definition) > 0 then
        raise notice 'submit_inquiry already establishes an audit context';
        return;
    end if;

    if position(anchor in definition) = 0 then
        raise exception
            'submit_inquiry no longer matches the expected shape; apply the '
            'audit_context call by hand before continuing.';
    end if;

    definition := replace(
        definition,
        anchor,
        '    perform public.audit_context(null, null, ''created''::audit_decision, false, null);' ||
        chr(10) || chr(10) || anchor
    );

    execute definition;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prove the repairs took, rather than assuming they did.
-- ---------------------------------------------------------------------------
do $$
begin
    if (select c.reloptions::text from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'event_position_availability') ilike '%security_invoker=true%' then
        raise exception 'event_position_availability is still caller-filtered';
    end if;

    -- Running as owner without a predicate would be worse than the bug it
    -- fixes, so assert the guard is actually present.
    if position('is_active_member' in
            pg_get_viewdef('public.event_position_availability'::regclass)) = 0 then
        raise exception
            'event_position_availability runs as owner with no authorization '
            'predicate — it would expose unannounced internal event roles';
    end if;

    if has_table_privilege('anon', 'public.event_position_availability', 'select') then
        raise exception 'anon can still read event_position_availability';
    end if;

    if not has_table_privilege('authenticated', 'public.event_position_availability', 'select') then
        raise exception 'authenticated cannot read event_position_availability';
    end if;

    -- The fix must not have loosened the tables underneath it.
    if not (select relrowsecurity from pg_class
             where oid = 'public.event_positions'::regclass) then
        raise exception 'RLS was disabled on event_positions';
    end if;
    if not (select relrowsecurity from pg_class
             where oid = 'public.event_position_applications'::regclass) then
        raise exception 'RLS was disabled on event_position_applications';
    end if;

    if not (select is_public from public.app_settings where key = 'max_upload_bytes') then
        raise exception 'max_upload_bytes is still hidden from members';
    end if;

    if position('audit_context' in pg_get_functiondef(
        'public.submit_inquiry(text,text,text,text,text,text,text)'::regprocedure)) = 0 then
        raise exception 'submit_inquiry still double-audits signed-in senders';
    end if;

    raise notice 'verified: capacity counts (guarded, anon revoked, RLS intact), upload limit and inquiry auditing repaired';
end;
$$;
