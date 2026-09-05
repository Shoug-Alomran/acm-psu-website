import { h, render, type Child } from '../lib/dom.js';
import {
  shell, pageHeader, panel, dataTable, loading, notice, action, attentionRow, attentionLegend,
} from '../lib/ui.js';
import { requireAdvisor, isClubAdmin } from '../lib/session.js';
import {
  websiteClubRecords, importEventRegistrations, type WebsiteRecordsResult,
} from '../lib/admin.js';
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

/**
 * The records browser tree.
 *
 * The Edge Function says which folder each worksheet belongs in. This is the
 * fallback for one it does not place — an older deployment, or a worksheet
 * added upstream before this page learns about it. Filing it under Admin keeps
 * it reachable instead of dropping it from the tree.
 */
const FALLBACK_FOLDER = ['Admin'];

interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  sheets: Array<{ name: string; rows: number }>;
}

/**
 * Groups the worksheets into their folders, preserving the order the Edge
 * Function returned them in so the tree reads in the same sequence as the
 * workbook itself.
 */
function buildTree(result: WebsiteRecordsResult): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], sheets: [] };

  for (const [name, sheet] of Object.entries(result.sheets)) {
    let node = root;
    for (const segment of (sheet.folder?.length ? sheet.folder : FALLBACK_FOLDER)) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let child = node.folders.find((f) => f.name === segment);
      if (!child) { child = { name: segment, path, folders: [], sheets: [] }; node.folders.push(child); }
      node = child;
    }
    node.sheets.push({ name, rows: sheet.rows.length });
  }
  return root;
}

/** Every worksheet in a folder and everything below it. */
function folderSheets(folder: TreeFolder): string[] {
  return [...folder.sheets.map((s) => s.name), ...folder.folders.flatMap(folderSheets)];
}

