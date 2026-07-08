/* Debug log — in-memory ring buffer for the on-device diagnostic
   overlay. Delete this module (and the DebugOverlay + all dlog()
   call sites) once the auth flow is verified working end-to-end.

   Ring buffer sits at 200 entries max. Every push notifies subscribers
   so DebugOverlay can rerender in real time. Also mirrors to console
   so we still get logs in Safari Web Inspector, and exposes the
   buffer on window.__debugLog for ad-hoc inspection. */

const MAX = 200;
const _entries = [];
const _listeners = new Set();

function _stamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function dlog(msg) {
  const entry = { t: _stamp(), msg: String(msg) };
  _entries.push(entry);
  if (_entries.length > MAX) _entries.splice(0, _entries.length - MAX);
  console.log('[dlog]', entry.t, entry.msg);
  for (const fn of _listeners) { try { fn(entry); } catch {} }
  return entry;
}

export function subscribeDlog(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getDlog() {
  return _entries.slice();
}

export function clearDlog() {
  _entries.length = 0;
  for (const fn of _listeners) { try { fn(null); } catch {} }
}

// Expose for ad-hoc console use + fallback tap-recorders that don't
// want to import the module.
if (typeof window !== 'undefined') {
  window.__debugLog = {
    push: (m) => dlog(m),
    get:  () => getDlog(),
    clear: () => clearDlog(),
  };
}
