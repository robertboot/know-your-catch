/* Supabase client singleton.

   URL + anon key are read from Vite env vars — VITE_SUPABASE_URL and
   VITE_SUPABASE_ANON_KEY. Keep those in an untracked `.env.local` at
   the repo root (or pass on the command line before build). The anon
   key is safe to embed — row-level security enforces per-user access.

   Until both env vars are set, `client()` returns null and every
   caller no-ops. That matches the pattern in cloudsync.js so the app
   still ships fine on an offline-first fallback. */
import { createClient } from '@supabase/supabase-js';
import { dlog } from './debug-log.js';

export const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Log at module load so the debug overlay picks up whether the env
// vars actually reached the bundle. Show only the URL suffix — enough
// to distinguish projects, safe to show. Anon key is yes/no.
dlog(`[supabase] url=${SUPABASE_URL ? '…' + SUPABASE_URL.slice(-16) : 'MISSING'} anonKey=${SUPABASE_ANON_KEY ? 'yes' : 'MISSING'}`);

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
    dlog('[supabase] client created');
  }
  return _client;
}

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
