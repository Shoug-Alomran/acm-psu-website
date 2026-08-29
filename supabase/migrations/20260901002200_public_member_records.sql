-- Public official records for members who opted into the public directory.
-- The directory inner join is the privacy guard; private members cannot appear.

create view public.public_verified_contributions
with (security_invoker = false) as
select
    c.user_id,
    c.id,
    c.title,
    c.type_slug,
    ct.label as type_label,
    c.role_text,
    c.description,
    c.occurred_on,
    c.links,
    c.verified_at,
    p.id as project_id,
    p.title as project_title,
    p.slug as project_slug
from public.contributions c
join public.public_member_directory d on d.user_id = c.user_id
left join public.contribution_types ct on ct.slug = c.type_slug
left join public.projects p on p.id = c.project_id
where c.status = 'approved'
  and c.verified_at is not null
  and c.deleted_at is null
  and (p.id is null or (p.visibility = 'public' and p.deleted_at is null));

comment on view public.public_verified_contributions is
    'Verified official work for opted-in public profiles only. No review or internal notes.';

create view public.public_event_participation
with (security_invoker = false) as
select
    pa.user_id,
    pa.id,
    pa.role_text,
    pa.status,
    pa.started_on,
    pa.ended_on,
    pa.verified_at,
    p.id as project_id,
    p.title as project_title,
    p.slug as project_slug
from public.participations pa
join public.public_member_directory d on d.user_id = pa.user_id
join public.projects p on p.id = pa.project_id
where pa.verified_at is not null
  and pa.status in ('confirmed', 'completed')
  and p.visibility = 'public'
  and p.deleted_at is null;

comment on view public.public_event_participation is
    'Verified event/project participation for opted-in public profiles only.';

grant select on public.public_verified_contributions to anon, authenticated;
grant select on public.public_event_participation to anon, authenticated;

-- Dashboard totals use the same verified record rules for every member.
create or replace view public.member_stats
with (security_invoker = true) as
select
    u.id as user_id,
    (select count(distinct pa.project_id) from public.participations pa
      where pa.user_id = u.id and pa.verified_at is not null
        and pa.status in ('confirmed', 'completed'))                       as events_count,
    (select count(distinct record.project_id)
       from (
         select c.project_id from public.contributions c
          where c.user_id = u.id and c.status = 'approved'
            and c.project_id is not null and c.deleted_at is null
         union
         select pa.project_id from public.participations pa
          where pa.user_id = u.id and pa.verified_at is not null
            and pa.status in ('confirmed', 'completed')
       ) record)                                                           as projects_count,
    (select count(*) from public.contributions c
      where c.user_id = u.id and c.status = 'approved' and c.deleted_at is null
        and c.type_slug in ('workshop-development', 'workshop-presenter')) as workshops_count,
    (select count(*) from public.contributions c
      where c.user_id = u.id and c.status = 'approved' and c.deleted_at is null)
                                                                           as verified_contributions,
    (select count(*) from public.archive_submissions s
      where s.submitted_by = u.id)                                         as submissions_count,
    (select count(*) from public.position_history ph
      where ph.user_id = u.id)                                             as positions_held
from public.app_users u
where u.deleted_at is null;

comment on view public.member_stats is
    'Verified per-member dashboard totals. Projects include both approved work and verified participation.';
