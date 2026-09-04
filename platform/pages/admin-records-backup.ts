import { h, render, type Child } from '../lib/dom.js';
import { shell, pageHeader, panel, dataTable, loading, notice, action } from '../lib/ui.js';
import { requireAdvisor } from '../lib/session.js';
import { websiteClubRecords } from '../lib/admin.js';
import { archiveDateTime } from '../lib/format.js';

const PAGE_SIZE = 50;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function start(): Promise<void> {
  const viewer = await requireAdvisor();
  const content = shell(viewer, 'admin', 'Records backup');
  let active = '';
  let query = '';
  let page = 0;

  async function draw(): Promise<void> {
    render(content, loading('LOADING LIVE RECORDS'));
    try {
      const result = await websiteClubRecords();
      const names = Object.keys(result.sheets);
      if (!active || !result.sheets[active]) active = names[0] ?? '';
      const sheet = result.sheets[active];
      const needle = query.trim().toLocaleLowerCase();
      const filtered = (sheet?.rows ?? []).filter((row) =>
        !needle || row.some((cell) => display(cell).toLocaleLowerCase().includes(needle)));
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      page = Math.max(0, Math.min(page, pages - 1));
      const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

      const search = h('input', {
        type: 'search', value: query, placeholder: `Search ${active || 'records'}…`,
        'aria-label': 'Search current records page',
      }) as HTMLInputElement;
      search.addEventListener('change', () => { query = search.value; page = 0; void draw(); });

      const tabs = h('div', { class: 'button-row', role: 'navigation', 'aria-label': 'Workbook pages' },
        names.map((name) => action(`${name} (${result.sheets[name]!.rows.length})`, async () => {
          active = name; query = ''; page = 0; await draw();
        }, name === active ? 'primary' : undefined)));

      const pager: Child = pages > 1 ? h('div', { class: 'button-row pager' },
        page > 0 ? action('PREVIOUS', async () => { page -= 1; await draw(); }) : null,
        h('span', { class: 'mono-meta dim-text' }, `PAGE ${page + 1} OF ${pages}`),
        page < pages - 1 ? action('NEXT', async () => { page += 1; await draw(); }) : null) : null;

      render(content,
        pageHeader('ADMIN / RECORDS BACKUP', 'Live club records', action('REFRESH', draw, 'primary')),
        notice('warn', 'Private records: this page can contain student identifiers and internal notes. Access is limited to club admins and advisory instructors.'),
        notice('info', `This is the Google workbook fallback. It reads live from Supabase and does not depend on Google Sheets. Loaded ${archiveDateTime(result.generated_at)}.`),
        panel('Workbook pages', tabs),
        panel(active || 'Records',
          h('div', { class: 'form-field', style: { maxWidth: '32rem', marginBottom: '1rem' } }, search),
          dataTable((sheet?.columns ?? []).map(display), visible.map((row) => row.map(display)), {
            empty: needle ? 'No rows match this search.' : 'This records page is empty.',
          }),
          pager,
          h('p', { class: 'mono-meta dim-text' }, `${filtered.length} MATCHING ROWS · ${sheet?.rows.length ?? 0} TOTAL`)),
      );
    } catch (error) {
      console.error('Website records backup failed:', error);
      render(content, pageHeader('ADMIN / RECORDS BACKUP', 'Records unavailable'),
        notice('err', `The live records could not be loaded: ${message(error)}`),
        action('TRY AGAIN', draw, 'primary'));
    }
  }

  await draw();
}

void start();
