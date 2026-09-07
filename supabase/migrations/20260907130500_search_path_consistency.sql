-- ===========================================================================
-- Every definer function searches pg_temp last.
--
-- 89 of the schema's 90 security definer functions set `search_path = public`.
-- That is nearly right, and the missing piece is the documented part: with no
-- pg_temp entry, Postgres searches the temporary schema *first*, because an
-- implicit pg_temp is prepended to any search_path that does not name it. A
-- caller able to create a temporary object can then shadow a table or function
-- the definer body refers to unqualified, and it runs with the definer's
-- rights.
--
-- Reaching that from PostgREST is not straightforward, which is why this is
-- hygiene rather than a finding. But "every definer function pins its
-- search_path safely" is the kind of property that is worth being able to
-- state without checking, and it costs one migration to make true.
--
-- Naming pg_temp explicitly puts it where it is written: last.
--
-- This is deliberately a loop rather than 90 hand-written ALTERs. It runs over
-- whatever the schema actually contains at this point, so a function added by
-- an earlier migration and forgotten here is still covered.
-- ===========================================================================

do $$
declare
    fn record;
    fixed integer := 0;
begin
    for fn in
        select p.oid::regprocedure as signature
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosecdef                                    -- security definer
           -- Substring, not equality: proconfig's stored spelling varies with
           -- how the setting was written, and all that matters is that pg_temp
           -- is named rather than implicitly prepended.
           and not exists (
               select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
                where cfg like 'search_path=%pg_temp%'
           )
    loop
        execute format('alter function %s set search_path = public, pg_temp', fn.signature);
        fixed := fixed + 1;
    end loop;

    raise notice 'search_path pinned to (public, pg_temp) on % security definer function(s).', fixed;
end;
$$;

-- Prove the loop above actually covered everything, so a mistake in its
-- predicate fails the deployment here rather than leaving a quiet gap. This
-- checks the schema as it stands at this migration; a definer function added
-- by a later migration should pin pg_temp in its own definition.
do $$
declare
    offenders text;
begin
    select string_agg(p.oid::regprocedure::text, ', ')
      into offenders
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (
           select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
            where cfg like 'search_path=%pg_temp%'
       );

    if offenders is not null then
        raise exception
            'These security definer functions do not pin pg_temp in their '
            'search_path: %', offenders;
    end if;
end;
$$;
