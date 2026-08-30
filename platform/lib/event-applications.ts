/**
 * Registering for and withdrawing from an event position.
 *
 * Both go through RPCs. The browser never writes these tables directly and
 * never tells the database who it is: identity inside the function comes from
 * auth.uid(). The functions return a machine-readable outcome so the portal
 * can render a state rather than a database error message — "you already
 * requested this" is a state, not a failure.
 */

import { requireClient, readableError } from './supabase.js';
import { bestEffortFunctionSync } from './api.js';

/** Outcomes register_event_position_application() can report. */
export type RegisterOutcome =
  | 'created'    // a new pending request was stored
  | 'reopened'   // a cancelled or rejected request was reused
  | 'pending'    // a pending request already existed
  | 'approved'   // the member already holds this position
  | 'closed'     // the opening is no longer accepting requests
  | 'full';      // every opening is taken

export interface RegisterResult {
  outcome: RegisterOutcome;
  status: string;
  applicationId: string | null;
}

/** Outcomes unregister_event_position_application() can report. */
export type UnregisterOutcome =
  | 'cancelled'
  | 'already_closed'
  | 'window_closed';

export interface UnregisterResult {
  outcome: UnregisterOutcome;
  status: string;
}

function rpcError(error: unknown): Error {
  return new Error(readableError(error));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
}

export async function registerEventApplication(input: {
  eventPositionId: string;
  availability: string;
  note: string | null;
}): Promise<RegisterResult> {
  const client = requireClient();

  const { data, error } = await client.rpc(
    'register_event_position_application',
    {
      p_event_position_id: input.eventPositionId,
      p_availability: input.availability,
      p_note: input.note,
    },
  );

  if (error) throw rpcError(error);

  const payload = asRecord(data);
  const outcome = payload.outcome;

  if (typeof outcome !== 'string') {
    throw new Error('Supabase did not return the saved application record.');
  }

  /*
   * Google Sheets is a snapshot, not the record. Only refresh it when
   * something actually changed, and never let it undo a committed write.
   */
  if (outcome === 'created' || outcome === 'reopened' || outcome === 'approved') {
    await bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['position_applications'] });
  }

  return {
    outcome: outcome as RegisterOutcome,
    status: typeof payload.status === 'string' ? payload.status : 'pending',
    applicationId:
      typeof payload.application_id === 'string' ? payload.application_id : null,
  };
}

export async function unregisterEventApplication(
  applicationId: string,
): Promise<UnregisterResult> {
  const client = requireClient();

  const { data, error } = await client.rpc(
    'unregister_event_position_application',
    {
      p_application_id: applicationId,
    },
  );

  if (error) throw rpcError(error);

  const payload = asRecord(data);
  const outcome = typeof payload.outcome === 'string'
    ? payload.outcome as UnregisterOutcome
    : 'already_closed';

  if (outcome === 'cancelled') {
    await bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['position_applications'] });
  }

  return {
    outcome,
    status: typeof payload.status === 'string' ? payload.status : 'cancelled',
  };
}
