-- ---------------------------------------------------------------------------
-- 0041 — Faculty-advisor production alignment.
--
-- The club has two faculty-advisor seats, and Dr. Souad is the real production
-- advisory instructor. Keep the organizational role and the system permission
-- as separate records: position_history describes the club role; an active
-- admin_assignment grants the restricted instructor console.
-- ---------------------------------------------------------------------------

-- Two faculty advisors serve the chapter.
update public.positions
   set max_holders = 2
 where slug = 'faculty-advisor';

-- Grant Dr. Souad the restricted advisory-instructor system role if it is not
-- already active. This is intentionally idempotent and does not touch her
-- existing Faculty Advisor position-history record.
insert into public.admin_assignments (user_id, role, note)
select
    u.id,
    'advisory_instructor'::admin_role,
    'Faculty advisor access to assigned ACM activities'
from public.app_users u
where lower(u.email::text) = 'slarabi@psu.edu.sa'
  and u.deleted_at is null
  and not exists (
      select 1
        from public.admin_assignments a
       where a.user_id = u.id
         and a.role = 'advisory_instructor'::admin_role
         and a.revoked_at is null
  );

notify pgrst, 'reload schema';
