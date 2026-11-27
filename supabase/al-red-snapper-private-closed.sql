-- Alabama private-angler red snapper closed on November 16, 2026.
--
-- Source, read 2026-11-27: ADCNR release dated November 13, 2026,
--   https://www.outdooralabama.com/articles/alabamas-red-snapper-season-closes-november-16
-- "will close the state's 2026 private angler red snapper fishing season
--  at 12:01 a.m. on Monday, November 16 ... to keep Alabama's private
--  angler red snapper harvest at or below the 2026 federal allocation of
--  664,552 pounds."
--
-- The row still read "Open May 22 – Dec 31, 2026 ... or until Alabama's
-- quota is met", so the app showed Season Open for eleven days after the
-- state shut it. Nothing was watching for it: the closure was announced
-- on the agency's news page, and the watcher reads the standing
-- regulations page, which to this day still says "until the end of the
-- year or when Alabama's quota has been met".
--
-- The sentence opens with "Closed —" and carries no date range, which is
-- the form the season reader takes as a stated closure.

update public.regulations
   set season_text = 'Closed — the 2026 private angler season closed Nov 16, 2026 when the quota was met.',
       notes       = 'Private boats, shore and pier anglers, and state-licensed charters without a federal reef fish permit. Alabama closed the season at 12:01 a.m. on November 16, 2026 to stay within its 664,552 lb allocation. 2027 dates are announced in the spring.',
       status      = 'verified',
       verified_by = 'claude-agency-read',
       verified_at = now(),
       last_checked_at = now(),
       source_note = 'ADCNR Marine Resources Division release, November 13, 2026, read 2026-11-27',
       source_url  = 'https://www.outdooralabama.com/articles/alabamas-red-snapper-season-closes-november-16'
 where species_id = 'red_snapper'
   and jurisdiction_id = 'al_state'
   and sector in ('private', 'state_charter', 'all')
returning sector, season_text, verified_at;
