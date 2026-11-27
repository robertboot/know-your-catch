/* Where a visitor came from, kept until they sign up.
 *
 * Outreach is about to go out through several doors at once - a podcast,
 * charter captains' cards, the newsletter, shared catches - and without
 * this there is no way to tell which door anyone walked through. Each
 * link carries ?ref=<name> (podcast, captain-<boat>, newsletter, share,
 * seo). The first one seen on this device is remembered and rides along
 * on the account when it is created, where it shows up in Supabase under
 * the user's metadata.
 *
 * First touch wins: someone who arrives from a captain's card and comes
 * back a week later through the newsletter was the captain's referral.
 *
 * This only sees the web. A person who installs from the App Store and
 * signs up inside the app arrives with no link, so their source is blank
 * - a blank is "the store", not "nobody".
 */
const KEY = 'kyc_ref';
const clean = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

export function captureReferral(search = (typeof window !== 'undefined' ? window.location.search : '')) {
  try {
    const q = new URLSearchParams(search || '');
    const ref = clean(q.get('ref') || q.get('utm_source'));
    if (!ref) return getReferral();
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify({ ref, at: new Date().toISOString() }));
  } catch { /* private mode: no storage, no tracking, nothing breaks */ }
  return getReferral();
}

export function getReferral() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

captureReferral();