/** The folder path leading to a worksheet, for the breadcrumb above the table. */
function pathTo(folder: TreeFolder, sheet: string): string[] | null {
  if (folder.sheets.some((s) => s.name === sheet)) return [];
  for (const child of folder.folders) {
    const below = pathTo(child, sheet);
    if (below) return [child.name, ...below];
  }
  return null;
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
  // Folders are open unless the viewer closed them. Their state lives here
  // rather than in the DOM because every keystroke re-renders the page.
  const collapsed = new Set<string>();
  let importNote: Child = null;

  // The whole workbook arrives in one call, so filtering, searching and paging
  // are local. Only REFRESH goes back to the server — otherwise every keystroke
  // would re-run nine table scans in the Edge Function.
  let cache: WebsiteRecordsResult | null = null;

  async function refresh(): Promise<void> {
    cache = null;
    importNote = null;
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

      const openSheet = (name: string) => async () => {
        active = name; query = ''; page = 0; await draw();
      };

      function leaf(sheet: { name: string; rows: number }): HTMLElement {
        return h('button', {
          type: 'button',
          class: `tree-sheet${sheet.name === active ? ' tree-sheet--active' : ''}`,
          'aria-current': sheet.name === active ? 'true' : undefined,
          onclick: openSheet(sheet.name),
        }, h('span', { class: 'tree-name' }, sheet.name),
          h('span', { class: 'tree-count' }, String(sheet.rows)));
      }

      function branch(folder: TreeFolder): HTMLElement {
        const contained = folderSheets(folder);
        // The folder holding the open worksheet is never drawn closed, so the
        // tree cannot hide what the table below it is showing.
        const holdsActive = contained.includes(active);
        const details = h('details', {
          class: 'tree-branch',
          open: holdsActive || !collapsed.has(folder.path),
        },
          h('summary', { class: 'tree-folder' },
            h('span', { class: 'tree-name' }, folder.name),
            h('span', { class: 'tree-count' }, String(contained.length))),
          h('div', { class: 'tree-children' },
            folder.folders.map(branch), folder.sheets.map(leaf)));

        details.addEventListener('toggle', () => {
          if (details.open) collapsed.delete(folder.path);
          else collapsed.add(folder.path);
        });
        return details;
      }

      const tree = buildTree(result);
      const browser = h('div', { class: 'record-tree', role: 'navigation', 'aria-label': 'Records' },
        tree.folders.map(branch), tree.sheets.map(leaf));

      const crumbs = h('p', { class: 'mono-meta dim-text' },
        [...(pathTo(tree, active) ?? []), active].join(' / ').toUpperCase());

      // Every registration worksheet, so the toolbar can offer them the same
      // way it offers semesters. An event is a thing you pick, not a folder
      // you have to find first.
      const registrations = tree.folders.find((f) => f.name === 'Events')
        ?.folders.find((f) => f.name === 'Registrations');
      const events = registrations?.sheets ?? [];

      const eventPicker = events.length ? h('select', {
        'aria-label': 'Choose an event',
      }, [
        h('option', { value: '', selected: !events.some((e) => e.name === active) },
          `Event registrations (${events.length})`),
        ...events.map((e) => h('option', { value: e.name, selected: e.name === active },
          `${e.name} (${e.rows})`)),
      ]) as HTMLSelectElement : null;
      eventPicker?.addEventListener('change', () => {
        if (eventPicker.value) void openSheet(eventPicker.value)();
      });

      const pager: Child = pages > 1 ? h('div', { class: 'button-row pager' },
        page > 0 ? action('PREVIOUS', async () => { page -= 1; await draw(); }) : null,
        h('span', { class: 'mono-meta dim-text' }, `PAGE ${page + 1} OF ${pages}`),
        page < pages - 1 ? action('NEXT', async () => { page += 1; await draw(); }) : null) : null;

      const scope = selected ? `${selected.code} · ${selected.label}` : 'ALL SEMESTERS';

      // Public event signups are collected in the club records workbook's own
      // jam26/ctf30 tabs by Apps Script, and copied here as they arrive.
      // Anything submitted before that copy existed is recovered on demand
      // rather than automatically: it reads Google, so it is a deliberate act
      // and not something a page load should do.
      const canImport = isClubAdmin(viewer) && !!registrations;
      const importControls: Child = canImport ? h('div', { class: 'button-row' },
        action('IMPORT FROM REGISTRATION TABS', async () => {
          importNote = loading('IMPORTING REGISTRATIONS');
          await draw();
          try {
            const outcome = await importEventRegistrations();
            const entries = Object.entries(outcome.imported);
            const added = entries.reduce((total, [, r]) => total + r.added, 0);
            const failed = entries.filter(([, r]) => r.error);
            importNote = notice(failed.length ? 'warn' : 'ok',
              `${added} registration${added === 1 ? '' : 's'} recovered from the sheet.` +
              (failed.length ? ` Could not read: ${failed.map(([label, r]) => `${label} (${r.error})`).join('; ')}` : ''));
            cache = null;
          } catch (error) {
            importNote = notice('err', `Import failed: ${message(error)}`);
          }
          await draw();
        }),
        h('span', { class: 'mono-meta dim-text' },
          'READS THE JAM26/CTF30 TABS AND ADDS ANYTHING MISSING HERE.')) : null;

      render(content,
        pageHeader('ADMIN / RECORDS BACKUP', 'Live club records', action('REFRESH', refresh, 'primary')),
        notice('warn', 'Private records: this page can contain student identifiers and internal notes. Access is limited to club admins and advisory instructors.'),
        notice('info', `Last loaded: ${archiveDateTime(result.generated_at)}.`),
        h('p', { class: 'mono-meta dim-text' },
          h('a', { href: 'https://psu.edu.sa/en/academiccalendar', target: '_blank', rel: 'noopener' })),
        result.registration_error
          ? notice('warn', `Event registrations could not be read: ${result.registration_error}. Everything else below is current.`)
          : null,
        // Every worksheet arriving without a folder means the records function
        // answering this page predates the tree — so it also predates event
        // registrations. Say that plainly instead of quietly filing everything
        // under Admin and leaving the missing events to be guessed at.
        !result.registration_error && names.every((name) => !result.sheets[name]!.folder)
          ? notice('info', 'This page is being answered by an older records function: worksheets arrive ' +
            'without folders and public event registrations are not included. Deploy ' +
            'club-records-sheet-sync (npm run functions:deploy) to enable both — see docs/SETUP.md step 5b.')
          : null,
        importNote,
        panel('Records', browser, importControls),
        panel(active || 'Records',
          crumbs,
          h('div', { class: 'browser-toolbar' }, search, eventPicker, semester, exportButton),
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
