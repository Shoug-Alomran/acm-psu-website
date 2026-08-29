-- Service-only snapshot and a small global throttle for automatic Members-sheet refreshes.
create table public.member_sheet_sync_state (
    singleton boolean primary key default true check (singleton),
    attempted_at timestamptz,
    completed_at timestamptz,
    succeeded boolean,
    row_count integer,
    error_message text
);

insert into public.member_sheet_sync_state (singleton) values (true);
alter table public.member_sheet_sync_state enable row level security;
revoke all on public.member_sheet_sync_state from anon, authenticated;

create or replace function public.export_members_for_sheet_sync()
returns table (
    full_name text,
    student_id text,
    psu_email text,
    major text,
    academic_year text,
    position_title text,
    membership_status text,
    join_date date
)
language sql
stable
security definer
set search_path = public
as $$
    select u.full_name, u.student_id, u.email::text, u.major,
           p.academic_year, cp.title, m.status::text, m.started_on
      from public.app_users u
      join public.memberships m on m.user_id = u.id
      left join public.member_profiles p on p.user_id = u.id
      left join public.current_positions cp on cp.user_id = u.id
     where u.deleted_at is null and m.status <> 'applicant'
     order by u.full_name;
$$;

create or replace function public.begin_member_sheet_sync()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    previous timestamptz;
begin
    select attempted_at into previous
      from public.member_sheet_sync_state where singleton for update;
    if previous is not null and previous > now() - interval '15 seconds' then
        return false;
    end if;
    update public.member_sheet_sync_state
       set attempted_at = now(), succeeded = null, error_message = null
     where singleton;
    return true;
end;
$$;

create or replace function public.finish_member_sheet_sync(
    succeeded boolean,
    failure_message text,
    synced_rows integer
)
returns void
language sql
security definer
set search_path = public
as $$
    update public.member_sheet_sync_state
       set completed_at = now(), succeeded = finish_member_sheet_sync.succeeded,
           error_message = failure_message, row_count = synced_rows
     where singleton;
$$;

revoke all on function public.export_members_for_sheet_sync() from public, anon, authenticated;
revoke all on function public.begin_member_sheet_sync() from public, anon, authenticated;
revoke all on function public.finish_member_sheet_sync(boolean, text, integer) from public, anon, authenticated;
grant execute on function public.export_members_for_sheet_sync() to service_role;
grant execute on function public.begin_member_sheet_sync() to service_role;
grant execute on function public.finish_member_sheet_sync(boolean, text, integer) to service_role;
