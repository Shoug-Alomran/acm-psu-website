-- ===========================================================================
-- 0010 — Row level security.
--
-- Read this file to understand who can do what. The portal's UI hides things,
-- but the UI is not the security boundary — these policies are. Anyone with
-- the anon key and a browser console is subject to exactly this file.
--
-- Rules of thumb applied throughout:
--   * Members get policies on the tables they own, and NO write policy at all
--     on official records (memberships, position_history, archive_items,
--     participations, audit_log).
--   * Approved rows stop matching the member's UPDATE policy, so a verified
--     record cannot be edited back into a draft.
--   * Internal notes live in columns/tables members have no SELECT path to.
-- ===========================================================================

alter table public.app_users                   enable row level security;
alter table public.member_profiles             enable row level security;
alter table public.memberships                 enable row level security;
alter table public.membership_status_history   enable row level security;
alter table public.admin_assignments           enable row level security;
alter table public.app_settings                enable row level security;
alter table public.audit_log                   enable row level security;
alter table public.positions                   enable row level security;
alter table public.position_history            enable row level security;
alter table public.position_change_requests    enable row level security;
alter table public.applications                enable row level security;
alter table public.application_notes           enable row level security;
alter table public.projects                    enable row level security;
alter table public.project_organizers          enable row level security;
alter table public.event_positions             enable row level security;
alter table public.event_position_applications enable row level security;
alter table public.participations              enable row level security;
alter table public.contribution_types          enable row level security;
alter table public.contributions               enable row level security;
alter table public.contribution_evidence       enable row level security;
alter table public.archive_categories          enable row level security;
alter table public.archive_folders             enable row level security;
alter table public.archive_items               enable row level security;
alter table public.archive_item_contributors   enable row level security;
alter table public.archive_submissions         enable row level security;
alter table public.archive_submission_ai       enable row level security;
alter table public.member_requests             enable row level security;
alter table public.university_exports          enable row level security;

-- ---------------------------------------------------------------------------
-- app_users
-- ---------------------------------------------------------------------------
create policy app_users_select_self on public.app_users
    for select to authenticated using (id = auth.uid());

create policy app_users_select_staff on public.app_users
    for select to authenticated using (public.is_staff());

create policy app_users_update_self on public.app_users
    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy app_users_update_admin on public.app_users
    for update to authenticated using (public.is_club_admin()) with check (public.is_club_admin());

-- A member may correct their own name, but student ID, major and the ability
-- to sign in are administrative facts. Enforced by trigger because a policy
-- cannot express "these particular columns did not change".
create or replace function public.guard_app_users_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_club_admin() then
        return new;
    end if;
    if new.account_state is distinct from old.account_state
       or new.student_id is distinct from old.student_id
       or new.email      is distinct from old.email
       or new.deleted_at is distinct from old.deleted_at then
        raise exception
            'Student ID, email and account state are administrative fields. '
            'Contact an ACM admin to change them.'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

create trigger app_users_guard
    before update on public.app_users
    for each row execute function public.guard_app_users_columns();

-- ---------------------------------------------------------------------------
-- member_profiles — the one place a member has genuinely free rein.
-- ---------------------------------------------------------------------------
create policy member_profiles_select_self on public.member_profiles
    for select to authenticated using (user_id = auth.uid());

create policy member_profiles_select_staff on public.member_profiles
    for select to authenticated using (public.is_staff());

create policy member_profiles_update_self on public.member_profiles
    for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy member_profiles_update_admin on public.member_profiles
    for update to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy member_profiles_insert_self on public.member_profiles
    for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- memberships — readable by the member, writable only by admins.
-- ---------------------------------------------------------------------------
create policy memberships_select_self on public.memberships
    for select to authenticated using (user_id = auth.uid());

create policy memberships_select_staff on public.memberships
    for select to authenticated using (public.is_staff());

create policy memberships_write_admin on public.memberships
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy membership_history_select_self on public.membership_status_history
    for select to authenticated using (user_id = auth.uid());

create policy membership_history_select_staff on public.membership_status_history
    for select to authenticated using (public.is_staff());
-- No INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER trigger writes here.

