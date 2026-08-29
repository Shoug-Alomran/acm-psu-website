/**
 * records-export — the private reporting layer.
 *
 * Supabase is the source of truth. This pushes snapshots OUT of it into a
 * single private workbook — "ACM PSU — Club Records" — as separate worksheets.
 * Nothing is ever read back from the sheet, so it cannot become a second,
 * diverging version of the truth.
 *
 * Four datasets, four worksheets in one workbook:
 *
 *   Members              | university reporting
 *   Event Participation  | university reporting
 *   Contributions        | university reporting
 *   Inquiries            | internal club record
 *
 * A NOTE ON SHARING. This is the club's live administrative workbook, and it
 * stays a single file on purpose. Google applies permissions to a whole
 * spreadsheet rather than tab by tab, and the Inquiries worksheet can carry
 * information submitted by members of the public — so when the university
 * needs records, export a separate reporting copy containing only the relevant
 * worksheets instead of sharing this one. The admin page says the same thing
 * where it can be acted on.
 *
 * Access: club admin only. Each dataset is a database function that returns
 * zero rows unless is_club_admin() is true, so even a mistake here cannot leak
 * a roster. Every export is recorded in university_exports and the audit log.
 *
 * POST { dataset: 'members'|'participation'|'contributions'|'inquiries'|'all',
 *        format:  'csv'|'xlsx'|'google_sheet' }
 *
 * 'all' is valid only with google_sheet — it refreshes every worksheet.
 */
import { clientForRequest, fail, json, corsHeaders, requireRole } from '../_shared/http.ts';
import { buildXlsx } from '../_shared/xlsx.ts';
import { pushToGoogleSheet, WORKBOOK_NAME } from '../_shared/google_sheets.ts';

const DATASETS = {
  members: {
    rpc: 'export_members',
    sheet: 'Members',
    columns: ['full_name', 'student_id', 'psu_email', 'major', 'academic_year',
              'position_title', 'membership_status', 'join_date'],
    headers: ['Name', 'Student ID', 'PSU Email', 'Major', 'Academic Year',
              'Position', 'Membership Status', 'Join Date'],
  },
  participation: {
    rpc: 'export_event_participation',
    sheet: 'Event Participation',
    columns: ['student_id', 'member_name', 'event_title', 'role_text', 'status', 'participated_on'],
    headers: ['Student ID', 'Member Name', 'Event', 'Position/Role', 'Participation Status', 'Date'],
  },
  contributions: {
    rpc: 'export_contributions',
    sheet: 'Contributions',
    columns: ['student_id', 'member_name', 'project_title', 'contribution',
              'contribution_type', 'occurred_on', 'verification'],
    headers: ['Student ID', 'Member', 'Event/Project', 'Contribution', 'Type',
              'Date', 'Verification Status'],
  },
  inquiries: {
    rpc: 'export_inquiries',
    sheet: 'Inquiries',
    columns: ['reference', 'submitted_on', 'sender_name', 'sender_email', 'category',
              'subject', 'message', 'status', 'assigned_to', 'responded_on', 'response_sent'],
    headers: ['Reference', 'Received', 'From', 'Email', 'Category', 'Subject',
              'Message', 'Status', 'Assigned To', 'Responded', 'Response Sent'],
  },
} as const;

type DatasetKey = keyof typeof DATASETS;

/** RFC 4180 quoting, plus the leading-character guard against formula injection. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // A cell starting with = + - @ is executed as a formula by Sheets and Excel.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);

  const supabase = clientForRequest(req);
  if (!supabase) return fail('Sign in required.', 401, origin);

  // Reviewers cannot export. Student data leaves the platform only for admins.
  const caller = await requireRole(supabase, ['club_admin']);
  if (!caller) return fail('Club admin access required.', 403, origin);

  let dataset: DatasetKey | 'all';
  let format: 'csv' | 'xlsx' | 'google_sheet';
  try {
    const body = await req.json();
    dataset = body.dataset;
    format = body.format ?? 'csv';
  } catch {
    return fail('Expected JSON body { dataset, format }.', 400, origin);
  }

  /** Runs one dataset's database function and shapes it into a sheet matrix. */
  async function collect(key: DatasetKey): Promise<{ matrix: unknown[][]; rows: number }> {
    const spec = DATASETS[key];
    const { data, error } = await supabase!.rpc(spec.rpc);
    if (error) throw new Error(`${spec.sheet}: ${error.message}`);
    const records = (data ?? []) as Array<Record<string, unknown>>;
    return {
      matrix: [
        [...spec.headers],
        ...records.map((row) => spec.columns.map((c) => row[c] ?? '')),
      ],
      rows: records.length,
    };
  }

  // record_university_export() writes the ledger row and the audit entry in one
  // transaction, so an export cannot happen without being accounted for.
  const logExport = (key: string, destination: string | null, rows: number) =>
    supabase.rpc('record_university_export', {
      dataset: key, format, row_count: rows, destination, reason: null,
    });

  /* ------------------------------------------------ refresh every worksheet */
  if (dataset === 'all') {
    if (format !== 'google_sheet') {
      return fail('Use a specific dataset for CSV and XLSX downloads.', 400, origin);
    }
    const results: Array<{ sheet: string; rows: number }> = [];
    let workbookUrl = '';
    try {
      for (const key of Object.keys(DATASETS) as DatasetKey[]) {
        const { matrix, rows } = await collect(key);
        workbookUrl = await pushToGoogleSheet(DATASETS[key].sheet, matrix);
        await logExport(key, workbookUrl, rows);
        results.push({ sheet: DATASETS[key].sheet, rows });
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Google Sheets export failed.', 503, origin);
    }
    return json({ ok: true, workbook: WORKBOOK_NAME, url: workbookUrl, sheets: results },
                200, origin);
  }

  const spec = DATASETS[dataset];
  if (!spec) return fail(`Unknown dataset "${dataset}".`, 400, origin);

  let collected;
  try {
    collected = await collect(dataset);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Export failed.', 500, origin);
  }
  const { matrix, rows } = collected;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `acm-psu-${dataset}-${stamp}`;

  if (format === 'google_sheet') {
    try {
      const url = await pushToGoogleSheet(spec.sheet, matrix);
      await logExport(dataset, url, rows);
      return json({ ok: true, rows, url, workbook: WORKBOOK_NAME, sheet: spec.sheet },
                  200, origin);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Google Sheets export failed.', 503, origin);
    }
  }

  await logExport(dataset, null, rows);

  if (format === 'xlsx') {
    const bytes = await buildXlsx(spec.sheet, matrix);
    return new Response(bytes, {
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      },
    });
  }

  const csv = matrix.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return new Response('﻿' + csv, {  // BOM so Excel reads Arabic correctly
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
});
