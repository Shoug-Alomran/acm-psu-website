-- ===========================================================================
-- 0013 — Audit coverage.
--
-- The privileged functions in earlier migrations write rich, reasoned entries
-- for the decisions that matter. This migration closes the gap around them:
--
--   1. Row triggers on the tables that the admin console still writes to
--      directly, so an audit entry never depends on the browser remembering
--      to ask for one.
--   2. RPCs for the remaining consequential actions — membership status,
--      admin roles, settings, exports — moving them out of the client and
--      into the same transaction as their audit entry.
--   3. Read paths: a member-safe view of decisions about them, a per-record
--      activity trail for admin pages, and a summary for the audit page.
--
-- HOW THE TWO LAYERS AVOID DUPLICATING EACH OTHER
--
-- audit_context() sets acm.audit_silent for the transaction. A transaction
-- that has established an audit context is one where an RPC is in charge and
-- will write its own entry, so the triggers stand down. Direct writes from the
-- console never set a context, so the triggers record them.
-- ===========================================================================

-- Every RPC that calls audit_context() takes responsibility for its own entry.
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
    -- The caller writes its own richer entry; row triggers stay quiet.
    perform set_config('acm.audit_silent', 'on', true);
    return correlation;
end;
$$;

-- ---------------------------------------------------------------------------
-- The generic row trigger.
--
-- Trigger arguments: category, entity type, label column, id column.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    cat        audit_category := tg_argv[0]::audit_category;
    ent        text := tg_argv[1];
    label_col  text := tg_argv[2];
    id_col     text := coalesce(tg_argv[3], 'id');
    before_js  jsonb;
    after_js   jsonb;
    subject    jsonb;
    changed    text[];
    decided    audit_decision;
    verb       text;
begin
    -- An RPC is handling this transaction and will write a better entry.
    if current_setting('acm.audit_silent', true) = 'on' then
        return coalesce(new, old);
    end if;

    -- Unauthenticated writes are migrations and seeds, not decisions.
    if auth.uid() is null then
        return coalesce(new, old);
    end if;

    if tg_op <> 'INSERT' then before_js := to_jsonb(old); end if;
    if tg_op <> 'DELETE' then after_js  := to_jsonb(new); end if;
    subject := coalesce(after_js, before_js);

    changed := public.jsonb_changed_fields(before_js, after_js);

    -- An UPDATE that only touched bookkeeping columns is not an event.
    if tg_op = 'UPDATE' and cardinality(changed) = 0 then
        return new;
    end if;

    decided := case tg_op
                 when 'INSERT' then 'created'::audit_decision
                 when 'DELETE' then 'deleted'::audit_decision
                 else 'updated'::audit_decision
               end;
    verb := lower(decided::text);

    perform public.write_audit(
        action         => ent || '.' || verb,
        category       => cat,
        entity_type    => ent,
        entity_id      => subject ->> id_col,
        entity_label   => subject ->> label_col,
        decision       => decided,
        summary        => initcap(replace(ent, '_', ' ')) || ' ' || verb
                          || coalesce(' — ' || (subject ->> label_col), ''),
        before_state   => before_js,
        after_state    => after_js,
        changed_fields => changed,
        -- Most tables name the person as user_id; app_users names them id.
        related_member => coalesce(
                            subject ->> 'user_id',
                            case when ent = 'account' then subject ->> 'id' end)::uuid,
        related_project => (subject ->> 'project_id')::uuid,
        metadata       => jsonb_build_object('via', 'direct_write', 'operation', tg_op)
    );

    return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Where the safety net is stretched.
--
-- Deliberately NOT on member_profiles: members edit their own bio and links
-- freely and often, and recording every one of those would bury the decisions
-- this log exists to preserve. Admin changes to a profile arrive through the
-- request RPCs instead, which do audit.
-- ---------------------------------------------------------------------------
create trigger memberships_audit
    after insert or update or delete on public.memberships
    for each row execute function public.audit_row_change('membership', 'membership', 'status', 'user_id');

create trigger position_history_audit
    after insert or update or delete on public.position_history
    for each row execute function public.audit_row_change('positions', 'position_history', 'title_snapshot');

