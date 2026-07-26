---
name: ship-change
description: Verify (ios + web builds) then commit and push a change on the feature branch. Use after editing app/admin code when the user wants it shipped.
---

# Ship a change

Every code change in this repo is validated by building BOTH targets, because
a single edit can compile for one and break the other:

- `npm run ios:build` — the app bundle (`KYC_ADMIN=false`). Catches app-screen breakage.
- `npm run web:build` — the marketing + admin bundle (`KYC_ADMIN=true`, 4 GB heap). Catches admin breakage.

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
