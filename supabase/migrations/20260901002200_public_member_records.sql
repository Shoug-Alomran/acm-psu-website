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
