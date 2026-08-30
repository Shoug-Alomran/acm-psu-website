-- Accounts are not limited to students. Faculty advisors, university staff,
-- alumni and other affiliates need accounts without student-only profile data.
alter table public.app_users
    add column university_role text not null default 'student',
    add constraint app_users_university_role_valid
        check (university_role in ('student', 'instructor', 'staff', 'alumni', 'other'));

comment on column public.app_users.university_role is
    'The person''s relationship to PSU; separate from ACM membership and admin roles.';

-- Accounts created while the signup UI was ahead of this migration already
-- carry the selection in auth metadata. Recover it instead of leaving every
-- pre-migration instructor labelled as a student by the column default.
update public.app_users as app_user
   set university_role = case
       when auth_user.raw_user_meta_data ->> 'university_role'
            in ('student', 'instructor', 'staff', 'alumni', 'other')
       then auth_user.raw_user_meta_data ->> 'university_role'
       else 'student'
   end
  from auth.users as auth_user
 where auth_user.id = app_user.id;

-- The value is chosen during signup and reaches this trigger through the auth
-- metadata, just like full_name. Validate it defensively before persisting it.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    requested_role text := coalesce(new.raw_user_meta_data ->> 'university_role', 'student');
begin
    if requested_role not in ('student', 'instructor', 'staff', 'alumni', 'other') then
        requested_role := 'other';
    end if;

    insert into public.app_users (id, email, full_name, university_role)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', ''),
        requested_role
    )
    on conflict (id) do nothing;

    insert into public.member_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    return new;
end;
$$;
