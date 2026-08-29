/**
 * Profile editing.
 *
 * Everything on this page is member-controlled and saves immediately with no
 * review. The ACM-verified half of the record is shown alongside, read-only,
 * so the boundary is visible rather than implied — and so nobody wastes time
 * looking for where to edit their own position.
 */

import { h, render, formValues, textOf, asArray } from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  field,
  chipPicker,
  statusPill,
  metaList,
  notice,
  submitButton,
  loading,
  toast,
} from '../lib/ui.js';

import {
  requireMember,
  loadViewer,
  displayName,
} from '../lib/session.js';

import {
  saveProfile,
  saveName,
  positionHistory,
} from '../lib/api.js';

import { requireClient } from '../lib/supabase.js';

import {
  archiveDate,
  term,
} from '../lib/format.js';

const INTERESTS = [
  'programming',
  'cybersecurity',
  'ai',
  'web-development',
  'design-media',
  'event-organising',
  'workshops',
  'competitions',
  'documentation',
  'community',
].map((value) => ({
  value,
  label: value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '),
}));

async function start(): Promise<void> {
  const viewer = await requireMember();

  const content = shell(viewer, 'member', 'My profile');

  render(content, loading());

  try {
    const history = await positionHistory(viewer.userId);

    const profile = viewer.profile;
    const status = h('div');
    const extraLinks = profile?.extra_links ?? [];

    const extraLinksList = h('div', { class: 'extra-links-editor' });
    const addExtraLinkRow = (link: { label?: string; url?: string } = {}): void => {
      const row = h('div', { class: 'field-pair', dataset: { extraLinkRow: 'true' } },
        field({
          label: 'Other link — label', name: 'extra_link_label', maxlength: 40,
          value: link.label, hint: 'Optional, e.g. "Behance".',
        }),
        field({
          label: 'Other link — URL', name: 'extra_link_url', type: 'url',
          value: link.url, placeholder: 'https://…',
        }),
        h('button', {
          class: 'btn-ghost', type: 'button',
          onclick: () => row.remove(),
        }, 'Remove link'),
      );
      extraLinksList.append(row);
    };
    for (const link of extraLinks) addExtraLinkRow(link);

    const form = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      h(
        'div',
        { class: 'field-pair' },

        field({
          label: 'Full name',
          name: 'full_name',
          required: true,
          maxlength: 120,
          value: viewer.user.full_name,
        }),

        field({
          label: 'Display name',
          name: 'display_name',
          maxlength: 120,
          value: profile?.display_name,
          hint: 'Optional. Shown instead of your full name.',
        }),
      ),

      field({
        label: 'Academic year',
        name: 'academic_year',
        type: 'select',
        value: profile?.academic_year,
        options: [
          {
            value: '',
            label: '—',
          },
          ...[
            'Foundation',
            'Year 1',
            'Year 2',
            'Year 3',
            'Year 4',
            'Year 5+',
            'Graduate',
          ].map((year) => ({
            value: year,
            label: year,
          })),
        ],
      }),

      field({
        label: 'Bio',
        name: 'bio',
        type: 'textarea',
        rows: 6,
        maxlength: 5000,
        value: profile?.bio,
        hint: 'Shown on your public profile if you choose to be listed.',
      }),

      h(
        'div',
        { class: 'form-field' },

        h(
          'span',
          { class: 'mono-meta' },
          'INTERESTS',
        ),

        chipPicker(
          'interests',
          INTERESTS,
          profile?.interests ?? [],
        ),
      ),

      h(
        'div',
        { class: 'field-pair' },

        field({
          label: 'LinkedIn',
          name: 'linkedin_url',
          type: 'url',
          value: profile?.linkedin_url,
          placeholder: 'https://linkedin.com/in/…',
        }),

        field({
          label: 'GitHub',
          name: 'github_url',
          type: 'url',
          value: profile?.github_url,
          placeholder: 'https://github.com/…',
        }),
      ),

      field({
        label: 'Portfolio or personal website',
        name: 'website_url',
        type: 'url',
        value: profile?.website_url,
        placeholder: 'https://…',
      }),

      extraLinksList,
      h('button', {
        class: 'btn-ghost', type: 'button',
        onclick: () => addExtraLinkRow(),
      }, 'Add another link'),

      field({
        label: 'Profile visibility',
        name: 'visibility',
        type: 'select',
        value: profile?.visibility ?? 'private',
        options: [
          {
            value: 'private',
            label: 'Private — only you and ACM admins can see it',
          },
          {
            value: 'public',
            label: 'Public — listed on the ACM team page',
          },
        ],
        hint:
          'You can change this whenever you like. Making a profile private does ' +
          'not affect your membership or your verified record.',
      }),

      status,

      submitButton('Save profile'),
    ) as HTMLFormElement;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      const values = formValues(form);

      const button = form.querySelector<HTMLButtonElement>('button');

      if (!button) {
        return;
      }

      button.disabled = true;

      status.replaceChildren(
        notice('info', 'SAVING…'),
      );

      const links = Array.from(form.querySelectorAll<HTMLElement>('[data-extra-link-row]'))
        .map((row) => ({
          label: (row.querySelector<HTMLInputElement>('[name="extra_link_label"]')?.value ?? '').trim(),
          url: (row.querySelector<HTMLInputElement>('[name="extra_link_url"]')?.value ?? '').trim(),
        }))
        .filter((link) => link.label && link.url);

      try {
        await saveName(
          viewer.userId,
          textOf(values, 'full_name'),
        );

        await saveProfile(viewer.userId, {
          display_name:
            textOf(values, 'display_name') || null,

          academic_year:
            textOf(values, 'academic_year') || null,

          bio:
            textOf(values, 'bio'),

          interests:
            asArray(values.interests),

          linkedin_url:
            textOf(values, 'linkedin_url') || null,

          github_url:
            textOf(values, 'github_url') || null,

          website_url:
            textOf(values, 'website_url') || null,

          extra_links: links,

          visibility:
            textOf(values, 'visibility') === 'public'
              ? 'public'
              : 'private',
        });

        await loadViewer(true);

        status.replaceChildren(
          notice('ok', 'PROFILE SAVED.'),
        );

        toast('Profile saved.');
      } catch (error) {
        status.replaceChildren(
          notice(
            'err',
            error instanceof Error
              ? error.message
              : String(error),
          ),
        );
      } finally {
        button.disabled = false;
      }
    });

    /*
     * Avatar upload writes into the caller's own folder in the avatars bucket;
     * the storage policy is what actually enforces that.
     */

    const avatarInput = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
    }) as HTMLInputElement;

    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files?.[0];

      if (!file) {
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        toast(
          'Profile photos must be under 2 MB.',
          'err',
        );
        return;
      }

      try {
        const safeName = file.name.replace(
          /[^\w.-]+/g,
          '-',
        );

        const path =
          `${viewer.userId}/` +
          `${crypto.randomUUID()}-${safeName}`;

        const { error } = await requireClient()
          .storage
          .from('avatars')
          .upload(
            path,
            file,
            {
              upsert: false,
              contentType: file.type,
            },
          );

        if (error) {
          throw new Error(error.message);
        }

        await saveProfile(viewer.userId, {
          avatar_path: path,
        });

        await loadViewer(true);

        toast('Photo updated.');
      } catch (error) {
        toast(
          error instanceof Error
            ? error.message
            : String(error),
          'err',
        );
      }
    });

    render(
      content,

      pageHeader(
        'MEMBER / PROFILE',
        displayName(viewer),

        h(
          'a',
          {
            class: 'btn-ghost',
            href: '/portal/index.html',
          },
          'Back to dashboard',
        ),
      ),

      notice(
        'info',
        'Members control who they are. ACM verifies what they did. ' +
        'Everything on this page is yours to edit; the record below is maintained by admins.',
      ),

      h(
        'div',
        { class: 'panel-grid' },

        panel(
          'About you',
          form,
        ),

        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            },
          },

          panel(
            'Profile photo',

            h(
              'p',
              { class: 'mono-meta dim-text' },
              profile?.avatar_path
                ? 'A photo is on file.'
                : 'No photo on file.',
            ),

            h(
              'div',
              { class: 'form-field' },
              avatarInput,
            ),
          ),

          panel(
            'Verified by ACM',

            metaList([
              [
                'Membership',
                statusPill(viewer.membership?.status),
              ],
              [
                'Current position',
                viewer.currentPosition ?? 'Member',
              ],
              [
                'Member since',
                archiveDate(
                  viewer.membership?.started_on,
                ),
              ],
              [
                'Student ID',
                viewer.user.student_id ?? '—',
              ],
              [
                'Major',
                viewer.user.major ?? '—',
              ],
              [
                'PSU email',
                viewer.email,
              ],
            ]),

            history.length
              ? h(
                'div',
                { class: 'history-list' },

                history.map((row) =>
                  h(
                    'div',
                    { class: 'history-row' },

                    h(
                      'span',
                      { class: 'mono-meta' },
                      term(
                        row.started_on,
                        row.ended_on,
                      ),
                    ),

                    h(
                      'strong',
                      row.title_snapshot,
                    ),
                  ),
                ),
              )
              : null,

            h(
              'div',
              { class: 'button-row' },

              h(
                'a',
                {
                  class: 'btn-ghost',
                  href: '/portal/requests.html',
                },
                'Request a change',
              ),
            ),
          ),
        ),
      ),
    );
  } catch (error) {
    console.error(
      'Profile page failed to load:',
      error,
    );

    render(
      content,

      pageHeader(
        'MEMBER / PROFILE',
        'Profile unavailable',

        h(
          'a',
          {
            class: 'btn-ghost',
            href: '/portal/index.html',
          },
          'Back to dashboard',
        ),
      ),

      notice(
        'err',
        error instanceof Error
          ? `Your profile could not load: ${error.message}`
          : 'Your profile could not load.',
      ),
    );
  }
}

void start();
