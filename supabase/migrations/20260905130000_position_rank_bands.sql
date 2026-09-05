-- Make positions.rank mean something.
--
-- rank is the sort key behind every roster, the public directory and the admin
-- catalogue, but nothing tied it to a role's organization level. The column
-- default was a flat 100, so every role created through the admin console
-- landed on the same number and the catalogue's Rank column filled up with
-- repeated, arbitrary values that did not describe the club's hierarchy.
--
-- Each organization level now owns a hundred-wide band:
--
--     executive    1– 99
--     lead       101–199
--     committee  201–299
--     general    301–399
--
-- Roles sit ten apart inside their band, which leaves room to slot a new role
-- between two existing ones without renumbering the list. The band boundaries
-- themselves (0, 100, 200, 300) are deliberately left unused so a rank can
-- never be ambiguous about which level it belongs to.

comment on column public.positions.rank is
    'Display order. Derived from category: executive 1-99, lead 101-199, '
    'committee 201-299, general 301-399. Lower sorts first; never sort by title text.';

-- A role created without an explicit rank belongs at the bottom of the general
-- band, not in the middle of the leadership one.
alter table public.positions alter column rank set default 310;

-- Renumber every existing role into its band, preserving the relative order
-- admins have already established within each level. Roles are spaced ten
-- apart; a band holding more than nine roles falls back to the widest even
-- spacing that still fits, so a renumber can never spill into the next level.
with slotted as (
    select
        id,
        band,
        ordinal,
        case when band_count <= 9 then 10
             else greatest(1, floor(99.0 / band_count)::integer)
        end as step
    from (
        select
            id,
            band,
            row_number() over (partition by band order by rank, title, slug) as ordinal,
            count(*) over (partition by band) as band_count
        from (
            select
                id, rank, title, slug,
                case category
                    when 'executive' then 0
                    when 'lead'      then 100
                    when 'committee' then 200
                    else 300
                end as band
            from public.positions
        ) banded
    ) counted
)
update public.positions p
   set rank = slotted.band + least(slotted.ordinal * slotted.step, 99)
  from slotted
 where slotted.id = p.id
   and p.rank is distinct from slotted.band + least(slotted.ordinal * slotted.step, 99);
