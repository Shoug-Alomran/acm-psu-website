-- Add concise, application-specific experience fields.
-- Membership is not a technical screening: this records context for reviewers
-- without scoring or requiring prior experience.

alter table public.applications
  add column if not exists experience_status text not null default 'not_provided',
  add column if not exists experience_text text;

alter table public.applications
  drop constraint if exists applications_experience_status_valid;

alter table public.applications
  add constraint applications_experience_status_valid
  check (experience_status in ('none', 'some', 'not_provided'));

alter table public.applications
  drop constraint if exists applications_experience_text_length;

alter table public.applications
  add constraint applications_experience_text_length
  check (experience_text is null or char_length(experience_text) <= 1500);

comment on column public.applications.experience_status is
  'Applicant self-report: none, some, or not_provided. Never a score or eligibility gate.';

comment on column public.applications.experience_text is
  'Optional self-reported prior experience such as coursework, projects, workshops, competitions, volunteering, or self-study.';
