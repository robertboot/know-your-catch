/* Who is an admin — the single client-side answer.

   This used to be written out in two places: App.jsx, which decides
   whether the console renders, and AdminApp.jsx, which had its own
   shorter list and its own isAdminEmail(). The two disagreed — the
   second still named only one person after a second admin was added —
   and the only reason it never broke was that App.jsx's gate ran first.

   This is a UX gate, not a security boundary. It decides what the
   browser draws. What actually protects the data is RLS in Postgres,
   which checks the same addresses inside the database; keep this list
   and public.is_admin() in step (supabase/add-admin-harper.sql). */
export const ADMIN_EMAILS = [
  'robertb1023@me.com',
  'annelies@reelintel.ai',
  'harper@reelintel.ai',
];

export const isAdminEmail = (e) =>
  ADMIN_EMAILS.includes(String(e || '').trim().toLowerCase());
