/* Supabase client singleton.

   URL + anon key are read from Vite env vars — VITE_SUPABASE_URL and
   VITE_SUPABASE_ANON_KEY. Keep those in an untracked `.env.local` at
   the repo root (or pass on the command line before build). The anon
   key is safe to embed — row-level security enforces per-user access.

   Until both env vars are set, `client()` returns null and every
   caller no-ops. That matches the pattern in cloudsync.js so the app
   still ships fine on an offline-first fallback. */
import { createClient } from '@supabase/supabase-js';

const RAW_SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/* Sanitize the URL so a mistyped env var can't brick the whole flow.
   The client library expects the bare project URL, e.g.
     https://<ref>.supabase.co
   Common mistakes we auto-fix:
     - trailing slash: https://<ref>.supabase.co/
     - full REST path appended: https://<ref>.supabase.co/rest/v1/
     - any path at all: https://<ref>.supabase.co/anything
   If nothing looks recognizable but we have an anon key, derive the
   URL from the ref claim inside the anon key's JWT payload — that
   claim is authoritative and can't drift. */
function sanitizeSupabaseUrl(raw, anonKey) {
  const m = /^https:\/\/[a-z0-9-]+\.supabase\.co/i.exec(raw || '');
  if (m) return m[0];
  // Fallback: try to derive from the anon key JWT (both legacy JWT
  // format and modern sb_publishable_ format encode the project ref
  // differently — only the legacy JWT has it in payload).
  if (anonKey && anonKey.includes('.')) {
    try {
      const payload = anonKey.split('.')[1];
      const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
      const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(b64));
      if (claims?.ref) return `https://${claims.ref}.supabase.co`;
    } catch {}
  }
  return raw;
}

export const SUPABASE_URL = sanitizeSupabaseUrl(RAW_SUPABASE_URL, SUPABASE_ANON_KEY);

// Keep the sanitizer diagnostic — surface (only) when we had to
// self-correct a bad env var. Silent when the env var was already
// clean. Routed to console instead of the (now-removed) debug
// overlay so Safari Web Inspector still sees it if we need to
// diagnose again.
if (RAW_SUPABASE_URL && RAW_SUPABASE_URL !== SUPABASE_URL) {
  console.warn(`[supabase] URL sanitized: raw=…${RAW_SUPABASE_URL.slice(-24)} clean=…${SUPABASE_URL.slice(-24)}`);
}

let _client = null;
export function client() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Magic-link callbacks land in the URL fragment; picking up
        // the session from there is exactly what we want for /admin.
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