-- ---------------------------------------------------------------------------
-- Admin roles — visible to staff, changeable only by a super admin.
-- ---------------------------------------------------------------------------
create policy admin_assignments_select_staff on public.admin_assignments
    for select to authenticated using (public.is_staff() or user_id = auth.uid());

create policy admin_assignments_write_super on public.admin_assignments
    for all to authenticated
    using (public.is_super_admin()) with check (public.is_super_admin());

-- A super admin must not be able to revoke their own last super-admin grant
-- and lock the club out of its own system.
create or replace function public.guard_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    remaining integer;
begin
    if new.role = 'super_admin' and new.revoked_at is not null and old.revoked_at is null then
        select count(*) into remaining
          from public.admin_assignments
         where role = 'super_admin' and revoked_at is null and id <> new.id;
        if remaining = 0 then
            raise exception
                'Cannot revoke the last super admin. Grant super_admin to the '
                'incoming leader first, then revoke this one.';
        end if;
    end if;
    return new;
end;
$$;

create trigger admin_assignments_guard_last_super
    before update on public.admin_assignments
    for each row execute function public.guard_last_super_admin();

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create policy app_settings_select_public on public.app_settings
    for select to anon, authenticated using (is_public);

create policy app_settings_select_staff on public.app_settings
    for select to authenticated using (public.is_staff());

create policy app_settings_write_admin on public.app_settings
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- ---------------------------------------------------------------------------
-- Audit log — readable by staff, writable by nobody directly.
-- ---------------------------------------------------------------------------
create policy audit_log_select_staff on public.audit_log
    for select to authenticated using (public.is_staff());
-- Intentionally no INSERT, UPDATE or DELETE policy anywhere, for any role.
-- public.write_audit() is SECURITY DEFINER and is the only writer.

-- ---------------------------------------------------------------------------
-- Positions
-- ---------------------------------------------------------------------------
create policy positions_select_all on public.positions
    for select to anon, authenticated using (true);

create policy positions_write_admin on public.positions
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy position_history_select_self on public.position_history
    for select to authenticated using (user_id = auth.uid());

create policy position_history_select_staff on public.position_history
    for select to authenticated using (public.is_staff());

create policy position_history_write_admin on public.position_history
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy position_requests_select_own on public.position_change_requests
    for select to authenticated using (user_id = auth.uid());

create policy position_requests_select_staff on public.position_change_requests
    for select to authenticated using (public.is_staff());

create policy position_requests_insert_own on public.position_change_requests
    for insert to authenticated
    with check (user_id = auth.uid() and status = 'pending' and public.is_active_member());

-- A member may withdraw their own request while it is still pending; they can
-- never decide it. approved_position_id/effective_date stay admin-only because
-- an approved row no longer matches this policy's USING clause.
create policy position_requests_cancel_own on public.position_change_requests
    for update to authenticated
    using (user_id = auth.uid() and status = 'pending')
    with check (user_id = auth.uid() and status in ('pending', 'cancelled'));

create policy position_requests_write_admin on public.position_change_requests
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
create policy applications_select_own on public.applications
    for select to authenticated using (user_id = auth.uid());

create policy applications_select_staff on public.applications
    for select to authenticated using (public.is_staff());

create policy applications_insert_own on public.applications
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and status = 'submitted'
        and public.setting_bool('applications_open', true)
    );

create policy applications_update_own on public.applications
    for update to authenticated
    using (user_id = auth.uid() and status = 'submitted')
    with check (user_id = auth.uid() and status = 'submitted');

create policy applications_write_admin on public.applications
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- internal_note and the decision fields are admin territory even while the
-- application is still open for the applicant to edit.
create or replace function public.guard_application_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_club_admin() then
        return new;
    end if;
    if new.status               is distinct from old.status
       or new.internal_note     is distinct from old.internal_note
       or new.decision_note     is distinct from old.decision_note
       or new.reviewed_by       is distinct from old.reviewed_by
       or new.approved_position_id is distinct from old.approved_position_id
       or new.membership_start_date is distinct from old.membership_start_date then
        raise exception 'Only an ACM admin can change the decision on an application.'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

create trigger applications_guard
    before update on public.applications
    for each row execute function public.guard_application_columns();