create trigger positions_audit
    after insert or update or delete on public.positions
    for each row execute function public.audit_row_change('positions', 'position', 'title');

create trigger projects_audit
    after insert or update or delete on public.projects
    for each row execute function public.audit_row_change('projects', 'project', 'title');

create trigger project_organizers_audit
    after insert or update or delete on public.project_organizers
    for each row execute function public.audit_row_change('projects', 'project_organizer', 'role_text');

create trigger event_positions_audit
    after insert or update or delete on public.event_positions
    for each row execute function public.audit_row_change('events', 'event_position', 'title');

create trigger participations_audit
    after insert or update or delete on public.participations
    for each row execute function public.audit_row_change('events', 'participation', 'role_text');

create trigger archive_items_audit
    after insert or update or delete on public.archive_items
    for each row execute function public.audit_row_change('archive', 'archive_item', 'name');

create trigger archive_folders_audit
    after insert or update or delete on public.archive_folders
    for each row execute function public.audit_row_change('archive', 'archive_folder', 'name');

create trigger admin_assignments_audit
    after insert or update or delete on public.admin_assignments
    for each row execute function public.audit_row_change('administration', 'admin_assignment', 'role');

create trigger app_settings_audit
    after insert or update or delete on public.app_settings
    for each row execute function public.audit_row_change('administration', 'setting', 'key', 'key');

create trigger app_users_audit
    after update on public.app_users
    for each row execute function public.audit_row_change('membership', 'account', 'full_name');

