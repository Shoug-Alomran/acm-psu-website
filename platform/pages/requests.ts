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
import { requireParticipant, canSubmit } from '../lib/session.js';
import {
  myRequests, createRequest, cancelRequest, myPositionRequest, requestPositionChange,
  saveProfile,
} from '../lib/api.js';
import { requireClient } from '../lib/supabase.js';
import { loadViewer } from '../lib/session.js';
import { myInquiries, STATUS_LABELS } from '../lib/inquiries.js';
import { archiveDate, enumLabel } from '../lib/format.js';
import type { MemberRequestKind } from '../lib/types.js';

interface MemberPositionChoice {
  id: string;
  title: string;
  category: string;
  rank: number;
  max_holders: number | null;
  filled: number;
  remaining: number | null;
}

async function start(): Promise<void> {
  const viewer = await requireParticipant();
  const content = shell(viewer, 'member', 'Requests');
  render(content, loading());

  const { data: positionChoiceRows, error: positionChoiceError } =
    await requireClient().rpc('member_position_choices');
  if (positionChoiceError) {
    render(content,
      pageHeader('MEMBER / REQUESTS', 'Requests unavailable'),
      notice('err', `Could not load available club roles: ${positionChoiceError.message}`));
    return;
  }
  const positionList = (positionChoiceRows ?? []) as MemberPositionChoice[];

  const { data: currentRole, error: currentRoleError } = await requireClient()
    .from('current_positions').select('position_id, rank, title')
    .eq('user_id', viewer.userId).maybeSingle();
  const hasStandingRole = Boolean(viewer.currentPosition && viewer.currentPosition !== 'Member');
  const hierarchyKnown = !currentRoleError && (!hasStandingRole || currentRole?.rank != null);
  // Lower rank values represent more senior roles in the club catalogue.
  const alternatives = positionList.filter(p => p.id !== currentRole?.position_id && p.title !== viewer.currentPosition)
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  const promotions = hierarchyKnown ? alternatives.filter(p => !hasStandingRole || p.rank < currentRole!.rank!) : [];
  const transfers = hierarchyKnown && hasStandingRole ? alternatives.filter(p => p.rank >= currentRole!.rank!) : [];

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

  function positionRequestForm(mode: 'promotion' | 'change'): void {
    const choices = mode === 'promotion' ? promotions : transfers;
    if (!choices.length) return;
    const title = mode === 'promotion' ? 'Apply for a promotion' : 'Request a different club role';
    const explanation = mode === 'promotion'
      ? 'Only available roles above your current level are shown. Members without a standing role can apply for an entry into the club organization. The committee reviews the request and your current position stays unchanged unless the request is approved.'
      : 'Only available roles at your current level or below are shown. Higher roles are listed under promotion. Your position history is never overwritten; an approved change closes the current term and records the new one.';

    const form = h('form', { class: 'portal-form', novalidate: true },
      notice('info', explanation),
      field({
        label: mode === 'promotion' ? 'Role you want to be considered for' : 'Role you want to move to',
        name: 'requested_position_id',
        type: 'select',
        required: true,
        options: [
          { value: '', label: 'Select an available role…' },
          ...choices.map((p) => ({
            value: p.id,
            label: p.max_holders === null
              ? `${p.title} — available`
              : `${p.title} — ${p.remaining ?? 0} seat${p.remaining === 1 ? '' : 's'} available`,
          })),
        ],
        hint: 'President, Vice President, faculty-only roles, archived roles and positions that are already full are not offered here.',
      }),
      field({
        label: 'Why are you interested in this role?',
        name: 'reason',
        type: 'textarea',
        rows: 4,
        maxlength: 1500,
        hint: 'Optional, but it helps the committee understand why the role fits what you want to contribute or learn.',
      }),
    ) as HTMLFormElement;

    const modal = dialog(title, form,
      h('div', { class: 'button-row' },
        action(mode === 'promotion' ? 'Submit promotion request' : 'Submit role change request', async () => {
          if (!form.reportValidity()) return;
          const values = formValues(form);
          const selected = textOf(values, 'requested_position_id');
          if (!choices.some(p => p.id === selected)) {
            toast('Choose an available role.', 'err');
            return;
          }

          await requestPositionChange({
            user_id: viewer.userId,
            requested_position_id: selected,
            requested_title: null,
            reason: textOf(values, 'reason') || null,
          });
          modal.close();
          toast(mode === 'promotion' ? 'Promotion request sent.' : 'Role change request sent.');
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

      panel('Club role',
        metaList([
          ['Current standing role', viewer.currentPosition ?? 'General member'],
          ['Open request', positionRequest && positionRequest.status === 'pending'
            ? (positionRequest.requested_title ?? 'Pending') : '—'],
        ]),
        h('p', { class: 'mono-meta dim-text' },
          'For event roles, visit Opportunities.'),
        positionRequest?.admin_note
          ? h('p', { class: 'mono-meta dim-text' }, `ADMIN: ${positionRequest.admin_note}`)
          : null,
        positionRequest?.status === 'pending'
          ? statusPill('pending')
          : canSubmit(viewer)
            ? h('div', { class: 'role-paths' },
                !hierarchyKnown ? notice('warn', 'Your current role ranking could not be determined. Ask the committee to check your role before requesting a change.') : null,
                h('div', { class: 'role-path' },
                  h('h3', hasStandingRole ? 'Move up' : 'Join a club team'),
                  h('p', hasStandingRole ? 'Apply for a role above your current level.' : 'Apply for an available standing club role.'),
                  promotions.length ? h('button', { type: 'button', class: 'btn-submit', onclick: () => positionRequestForm('promotion') },
                    hasStandingRole ? `Apply for promotion (${promotions.length})` : 'Apply for a club role')
                    : h('p', { class: 'role-path__empty' }, hierarchyKnown ? 'No higher roles are currently open for applications. President and Vice President are appointed through the committee.' : 'Role options unavailable.')),
                hasStandingRole ? h('div', { class: 'role-path' },
                  h('h3', 'Change direction'),
                  h('p', 'Move to a different role at the same level or step down to a lower level.'),
                  transfers.length ? h('button', { type: 'button', class: 'btn-ghost', onclick: () => positionRequestForm('change') }, 'Request a role change')
                    : h('p', { class: 'role-path__empty' }, 'No alternative roles are currently available.')) : null)
            : null),

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
