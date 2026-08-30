-- Keep the portal dashboard sourced from official records for every account type.
-- Student members derive activity totals from verified participation/work.
-- Instructors/staff derive event/project totals from the ACM activities they are
-- formally assigned to through project_organizers. Contribution totals remain
-- their own verified contributions in both cases.

create or replace view public.member_stats
with (security_invoker = true) as
select
    u.id as user_id,
    case
      when u.university_role in ('instructor', 'staff') then
        (select count(distinct po.project_id)
           from public.project_organizers po
           join public.projects pr on pr.id = po.project_id
          where po.user_id = u.id
            and pr.kind = 'event'
            and pr.deleted_at is null)
      else
        (select count(distinct pa.project_id)
           from public.participations pa
          where pa.user_id = u.id
            and pa.verified_at is not null
            and pa.status in ('confirmed', 'completed'))
    end as events_count,
    case
      when u.university_role in ('instructor', 'staff') then
        (select count(distinct po.project_id)
           from public.project_organizers po
           join public.projects pr on pr.id = po.project_id
          where po.user_id = u.id
            and pr.deleted_at is null)
      else
        (select count(distinct record.project_id)
           from (
             select c.project_id
               from public.contributions c
              where c.user_id = u.id
                and c.status = 'approved'
                and c.project_id is not null
                and c.deleted_at is null
             union
             select pa.project_id
               from public.participations pa
              where pa.user_id = u.id
                and pa.verified_at is not null
                and pa.status in ('confirmed', 'completed')
           ) record)
    end as projects_count,
    case
      when u.university_role in ('instructor', 'staff') then
        (select count(distinct po.project_id)
           from public.project_organizers po
           join public.projects pr on pr.id = po.project_id
          where po.user_id = u.id
            and pr.kind = 'workshop_series'
            and pr.deleted_at is null)
      else
        (select count(*)
           from public.contributions c
          where c.user_id = u.id
            and c.status = 'approved'
            and c.deleted_at is null
            and c.type_slug in ('workshop-development', 'workshop-presenter'))
    end as workshops_count,
    (select count(*)
       from public.contributions c
      where c.user_id = u.id
        and c.status = 'approved'
        and c.deleted_at is null) as verified_contributions,
    (select count(*)
       from public.archive_submissions s
      where s.submitted_by = u.id) as submissions_count,
    (select count(*)
       from public.position_history ph
      where ph.user_id = u.id) as positions_held
from public.app_users u
where u.deleted_at is null;

comment on view public.member_stats is
  'Canonical dashboard statistics for all portal people. Students use verified participation/work; instructors and staff use formal project assignments. No browser-maintained counters.';