-- ===========================================================================
-- Remaining consequential actions, moved out of the browser.
--
-- Each of these was previously a direct table write from the admin console
-- followed by a separate audit call — two round trips, either of which could
-- succeed without the other. As RPCs they are one transaction: if the audit
-- entry cannot be written, the change does not happen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Membership status, set directly by an admin rather than through a request.
-- ---------------------------------------------------------------------------
create or replace function public.set_membership_status(
    target_user  uuid,
    new_status   membership_status,
    reason       text default null,
    internal     text default null,
    close_position boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    before_row record;
    old_title  text;
    given      text;
    should_close boolean;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may change membership status.'
            using errcode = '42501';
    end if;

    select * into before_row from public.memberships where user_id = target_user for update;
    if before_row is null then
        raise exception 'That person has no membership record.';
    end if;
    if before_row.status = new_status then
        raise exception 'Their membership is already %.', new_status;
    end if;

    -- Ending or refusing someone's membership needs an account of why.
    -- Reinstating or activating does not.
    if new_status in ('withdrawn', 'inactive', 'rejected', 'alumni') then
        given := public.require_reason(reason,
            'change a membership to ' || new_status::text);
    else
        given := reason;
    end if;

    select title_snapshot into old_title from public.position_history
     where user_id = target_user and ended_on is null;

    should_close := coalesce(close_position,
                             new_status in ('withdrawn', 'inactive', 'alumni'));

    perform public.audit_context(given, internal, 'updated', true, target_user);

    update public.memberships
       set status   = new_status,
           ended_on = case when new_status in ('withdrawn', 'alumni', 'inactive')
                           then coalesce(ended_on, current_date)
                           when new_status = 'active' then null
                           else ended_on end,
           internal_note = coalesce(internal, internal_note)
     where user_id = target_user;

    if should_close then
        update public.position_history
           set ended_on = current_date
         where user_id = target_user and ended_on is null;
    end if;

    perform public.write_audit(
        action         => 'member.status_changed',
        category       => 'membership',
        entity_type    => 'member',
        entity_id      => target_user::text,
        entity_label   => (select full_name from public.app_users where id = target_user),
        decision       => 'updated',
        summary        => initcap(before_row.status::text) || ' → ' || initcap(new_status::text),
        reason         => given,
        internal_note  => internal,
        member_visible => true,
        before_state   => jsonb_build_object('membership_status', before_row.status,
                                             'position', coalesce(old_title, 'none')),
        after_state    => jsonb_build_object('membership_status', new_status,
                                             'position', case when should_close then 'ended'
                                                              else coalesce(old_title, 'none') end),
        related_member => target_user,
        metadata       => jsonb_build_object('history_preserved', true)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Account access. Disabling stops sign-in; it removes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.set_account_state(
    target_user uuid,
    new_state   account_state,
    reason      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    before_row record;
    given      text;
begin
    if not public.is_super_admin() then
        raise exception 'Only a super admin may disable or restore an account.'
            using errcode = '42501';
    end if;

    given := public.require_reason(reason, 'change whether someone can sign in');

    select * into before_row from public.app_users where id = target_user for update;
    if before_row is null then
        raise exception 'Account not found.';
    end if;

    perform public.audit_context(given, null,
        (case when new_state = 'disabled' then 'revoked' else 'restored' end)::audit_decision,
        true, target_user);

    update public.app_users set account_state = new_state where id = target_user;

    perform public.write_audit(
        action         => 'account.' || new_state::text,
        category       => 'administration',
        entity_type    => 'account',
        entity_id      => target_user::text,
        entity_label   => before_row.full_name,
        decision       => (case when new_state = 'disabled' then 'revoked' else 'restored' end)::audit_decision,
        summary        => before_row.full_name || ' — sign-in ' || new_state::text,
        reason         => given,
        member_visible => true,
        before_state   => jsonb_build_object('account_state', before_row.account_state),
        after_state    => jsonb_build_object('account_state', new_state),
        related_member => target_user,
        metadata       => jsonb_build_object(
                            'records_retained', true,
                            'note', 'Position history and verified contributions are unaffected.')
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin roles. Handover happens here, so it is recorded here.
-- ---------------------------------------------------------------------------
create or replace function public.grant_admin_role(
    target_user uuid,
    new_role    admin_role,
    reason      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    assignment uuid;
    given      text;
    person     text;
begin
    if not public.is_super_admin() then
        raise exception 'Only a super admin may grant admin roles.' using errcode = '42501';
    end if;

    given := public.require_reason(reason, 'grant an admin role');

    select full_name into person from public.app_users where id = target_user;
    if person is null then
        raise exception 'That person does not have an account yet.';
    end if;

    perform public.audit_context(given, null, 'granted', true, target_user);

    insert into public.admin_assignments (user_id, role, granted_by, note)
    values (target_user, new_role, auth.uid(), given)
    returning id into assignment;

    perform public.write_audit(
        action         => 'admin.role_granted',
        category       => 'administration',
        entity_type    => 'admin_assignment',
        entity_id      => assignment::text,
        entity_label   => person,
        decision       => 'granted',
        summary        => person || ' granted ' || replace(new_role::text, '_', ' '),
        reason         => given,
        member_visible => true,
        before_state   => jsonb_build_object('role', 'none'),
        after_state    => jsonb_build_object('role', new_role),
        related_member => target_user,
        metadata       => jsonb_build_object('is_handover', new_role = 'super_admin')
    );

    return assignment;
end;
$$;

create or replace function public.revoke_admin_role(
    assignment_id uuid,
    reason        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
    person     text;
    given      text;
begin
    if not public.is_super_admin() then
        raise exception 'Only a super admin may revoke admin roles.' using errcode = '42501';
    end if;

    given := public.require_reason(reason, 'revoke an admin role');

    select * into row_before from public.admin_assignments
     where id = assignment_id for update;
    if row_before is null then
        raise exception 'Role assignment not found.';
    end if;
    if row_before.revoked_at is not null then
        raise exception 'That role has already been revoked.';
    end if;

    select full_name into person from public.app_users where id = row_before.user_id;

    perform public.audit_context(given, null, 'revoked', true, row_before.user_id);

    -- guard_last_super_admin() refuses to leave the club with no super admin.
    update public.admin_assignments
       set revoked_at = now(), revoked_by = auth.uid()
     where id = assignment_id;

    perform public.write_audit(
        action         => 'admin.role_revoked',
        category       => 'administration',
        entity_type    => 'admin_assignment',
        entity_id      => assignment_id::text,
        entity_label   => person,
        decision       => 'revoked',
        summary        => replace(row_before.role::text, '_', ' ') || ' revoked from ' || person,
        reason         => given,
        member_visible => true,
        before_state   => jsonb_build_object('role', row_before.role, 'active', true),
        after_state    => jsonb_build_object('role', row_before.role, 'active', false),
        related_member => row_before.user_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings. Changing the chapter year or closing applications affects
-- everybody, so both are recorded with their before and after values.
-- ---------------------------------------------------------------------------
create or replace function public.save_setting(
    setting_key text,
    new_value   jsonb,
    reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    before_value jsonb;
    given        text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may change settings.' using errcode = '42501';
    end if;

    select value into before_value from public.app_settings
     where key = setting_key for update;
    if before_value is null and not exists (
        select 1 from public.app_settings where key = setting_key) then
        raise exception 'Unknown setting "%".', setting_key;
    end if;

    -- The switches that change what the platform does for everyone.
    if setting_key in ('ai_review_enabled', 'google_sheets_enabled',
                       'applications_open', 'psu_email_domains') then
        given := public.require_reason(reason, 'change the "' || setting_key || '" setting');
    else
        given := reason;
    end if;

    perform public.audit_context(given, null, 'updated', false, null);

    update public.app_settings
       set value = new_value, updated_by = auth.uid()
     where key = setting_key;

    perform public.write_audit(
        action       => case when setting_key = 'current_chapter_year'
                             then 'settings.chapter_year_changed'
                             else 'settings.changed' end,
        category     => 'administration',
        entity_type  => 'setting',
        entity_id    => setting_key,
        entity_label => setting_key,
        decision     => 'updated',
        summary      => setting_key || ': ' || coalesce(before_value #>> '{}', 'unset')
                        || ' → ' || coalesce(new_value #>> '{}', 'unset'),
        reason       => given,
        before_state => jsonb_build_object(setting_key, before_value),
        after_state  => jsonb_build_object(setting_key, new_value)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- University exports. Handing student data to the university is exactly the
-- kind of action a successor needs to be able to account for.
-- ---------------------------------------------------------------------------
create or replace function public.record_university_export(
    dataset     text,
    format      text,
    row_count   integer,
    destination text default null,
    reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may generate university records.'
            using errcode = '42501';
    end if;

    insert into public.university_exports
        (dataset, format, row_count, destination, generated_by)
    values (dataset, format, row_count, destination, auth.uid());

    perform public.write_audit(
        action       => 'export.generated',
        category     => 'exports',
        entity_type  => 'university_export',
        entity_id    => dataset,
        entity_label => initcap(dataset) || ' (' || upper(format) || ')',
        decision     => 'exported',
        summary      => row_count::text || ' ' || dataset || ' records exported as ' || upper(format),
        reason       => reason,
        metadata     => jsonb_build_object('rows', row_count, 'destination', destination)
    );
end;
$$;

-- ===========================================================================
-- Read paths.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- What a member may see about decisions concerning them.
--
-- This view is the member-facing contract, and it is written as an allow-list
-- of columns rather than a filter over the table: internal_note, before_state,
-- after_state, metadata, correlation_id and the actor's email are not selected
-- here at all, so no policy mistake can surface them. Only entries an admin
-- explicitly marked member_visible appear, and only to the person they name.
--
-- security_invoker = false is deliberate. The view runs as its owner so it can
-- read audit_log, and the WHERE clause below is the entire authorization.
-- ---------------------------------------------------------------------------
create view public.my_decision_history
with (security_invoker = false) as
select
    a.id,
    a.created_at,
    a.category,
    a.action,
    a.decision,
    a.entity_type,
    a.entity_label,
    a.summary,
    a.reason,                     -- the public account of the decision
    a.actor_name,                 -- who decided, as they were at the time
    a.actor_position,
    a.related_project_id
from public.audit_log a
where a.member_visible
  and a.related_member_id = auth.uid()
  and a.actor_kind <> 'ai_assistant';

comment on view public.my_decision_history is
    'Member-safe decision history. Column allow-list, not a filter: internal '
    'notes, before/after state, metadata and actor email are not selected. '
    'Never add a column here without asking whether the member should see it.';

grant select on public.my_decision_history to authenticated;

-- ---------------------------------------------------------------------------
-- The activity trail shown on an individual admin record page, so nobody has
-- to go to the global audit log to answer "what happened to this application".
-- ---------------------------------------------------------------------------
create or replace function public.record_history(
    entity   text,
    entity_key text,
    member   uuid default null
)
returns setof public.audit_log
language sql
stable
security definer
set search_path = public
as $$
    select a.*
    from public.audit_log a
    where (public.is_club_admin() or (public.is_reviewer() and a.actor_id = auth.uid()))
      and (
            (a.entity_type = entity and a.entity_id = entity_key)
         or (member is not null and a.related_member_id = member)
         or a.related_request_id::text = entity_key
      )
    order by a.created_at desc
    limit 200;
$$;

comment on function public.record_history is
    'Activity for one record, widened to the person it concerns so an '
    'application also shows the membership and position events that followed.';

-- ---------------------------------------------------------------------------
-- Audit page summary.
--
-- Operational visibility, not surveillance: it counts decisions by type and
-- reports how many admins were active, deliberately without ranking anyone or
-- attributing counts to named people.
-- ---------------------------------------------------------------------------
create or replace function public.audit_summary(since_days integer default 30)
returns table (
    total_actions     bigint,
    approvals         bigint,
    rejections        bigint,
    changes_requested bigint,
    active_admins     bigint,
    reasons_recorded  bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        count(*),
        count(*) filter (where a.decision in ('approved', 'granted', 'published')),
        count(*) filter (where a.decision in ('rejected', 'revoked')),
        count(*) filter (where a.decision = 'changes_requested'),
        count(distinct a.actor_id) filter (where a.actor_kind = 'admin'),
        count(*) filter (where a.reason is not null and btrim(a.reason) <> '')
    from public.audit_log a
    where public.is_staff()
      and a.created_at >= now() - make_interval(days => greatest(since_days, 1))
      -- Reviewers see only their own activity, so their summary matches it.
      and (public.is_club_admin() or a.actor_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row level security for the audit log itself.
--
-- Replaces the placeholder policy from migration 0010 with the tiered read
-- rule. There is still no INSERT, UPDATE or DELETE policy for anyone: entries
-- arrive only through write_audit(), which is SECURITY DEFINER, and the
-- append-only triggers reject changes even from the table owner.
-- ---------------------------------------------------------------------------
drop policy if exists audit_log_select_staff on public.audit_log;

create policy audit_log_select_admin on public.audit_log
    for select to authenticated
    using (public.is_club_admin());

-- A reviewer works the submission queues; they can account for their own
-- decisions but have no business reading membership or administration history.
create policy audit_log_select_own_reviewer on public.audit_log
    for select to authenticated
    using (public.is_reviewer() and actor_id = auth.uid());

grant execute on function public.record_history(text, text, uuid) to authenticated;
grant execute on function public.audit_summary(integer) to authenticated;
grant execute on function public.set_membership_status(uuid, membership_status, text, text, boolean) to authenticated;
grant execute on function public.set_account_state(uuid, account_state, text) to authenticated;
grant execute on function public.grant_admin_role(uuid, admin_role, text) to authenticated;
grant execute on function public.revoke_admin_role(uuid, text) to authenticated;
grant execute on function public.save_setting(text, jsonb, text) to authenticated;
grant execute on function public.record_university_export(text, text, integer, text, text) to authenticated;
grant execute on function public.revoke_contribution_verification(uuid, text, text) to authenticated;
grant execute on function public.set_archive_item_visibility(uuid, content_visibility, text, text, text) to authenticated;
grant execute on function public.move_archive_item(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.delete_archive_item(uuid, text) to authenticated;
grant execute on function public.record_ai_suggestion(uuid, text, text, jsonb) to authenticated;
grant execute on function public.mark_application_for_interview(uuid, text) to authenticated;
grant execute on function public.add_application_note(uuid, text) to authenticated;
grant execute on function public.resolve_member_request(uuid, boolean, text, text) to authenticated;
grant execute on function public.audit_context(text, text, audit_decision, boolean, uuid) to authenticated;

-- Members and admins alike now write settings through save_setting(), which
-- audits. Direct UPDATE stays available to club admins as a fallback, and the
-- app_settings trigger records it if anyone uses it.
