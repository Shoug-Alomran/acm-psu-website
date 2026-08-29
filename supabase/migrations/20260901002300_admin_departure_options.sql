-- Revoke administrative authority and, when appropriate, resolve the person's
-- membership/public-profile disposition in the same audited transaction.

create or replace function public.revoke_admin_with_disposition(
    assignment_id uuid,
    disposition text,
    reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    assignment record;
    person_name text;
    given text;
begin
    if not public.is_super_admin() then
        raise exception 'Only a super admin may revoke admin roles.' using errcode = '42501';
    end if;
    if disposition not in ('admin_only', 'archive_public', 'archive_private', 'erase_personal_data') then
        raise exception 'Unknown departure disposition.';
    end if;

    given := public.require_reason(reason, 'revoke an admin role');
    select * into assignment from public.admin_assignments
     where id = assignment_id for update;
    if assignment is null or assignment.revoked_at is not null then
        raise exception 'Active role assignment not found.';
    end if;

    select full_name into person_name from public.app_users where id = assignment.user_id;
    perform public.audit_context(given, null, 'revoked', true, assignment.user_id);

    -- The existing guard trigger still prevents revoking the final super admin.
    update public.admin_assignments
       set revoked_at = now(), revoked_by = auth.uid()
     where id = assignment_id;

    if disposition in ('archive_public', 'archive_private', 'erase_personal_data') then
        update public.memberships
           set status = case when disposition = 'erase_personal_data'
                             then 'withdrawn'::membership_status
                             else 'alumni'::membership_status end,
               ended_on = coalesce(ended_on, current_date)
         where user_id = assignment.user_id;

        update public.position_history
           set ended_on = current_date
         where user_id = assignment.user_id and ended_on is null;
    end if;

    if disposition in ('archive_public', 'archive_private') then
        update public.member_profiles
           set visibility = case when disposition = 'archive_public'
                                 then 'public'::profile_visibility
                                 else 'private'::profile_visibility end
         where user_id = assignment.user_id;
    elsif disposition = 'erase_personal_data' then
        update public.member_profiles
           set bio = '', academic_year = null, interests = '{}',
               linkedin_url = null, github_url = null, website_url = null,
               extra_links = '[]'::jsonb, avatar_path = null,
               visibility = 'private', display_name = null
         where user_id = assignment.user_id;

        update public.app_users
           set full_name = 'Former member ' || left(assignment.user_id::text, 8),
               email = ('deleted+' || assignment.user_id::text || '@invalid.local')::citext,
               student_id = null, major = null,
               account_state = 'disabled', deleted_at = now()
         where id = assignment.user_id;
    end if;

    perform public.write_audit(
        action         => 'admin.role_revoked',
        category       => 'administration',
        entity_type    => 'admin_assignment',
        entity_id      => assignment_id::text,
        entity_label   => person_name,
        decision       => 'revoked',
        summary        => replace(assignment.role::text, '_', ' ') || ' revoked from ' || person_name,
        reason         => given,
        member_visible => disposition <> 'erase_personal_data',
        before_state   => jsonb_build_object('role', assignment.role, 'active', true),
        after_state    => jsonb_build_object('role', assignment.role, 'active', false,
                                             'disposition', disposition),
        related_member => assignment.user_id,
        metadata       => jsonb_build_object('disposition', disposition,
                                             'official_history_preserved', true)
    );
end;
$$;

revoke execute on function public.revoke_admin_with_disposition(uuid, text, text) from anon;
grant execute on function public.revoke_admin_with_disposition(uuid, text, text) to authenticated;
