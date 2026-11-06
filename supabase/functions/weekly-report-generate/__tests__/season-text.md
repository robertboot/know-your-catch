# Season-text cases this parser must handle

Real rows from `regulations`, Sep 2026. These are why the parser reads
ranges instead of keywords, and why it drops parentheses first.

| species / waters | season_text | expected on Sep 14 |
|---|---|---|
| gag_grouper · al_state | `September 1 - October 1, 2026 (Alabama state waters open concurrently with federal Gulf waters)` | closes in 17 days |
| gag_grouper · fed_gulf | `September 1 - September 30, 2026 (closes 12:01 a.m. October 1, 2026)` | closes in 16 days |
| gray_triggerfish · al_state | `Open August 1 – December 31, 2026 (or until the federal quota is met); closed annually in January/February and June/July` | nothing — closes in 108 days |
| gray_triggerfish · fed_gulf | `March 1 - May 31, 2026 and August 1 - December 31, 2026 (subject to early closure…)` | nothing |
| greater_amberjack · al_state | `September 1 - October 14, 2026 (currently closed as of Aug 3, 2026; reopens Sept 1, 2026)` | closes in 30 days |
| greater_amberjack · fed_gulf | `September 1 - October 14, 2026 (season currently CLOSED until Sept 1, 2026 opener; will re-close after Oct 14, 2026 until Sept 1, 2027)` | closes in 30 days |
| red_snapper · al_state | `June 1, 2026 - October 26, 2026` | nothing — closes in 42 days |

Three traps in that set:

1. **The closing date has no keyword in front of it.** It sits after a
   dash. A parser that looks for `closes <date>` finds only the opening
   and reports a season as having no upcoming change.
2. **Parentheses restate and narrate.** `(closes 12:01 a.m. October 1)`
   repeats the end date; `(currently closed as of Aug 3; reopens Sept 1)`
   describes last month. Reading them produces phantom edges.
3. **"closed" can appear after an open range in the same string.** Gray
   triggerfish is open Aug–Dec *and* says "closed annually in
   January/February". Polarity is judged per clause, not per string.