-- Interview notes: staff only, with no policy for the applicant at all.
create policy application_notes_staff on public.application_notes
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Projects and events
-- ---------------------------------------------------------------------------
create policy projects_select_public on public.projects
    for select to anon, authenticated
    using (visibility = 'public' and deleted_at is null);

create policy projects_select_members on public.projects
    for select to authenticated
    using (deleted_at is null and (public.is_active_member() or public.is_staff()));

create policy projects_write_admin on public.projects
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy project_organizers_select on public.project_organizers
    for select to anon, authenticated using (true);

create policy project_organizers_write_admin on public.project_organizers
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy event_positions_select on public.event_positions
    for select to authenticated
    using (public.is_active_member() or public.is_staff());

create policy event_positions_write_admin on public.event_positions
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy event_position_apps_select_own on public.event_position_applications
    for select to authenticated using (user_id = auth.uid());

create policy event_position_apps_select_staff on public.event_position_applications
    for select to authenticated using (public.is_staff());

create policy event_position_apps_insert_own on public.event_position_applications
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and status = 'pending'
        and public.is_active_member()
        and exists (
            select 1 from public.event_positions ep
            where ep.id = event_position_id
              and ep.is_open
              and (ep.closes_on is null or ep.closes_on >= current_date)
        )
    );

create policy event_position_apps_cancel_own on public.event_position_applications
    for update to authenticated
    using (user_id = auth.uid() and status = 'pending')
    with check (user_id = auth.uid() and status in ('pending', 'cancelled'));

create policy event_position_apps_write_admin on public.event_position_applications
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy participations_select_own on public.participations
    for select to authenticated using (user_id = auth.uid());

create policy participations_select_staff on public.participations
    for select to authenticated using (public.is_staff());

create policy participations_write_admin on public.participations
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- ---------------------------------------------------------------------------
-- Contributions
-- ---------------------------------------------------------------------------
create policy contribution_types_select on public.contribution_types
    for select to anon, authenticated using (true);

create policy contribution_types_write_admin on public.contribution_types
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy contributions_select_own on public.contributions
    for select to authenticated using (user_id = auth.uid());

create policy contributions_select_staff on public.contributions
    for select to authenticated using (public.is_staff());

create policy contributions_insert_own on public.contributions
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and status in ('draft', 'submitted')
        and public.is_active_member()
    );

-- Editable only while the member still owns the outcome. Once a reviewer sets
-- it to approved or rejected, this policy no longer matches the row.
create policy contributions_update_own on public.contributions
    for update to authenticated
    using (user_id = auth.uid() and status in ('draft', 'submitted', 'changes_requested'))
    with check (user_id = auth.uid() and status in ('draft', 'submitted'));

create policy contributions_write_reviewer on public.contributions
    for all to authenticated
    using (public.is_reviewer()) with check (public.is_reviewer());

create policy contribution_evidence_own on public.contribution_evidence
    for all to authenticated
    using (exists (select 1 from public.contributions c
                   where c.id = contribution_id and c.user_id = auth.uid()
                     and c.status in ('draft', 'submitted', 'changes_requested')))
    with check (exists (select 1 from public.contributions c
                        where c.id = contribution_id and c.user_id = auth.uid()));

create policy contribution_evidence_select_own on public.contribution_evidence
    for select to authenticated
    using (exists (select 1 from public.contributions c
                   where c.id = contribution_id and c.user_id = auth.uid()));

create policy contribution_evidence_staff on public.contribution_evidence
    for all to authenticated
    using (public.is_reviewer()) with check (public.is_reviewer());

-- ---------------------------------------------------------------------------
-- Archive
-- ---------------------------------------------------------------------------
create policy archive_categories_select on public.archive_categories
    for select to anon, authenticated using (true);

create policy archive_categories_write_admin on public.archive_categories
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy archive_folders_select_public on public.archive_folders
    for select to anon, authenticated
    using (visibility = 'public' and deleted_at is null);

create policy archive_folders_select_members on public.archive_folders
    for select to authenticated
    using (deleted_at is null and (public.is_active_member() or public.is_staff()));

create policy archive_folders_write_admin on public.archive_folders
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy archive_items_select_public on public.archive_items
    for select to anon, authenticated
    using (visibility = 'public' and deleted_at is null);

