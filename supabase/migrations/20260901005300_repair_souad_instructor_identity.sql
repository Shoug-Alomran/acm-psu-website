-- ---------------------------------------------------------------------------
-- 0053 — Repair Dr. Souad's identity and faculty access.
--
-- The original access migration could run before her account was created. In
-- that case its email lookup matched no row and could not grant the role.
-- Repeat the grant now and keep the application/auth identity fields aligned.
-- ---------------------------------------------------------------------------

update public.app_users
   set full_name = 'Dr. Souad Larabi-Marie-Sainte',
       university_role = 'instructor'
 where lower(email::text) = 'slarabi@psu.edu.sa'
   and deleted_at is null;

update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
       || jsonb_build_object(
            'full_name', 'Dr. Souad Larabi-Marie-Sainte',
            'university_role', 'instructor'
          )
 where lower(email::text) = 'slarabi@psu.edu.sa';

update public.member_profiles p
   set display_name = 'Dr. Souad Larabi-Marie-Sainte',
       updated_at = now()
  from public.app_users u
 where p.user_id = u.id
   and lower(u.email::text) = 'slarabi@psu.edu.sa'
   and u.deleted_at is null;

insert into public.instructor_profiles (user_id)
select id
  from public.app_users
 where lower(email::text) = 'slarabi@psu.edu.sa'
   and deleted_at is null
on conflict (user_id) do nothing;

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
