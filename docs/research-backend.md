# Research backend (Supabase) — setup

The app collects opt-in citizen-science catch data for a partnership
with NOAA Fisheries. This doc explains how to bring the backend live.

## What's already built

- `src/cloudsync.js` — dormant client. Until `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` are filled in, every function is a no-op and the
  app behaves exactly as it does today (catches live only in the
  user's local log).
- `supabase/schema.sql` — full schema: `anglers`, `catches`,
  `catch_photos`, RLS policies (own-row read/insert/update, **no
  delete** per app policy), researcher read-only role, an aggregated
  monthly-effort view.
- Settings → **Research contribution** card — opt-in consent UX with
  permanent-contribution wording, location precision picker (exact /
  1 km / 10 km grid), and a "stop contributing future catches" action.

## Bring it live (one-time, ~15 min)

1. Create a free Supabase project at https://supabase.com.
2. In **Project → SQL Editor**, paste and run `supabase/schema.sql`.
3. In **Project → Settings → API**, copy the **Project URL** and the
   **anon public** key.
4. In `src/cloudsync.js`, fill in:
   ```js
   export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
   export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
   ```
5. In **Authentication → Providers**, enable **Anonymous sign-ins**.
6. Commit + push. The next app build starts uploading catches from
   any user who has opted in.

That's it. No servers to run.

## Policy notes encoded in the schema

- **Permanent contribution.** RLS allows the angler to read, insert,
  and update their own rows — but not delete. The "free app in
  exchange for permanent dataset contribution" is enforced at the DB
  layer, not just in UI.
- **Anonymous IDs.** `anglers.id == auth.uid()` from Supabase's
  anonymous sign-in. No PII collected.
- **Coordinate precision** is enforced client-side via the snapping
  in `applyLocPrecision()`. The server stores the chosen precision in
  `catches.loc_precision` so researchers know what they're looking at.
- **Photos** are a separate opt-in (`state.research.sharePhotos`),
  defaults off. The schema has a `catch_photos` table ready; the
  upload wiring is the obvious v1.1 add when you confirm photo
  consent UX with legal review.

## Right-to-erasure note (CCPA / GDPR)

A "free app for permanent contribution" deal is a clean trade, but in
some jurisdictions (CCPA-California, GDPR-EU) users have statutory
deletion rights that an EULA can't fully waive — especially when
anonymous IDs + frequent precise locations can sometimes be re-
identified to a person. The 1 km / 10 km grid options mitigate this.
Get a legal review on the consent wording and your privacy policy
before App Store submission.

## Admin / researcher access

- **Admin dashboard:** add a `Research` tab to `admin/index.html`
  that uses a service-role key (kept *only* in the admin operator's
  browser, never committed) to query all rows. v1 sketch lives in the
  next push.
- **NOAA partner access:** create a Supabase user with the
  `researcher` JWT claim. The RLS policy already grants them
  read-only access across `catches`. Share via Supabase's PostgREST
  endpoints or set up a scheduled CSV export.
