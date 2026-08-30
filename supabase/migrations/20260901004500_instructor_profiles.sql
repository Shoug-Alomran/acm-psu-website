-- Instructor-specific profile data. Student/member profile fields remain in member_profiles.

create table if not exists public.instructor_profiles (
    user_id uuid primary key references public.app_users(id) on delete cascade,
    academic_title text,
    department text,
    courses_taught text[] not null default '{}',
    expertise text[] not null default '{}',
    research_interests text[] not null default '{}',
    office_location text,
    office_hours text,
    faculty_page_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.instructor_profiles enable row level security;

grant select, insert, update on public.instructor_profiles to authenticated;

create policy instructor_profiles_select_own
on public.instructor_profiles
for select
to authenticated
using (
    user_id = auth.uid()
    or public.is_staff()
);

create policy instructor_profiles_insert_own
on public.instructor_profiles
for insert
to authenticated
with check (
    user_id = auth.uid()
    and exists (
        select 1
        from public.app_users u
        where u.id = auth.uid()
          and u.university_role in ('instructor', 'staff')
    )
);

create policy instructor_profiles_update_own
on public.instructor_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (
    user_id = auth.uid()
    and exists (
        select 1
        from public.app_users u
        where u.id = auth.uid()
          and u.university_role in ('instructor', 'staff')
    )
);

comment on table public.instructor_profiles is
    'Instructor-controlled academic and teaching profile details, separate from student membership metadata.';
