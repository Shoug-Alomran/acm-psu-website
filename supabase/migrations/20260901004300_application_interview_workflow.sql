-- Enforce the intended membership review sequence:
-- submitted -> interview -> approved/rejected.
-- This prevents bypassing the interview stage through a direct RPC or browser call.

create or replace function public.guard_application_status_workflow()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'interview' and old.status <> 'submitted' then
    raise exception 'Only submitted applications can move to interview.'
      using errcode = '23514';
  end if;

  if new.status in ('approved', 'rejected') and old.status <> 'interview' then
    raise exception 'An interview must be completed before recording the final application decision.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists applications_status_workflow on public.applications;
create trigger applications_status_workflow
  before update of status on public.applications
  for each row execute function public.guard_application_status_workflow();

comment on function public.guard_application_status_workflow() is
  'Enforces submitted -> interview -> approved/rejected for membership applications.';
