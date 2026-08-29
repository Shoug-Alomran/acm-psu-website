/**
 * The Supabase client, and the guard that keeps the site usable before anyone
 * has configured one.
 *
 * The anon key is a public value by design: every table in this schema has row
 * level security, so the key on its own opens nothing. Privileged keys — the
 * service role key, the Cloudflare token, Google's private key — live in Edge
 * Function secrets and never appear in a bundle.
 */
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

interface RuntimeEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
}

declare global {
  interface Window { ACM_ENV?: RuntimeEnv }
}

const env: RuntimeEnv = window.ACM_ENV ?? { supabaseUrl: '', supabaseAnonKey: '', siteUrl: '' };

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

export const siteUrl = env.siteUrl || window.location.origin;

/**
 * Null when the platform has not been configured yet, so a page can show a
 * setup notice instead of throwing. Use requireClient() where a client is
 * genuinely mandatory.
 */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'acm-psu-auth',
      },
    })
  : null;

export function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'The ACM platform is not connected to a database yet. ' +
      'See docs/SETUP.md step 1.',
    );
  }
  return supabase;
}

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Turns a PostgREST error into something a student can act on. */
export function readableError(error: unknown): string {
  if (!error) return 'Something went wrong.';
  const message = typeof error === 'string'
    ? error
    : (error as { message?: string }).message ?? String(error);

  if (/row-level security|violates row-level/i.test(message)) {
    return 'You do not have permission to do that.';
  }
  if (/duplicate key|already exists/i.test(message)) {
    return 'That already exists — check whether you have already submitted it.';
  }
  if (/JWT expired|invalid claim/i.test(message)) {
    return 'Your session expired. Please sign in again.';
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return 'Could not reach the server. Check your connection and retry.';
  }
  return message;
}

/**
 * Calls an Edge Function with the caller's session attached.
 * Returns the raw Response so callers can stream file downloads.
 */
export async function callFunction(name: string, body: unknown): Promise<Response> {
  const client = requireClient();
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Sign in required.');

  return fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: env.supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
