-- Rollback-contained live security smoke test. All fixture rows, including
-- audit rows, are rolled back by the expected AC999 exception at the end.

do $$
declare
    admin_id uuid := gen_random_uuid();
    member_id uuid := gen_random_uuid();
    admin_assignment_id uuid;
    audit_id bigint;
    rejected boolean;
begin
  begin
    insert into auth.users
      (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', admin_id,
       'authenticated', 'authenticated',
       'live-test-admin@invalid.example', '', now(),
       '{"provider":"email","providers":["email"]}',
       '{"full_name":"Live Test Admin"}', now(), now()),
      ('00000000-0000-0000-0000-000000000000', member_id,
       'authenticated', 'authenticated',
       'live-test-member@invalid.example', '', now(),
       '{"provider":"email","providers":["email"]}',
       '{"full_name":"Live Test Member"}', now(), now());

    insert into public.admin_assignments (user_id, role, note)
    values (admin_id, 'super_admin', 'Rollback-contained live verification')
    returning id into admin_assignment_id;

    perform set_config('request.jwt.claim.sub', admin_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);

    insert into public.member_profiles (user_id, visibility)
    values (member_id, 'private')
    on conflict (user_id) do update set visibility = excluded.visibility;
    insert into public.memberships (user_id, status, started_on, chapter_year)
    values (member_id, 'active', current_date, public.current_chapter_year());

    -- Reason enforcement: a privileged negative action must reject a short reason.
    rejected := false;
    begin
      perform public.set_membership_status(member_id, 'withdrawn', 'short', null, true);
    exception when others then
      rejected := true;
    end;
    if not rejected then
      raise exception 'Reason enforcement accepted an insufficient reason';
    end if;

    -- A successful RPC must mutate the domain row and produce one rich audit row.
    perform public.set_membership_status(
      member_id, 'inactive', 'Live security verification reason', null, true);
    if (select status from public.memberships where user_id = member_id) <> 'inactive' then
      raise exception 'Membership RPC did not mutate domain state';
    end if;
    select id into audit_id from public.audit_log
     where action = 'member.status_changed' and related_member_id = member_id;
    if audit_id is null then raise exception 'Membership RPC did not audit'; end if;
    if (select count(*) from public.audit_log
         where action = 'member.status_changed' and related_member_id = member_id) <> 1 then
      raise exception 'Explicit RPC audit was duplicated by fallback trigger';
    end if;
    if (select actor_name from public.audit_log where id = audit_id) <> 'Live Test Admin' then
      raise exception 'Actor name snapshot was not populated';
    end if;
    if (select actor_role from public.audit_log where id = audit_id) <> 'super_admin' then
      raise exception 'Actor role snapshot was not populated';
    end if;
    if (select decision from public.audit_log where id = audit_id) <> 'updated' then
      raise exception 'Audit decision is incorrect';
    end if;
    if not (select member_visible from public.audit_log where id = audit_id) then
      raise exception 'Member-visible decision flag was not preserved';
    end if;
    if (select before_state->>'membership_status' from public.audit_log where id = audit_id) <> 'active'
       or (select after_state->>'membership_status' from public.audit_log where id = audit_id) <> 'inactive' then
      raise exception 'Audit before/after state is incorrect';
    end if;
    if not ('membership_status' = any(select unnest(changed_fields) from public.audit_log where id = audit_id)) then
      raise exception 'Audit changed_fields omitted membership_status';
    end if;

    -- Append-only triggers protect even the table owner.
    rejected := false;
    begin update public.audit_log set summary = 'tampered' where id = audit_id;
    exception when others then rejected := true; end;
    if not rejected then raise exception 'Audit UPDATE was not rejected'; end if;
    rejected := false;
    begin delete from public.audit_log where id = audit_id;
    exception when others then rejected := true; end;
    if not rejected then raise exception 'Audit DELETE was not rejected'; end if;

    -- Role revocation succeeds while another live super admin keeps the guard valid.
    perform public.revoke_admin_role(
      admin_assignment_id, 'Rollback-contained admin revocation verification');
    if (select revoked_at from public.admin_assignments where id = admin_assignment_id) is null then
      raise exception 'Admin role revocation did not mutate the assignment';
    end if;

    raise exception using errcode = 'AC999', message = 'rollback live security fixtures';
  exception when sqlstate 'AC999' then
    null;
  end;

  if exists (select 1 from auth.users where id in (admin_id, member_id)) then
    raise exception 'Live security fixture rollback failed';
  end if;
  raise notice 'verified rollback-contained audit/reason/admin security smoke tests';
end;
$$;
