/**
 * The public inquiry form.
 *
 * Runs on a plain static page and talks to submit_inquiry(), a SECURITY
 * DEFINER function. A visitor needs no account: the point of a contact form is
 * that a stranger can use it.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import { isConfigured } from '../lib/supabase.js';
import { inquiryCategories, submitInquiry } from '../lib/inquiries.js';
import { setting } from '../lib/api.js';
import type { InquiryCategory } from '../lib/types.js';

const FALLBACK_CATEGORIES: InquiryCategory[] = [
  { slug: 'membership',   label: 'Membership',   label_ar: null, rank: 10,  is_active: true },
  { slug: 'events',       label: 'Events',       label_ar: null, rank: 20,  is_active: true },
  { slug: 'workshops',    label: 'Workshops',    label_ar: null, rank: 30,  is_active: true },
  { slug: 'competitions', label: 'Competitions', label_ar: null, rank: 40,  is_active: true },
  { slug: 'technical',    label: 'Technical',    label_ar: null, rank: 50,  is_active: true },
  { slug: 'partnerships', label: 'Partnerships', label_ar: null, rank: 60,  is_active: true },
  { slug: 'other',        label: 'Other',         label_ar: null, rank: 999, is_active: true },
];

function notice(kind: 'ok' | 'err' | 'info', ...body: Array<Node | string>): HTMLElement {
  return h('p', {
    class: `form-status form-status--${kind}`,
    role: kind === 'err' ? 'alert' : 'status',
  }, body);
}

function mountPublicAssistant(): void {
  if (document.querySelector('script[data-public-assistant-loader]')) return;
  const script = document.createElement('script');
  script.src = '/assets/js/public-assistant-loader.js?v=20260901-1';
  script.defer = true;
  script.dataset.publicAssistantLoader = 'true';
  document.body.appendChild(script);
}

async function start(): Promise<void> {
  mountPublicAssistant();

  const host = document.getElementById('inquiry-form');
  if (!host) return;

  const clubEmail = isConfigured
    ? await setting<string>('club_email', 'acm@psu.edu.sa').catch(() => 'acm@psu.edu.sa')
    : 'acm@psu.edu.sa';

  if (!isConfigured) {
    render(host, notice('info',
      'The contact form is not connected yet. Please email ',
      h('a', { class: 'accent-text', href: `mailto:${clubEmail}` }, clubEmail),
      ' in the meantime.'));
    return;
  }

  let categories: InquiryCategory[] = [];
  let lookupFailed = false;
  try {
    categories = await inquiryCategories();
  } catch (error) {
    lookupFailed = true;
    console.warn('[acm] inquiry categories unavailable:', error);
  }
  if (!categories.length) categories = FALLBACK_CATEGORIES;

  const status = h('div');
  const input = (
    id: string, name: string, label: string, hint: string,
    attrs: Record<string, unknown> = {},
  ) => h('div', { class: 'input-group' },
    h('div', { class: 'label-wrap' },
      h('label', { for: id }, label),
      h('span', { class: 'mono-meta field-hint' }, hint)),
    h('input', { id, name, ...attrs }));

  const form = h('form', { class: 'form-body', novalidate: true },
    input('inq-name', 'name', 'Full Name', 'STR_REQ',
      { type: 'text', required: true, maxlength: 120,
        placeholder: 'e.g. Faisal Al-Dosari', autocomplete: 'name' }),
    input('inq-email', 'email', 'Email', 'STR_REQ',
      { type: 'email', required: true, maxlength: 200,
        placeholder: 'you@example.com', autocomplete: 'email' }),
    h('div', { class: 'input-group' },
      h('div', { class: 'label-wrap' },
        h('label', { for: 'inq-category' }, 'Category'),
        h('span', { class: 'mono-meta field-hint' }, 'ENUM_REQ')),
      h('select', { id: 'inq-category', name: 'category', required: true },
        h('option', { value: '' }, 'Select a topic…'),
        categories.map((c) => h('option', { value: c.slug }, c.label)))),
    input('inq-subject', 'subject', 'Subject', 'STR_REQ',
      { type: 'text', required: true, minlength: 3, maxlength: 160,
        placeholder: 'What is this about?' }),
    h('div', { class: 'input-group input-group--wide' },
      h('div', { class: 'label-wrap' },
        h('label', { for: 'inq-message' }, 'Message'),
        h('span', { class: 'mono-meta field-hint' }, 'TEXT_REQ')),
      h('textarea', {
        id: 'inq-message', name: 'message', rows: 6, required: true,
        minlength: 10, maxlength: 4000,
        placeholder: 'Tell us what you would like to know.',
      })),
    h('div', { class: 'form-trap', 'aria-hidden': 'true' },
      h('label', { for: 'inq-website' }, 'Website'),
      h('input', { id: 'inq-website', name: 'website', type: 'text',
                   tabindex: '-1', autocomplete: 'off' })),
    status,
    h('button', { type: 'submit', class: 'btn-submit' }, 'Send message'),
  ) as HTMLFormElement;

  if (lookupFailed) {
    status.replaceChildren(h('p', { class: 'mono-meta dim-text' },
      'TOPIC LIST UNAVAILABLE — USING DEFAULTS. YOUR MESSAGE WILL STILL REACH US.'));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = formValues(form);
    const button = form.querySelector('button')!;
    button.disabled = true;
    status.replaceChildren(notice('info', 'SENDING…'));

    try {
      const reference = await submitInquiry({
        name: textOf(values, 'name'),
        email: textOf(values, 'email'),
        category: textOf(values, 'category'),
        subject: textOf(values, 'subject'),
        message: textOf(values, 'message'),
        website: textOf(values, 'website'),
      });

      render(host,
        notice('ok', 'MESSAGE RECEIVED.'),
        h('p', { style: { marginTop: '1rem' } },
          'Thank you — your message has reached the ACM committee. ',
          'Your reference is ', h('strong', { class: 'accent-text' }, reference),
          '. Quote it if you follow up.'),
        h('p', { class: 'mono-meta dim-text', style: { marginTop: '1rem' } },
          'REPLIES COME FROM ' + clubEmail.toUpperCase() + '. ' +
          'PLEASE ALLOW A FEW DAYS — THE COMMITTEE ARE STUDENTS TOO.'));
      host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      button.disabled = false;
      const message = error instanceof Error ? error.message : String(error);
      status.replaceChildren(notice('err', message.replace(/^.*?:\s*/, '')));
    }
  });

  render(host, form);
}

void start().catch((error) => {
  console.error('[acm] contact form failed to start:', error);
  const host = document.getElementById('inquiry-form');
  if (host) {
    render(host,
      notice('err', 'The form could not be loaded.'),
      h('p', { style: { marginTop: '1rem' } },
        'Please email ',
        h('a', { class: 'accent-text', href: 'mailto:acm@psu.edu.sa' }, 'acm@psu.edu.sa'),
        ' and we will pick it up from there.'));
  }
});
