-- ===========================================================================
-- 0008 — Member requests.
--
-- Three things people confuse are kept strictly separate here:
--
--   leaving ACM        -> kind = 'withdrawal'      (membership status changes)
--   hiding a profile   -> kind = 'profile_removal' (visibility changes)
--   deleting an account-> kind = 'account_deletion'(sign-in access ends)
--
-- None of them destroys verified contributions or position history. Those are
-- the club's official record of work that genuinely happened, and the person
-- keeps the benefit of them being on file.
-- ===========================================================================

create table public.member_requests (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.app_users (id) on delete cascade,
    kind        member_request_kind not null,
    message     text,
    -- Kind-specific extras, e.g. {"preferred_outcome": "alumni"}.
    payload     jsonb not null default '{}'::jsonb,

    status      request_status not null default 'pending',
    -- What the admin actually did, e.g. {"status": "alumni"}.
    resolution  jsonb not null default '{}'::jsonb,
    admin_note  text,
    decided_by  uuid references public.app_users (id),
    decided_at  timestamptz,

    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint member_requests_message_length
        check (message is null or char_length(message) <= 2000)
);

create index member_requests_status_idx on public.member_requests (status, created_at desc);
create index member_requests_user_idx   on public.member_requests (user_id, created_at desc);

-- One open request of each kind per person.
create unique index member_requests_one_pending_per_kind
    on public.member_requests (user_id, kind)
    where status = 'pending';

