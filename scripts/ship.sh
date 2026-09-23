#!/usr/bin/env bash
# ship.sh — verify + commit + push a web/admin change in one step.
#
# The build-then-commit-then-push loop was run dozens of times by hand.
# This scripts the mechanical part: it type-checks via the real builds
# (ios AND web/admin, since a change can break either target) and only
# commits + pushes if BOTH pass — so a broken build never lands.
#
# Usage:
#   scripts/ship.sh "commit subject line"        # build → commit -A → push
#   scripts/ship.sh --check                        # build only, no commit
#
# The commit body/trailers are intentionally NOT added here (they are
# per-session), so pass a full message via git yourself when you need
# trailers, or use --check and commit manually.
set -euo pipefail

MSG="${1:-}"

echo "▶ Building iOS bundle (KYC_ADMIN=false)…"
npm run ios:build >/tmp/ship-ios.log 2>&1 || { echo "✗ ios:build FAILED"; tail -20 /tmp/ship-ios.log; exit 1; }
echo "✓ ios:build passed"

echo "▶ Building web/admin bundle…"
npm run web:build >/tmp/ship-web.log 2>&1 || { echo "✗ web:build FAILED"; tail -20 /tmp/ship-web.log; exit 1; }
echo "✓ web:build passed"

if [ "$MSG" = "--check" ] || [ -z "$MSG" ]; then
  echo "✓ Build check only — nothing committed."
  exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git add -A
git commit -m "$MSG"
git push -u origin "$BRANCH"
echo "✓ Shipped to $BRANCH"
