alter table public.projects
  add column if not exists registration_url text;

update public.projects
set registration_url = 'https://ai-programming-jam.shoug-tech.com/team-formation.html',
    updated_at = now()
where slug = 'ai-programming-jam-2026';
