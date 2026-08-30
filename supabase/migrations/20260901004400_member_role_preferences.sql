-- Membership applications and member position requests may express a preferred
-- standing club role. A preference is advisory only: administrators still make
-- the official assignment after interview/review.

alter table public.applications
  add column if not exists preferred_position_id uuid
  references public.positions(id) on delete set null;

comment on column public.applications.preferred_position_id is
  'Optional applicant preference for a standing club role. Null means general member / no standing role preference.';

-- Applicants and members should only be offered positions that are actually
-- available. President and Vice President are succession/appointment roles,
-- not self-selected preferences. Faculty Advisor is also not a student role.
-- Unlimited positions remain available regardless of holder count.
create or replace function public.member_position_choices()
returns table (
  id uuid,
  title text,
  category text,
  rank integer,
  max_holders integer,
  filled integer,
  remaining integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with holder_counts as (
    select ph.position_id, count(*)::integer as filled
    from public.position_history ph
    where ph.ended_on is null
      and ph.position_id is not null
    group by ph.position_id
  )
  select
    p.id,
    p.title,
    p.category,
    p.rank,
    p.max_holders,
    coalesce(h.filled, 0) as filled,
    case
      when p.max_holders is null then null
      else greatest(p.max_holders - coalesce(h.filled, 0), 0)
    end as remaining
  from public.positions p
  left join holder_counts h on h.position_id = p.id
  where p.is_active = true
    and p.archived_at is null
    and lower(p.title) not in ('president', 'vice president', 'faculty advisor')
    and (p.max_holders is null or coalesce(h.filled, 0) < p.max_holders)
  order by p.rank, p.title;
$$;

revoke all on function public.member_position_choices() from public, anon;
grant execute on function public.member_position_choices() to authenticated;
