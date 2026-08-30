/** Instructor-specific profile enhancement for the member portal. */
import { h, formValues, textOf } from '../lib/dom.js';
import { action, field, metaList, notice, panel, submitButton, toast } from '../lib/ui.js';
import { requireMember } from '../lib/session.js';
import { requireClient } from '../lib/supabase.js';

interface InstructorProfile {
  user_id: string;
  academic_title: string | null;
  department: string | null;
  courses_taught: string[];
  expertise: string[];
  research_interests: string[];
  office_location: string | null;
  office_hours: string | null;
  faculty_page_url: string | null;
}

function listText(values: string[] | null | undefined): string {
  return values?.length ? values.join(', ') : '—';
}

function splitList(value: string): string[] {
  return Array.from(new Set(
    value.split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )).slice(0, 40);
}

async function loadProfile(userId: string): Promise<InstructorProfile | null> {
  const { data, error } = await requireClient()
    .from('instructor_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as InstructorProfile | null;
}

async function saveInstructorProfile(userId: string, profile: Omit<InstructorProfile, 'user_id'>): Promise<void> {
  const { error } = await requireClient()
    .from('instructor_profiles')
    .upsert({ user_id: userId, ...profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

async function waitForPanel(title: string): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const heading = Array.from(document.querySelectorAll<HTMLElement>('.panel-head h2'))
      .find((node) => node.textContent?.trim() === title);
    const found = heading?.closest<HTMLElement>('.panel') ?? null;
    if (found) return found;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return null;
}

function profileLinks(profile: { linkedin_url?: string | null; github_url?: string | null; website_url?: string | null; extra_links?: Array<{ label: string; url: string }> } | null | undefined, instructor: InstructorProfile | null): string {
  return [
    profile?.linkedin_url ? 'LinkedIn' : null,
    profile?.github_url ? 'GitHub' : null,
    profile?.website_url ? 'Website' : null,
    ...(profile?.extra_links ?? []).map((link) => link.label),
    instructor?.faculty_page_url ? 'PSU faculty page' : null,
  ].filter(Boolean).join(', ') || '—';
}

async function enhanceProfilePage(userId: string, current: InstructorProfile | null): Promise<void> {
  const about = await waitForPanel('About you');
  if (!about || document.querySelector('[data-instructor-profile-panel]')) return;

  const status = h('div');
  const form = h('form', { class: 'portal-form', novalidate: true },
    notice('info',
      'This section is for faculty information. Use it for the academic details that are relevant to students and ACM activities.'),
    h('div', { class: 'field-pair' },
      field({
        label: 'Academic title', name: 'academic_title', maxlength: 120,
        value: current?.academic_title,
        placeholder: 'e.g. Associate Professor',
      }),
      field({
        label: 'Department', name: 'department', maxlength: 160,
        value: current?.department,
        placeholder: 'e.g. Computer Science',
      }),
    ),
    field({
      label: 'Courses taught', name: 'courses_taught', type: 'textarea', rows: 4, maxlength: 2000,
      value: current?.courses_taught?.join('\n') ?? '',
      hint: 'One course per line, or separate courses with commas. Course codes are useful when available.',
      placeholder: 'CS 210 — Data Structures\nCYS 401 — Cybersecurity',
    }),
    field({
      label: 'Areas of expertise', name: 'expertise', type: 'textarea', rows: 4, maxlength: 2000,
      value: current?.expertise?.join('\n') ?? '',
      hint: 'Examples: cybersecurity, machine learning, software engineering, databases.',
    }),
    field({
      label: 'Research interests', name: 'research_interests', type: 'textarea', rows: 4, maxlength: 2000,
      value: current?.research_interests?.join('\n') ?? '',
      hint: 'Optional. Add the research areas you would like students or ACM members to know about.',
    }),
    h('div', { class: 'field-pair' },
      field({
        label: 'Office / room', name: 'office_location', maxlength: 120,
        value: current?.office_location,
        placeholder: 'e.g. Building 1, Room 214',
      }),
      field({
        label: 'Office hours', name: 'office_hours', maxlength: 200,
        value: current?.office_hours,
        placeholder: 'e.g. Sun & Tue, 12:00–13:00',
      }),
    ),
    field({
      label: 'PSU faculty page', name: 'faculty_page_url', type: 'url', maxlength: 500,
      value: current?.faculty_page_url,
      placeholder: 'https://www.psu.edu.sa/...',
    }),
    status,
    submitButton('Save instructor profile'),
  ) as HTMLFormElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = formValues(form);
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"], button');
    if (button) button.disabled = true;
    status.replaceChildren(notice('info', 'SAVING…'));
    try {
      await saveInstructorProfile(userId, {
        academic_title: textOf(values, 'academic_title').trim() || null,
        department: textOf(values, 'department').trim() || null,
        courses_taught: splitList(textOf(values, 'courses_taught')),
        expertise: splitList(textOf(values, 'expertise')),
        research_interests: splitList(textOf(values, 'research_interests')),
        office_location: textOf(values, 'office_location').trim() || null,
        office_hours: textOf(values, 'office_hours').trim() || null,
        faculty_page_url: textOf(values, 'faculty_page_url').trim() || null,
      });
      status.replaceChildren(notice('ok', 'INSTRUCTOR PROFILE SAVED.'));
      toast('Instructor profile saved.');
    } catch (error) {
      status.replaceChildren(notice('err', error instanceof Error ? error.message : String(error)));
    } finally {
      if (button) button.disabled = false;
    }
  });

  const instructorPanel = panel('Academic & teaching profile', form);
  instructorPanel.dataset.instructorProfilePanel = 'true';
  about.insertAdjacentElement('afterend', instructorPanel);
}

async function enhanceDashboard(current: InstructorProfile | null, viewer: Awaited<ReturnType<typeof requireMember>>): Promise<void> {
  const target = await waitForPanel('Your profile');
  if (!target) return;
  const body = target.querySelector<HTMLElement>('.panel-body');
  if (!body) return;

  const profile = viewer.profile;
  body.replaceChildren(
    metaList([
      ['Visibility', profile?.visibility ?? 'private'],
      ['Public listing', profile?.visibility === 'public' ? 'Shown on the ACM team page' : 'Not shown publicly'],
      ['Academic title', current?.academic_title ?? '—'],
      ['Department', current?.department ?? '—'],
      ['Courses taught', listText(current?.courses_taught)],
      ['Expertise', listText(current?.expertise)],
      ['Research interests', listText(current?.research_interests)],
      ['Office / room', current?.office_location ?? '—'],
      ['Office hours', current?.office_hours ?? '—'],
      ['Links', profileLinks(profile, current)],
    ]),
    h('div', { class: 'button-row' },
      h('a', { class: 'btn-ghost', href: '/portal/profile.html' }, 'Edit faculty profile'),
      h('a', { class: 'btn-ghost', href: '/portal/requests.html' }, 'Privacy & membership'),
    ),
  );
}

async function start(): Promise<void> {
  const viewer = await requireMember();
  if (!['instructor', 'staff'].includes(viewer.user.university_role)) return;

  let current: InstructorProfile | null = null;
  try {
    current = await loadProfile(viewer.userId);
  } catch (error) {
    console.error('Could not load instructor profile:', error);
  }

  if (window.location.pathname.endsWith('/portal/profile.html')) {
    await enhanceProfilePage(viewer.userId, current);
  } else if (window.location.pathname.endsWith('/portal/index.html') || window.location.pathname === '/portal/') {
    await enhanceDashboard(current, viewer);
  }
}

void start();
