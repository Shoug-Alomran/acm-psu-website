-- Repair the admin lifecycle for accounts that exist in app_users/member_profiles
-- but do not yet have a memberships row. This is a valid state before approval.
-- The admin Members page displays such accounts as applicants, so activating one
-- must create the official membership record rather than fail with
-- "That person has no membership record."

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
    before_row public.memberships%rowtype;
    had_membership boolean := false;
    old_status membership_status := 'applicant';
    old_title  text;
    given      text;
    should_close boolean;
    person_name text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may change membership status.'
            using errcode = '42501';
    end if;

    select full_name into person_name
      from public.app_users
     where id = target_user and deleted_at is null;

    if person_name is null then
        raise exception 'Account not found.';
    end if;

    select * into before_row
      from public.memberships
     where user_id = target_user
     for update;

    had_membership := found;
    if had_membership then
        old_status := before_row.status;
        if old_status = new_status then
            raise exception 'Their membership is already %.', new_status;
        end if;
    elsif new_status <> 'active' then
        raise exception 'This account has not been admitted yet. Activate it first before changing it to %.', new_status;
    end if;

    if new_status in ('withdrawn', 'inactive', 'rejected', 'alumni') then
        given := public.require_reason(reason,
            'change a membership to ' || new_status::text);
    else
        given := reason;
    end if;

    select title_snapshot into old_title
      from public.position_history
     where user_id = target_user and ended_on is null;

    should_close := coalesce(close_position,
                             new_status in ('withdrawn', 'inactive', 'alumni'));

    perform public.audit_context(given, internal, 'updated', true, target_user);

    if had_membership then
        update public.memberships
           set status   = new_status,
               started_on = case
                   when new_status = 'active' then coalesce(started_on, current_date)
                   else started_on
               end,
               ended_on = case
                   when new_status in ('withdrawn', 'alumni', 'inactive')
                       then coalesce(ended_on, current_date)
                   when new_status = 'active' then null
                   else ended_on
               end,
               approved_by = case
                   when new_status = 'active' then coalesce(approved_by, auth.uid())
                   else approved_by
               end,
               approved_at = case
                   when new_status = 'active' then coalesce(approved_at, now())
                   else approved_at
               end,
               chapter_year = case
                   when new_status = 'active' then coalesce(chapter_year, public.current_chapter_year())
                   else chapter_year
               end,
               internal_note = coalesce(internal, internal_note)
         where user_id = target_user;
    else
        insert into public.memberships (
            user_id, status, started_on, chapter_year,
            approved_by, approved_at, internal_note
        ) values (
            target_user, 'active', current_date, public.current_chapter_year(),
            auth.uid(), now(), internal
        );
    end if;

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
        entity_label   => person_name,
        decision       => 'updated',
        summary        => initcap(old_status::text) || ' → ' || initcap(new_status::text),
        reason         => given,
        internal_note  => internal,
        member_visible => true,
        before_state   => jsonb_build_object(
            'membership_status', old_status,
            'membership_record_existed', had_membership,
            'position', coalesce(old_title, 'none')
        ),
        after_state    => jsonb_build_object(
            'membership_status', new_status,
            'membership_record_existed', true,
            'position', case when should_close then 'ended'
                             else coalesce(old_title, 'none') end
        ),
        related_member => target_user,
        metadata       => jsonb_build_object(
            'history_preserved', true,
            'membership_created_on_activation', not had_membership
        )
    );
end;
$$;

grant execute on function public.set_membership_status(
    uuid, membership_status, text, text, boolean
) to authenticated;

notify pgrst, 'reload schema';
