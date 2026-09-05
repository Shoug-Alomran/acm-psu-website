import { h, render, type Child } from '../lib/dom.js';
import {
  shell, pageHeader, panel, dataTable, loading, notice, action, attentionRow, attentionLegend,
} from '../lib/ui.js';
import { requireAdvisor } from '../lib/session.js';
import { websiteClubRecords, type WebsiteRecordsResult } from '../lib/admin.js';
import { archiveDateTime } from '../lib/format.js';
import { newestFirst, type Term } from '../lib/terms.js';
import { csvCell, termsResolver, rowTintResolver, type RowTint } from '../lib/record-terms.js';

const PAGE_SIZE = 50;

/**
 * Row colours reuse the portal's existing attention vocabulary rather than
 * introducing a private palette: an applicant nobody has contacted yet needs
 * action ('now'), one already marked for interview is in progress ('review').
 */
const TINT_LEVEL: Record<RowTint, 'now' | 'review'> = { new: 'now', interview: 'review' };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function downloadCsv(filename: string, matrix: unknown[][]): void {
  const csv = matrix.map((row) => row.map(csvCell).join(',')).join('\r\n');
  // BOM so Excel reads Arabic names correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function start(): Promise<void> {
  const viewer = await requireAdvisor();
  const content = shell(viewer, 'admin', 'Records backup');
  let active = '';
  let term = '';
  let query = '';
  let page = 0;

  // The whole workbook arrives in one call, so filtering, searching and paging
  // are local. Only REFRESH goes back to the server — otherwise every keystroke
  // would re-run nine table scans in the Edge Function.
  let cache: WebsiteRecordsResult | null = null;

  async function refresh(): Promise<void> {
    cache = null;
    await draw();
  }

  async function draw(): Promise<void> {
    try {
      if (!cache) {
        render(content, loading('LOADING LIVE RECORDS'));
        cache = await websiteClubRecords();
      }
      const result = cache;
      const names = Object.keys(result.sheets);
      if (!active || !result.sheets[active]) active = names[0] ?? '';
      const sheet = result.sheets[active];
      const rows = sheet?.rows ?? [];
      const columns = sheet?.columns ?? [];

      const resolve = termsResolver(columns, active);
      const tintOf = rowTintResolver(columns, active);

      // Only offer terms this worksheet actually has rows in, so the list
      // never promises a semester that turns out to be empty.
      const present = new Map<string, { term: Term; count: number }>();
      if (resolve) {
        for (const row of rows) {
          for (const t of resolve(row)) {
            const seen = present.get(t.code);
            if (seen) seen.count += 1;
            else present.set(t.code, { term: t, count: 1 });
          }
        }
      }
      const terms = newestFirst([...present.values()].map((e) => e.term));
      // A term selected on another worksheet may not exist here.
      if (term && !present.has(term)) term = '';

      const inTerm = !term || !resolve
        ? rows
        : rows.filter((row) => resolve(row).some((t) => t.code === term));

      const needle = query.trim().toLocaleLowerCase();
      const filtered = inTerm.filter((row) =>
        !needle || row.some((cell) => display(cell).toLocaleLowerCase().includes(needle)));
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      page = Math.max(0, Math.min(page, pages - 1));
      const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

      const search = h('input', {
        type: 'search', value: query, placeholder: `Search ${active || 'records'}…`,
        'aria-label': 'Search current records page',
      }) as HTMLInputElement;
      search.addEventListener('change', () => { query = search.value; page = 0; void draw(); });

      const semester = h('select', {
        'aria-label': 'Filter by semester', disabled: !resolve,
      }, [
        h('option', { value: '', selected: term === '' },
          resolve ? 'All semesters' : 'Not dated by semester'),
        ...terms.map((t) => h('option', { value: t.code, selected: t.code === term },
          `${t.code} — ${t.label} (${present.get(t.code)!.count})`)),
      ]) as HTMLSelectElement;
      semester.addEventListener('change', () => { term = semester.value; page = 0; void draw(); });

      const selected = term ? present.get(term)!.term : null;
      const exportName = `acm-psu-${slug(active)}-${term ? `${term}-${slug(selected!.label)}` : 'all'}.csv`;
      const exportButton = action(`EXPORT CSV (${filtered.length})`, async () => {
        downloadCsv(exportName, [columns, ...filtered]);
      }, filtered.length ? 'primary' : undefined);

      const tabs = h('div', { class: 'button-row', role: 'navigation', 'aria-label': 'Workbook pages' },
        names.map((name) => action(`${name} (${result.sheets[name]!.rows.length})`, async () => {
          active = name; query = ''; page = 0; await draw();
        }, name === active ? 'primary' : undefined)));

      const pager: Child = pages > 1 ? h('div', { class: 'button-row pager' },
        page > 0 ? action('PREVIOUS', async () => { page -= 1; await draw(); }) : null,
        h('span', { class: 'mono-meta dim-text' }, `PAGE ${page + 1} OF ${pages}`),
        page < pages - 1 ? action('NEXT', async () => { page += 1; await draw(); }) : null) : null;

      const scope = selected ? `${selected.code} · ${selected.label}` : 'ALL SEMESTERS';

      render(content,
        pageHeader('ADMIN / RECORDS BACKUP', 'Live club records', action('REFRESH', refresh, 'primary')),
        notice('warn', 'Private records: this page can contain student identifiers and internal notes. Access is limited to club admins and advisory instructors.'),
        notice('info', `Last loaded: ${archiveDateTime(result.generated_at)}.`),
        h('p', { class: 'mono-meta dim-text' },
          h('a', { href: 'https://psu.edu.sa/en/academiccalendar', target: '_blank', rel: 'noopener' })),
        panel('Workbook pages', tabs),
        panel(active || 'Records',
          h('div', { class: 'browser-toolbar' }, search, semester, exportButton),
          resolve ? null : h('p', { class: 'mono-meta dim-text' },
            'THIS WORKSHEET HAS NO DATE COLUMN, SO IT IS NOT FILTERED BY SEMESTER.'),
          tintOf ? attentionLegend(
            ['now', 'New — nobody has contacted this applicant yet'],
            ['review', 'Marked for interview']) : null,
          dataTable(columns.map(display), visible.map((row) => row.map(display)), {
            empty: needle || term ? 'No rows match these filters.' : 'This records page is empty.',
            rowClass: (index) => {
              const tint = tintOf?.(visible[index]!);
              return tint ? attentionRow(TINT_LEVEL[tint]) : null;
            },
          }),
          pager,
          h('p', { class: 'mono-meta dim-text' },
            `${scope} · ${filtered.length} MATCHING ROWS · ${rows.length} TOTAL`)),
      );
    } catch (error) {
      console.error('Website records backup failed:', error);
      cache = null;
      render(content, pageHeader('ADMIN / RECORDS BACKUP', 'Records unavailable'),
        notice('err', `The live records could not be loaded: ${message(error)}`),
        action('TRY AGAIN', refresh, 'primary'));
    }
  }

  await draw();
}

void start();
