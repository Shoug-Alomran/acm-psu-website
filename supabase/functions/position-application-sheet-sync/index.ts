/**
 * Refreshes the private Position Applications worksheet.
 *
 * Supabase remains the source of truth. This function exports the current
 * event-position application state to Google Sheets as a read-only snapshot.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
    corsHeaders,
    fail,
    json,
} from '../_shared/http.ts';

import {
    pushToGoogleSheet,
} from '../_shared/google_sheets.ts';

const HEADERS = [
  'Member Name',
  'Email',
  'Project',
  'Position',
  'Availability',
  'Note',
  'Application Status',
  'Admin Note',
  'Application Date',
];

type ApplicationRow = {
  user_id: string;
  event_position_id: string;
  availability: string | null;
  note: string | null;
  status: string | null;
  admin_note: string | null;
  created_at: string | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type PositionRow = {
  id: string;
  project_id: string | null;
  title: string | null;
};

type ProjectRow = {
  id: string;
  title: string | null;
};

Deno.serve(async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');

    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: corsHeaders(origin),
        });
    }

    if (req.method !== 'POST') {
        return fail('POST only', 405, origin);
    }

    const authorization =
        req.headers.get('Authorization');

    if (
        !authorization?.startsWith('Bearer ')
    ) {
        return fail(
            'Sign in required.',
            401,
            origin,
        );
    }

    const url =
        Deno.env.get('SUPABASE_URL')!;

    /*
     * Verify the caller is actually an authenticated Supabase user.
     */
    const caller = createClient(
        url,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
            global: {
                headers: {
                    Authorization: authorization,
                },
            },
            auth: {
                persistSession: false,
            },
        },
    );

    const {
        data: identity,
    } = await caller.auth.getUser();

    if (!identity.user) {
        return fail(
            'Sign in required.',
            401,
            origin,
        );
    }

    /*
     * Service-role access stays entirely inside the Edge Function.
     */
    const service = createClient(
        url,
        Deno.env.get(
            'SUPABASE_SERVICE_ROLE_KEY',
        )!,
        {
            auth: {
                persistSession: false,
            },
        },
    );

    /*
     * Respect the same global Google Sheets setting used by member-sheet-sync.
     */
    const {
        data: enabled,
    } = await service
        .from('app_settings')
        .select('value')
        .eq(
            'key',
            'google_sheets_enabled',
        )
        .maybeSingle();

    if (enabled?.value !== true) {
        return json(
            {
                ok: true,
                skipped: 'disabled',
            },
            200,
            origin,
        );
    }

    /*
     * Read applications.
     */
    const {
        data: applications,
        error: applicationError,
    } = await service
        .from(
            'event_position_applications',
        )
        .select(
            `
        id,
        user_id,
        event_position_id,
        availability,
        note,
        status,
        admin_note,
        created_at
      `,
        )
        .order(
            'created_at',
            {
                ascending: false,
            },
        );

    const applicationRows = (applications ?? []) as ApplicationRow[];

    if (applicationError) {
        return fail(
            'Could not collect position applications.',
            503,
            origin,
        );
    }

    /*
     * Fetch users separately so we do not depend on a particular PostgREST
     * relationship name.
     */
    const {
        data: users,
        error: userError,
    } = await service
        .from('app_users')
        .select(
            'id, full_name, email',
        );

    const userRows = (users ?? []) as UserRow[];

    if (userError) {
        return fail(
            'Could not collect member records.',
            503,
            origin,
        );
    }

    /*
     * Fetch event positions.
     */
    const {
        data: positions,
        error: positionError,
    } = await service
        .from('event_positions')
        .select(
            'id, project_id, title',
        );

    const positionRows = (positions ?? []) as PositionRow[];

    if (positionError) {
        return fail(
            'Could not collect event positions.',
            503,
            origin,
        );
    }

    /*
     * Fetch project titles.
     */
    const {
        data: projects,
        error: projectError,
    } = await service
        .from('projects')
        .select(
            'id, title',
        );

    const projectRows = (projects ?? []) as ProjectRow[];

    if (projectError) {
        return fail(
            'Could not collect projects.',
            503,
            origin,
        );
    }

    const userMap = new Map(userRows.map((user) => [user.id, user]));
    const positionMap = new Map(positionRows.map((position) => [position.id, position]));
    const projectMap = new Map(projectRows.map((project) => [project.id, project]));

    const matrix = [
      HEADERS,
      ...applicationRows.map((application) => {
        const member = userMap.get(application.user_id);
        const position = positionMap.get(application.event_position_id);
        const project = position?.project_id ? projectMap.get(position.project_id) : null;

        return [
          member?.full_name ?? '',
          member?.email ?? '',
          project?.title ?? '',
          position?.title ?? '',
          application.availability ?? '',
          application.note ?? '',
          application.status ?? '',
          application.admin_note ?? '',
          application.created_at ?? '',
        ];
      }),
    ];

    try {
        const sheetUrl =
            await pushToGoogleSheet(
                'Position Applications',
                matrix,
            );

        return json(
            {
                ok: true,
                rows:
                    applications?.length ?? 0,
                url: sheetUrl,
            },
            200,
            origin,
        );
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : 'Google Sheets sync failed.';

        console.error(
            '[position-application-sheet-sync] Google Sheets sync failed:',
            error,
        );

        return json(
            {
                ok: false,
                skipped: 'sheet_failed',
                error: message,
                rows: applicationRows.length,
            },
            200,
            origin,
        );
    }
});