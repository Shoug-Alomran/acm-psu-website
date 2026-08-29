-- Live catalog assertions. This migration creates no objects or data; it makes
-- deployment fail if the resulting PostgreSQL security shape is incomplete.

do $$
declare
    table_count integer;
    view_count integer;
    enum_count integer;
    function_count integer;
    trigger_count integer;
    auth_trigger_count integer;
    policy_count integer;
    rls_missing integer;
    bucket_count integer;
    storage_policy_count integer;
begin
    select count(*) into table_count
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p');
    select count(*) into view_count
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm');
    select count(*) into enum_count
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'e';
    select count(*) into function_count
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f';
    select count(*) into trigger_count
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal;
    select count(*) into auth_trigger_count
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'on_auth_user_created' and not t.tgisinternal;
    select count(*) into policy_count from pg_policies where schemaname = 'public';
    select count(*) into rls_missing
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
    select count(*) into bucket_count from storage.buckets
     where id in ('public-archive', 'internal-archive', 'submissions', 'evidence', 'avatars');
    select count(*) into storage_policy_count from pg_policies
     where schemaname = 'storage' and tablename = 'objects';

    if table_count <> 31 then raise exception 'Expected 31 public tables, found %', table_count; end if;
    if view_count <> 7 then raise exception 'Expected 7 public views, found %', view_count; end if;
    if enum_count <> 17 then raise exception 'Expected 17 public enums, found %', enum_count; end if;
    if function_count < 64 then raise exception 'Expected at least 64 public functions, found %', function_count; end if;
    if trigger_count <> 37 then raise exception 'Expected 37 public triggers, found %', trigger_count; end if;
    if auth_trigger_count <> 1 then raise exception 'Expected auth user provisioning trigger, found %', auth_trigger_count; end if;
    if policy_count <> 92 then raise exception 'Expected 92 public policies, found %', policy_count; end if;
    if rls_missing <> 0 then raise exception '% public tables do not have RLS enabled', rls_missing; end if;
    if bucket_count <> 5 then raise exception 'Expected 5 storage buckets, found %', bucket_count; end if;
    if storage_policy_count <> 19 then raise exception 'Expected 19 storage object policies, found %', storage_policy_count; end if;

    raise notice 'verified: tables=%, views=%, enums=%, public triggers=% (+1 auth), functions=%, public policies=%, storage buckets=%, storage policies=%',
        table_count, view_count, enum_count, trigger_count, function_count,
        policy_count, bucket_count, storage_policy_count;
end;
$$;
