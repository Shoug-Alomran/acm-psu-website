-- ===========================================================================
-- Two boundaries that were defined once and then not carried forward.
--
--   1. guard_app_users_columns() was written before app_users had a
--      university_role column. 20260901003300_university_roles.sql added the
--      column and did not revisit the guard, so app_users_update_self left
--      every signed-in account free to set its own university_role. That is a
--      direct privilege escalation: 'instructor' unlocks the instructor branch
--      of profile-bio-format, publishes instructor academic detail through
--      public_member_directory, and relabels the account as "Instructor" /
--      "Faculty Advisor" in the People worksheet. A student could present
--      themselves as faculty on a university-affiliated public page.
--
--   2. project_organizers was readable by anon with `using (true)`, while
--      projects itself is filtered to public, undeleted rows. An anonymous
--      visitor could enumerate organiser rows for internal projects the
--      projects policy exists to hide.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app_users column guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_app_users_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if public.is_club_admin() then
        return new;
    end if;

    -- university_role decides whether an account is presented as faculty.
    -- It is not a preference; it is a claim about the person, and only an
    -- admin may make it.
    if new.university_role is distinct from old.university_role then
        raise exception
            'University role is set by an ACM admin, not by the account holder.'
            using errcode = '42501';
    end if;

    -- major is administrative once it is set, but sign-up genuinely fills it
    -- in from the new account's own answers (platform/lib/signup-profile.ts
    -- writes it exactly once, only while it is still empty). Allow that first
    -- write and freeze it afterwards, rather than blocking the flow outright.
    if old.major is not null and btrim(old.major) <> ''
       and new.major is distinct from old.major then
        raise exception
            'Major is an administrative field. Contact an ACM admin to change it.'
            using errcode = '42501';
    end if;

    if new.account_state is distinct from old.account_state
       or new.student_id is distinct from old.student_id
       or new.email      is distinct from old.email
       or new.deleted_at is distinct from old.deleted_at then
        raise exception
            'Student ID, email and account state are administrative fields. '
            'Contact an ACM admin to change them.'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

comment on function public.guard_app_users_columns() is
    'Blocks a member from editing the administrative columns of their own '
    'app_users row. A member may correct full_name, and may set major once '
    'from their sign-up answers; everything else is an admin decision.';

-- ---------------------------------------------------------------------------
-- 2. project_organizers visibility follows projects
-- ---------------------------------------------------------------------------
drop policy if exists project_organizers_select on public.project_organizers;

-- Anonymous visitors see organisers of exactly the projects they can already
-- see. Members and staff keep the wider view their projects policies grant, so
-- this is expressed as "a visible project" rather than by repeating the rules.
create policy project_organizers_select_anon on public.project_organizers
    for select to anon
    using (exists (
        select 1 from public.projects p
         where p.id = project_organizers.project_id
           and p.visibility = 'public'
           and p.deleted_at is null
    ));

create policy project_organizers_select_authenticated on public.project_organizers
    for select to authenticated
    using (exists (
        select 1 from public.projects p
         where p.id = project_organizers.project_id
    ));
