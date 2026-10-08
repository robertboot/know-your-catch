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

# ---- Model input parity -------------------------------------------------
# The admin Test Image panel and the app's identify path each had their own
# copy of the preprocessing. They drifted: the app letterboxed, the admin
# squashed the photo into a square, and the admin panel's results were read
# as the MODEL being wrong. Two models were nearly retrained over it.
#
# There is now one copy, in src/identify/preprocess.js. This refuses to
# build a second one.
echo "▶ Checking model input preprocessing has one copy…"
DUPES="$(grep -rln "function imageToRgb" src/ --include=*.js --include=*.jsx \
         | grep -v "^src/identify/preprocess.js$" || true)"
if [ -n "$DUPES" ]; then
  echo "✗ imageToRgb is defined outside src/identify/preprocess.js:"
  echo "$DUPES"
  echo "  Import it from there instead — see .claude/skills/harness-parity."
  exit 1
fi
# A squashing drawImage into a model-sized canvas is the exact bug.
SQUASH="$(grep -rn "drawImage([a-zA-Z]*, *0, *0, *\(runtime\.\)\?input[Ss]ize" src/ \
          --include=*.js --include=*.jsx || true)"
if [ -n "$SQUASH" ]; then
  echo "✗ Aspect-squashing drawImage into the model input:"
  echo "$SQUASH"
  echo "  Model input must be letterboxed — use imageToRgb()."
  exit 1
fi
echo "✓ one preprocessing copy, no aspect squash"

echo "▶ Building iOS bundle (KYC_ADMIN=false)…"
npm run ios:build >/tmp/ship-ios.log 2>&1 || { echo "✗ ios:build FAILED"; tail -20 /tmp/ship-ios.log; exit 1; }
echo "✓ ios:build passed"

# ---- No trackers in the app bundle --------------------------------------
# The Meta Pixel is injected into index.html at build time behind KYC_WEB,
# so it belongs to the web deploy only. If it ever reaches dist/ it is in
# the iOS app, which changes what the App Store privacy declaration has to
# say and drags the app into App Tracking Transparency — a consent prompt
# for a marketing tag the app has no use for. Verified to catch a leak:
# running ios:build with KYC_WEB=true forced does put it there.
if grep -qi "fbevents\|connect.facebook.net" dist/index.html 2>/dev/null; then
  echo "✗ Meta Pixel found in the iOS bundle (dist/index.html)"
  echo "  The tracker is web-only. Check KYC_WEB is not set for ios:build."
  exit 1
fi
echo "✓ no trackers in the app bundle"

# ---- Smoke render -------------------------------------------------------
# esbuild checks syntax, not whether an identifier resolves. A panel that
# references a variable nobody declared builds perfectly and throws
# "Can't find variable" the moment it renders — twice now, both times
# reaching the live console first. Mounting the component is the cheapest
# thing that catches it. Verified to fail on the real bug before being
# trusted.
echo "▶ Smoke-rendering admin panels…"
node scripts/smoke-render.mjs || { echo "✗ smoke render FAILED"; exit 1; }

# find-hotspots against fabricated satellite grids — no network. Catches
# scoring that publishes nothing whatever it is fed, which is otherwise
# indistinguishable from NOAA being down.
node scripts/hotspots-test/run.mjs || { echo "✗ hotspots scoring FAILED"; exit 1; }
node scripts/hotspots-test/hosts.mjs >/dev/null || { echo "✗ ERDDAP host walk FAILED"; exit 1; }

# The daily brief must not call a dead pipeline healthy. It did, for
# thirteen hours, because it only ever asked whether jobs errored.
node scripts/brief-test/run.mjs >/dev/null || { echo "✗ daily brief FAILED"; exit 1; }

# The cached model and its species list must belong together. A torn
# pair does not fail — it renames every species.
node scripts/model-cache-test/run.mjs >/dev/null || { echo "✗ model cache pairing FAILED"; exit 1; }
echo "✓ model cache pairing"
echo "✓ daily brief reports a dead pipeline"
echo "✓ ERDDAP host walk"

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
