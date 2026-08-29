-- Complete project/date metadata on Shoug's already-verified platform records.
-- No contribution history is created here; existing official records are linked
-- to the public platform project and retain their recorded timestamps.
do $$
declare
    shoug_id uuid;
    platform_id uuid;
    first_recorded_on date;
begin
    select id into shoug_id
      from public.app_users
     where lower(email) = 'shoug.alomran@shoug-tech.com'
     limit 1;

    if shoug_id is null then
        raise notice 'Shoug account not present; existing-record completion skipped';
        return;
    end if;

    select min(coalesce(verified_at, reviewed_at, created_at)::date)
      into first_recorded_on
      from public.contributions
     where user_id = shoug_id
       and deleted_at is null
       and title in (
           'ACM Workshop Documentation Framework',
           'ACM Workshop & Project Management System',
           'ACM PSU Digital Platform',
           'ACM Records & Contribution Verification System'
       );

    insert into public.projects (
        slug, title, kind, status, summary, starts_on, chapter_year,
        site_path, visibility, category
    ) values (
        'acm-psu-digital-platform',
        'ACM PSU Digital Platform',
        'project',
        'active',
        'The chapter website, member portal, records system, and workshop documentation infrastructure.',
        first_recorded_on,
        public.current_chapter_year(),
        '/',
        'public',
        'platform'
    )
    on conflict (slug) do update set
        title = excluded.title,
        summary = coalesce(public.projects.summary, excluded.summary),
        starts_on = coalesce(public.projects.starts_on, excluded.starts_on),
        site_path = coalesce(public.projects.site_path, excluded.site_path),
        visibility = 'public',
        deleted_at = null
    returning id into platform_id;

    update public.contributions
       set project_id = coalesce(project_id, platform_id),
           occurred_on = coalesce(
               occurred_on,
               verified_at::date,
               reviewed_at::date,
               created_at::date
           )
     where user_id = shoug_id
       and deleted_at is null
       and status = 'approved'
       and title in (
           'ACM Workshop Documentation Framework',
           'ACM Workshop & Project Management System',
           'ACM PSU Digital Platform',
           'ACM Records & Contribution Verification System'
       );
end;
$$;
