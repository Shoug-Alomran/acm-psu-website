-- Standing club roles may have one, several, or unlimited simultaneous holders.
alter table public.positions
    add column max_holders integer,
    add constraint positions_max_holders_positive
        check (max_holders is null or max_holders > 0);

comment on column public.positions.max_holders is
    'Maximum simultaneous holders. NULL means unlimited capacity.';

-- Officers and named leads are single-seat roles. Committee membership is open.
update public.positions
   set max_holders = case
       when category in ('executive', 'lead') then 1
       else null
   end;

-- Membership status and event participation have dedicated records. Retire the
-- duplicate catalogue entries only when doing so cannot strand a current holder.
update public.positions p
   set is_active = false,
       archived_at = now()
 where p.slug in ('member', 'volunteer')
   and not exists (
       select 1 from public.position_history ph
        where ph.position_id = p.id and ph.ended_on is null
   );

-- Capacity is enforced inside the same transaction as the grant. Locking the
-- catalogue row serializes concurrent grants for one role and prevents overfill.
create or replace function public.grant_position(
    target_user    uuid,
    new_position   uuid,
    effective_on   date default current_date,
    fallback_title text default null,
    reason         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    new_row_id      uuid;
    resolved_title  text;
    previous_title  text;
    seat_limit      integer;
    occupied_seats  integer;
    nested boolean := public.audit_context_value('correlation') is not null;
begin
    if not public.is_club_admin() then
        raise exception 'Only a club admin may grant a position.'
            using errcode = '42501';
    end if;

    select title, max_holders
      into resolved_title, seat_limit
      from public.positions
     where id = new_position
     for update;
    resolved_title := coalesce(resolved_title, fallback_title);

    if resolved_title is null then
        raise exception 'A position or a fallback title is required.';
    end if;

    if seat_limit is not null then
        select count(*) into occupied_seats
          from public.position_history
         where position_id = new_position
           and ended_on is null
           and user_id <> target_user;

        if occupied_seats >= seat_limit then
            raise exception 'This position is full (% of % seats occupied).', occupied_seats, seat_limit
                using errcode = '23514';
        end if;
    end if;

    select title_snapshot into previous_title
      from public.position_history
     where user_id = target_user and ended_on is null;

    if not nested then
        perform public.audit_context(reason, null, 'granted', true, target_user);
    end if;

    update public.position_history
       set ended_on = greatest(started_on, effective_on - 1)
     where user_id = target_user
       and ended_on is null;

    insert into public.position_history
        (user_id, position_id, title_snapshot, started_on, chapter_year, note, granted_by)
    values (
        target_user, new_position, resolved_title, effective_on,
        public.current_chapter_year(), reason, auth.uid()
    )
    returning id into new_row_id;

    if not nested then
        perform public.write_audit(
            action         => 'position.granted',
            category       => 'positions',
            entity_type    => 'member',
            entity_id      => target_user::text,
            entity_label   => (select full_name from public.app_users where id = target_user),
            decision       => 'granted',
            summary        => coalesce(previous_title, 'No position') || ' → ' || resolved_title,
            reason         => reason,
            member_visible => true,
            before_state   => jsonb_build_object('position', coalesce(previous_title, 'none')),
            after_state    => jsonb_build_object('position', resolved_title,
                                                 'effective_from', effective_on),
            related_member => target_user,
            metadata       => jsonb_build_object('position_history_id', new_row_id,
                                                 'previous_preserved', true,
                                                 'seat_limit', seat_limit)
        );
    end if;

    return new_row_id;
end;
$$;
