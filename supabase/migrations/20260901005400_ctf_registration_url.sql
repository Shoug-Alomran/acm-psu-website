-- Keep the public event record aligned with the CTF 3.0 registration page.
update public.projects
set registration_url = 'https://ctf-psu.shoug-tech.com/register.html'
where slug = 'ctf-3-0';
