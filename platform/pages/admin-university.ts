/**
 * University records — the private reporting layer.
 *
 * The university asks for Google Sheets. The platform stays the operational
 * system; a sheet is a snapshot pushed out of it, never read back in, so the
 * two cannot diverge into two versions of the truth.
 *
 * Members never see this page, and it is not merely hidden from them: the
 * three export functions in the database return zero rows unless the caller is
 * a club admin, and the Edge Function checks the role again before it runs.
 *
 * The columns are exactly what the university asked for. Bio, GitHub, LinkedIn,
 * portfolio and privacy preferences are deliberately not exported.
 */
import { h, render } from '../lib/dom.js';
import {
  shell, pageHeader, panel, dataTable, loading, notice, toast, action, emptyState,
} from '../lib/ui.js';
import { requireAdmin } from '../lib/session.js';
import { runExport, exportHistory, type Dataset } from '../lib/admin.js';
import { setting } from '../lib/api.js';
import { archiveDateTime } from '../lib/format.js';

const DATASETS: Array<{ key: Dataset; title: string; columns: string[]; note: string }> = [
  {
    key: 'members',
    title: 'Members',
    columns: ['Name', 'Student ID', 'PSU Email', 'Major', 'Academic Year',
              'Position', 'Membership Status', 'Join Date'],
    note: 'Every member and alumnus. Applicants are excluded.',
  },
  {
    key: 'participation',
    title: 'Event participation',
    columns: ['Student ID', 'Member Name', 'Event', 'Position/Role',
              'Participation Status', 'Date'],
    note: 'Who took part in what, and in which role.',
  },
  {
    key: 'contributions',
    title: 'Contributions',
    columns: ['Student ID', 'Member', 'Event/Project', 'Contribution', 'Type',
              'Date', 'Verification Status'],
    note: 'Submitted work with its verification state.',
  },
];

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'University records');
  render(content, loading());

  const sheetsEnabled = await setting<boolean>('google_sheets_enabled', false);

  async function draw(): Promise<void> {
    const history = await exportHistory();

    render(content,
      pageHeader('ADMIN / UNIVERSITY RECORDS', 'University records'),

      notice('warn',
        'This page contains student identifiers. It is restricted to club admins — ' +
        'reviewers and members cannot reach it, and the database returns no rows to them ' +
        'even if they try. Share generated files only with the university.'),

      DATASETS.map((dataset) => panel(dataset.title,
        h('p', dataset.note),
        h('p', { class: 'mono-meta dim-text' }, 'COLUMNS: ' + dataset.columns.join(' · ')),
        h('div', { class: 'button-row' },
          action('Download CSV', async () => {
            await runExport(dataset.key, 'csv');
            toast('CSV downloaded.');
            await draw();
          }, 'primary'),
          action('Download XLSX', async () => {
            await runExport(dataset.key, 'xlsx');
            toast('XLSX downloaded.');
            await draw();
          }),
          sheetsEnabled
            ? action('Update Google Sheet', async () => {
                const result = await runExport(dataset.key, 'google_sheet');
                toast(`Sheet updated with ${result.rows ?? 0} rows.`);
                if (result.url) window.open(result.url, '_blank', 'noopener');
                await draw();
              })
            : h('span', { class: 'mono-meta dim-text' },
                'GOOGLE SHEET EXPORT NOT CONFIGURED')))),

      sheetsEnabled ? null : notice('info',
        'CSV and XLSX work now and are enough to hand the university a spreadsheet. ' +
        'Pushing directly into a private Google Sheet needs a service account — ' +
        'see docs/SETUP.md step 5, then switch it on in Administration → Settings.'),

      panel('Export history',
        history.length
          ? dataTable(['When', 'Dataset', 'Format', 'Rows', 'By', 'Destination'],
              (history as Array<Record<string, unknown>>).map((row) => [
                h('span', { class: 'mono-meta' }, archiveDateTime(String(row.created_at))),
                h('span', { class: 'mono-meta' }, String(row.dataset).toUpperCase()),
                h('span', { class: 'mono-meta' }, String(row.format).toUpperCase()),
                h('span', { class: 'mono-meta' }, String(row.row_count)),
                (row.admin as { full_name: string } | null)?.full_name ?? '—',
                row.destination
                  ? h('a', { href: String(row.destination), rel: 'noopener', target: '_blank' },
                      'Open sheet')
                  : '—',
              ]))
          : emptyState('No exports generated yet.'),
        h('p', { class: 'mono-meta dim-text' },
          'Every export is recorded, so a future committee can account for where ' +
          'student data went.')),
    );
  }

  await draw();
}

void start();
