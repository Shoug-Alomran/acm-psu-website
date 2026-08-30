/**
 * University records — the private reporting layer.
 *
 * The university asks for Google Sheets. The platform stays the operational
 * system; a sheet is a snapshot pushed out of it, never read back in, so the
 * two cannot diverge into two versions of the truth.
 *
 * Members never see this page, and it is not merely hidden from them: the
 * export functions in the database return zero rows unless the caller is a
 * club admin, and the Edge Function checks the role again before it runs.
 *
 * The columns are exactly what the university asked for. Bio, GitHub,
 * LinkedIn, portfolio and privacy preferences are deliberately not exported.
 */

import {
  h,
  render,
} from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  dataTable,
  loading,
  notice,
  toast,
  action,
  emptyState,
} from '../lib/ui.js';

import {
  requireAdmin,
  isSuperAdmin,
} from '../lib/session.js';

import {
  runExport,
  exportHistory,
  syncClubRecordsWorkbook,
  type Dataset,
} from '../lib/admin.js';

import {
  setting,
} from '../lib/api.js';

import {
  archiveDateTime,
} from '../lib/format.js';

interface ExportHistoryRow {
  created_at: string;
  dataset: string;
  format: string;
  row_count: number | null;
  destination: string | null;
  admin: {
    full_name: string;
  } | null;
}

const DATASETS: Array<{
  key: Dataset;
  title: string;
  columns: string[];
  note: string;
}> = [
    {
      key: 'members',

      title: 'Members',

      columns: [
        'Name',
        'University Role',
        'Student ID',
        'PSU Email',
        'Major',
        'Academic Year',
        'Position',
        'Membership Status',
        'Join Date',
      ],

      note:
        'Every live account, including instructors and other university affiliates.',
    },

    {
      key: 'participation',

      title:
        'Event participation',

      columns: [
        'Student ID',
        'Member Name',
        'Event',
        'Position/Role',
        'Participation Status',
        'Date',
      ],

      note:
        'Who took part in what, and in which role.',
    },

    {
      key: 'contributions',

      title:
        'Contributions',

      columns: [
        'Student ID',
        'Member',
        'Event/Project',
        'Contribution',
        'Type',
        'Date',
        'Verification Status',
      ],

      note:
        'Submitted work with its verification state.',
    },
  ];

function errorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (
      error as {
        message?: unknown;
      }
    ).message === 'string'
  ) {
    return (
      error as {
        message: string;
      }
    ).message;
  }

  return 'An unknown error occurred.';
}

