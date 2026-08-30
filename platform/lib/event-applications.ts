import { requireClient, readableError } from './supabase.js';
import { bestEffortFunctionSync } from './api.js';

function rpcError(error: unknown): Error {
  return new Error(readableError(error));
}

export async function registerEventApplication(input: {
  eventPositionId: string;
  availability: string;
  note: string | null;
}): Promise<string> {
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
  if (typeof data !== 'string' || !data) {
    throw new Error('Supabase did not return the saved application record.');
  }

  await bestEffortFunctionSync('position-application-sheet-sync');
  return data;
}

export async function unregisterEventApplication(
  applicationId: string,
): Promise<void> {
  const client = requireClient();

  const { error } = await client.rpc(
    'unregister_event_position_application',
    {
      p_application_id: applicationId,
    },
  );

  if (error) throw rpcError(error);

  await bestEffortFunctionSync('position-application-sheet-sync');
}