create policy archive_items_select_members on public.archive_items
    for select to authenticated
    using (deleted_at is null and (public.is_active_member() or public.is_staff()));

create policy archive_items_write_admin on public.archive_items
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

create policy archive_contributors_select on public.archive_item_contributors
    for select to anon, authenticated
    using (exists (select 1 from public.archive_items i
                   where i.id = item_id and i.visibility = 'public' and i.deleted_at is null));

create policy archive_contributors_select_members on public.archive_item_contributors
    for select to authenticated
    using (public.is_active_member() or public.is_staff());

create policy archive_contributors_write_admin on public.archive_item_contributors
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- Submissions: the member's own until a reviewer takes it.
create policy archive_submissions_select_own on public.archive_submissions
    for select to authenticated using (submitted_by = auth.uid());

create policy archive_submissions_select_staff on public.archive_submissions
    for select to authenticated using (public.is_staff());

create policy archive_submissions_insert_own on public.archive_submissions
    for insert to authenticated
    with check (submitted_by = auth.uid() and status = 'submitted' and public.is_active_member());

create policy archive_submissions_update_own on public.archive_submissions
    for update to authenticated
    using (submitted_by = auth.uid() and status in ('draft', 'submitted', 'changes_requested'))
    with check (submitted_by = auth.uid() and status in ('draft', 'submitted'));

create policy archive_submissions_write_reviewer on public.archive_submissions
    for all to authenticated
    using (public.is_reviewer()) with check (public.is_reviewer());

-- AI suggestions are an internal review aid; members never see them.
create policy archive_submission_ai_staff on public.archive_submission_ai
    for all to authenticated
    using (public.is_reviewer()) with check (public.is_reviewer());

-- ---------------------------------------------------------------------------
-- Member requests
-- ---------------------------------------------------------------------------
create policy member_requests_select_own on public.member_requests
    for select to authenticated using (user_id = auth.uid());

create policy member_requests_select_staff on public.member_requests
    for select to authenticated using (public.is_staff());

create policy member_requests_insert_own on public.member_requests
    for insert to authenticated
    with check (user_id = auth.uid() and status = 'pending');

create policy member_requests_cancel_own on public.member_requests
    for update to authenticated
    using (user_id = auth.uid() and status = 'pending')
    with check (user_id = auth.uid() and status in ('pending', 'cancelled'));

create policy member_requests_write_admin on public.member_requests
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- ---------------------------------------------------------------------------
-- University exports — staff read, admin write. Never anon.
-- ---------------------------------------------------------------------------
create policy university_exports_select_staff on public.university_exports
    for select to authenticated using (public.is_club_admin());

create policy university_exports_insert_admin on public.university_exports
    for insert to authenticated with check (public.is_club_admin());

-- ---------------------------------------------------------------------------
-- Function execution grants.
-- ---------------------------------------------------------------------------
grant execute on function public.approve_application(uuid, uuid, date, text, text) to authenticated;
grant execute on function public.mark_application_for_interview(uuid, text) to authenticated;
grant execute on function public.reject_application(uuid, text, text) to authenticated;
grant execute on function public.grant_position(uuid, uuid, date, text, text) to authenticated;
grant execute on function public.approve_event_position_application(uuid, text) to authenticated;
grant execute on function public.verify_contribution(uuid, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.decide_contribution(uuid, review_status, text, text) to authenticated;
grant execute on function public.publish_archive_submission(uuid, text, text, text, uuid, uuid, content_visibility, text, text, text, text, text[]) to authenticated;
grant execute on function public.decide_archive_submission(uuid, review_status, text, text) to authenticated;
grant execute on function public.resolve_withdrawal(uuid, membership_status, boolean, text) to authenticated;
grant execute on function public.resolve_profile_removal(uuid, boolean, text) to authenticated;
grant execute on function public.resolve_position_request(uuid, boolean, uuid, date, text) to authenticated;
grant execute on function public.export_members() to authenticated;
grant execute on function public.export_event_participation() to authenticated;
grant execute on function public.export_contributions() to authenticated;

-- Every one of the functions above re-checks the caller's role internally, so
-- granting EXECUTE to authenticated is safe: a member calling them gets a
-- permission error from inside the function rather than a silent success.
