-- ---------------------------------------------------------------------------
-- 0039 — Let assigned advisory instructors resolve member identity for the
-- contributions they are explicitly allowed to review.
--
-- The existing advisor policy on app_users only covered people who already had
-- a participation row in an advised project. A contribution can legitimately
-- exist before a participation row is created, so PostgREST returned the
-- contribution but the embedded member relation was null. That produced the
-- blank MEMBER column in the instructor console.
--
-- This keeps access assignment-scoped: advisors can resolve an app_users row
-- only when that person participates in, OR has a contribution attached to, a
-- project the advisor is assigned to.
-- ---------------------------------------------------------------------------

drop policy if exists app_users_select_assigned_advisor on public.app_users;

create policy app_users_select_assigned_advisor on public.app_users
    for select to authenticated
    using (
        public.is_advisory_instructor()
        and (
            exists (
                select 1
                  from public.participations pa
                 where pa.user_id = app_users.id
                   and public.advises_project(pa.project_id)
            )
            or exists (
                select 1
                  from public.contributions c
                 where c.user_id = app_users.id
                   and c.project_id is not null
                   and c.deleted_at is null
                   and public.advises_project(c.project_id)
            )
        )
    );

notify pgrst, 'reload schema';
