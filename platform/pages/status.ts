/**
 * Application status.
 *
 * The one page an applicant has before they are a member. It shows exactly
 * where their application stands and, on rejection, whatever note the admin
 * chose to share — never the internal interview notes, which live in a table
 * applicants have no read policy on at all.
 */
import { h, render } from '../lib/dom.js';
import { shell, pageHeader, panel, statusPill, metaList, notice, loading } from '../lib/ui.js';
import { requireSignedIn, isMember, isStaff, isAdvisoryInstructor, isReviewer } from '../lib/session.js';
import { myApplication, setting } from '../lib/api.js';
import { myDecisions } from '../lib/audit.js';
import { memberDecisionList } from '../lib/history.js';
import { archiveDate, enumLabel } from '../lib/format.js';

const EXPLANATION: Record<string, string> = {
  submitted: 'Your application has been received and is waiting to be read. ' +
    'Applications are reviewed in batches, so this can take a couple of weeks.',
  interview: 'An organiser would like to talk with you. Someone will be in touch ' +
    'at the email on your application to arrange a time.',
  approved: 'You have been accepted. Your member dashboard is available now.',
  rejected: 'You were not accepted in this cycle. This is not a judgement of your ' +
    'ability — intakes are limited. You are welcome to apply again next time.',
  withdrawn: 'This application was withdrawn.',
};

async function start(): Promise<void> {
  const viewer = await requireSignedIn();
  const content = shell(viewer, 'member', 'Application status');
  render(content, loading());

  const [application, clubEmail, decisions] = await Promise.all([
    myApplication(viewer.userId),
    setting<string>('club_email', 'acm@psu.edu.sa'),
    myDecisions(20).catch(() => []),
  ]);

  if (isMember(viewer) || isStaff(viewer)) {
    window.location.replace(isMember(viewer) ? '/portal/index.html'
      : isAdvisoryInstructor(viewer) && !isReviewer(viewer)
        ? '/admin/advisor.html' : '/admin/index.html');
    return;
  }

  if (!application) {
    if (viewer.user.university_role !== 'student') {
      render(content,
        pageHeader('ACCOUNT', 'Account ready'),
        panel('Your university role',
          h('p', `You are registered as ${enumLabel(viewer.user.university_role)}.`),
          h('p', 'The membership application is for students, so it does not ask you for a major, academic year, or student ID. An ACM administrator can assign any club access you need.'),
          h('div', { class: 'button-row' },
            h('a', { class: 'btn-ghost', href: `mailto:${clubEmail}` }, 'Contact ACM'),
            h('a', { class: 'btn-ghost', href: '/index.html' }, 'Public website'))));
      return;
    }

    render(content,
      pageHeader('MEMBERSHIP', 'No application yet'),
      panel('Join ACM PSU',
        h('p', 'You have an account, but you have not applied for membership yet.'),
        h('div', { class: 'button-row' },
          h('a', { class: 'btn-submit', href: '/portal/apply.html' }, 'Apply now'),
          h('a', { class: 'btn-ghost', href: '/join.html' }, 'What membership involves'))));
    return;
  }

  render(content,
    pageHeader('MEMBERSHIP / APPLICATION', 'Application status', statusPill(application.status)),

    panel('Where things stand',
      notice(
        application.status === 'approved' ? 'ok'
          : application.status === 'rejected' ? 'warn' : 'info',
        EXPLANATION[application.status] ?? enumLabel(application.status)),

      application.decision_note
        ? h('div', {},
            h('p', { class: 'mono-meta dim-text' }, 'NOTE FROM THE REVIEWERS'),
            h('p', application.decision_note))
        : null,

      application.status === 'approved'
        ? h('div', { class: 'button-row' },
            h('a', { class: 'btn-submit', href: '/portal/index.html' }, 'Open my dashboard'))
        : h('div', { class: 'button-row' },
            h('a', { class: 'btn-ghost', href: `mailto:${clubEmail}` }, 'Contact ACM'))),

    decisions.length
      ? panel('Decision history',
          h('p', { class: 'mono-meta dim-text' },
            'What ACM has recorded about your application, and why.'),
          memberDecisionList(decisions))
      : null,

    panel('What you submitted',
      metaList([
        ['Submitted', archiveDate(application.created_at)],
        ['Name', application.full_name],
        ['Student ID', application.student_id],
        ['PSU email', application.psu_email],
        ['Major', application.major],
        ['Academic year', application.academic_year],
        ['Interests', application.interests.join(', ') || '—'],
        ['Chapter', application.chapter_year],
        ['Goal', application.goal_text || '—'],
      ])));
}

void start();
