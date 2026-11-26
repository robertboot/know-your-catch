---
name: ship-change
description: Verify (ios + web builds) then commit and push a change on the feature branch. Use after editing app/admin code when the user wants it shipped.
---

# Ship a change

Every code change in this repo is validated by building BOTH targets, because
a single edit can compile for one and break the other:

- `npm run ios:build` — the app bundle (`KYC_ADMIN=false`). Catches app-screen breakage.
- `npm run web:build` — the marketing + admin bundle (`KYC_ADMIN=true`, 4 GB heap). Catches admin breakage.

## Pre-ship checklist

Run through this every time. Each item is here because skipping it
shipped a real bug.

1. **`npm run check`** — parity checks. Also runs automatically as the
   first step of `npm run ios:ship`, so it can't be skipped there, but
   run it early rather than finding out at ship time. It asserts:
     - every jurisdiction in `src/data.js` also exists in the
       regulations edge function (and vice versa)
     - no screen re-inlines `active !== false` instead of
       `isAnglerVisible()`
     - no raw `<img src={photoThumbUrl(...)}>` — must use `PhotoImg`
2. **Did I change a list that exists in two places?** Jurisdictions,
   species categories, model labels, cron job definitions. If the second
   copy isn't covered by `check-parity.mjs`, add a rule for it there —
   don't rely on a comment saying "must match".
3. **Did I fix a bug at ONE call site?** Grep for the pattern across the
   repo. Thumbnails were fixed at four sites and broken at a fifth;
   Home's Recent Catches then needed its own build.
4. **Did I change an edge function?** It needs deploying separately —
   `git push` does not deploy it. Cron-called functions need
   `--no-verify-jwt`.
5. **Did I change something only verifiable on device?** Say what was
   verified and what wasn't. "Archive succeeded" means it compiled, not
   that it works.
6. **Bump the iOS build number** to last-shipped + 0 before `ios:ship`
   (the script adds 1). A `git pull` often resets `project.pbxproj` to a
   stale number and Apple rejects duplicates.

## Steps

1. Make the edit.
2. Run `scripts/ship.sh --check` to build both. If either fails, read the tail of
   `/tmp/ship-ios.log` or `/tmp/ship-web.log`, fix, and re-run.
3. Commit + push with the required trailers (do NOT let ship.sh write the message —
   it omits trailers on purpose):
   ```
   git add -A && git commit -q -m "type(scope): subject

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: <this session's URL>" && git push -u origin <branch>
   ```
4. Tell the user which commit to **Promote to Production** in Vercel — the feature
   branch is NOT the production branch, so each push needs a manual promote
   (Deployments → the commit → ⋯ → Promote to Production).

## Notes
- Never push to a branch other than the designated feature branch.
- The web build OOMs without `NODE_OPTIONS=--max-old-space-size=4096` (already in the `web:build` script).
