-- "The agency does not list this fish" is an answer, not a backlog item.
--
-- The updater rotates every active species against every jurisdiction.
-- Most saltwater species have no species-specific rule — the agency
-- names a few dozen and the rest fall under general limits — but the
-- researcher had no way to SAY that, so it wrote an empty draft every
-- time. 282 unproven drafts, 208 of them older than a week, and a triage
-- of the twenty oldest found seventeen were species no agency lists and
-- five were placeholder text. Nobody could ever clear that queue,
-- because clearing it was not the work; it was a loop.
--
-- 'unregulated' is a resolved state: it does not read as a to-do, it
-- does not block the weekly email, the app keeps falling back to the
-- bundled rules as it does for any unverified row, and last_checked_at
-- sends the pair to the back of the rotation like any answered question.

alter table public.regulations
  drop constraint if exists regulations_status_check;

alter table public.regulations
  add constraint regulations_status_check
  check (status in ('draft','verified','stale','disputed','unregulated'));

-- What the backlog really looks like, once the non-rules are named.
select status, count(*) from public.regulations group by status order by count(*) desc;