create trigger member_requests_touch
    before update on public.member_requests
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Resolving a withdrawal. The admin picks the resulting standing; the person's
-- history is left completely intact.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_withdrawal(
    request_id     uuid,
    final_status   membership_status,
    close_position boolean default true,
    reason         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    req        record;
    before_row record;
    old_title  text;
    given      text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may resolve a withdrawal.' using errcode = '42501';
    end if;
    if final_status not in ('withdrawn', 'alumni', 'inactive') then
        raise exception 'A withdrawal resolves to withdrawn, alumni or inactive.';
    end if;

    given := public.require_reason(reason, 'end someone''s active membership');

    select * into req from public.member_requests where id = request_id for update;
    if req is null or req.kind <> 'withdrawal' then
        raise exception 'Withdrawal request not found.';
    end if;

    select * into before_row from public.memberships where user_id = req.user_id;
    select title_snapshot into old_title from public.position_history
     where user_id = req.user_id and ended_on is null;

    perform public.audit_context(given, null, 'approved', true, req.user_id);

    update public.memberships
       set status = final_status,
           ended_on = coalesce(ended_on, current_date)
     where user_id = req.user_id;

    -- Close the open position so the roster stops listing them as serving,
    -- while the history row itself remains.
    if close_position then
        update public.position_history
           set ended_on = current_date
         where user_id = req.user_id and ended_on is null;
    end if;

    -- Leaving does not publish or unpublish anything by itself; profile
    -- visibility is a separate request kind on purpose.
    update public.member_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           admin_note = given,
           resolution = jsonb_build_object('status', final_status,
                                           'closed_position', close_position)
     where id = request_id;

    perform public.write_audit(
        action         => 'member.withdrawn',
        category       => 'membership',
        entity_type    => 'member',
        entity_id      => req.user_id::text,
        entity_label   => (select full_name from public.app_users where id = req.user_id),
        decision       => 'approved',
        summary        => 'Membership set to ' || final_status::text,
        reason         => given,
        member_visible => true,
        before_state   => jsonb_build_object('membership_status', before_row.status,
                                             'position', coalesce(old_title, 'none')),
        after_state    => jsonb_build_object('membership_status', final_status,
                                             'position', case when close_position
                                                              then 'ended' else coalesce(old_title, 'none') end),
        related_member  => req.user_id,
        related_request => request_id,
        metadata        => jsonb_build_object(
                             'history_preserved', true,
                             'note', 'Position history and verified contributions are kept.')
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Removing a public profile. Hides the person from the public roster; the
-- account, the record and the history all stay.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_profile_removal(
    request_id uuid,
    approve    boolean,
    reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    req    record;
    before_visibility profile_visibility;
    given  text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may resolve profile removals.' using errcode = '42501';
    end if;

    -- Declining someone's request about their own public presence needs an
    -- explanation. Granting it does not.
    if not approve then
        given := public.require_reason(reason, 'decline a profile removal request');
    else
        given := reason;
    end if;

    select * into req from public.member_requests where id = request_id for update;
    if req is null or req.kind <> 'profile_removal' then
        raise exception 'Profile removal request not found.';
    end if;

    select visibility into before_visibility from public.member_profiles
     where user_id = req.user_id;

    perform public.audit_context(given, null,
        (case when approve then 'approved' else 'rejected' end)::audit_decision,
        true, req.user_id);

    if approve then
        update public.member_profiles
           set visibility = 'private'
         where user_id = req.user_id;
    end if;

    update public.member_requests
       set status = (case when approve then 'approved' else 'rejected' end)::request_status,
           decided_by = auth.uid(), decided_at = now(), admin_note = given
     where id = request_id;

    perform public.write_audit(
        action         => 'member.profile_removal',
        category       => 'requests',
        entity_type    => 'member',
        entity_id      => req.user_id::text,
        entity_label   => (select full_name from public.app_users where id = req.user_id),
        decision       => (case when approve then 'approved' else 'rejected' end)::audit_decision,
        summary        => case when approve then 'Public profile hidden'
                               else 'Profile removal declined' end,
        reason         => given,
        member_visible => true,
        before_state   => jsonb_build_object('visibility', before_visibility),
        after_state    => jsonb_build_object('visibility',
                            case when approve then 'private' else before_visibility end),
        related_member  => req.user_id,
        related_request => request_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Approving a position change request.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_position_request(
    request_id     uuid,
    approve        boolean,
    position_id    uuid default null,
    effective_on   date default current_date,
    reason         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    req       record;
    old_title text;
    new_title text;
    given     text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may decide position requests.' using errcode = '42501';
    end if;

    if not approve then
        given := public.require_reason(reason, 'decline a position request');
    else
        given := reason;
    end if;

    select * into req from public.position_change_requests where id = request_id for update;
    if req is null then
        raise exception 'Position request not found.';
    end if;

    select title_snapshot into old_title from public.position_history
     where user_id = req.user_id and ended_on is null;

    perform public.audit_context(given, null,
        (case when approve then 'approved' else 'rejected' end)::audit_decision,
        true, req.user_id);

    if approve then
        if position_id is null then
            raise exception 'Select the position being granted before approving.';
        end if;
        select title into new_title from public.positions where id = position_id;
        perform public.grant_position(req.user_id, position_id, effective_on, null, given);
    end if;

    update public.position_change_requests
       set status = (case when approve then 'approved' else 'rejected' end)::request_status,
           approved_position_id = case when approve then position_id else null end,
           effective_date = case when approve then effective_on else null end,
           admin_note = given, decided_by = auth.uid(), decided_at = now()
     where id = request_id;

    perform public.write_audit(
        action         => case when approve then 'position.granted'
                               else 'position.request_rejected' end,
        category       => 'positions',
        entity_type    => 'member',
        entity_id      => req.user_id::text,
        entity_label   => (select full_name from public.app_users where id = req.user_id),
        decision       => (case when approve then 'approved' else 'rejected' end)::audit_decision,
        summary        => case when approve
                               then coalesce(old_title, 'No position') || ' → ' || new_title
                               else 'Position request declined' end,
        reason         => given,
        member_visible => true,
        before_state   => jsonb_build_object('position', coalesce(old_title, 'none')),
        after_state    => jsonb_build_object('position',
                            case when approve then new_title else coalesce(old_title, 'none') end,
                            'effective_from', case when approve then effective_on end),
        related_member  => req.user_id,
        related_request => request_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- The remaining member request kinds, which have no side effects of their own
-- beyond being answered. Account deletion is deliberately included here rather
-- than being made to actually delete anything: the conversation with the
-- person comes first, and disabling the account is the reversible step.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_member_request(
    request_id uuid,
    approve    boolean,
    reason     text default null,
    internal   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    req   record;
    given text;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may resolve member requests.' using errcode = '42501';
    end if;

    select * into req from public.member_requests where id = request_id for update;
    if req is null then
        raise exception 'Request not found.';
    end if;

    -- Account deletion and declining anything both need an account of why.
    if not approve or req.kind = 'account_deletion' then
        given := public.require_reason(reason,
            case when req.kind = 'account_deletion'
                 then 'resolve an account deletion request'
                 else 'decline a member request' end);
    else
        given := reason;
    end if;

    perform public.audit_context(given, internal,
        (case when approve then 'approved' else 'rejected' end)::audit_decision,
        true, req.user_id);

    update public.member_requests
       set status = (case when approve then 'approved' else 'rejected' end)::request_status,
           decided_by = auth.uid(), decided_at = now(),
           admin_note = given
     where id = request_id;

    perform public.write_audit(
        action         => 'request.' || req.kind::text || '.'
                          || case when approve then 'approved' else 'rejected' end,
        category       => 'requests',
        entity_type    => 'member_request',
        entity_id      => request_id::text,
        entity_label   => (select full_name from public.app_users where id = req.user_id),
        decision       => (case when approve then 'approved' else 'rejected' end)::audit_decision,
        summary        => replace(req.kind::text, '_', ' ') || ' request '
                          || case when approve then 'approved' else 'declined' end,
        reason         => given,
        internal_note  => internal,
        member_visible => true,
        before_state   => jsonb_build_object('status', req.status),
        after_state    => jsonb_build_object('status',
                            case when approve then 'approved' else 'rejected' end),
        related_member  => req.user_id,
        related_request => request_id
    );
end;
$$;
