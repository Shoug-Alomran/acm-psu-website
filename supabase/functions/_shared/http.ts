/**
 * Shared plumbing for every Edge Function.
 *
 * Two rules hold across all of them:
 *   1. The caller's own JWT is used for database access, so row level security
 *      still applies. The service-role key is never used to answer a browser
 *      request.
 *   2. Authorization is re-checked here as well as in the database. A function
 *      that forgets is a hole; a database that forgets is a breach.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
  'https://acm-psu.shoug-tech.com,http://localhost:8000,http://127.0.0.1:8000')
  .split(',')
  .map((o) => o.trim());

export function corsHeaders(origin: string | null): Record<string, string> {
  // Local static servers use arbitrary ports (and macOS often exposes the
  // IPv6 wildcard as [::]). Permit only HTTP loopback origins in addition to
  // the explicit production allow-list; never reflect an arbitrary website.
  let localDevelopment = false;
  if (origin) {
    try {
      const parsed = new URL(origin);
      localDevelopment = parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]', '[::]'].includes(parsed.hostname);
    } catch { /* invalid origins remain disallowed */ }
  }
  const allowed = origin && (ALLOWED_ORIGINS.includes(origin) || localDevelopment)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export function fail(message: string, status: number, origin: string | null): Response {
  return json({ error: message }, status, origin);
}

/** A Supabase client acting as the calling user, so RLS is in force. */
export function clientForRequest(req: Request): SupabaseClient | null {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;

  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
}

/**
 * Confirms the caller holds one of the given roles. Reads admin_assignments
 * through the user's own client, which its RLS policy permits for the caller's
 * own row, so no elevated key is needed to answer "who am I".
 */
export async function requireRole(
  supabase: SupabaseClient,
  roles: Array<'super_admin' | 'club_admin' | 'reviewer' | 'advisory_instructor'>,
): Promise<{ userId: string } | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('admin_assignments')
    .select('role')
    .eq('user_id', auth.user.id)
    .is('revoked_at', null);

  if (error || !data?.length) return null;
  const held = new Set(data.map((r) => r.role as string));
  // Roles are hierarchical: a super admin satisfies every check.
  if (held.has('super_admin')) return { userId: auth.user.id };
  if (roles.some((r) => held.has(r))) return { userId: auth.user.id };
  return null;
}