async function start(): Promise<void> {
  const viewer =
    await requireAdmin(
      'club_admin',
    );

  const content =
    shell(
      viewer,
      'admin',
      'University records',
    );

  render(
    content,
    loading(),
  );

  let lastSync: Awaited<ReturnType<typeof syncClubRecordsWorkbook>> | null = null;

  let sheetsEnabled =
    false;

  /*
   * Google Sheets is optional.
   *
   * If the setting cannot be read, CSV/XLSX exports should still remain
   * available rather than taking down the entire page.
   */
  try {
    sheetsEnabled =
      await setting<boolean>(
        'google_sheets_enabled',
        false,
      );
  } catch (error) {
    console.error(
      'Could not load Google Sheets export setting:',
      error,
    );

    sheetsEnabled =
      false;
  }

  async function runDatasetExport(
    dataset: Dataset,
    format:
      'csv' |
      'xlsx',
  ): Promise<void> {
    try {
      const result =
        await runExport(
          dataset,
          format,
        );

      if (
        format ===
        'xlsx'
      ) {
        toast(
          'XLSX downloaded.',
        );
      } else {
        toast(
          'CSV downloaded.',
        );
      }

      await draw();
    } catch (error) {
      console.error(
        `Could not export ${dataset} as ${format}:`,
        error,
      );

      const label = format.toUpperCase();

      toast(
        `Could not generate ${label}: ${errorMessage(error)}`,
        'err',
      );
    }
  }

  async function draw(): Promise<void> {
    render(
      content,
      loading(),
    );

    try {
      const rawHistory =
        await exportHistory();

      const history =
        rawHistory as unknown as ExportHistoryRow[];

      render(
        content,

        pageHeader(
          'ADMIN / UNIVERSITY RECORDS',
          'University records',
        ),

        notice(
          'warn',
          'This page contains student identifiers. It is restricted to club admins — ' +
          'reviewers and members cannot reach it, and the database returns no rows to them ' +
          'even if they try. Share generated files only with the university.',
        ),

        panel(
          'Private Google workbook',
          h('p', 'Update Google Sheet exports the current Supabase club records to every supported tab in the configured private “ACM PSU — Club Records” workbook. Supabase remains the source of truth.'),
          isSuperAdmin(viewer)
            ? action('Update Google Sheet', async () => {
                if (!window.confirm('This exports names, PSU emails, student IDs where applicable, roles, memberships, and operational club records to the configured private Google workbook. Continue?')) return;
                try {
                  toast('Updating every Google Sheet tab…');
                  lastSync = await syncClubRecordsWorkbook();
                  const failures = Object.values(lastSync.sheets).filter((sheet) => sheet.status === 'failed').length;
                  toast(failures ? `${failures} worksheet(s) failed. See the results below.` : 'Every workbook tab updated.', failures ? 'err' : 'ok');
                  await draw();
                } catch (error) {
                  toast(`Could not update workbook: ${errorMessage(error)}`, 'err');
                }
              }, 'primary')
            : notice('info', 'Only a super admin can refresh the complete private workbook.'),
          lastSync ? dataTable(['Worksheet', 'Rows', 'Result'],
            Object.entries(lastSync.sheets).map(([name, result]) => [name, String(result.rows),
              result.status === 'updated' ? 'Updated' : `Failed: ${result.error ?? 'Unknown error'}`])) : null,
        ),

        DATASETS.map(
          (
            dataset,
          ) =>
            panel(
              dataset.title,

              h(
                'p',
                dataset.note,
              ),

              h(
                'p',
                {
                  class:
                    'mono-meta dim-text',
                },
                'COLUMNS: ' +
                dataset.columns.join(
                  ' · ',
                ),
              ),

              h(
                'div',
                {
                  class:
                    'button-row',
                },

                action(
                  'Download CSV',

                  async () => {
                    await runDatasetExport(
                      dataset.key,
                      'csv',
                    );
                  },

                  'primary',
                ),

                action(
                  'Download XLSX',

                  async () => {
                    await runDatasetExport(
                      dataset.key,
                      'xlsx',
                    );
                  },
                ),

                null,
              ),
            ),
        ),

        sheetsEnabled
          ? null
          : notice(
            'info',
            'CSV and XLSX work without Google Sheets. Pushing directly into the private ' +
            'university workbook requires the service account configuration and the ' +
            'google_sheets_enabled setting.',
          ),

        panel(
          'Export history',

          history.length
            ? dataTable(
              [
                'When',
                'Dataset',
                'Format',
                'Rows',
                'By',
                'Destination',
              ],

              history.map(
                (
                  row,
                ) => [
                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      archiveDateTime(
                        row.created_at,
                      ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      row.dataset
                        .toUpperCase(),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      row.format
                        .toUpperCase(),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      row.row_count ===
                        null
                        ? '—'
                        : String(
                          row.row_count,
                        ),
                    ),

                    row.admin
                      ?.full_name ??
                    '—',

                    row.destination
                      ? h(
                        'a',
                        {
                          href:
                            row.destination,
                          rel:
                            'noopener',
                          target:
                            '_blank',
                        },
                        'Open sheet',
                      )
                      : '—',
                  ],
              ),
            )
            : emptyState(
              'No exports generated yet.',
            ),

          h(
            'p',
            {
              class:
                'mono-meta dim-text',
            },
            'Every export is recorded, so a future committee can account for where ' +
            'student data went.',
          ),
        ),
      );
    } catch (error) {
      console.error(
        'University records page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / UNIVERSITY RECORDS',
          'University records unavailable',
        ),

        notice(
          'err',
          `The university records page could not load: ${errorMessage(error)}`,
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          h(
            'button',
            {
              type:
                'button',
              class:
                'btn-ghost',

              onclick:
                () =>
                  void draw(),
            },
            'TRY AGAIN',
          ),
        ),
      );
    }
  }

  await draw();
}

void start();
