/* Auto-recover from stale-deploy chunk errors (web only).

   When a new build deploys while a tab is open, the page's hashed chunk
   filenames change on the server. A later lazy import() of an old-hash
   chunk then 404s and the server returns index.html, which the browser
   rejects with errors like:
     - "Failed to fetch dynamically imported module …"
     - "'text/html' is not a valid JavaScript MIME type."
     - "Importing a module script failed."
   This installs global handlers that catch that specific failure and
   reload ONCE to pick up the fresh index.html + correct chunk names, so
   neither the admin nor a landing-page visitor is left staring at the
   error during a deploy.

   A sessionStorage cooldown guards against a reload loop: if the failure
   is actually a genuinely missing asset (not a stale hash), a reload
   won't fix it, so we only try once per cooldown window and then let the
   error surface normally. */

const FLAG = 'kyc.chunkReloadAt';
const COOLDOWN_MS = 20000; // at most one auto-reload per 20s

const PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'is not a valid javascript mime type',
  'expected a javascript module script',
  'chunkloaderror',
];

function looksLikeStaleChunk(msg) {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  return PATTERNS.some((p) => m.includes(p));
}

function maybeReload(msg) {
  if (!looksLikeStaleChunk(msg)) return;
  let last = 0;
  try { last = Number(sessionStorage.getItem(FLAG)) || 0; } catch { /* private mode */ }
  if (Date.now() - last < COOLDOWN_MS) return; // already tried — don't loop on a real failure
  try { sessionStorage.setItem(FLAG, String(Date.now())); } catch { /* ignore */ }
  window.location.reload();
}

export function installChunkReloadGuard() {
  if (typeof window === 'undefined') return;
  // A failed dynamic import() rejects a promise — this is the common path
  // for React.lazy() and our on-demand imports.
  window.addEventListener('unhandledrejection', (e) => {
    maybeReload(e && e.reason && (e.reason.message || e.reason));
  });
  // Module/script load failures also surface as window error events.
  window.addEventListener('error', (e) => {
    maybeReload(e && (e.message || (e.error && e.error.message)));
  });
}
