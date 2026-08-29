/**
 * Member requests.
 *
 * Three things people often conflate are kept separate here, and the page says
 * so plainly, because the difference matters to the person making the request:
 *
 *   Hide my public profile  — you stay a member; the website stops listing you.
 *   Withdraw from ACM       — you stop being an active member; your record stays.
 *   Delete my account       — you lose sign-in; official records still stand.
 *
 * No request destroys verified contributions or position history. Those are
 * the club's record of work that genuinely happened.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, loading, dialog, field, notice, toast,
  action, emptyState, metaList,
} from '../lib/ui.js';
import { requireMember, canSubmit } from '../lib/session.js';
import {
  myRequests, createRequest, cancelRequest, myPositionRequest, requestPositionChange,
  positions, saveProfile,
} from '../lib/api.js';
import { loadViewer } from '../lib/session.js';
import { myInquiries, STATUS_LABELS } from '../lib/inquiries.js';
import { archiveDate, enumLabel } from '../lib/format.js';
import type { MemberRequestKind, Position } from '../lib/types.js';

async function start(): Promise<void> {
  const viewer = await requireMember();
  const content = shell(viewer, 'member', 'Requests');
  render(content, loading());

  const positionList = await positions();

  function simpleRequest(
    kind: MemberRequestKind, title: string, explanation: string, prompt: string,
    extra?: HTMLElement,
  ): void {
    const form = h('form', { class: 'portal-form', novalidate: true },
      notice('info', explanation),
      extra ?? null,
      field({ label: prompt, name: 'message', type: 'textarea', rows: 4, maxlength: 2000 }),
    ) as HTMLFormElement;

    const modal = dialog(title, form,
      h('div', { class: 'button-row' },
        action('Send request', async () => {
          const values = formValues(form);
          const outcome = textOf(values, 'preferred_outcome');
          await createRequest({
            user_id: viewer.userId,
            kind,
            message: textOf(values, 'message') || null,
            payload: outcome ? { preferred_outcome: outcome } : {},
          });
          modal.close();
          toast('Request sent to the admins.');
          await draw();
        }, 'primary')));
  }

  function positionRequestForm(): void {
    const form = h('form', { class: 'portal-form', novalidate: true },
      notice('info',
        'Positions are official records, so an admin decides them. Your existing ' +
        'position history is never overwritten — an approved change adds a new entry.'),
      field({ label: 'Position you are asking for', name: 'requested_position_id',
              type: 'select',
              options: [{ value: '', label: 'Select…' },
                ...positionList.map((p: Position) => ({ value: p.id, label: p.title })),
                { value: 'other', label: 'Something else — I will describe it' }] }),
      field({ label: 'If something else, describe it', name: 'requested_title', maxlength: 120 }),
      field({ label: 'Why?', name: 'reason', type: 'textarea', rows: 4,
              hint: 'Optional, but it helps the admins decide.' }),
    ) as HTMLFormElement;

    const modal = dialog('Request a position change', form,
      h('div', { class: 'button-row' },
        action('Send request', async () => {
          const values = formValues(form);
          const selected = textOf(values, 'requested_position_id');
          const described = textOf(values, 'requested_title');

          if (!selected && !described) {
            toast('Choose a position or describe the one you want.', 'err');
            return;
          }

          await requestPositionChange({
            user_id: viewer.userId,
            requested_position_id: selected && selected !== 'other' ? selected : null,
            requested_title: described || null,
            reason: textOf(values, 'reason') || null,
          });
          modal.close();
          toast('Request sent.');
          await draw();
        }, 'primary')));
  }

  async function draw(): Promise<void> {
    const [requests, positionRequest, questions] = await Promise.all([
      myRequests(viewer.userId), myPositionRequest(viewer.userId),
      // Only inquiries this person sent while signed in. The view omits every
      // internal column, so there is nothing here to leak.
      myInquiries().catch(() => []),
    ]);

    const hasPending = (kind: MemberRequestKind) =>
      requests.some((r) => r.kind === kind && r.status === 'pending');

    const isPublic = viewer.profile?.visibility === 'public';

    render(content,
      pageHeader('MEMBER / REQUESTS', 'Requests'),

      notice('info',
        'Hiding your profile, leaving ACM and deleting your account are three different ' +
        'things. None of them removes verified contributions or position history from ' +
        'the club’s record.'),

      h('div', { class: 'panel-grid' },
        panel('Profile visibility',
          h('p', isPublic
            ? 'Your profile is currently listed on the public ACM team page.'
            : 'Your profile is currently private. It is not shown publicly.'),
          h('p', { class: 'mono-meta dim-text' },
            'You can switch this yourself at any time. If your profile is already ' +
            'published and you would rather it were taken down and kept down, ask ' +
            'the admins to remove it.'),
          h('div', { class: 'button-row' },
            action(isPublic ? 'Make my profile private' : 'List my profile publicly', async () => {
              await saveProfile(viewer.userId,
                { visibility: isPublic ? 'private' : 'public' });
              await loadViewer(true);
              toast('Visibility updated.');
              window.location.reload();
            }),
            hasPending('profile_removal')
              ? statusPill('pending')
              : h('button', { type: 'button', class: 'btn-ghost',
                  onclick: () => simpleRequest('profile_removal',
                    'Request public profile removal',
                    'This asks an admin to take your profile off the public website and ' +
                    'keep it off. Your membership, record and history are unaffected.',
                    'Anything you would like the admins to know?') }, 'Request removal'))),

        panel('Membership',
          h('p', 'Leaving ACM ends your active membership. Your position history and ' +
                 'verified contributions stay on file — they are a record of work you ' +
                 'actually did.'),
          h('p', { class: 'mono-meta dim-text' },
            'An admin confirms the request and sets the outcome: alumni, withdrawn, or inactive.'),
          h('div', { class: 'button-row' },
            hasPending('withdrawal')
              ? statusPill('pending')
              : canSubmit(viewer)
                ? h('button', { type: 'button', class: 'btn-ghost btn-danger',
                    onclick: () => simpleRequest('withdrawal', 'Withdraw from ACM',
                      'An admin will confirm this and choose the resulting status. ' +
                      'Nothing in your record is deleted.',
                      'Why are you leaving? (optional)',
                      field({ label: 'Preferred outcome', name: 'preferred_outcome',
                              type: 'select',
                              options: [
                                { value: '', label: 'Let the admins decide' },
                                { value: 'alumni', label: 'Alumni — I have finished my time here' },
                                { value: 'inactive', label: 'Inactive — I may come back' },
                                { value: 'withdrawn', label: 'Withdrawn' },
                              ] })) }, 'Withdraw from ACM')
                : h('span', { class: 'mono-meta dim-text' },
                    `MEMBERSHIP: ${enumLabel(viewer.membership?.status)}`))),
      ),

      panel('Position',
        metaList([
          ['Current position', viewer.currentPosition ?? 'Member'],
          ['Open request', positionRequest && positionRequest.status === 'pending'
            ? (positionRequest.requested_title ?? 'Pending') : '—'],
        ]),
        positionRequest?.admin_note
          ? h('p', { class: 'mono-meta dim-text' }, `ADMIN: ${positionRequest.admin_note}`)
          : null,
        h('div', { class: 'button-row' },
          positionRequest?.status === 'pending'
            ? statusPill('pending')
            : canSubmit(viewer)
              ? h('button', { type: 'button', class: 'btn-ghost',
                  onclick: () => positionRequestForm() }, 'Request a position change')
              : null)),

      panel('Account',
        h('p', 'Deleting your account removes your ability to sign in. Official ACM ' +
               'records — position history, verified contributions, published archive ' +
               'items — are club records and remain, because they document work the ' +
               'club actually did.'),
        h('div', { class: 'button-row' },
          hasPending('account_deletion')
            ? statusPill('pending')
            : h('button', { type: 'button', class: 'btn-ghost btn-danger',
                onclick: () => simpleRequest('account_deletion', 'Request account deletion',
                  'An admin will contact you to confirm what happens to your public ' +
                  'profile and your account before anything is done.',
                  'Anything you would like the admins to know?') }, 'Request account deletion'),
          h('button', { type: 'button', class: 'btn-ghost',
            onclick: () => simpleRequest('data_export', 'Request a copy of my data',
              'An admin will send you everything the platform holds about you.',
              'Anything specific you need?') }, 'Request my data'))),

      panel('Your questions to the committee',
        questions.length
          ? h('div', { class: 'history-list' },
              questions.map((question) => h('div', { class: 'history-row' },
                h('span', { class: 'mono-meta' }, archiveDate(question.created_at)),
                h('div', {},
                  h('strong', question.subject), ' ',
                  statusPill(question.status),
                  h('p', { class: 'mono-meta dim-text' }, question.reference),
                  question.response
                    ? h('p', { class: 'history-reason' },
                        h('span', { class: 'mono-meta dim-text' }, 'REPLY  '),
                        question.response)
                    : h('p', { class: 'mono-meta dim-text' },
                        STATUS_LABELS[question.status].toUpperCase() +
                        ' — NO REPLY YET')))))
          : emptyState('You have not sent the committee a question.',
              'Anything sent from the contact page while signed in appears here.'),
        h('div', { class: 'button-row' },
          h('a', { class: 'btn-ghost', href: '/contact.html' }, 'Ask a question'))),

      panel('Request history',
        requests.length
          ? h('div', { class: 'history-list' },
              requests.map((request) => h('div', { class: 'history-row' },
                h('span', { class: 'mono-meta' }, archiveDate(request.created_at)),
                h('div', {},
                  h('strong', enumLabel(request.kind)), ' ', statusPill(request.status),
                  request.message ? h('p', request.message) : null,
                  request.admin_note
                    ? h('p', { class: 'mono-meta dim-text' }, `ADMIN: ${request.admin_note}`)
                    : null,
                  request.status === 'pending'
                    ? h('div', { class: 'button-row' },
                        action('Cancel', async () => {
                          await cancelRequest(request.id);
                          toast('Request cancelled.');
                          await draw();
                        }))
                    : null))))
          : emptyState('You have not made any requests.')),
    );
  }

  await draw();
}

void start();
