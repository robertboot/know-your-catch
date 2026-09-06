#!/bin/bash
# ReelIntel → Command Center status reporter.
#
# Gathers live project status (repo, web deploy, published model,
# verified regulations) and POSTs a summary to Robert's Command
# Center at http://localhost:4780. Designed to run on a schedule
# (see the crontab line at the bottom) so the dashboard stays
# current without anyone asking for updates.
#
# Fails soft everywhere: if the Command Center isn't running, or the
# network is down, it exits quietly. Never blocks, never retries.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CC_URL="http://localhost:4780/api/report"
BRANCH="claude/upload-app-assets-NUxRr"
SITE="https://reelintel.ai"

# ---------- Supabase creds from .env.local (never hardcoded) ----------
SUPA_URL=""
SUPA_KEY=""
if [ -f "$ROOT/.env.local" ]; then
  SUPA_URL="$(grep -E '^VITE_SUPABASE_URL=' "$ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  SUPA_KEY="$(grep -E '^VITE_SUPABASE_ANON_KEY=' "$ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi

STATUS="🟢"
ISSUES=()
LINES=()

# ---------- 1. Repo state ----------
cd "$ROOT" || exit 0
git fetch origin "$BRANCH" --quiet 2>/dev/null
LOCAL_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
BEHIND="$(git rev-list --count HEAD..origin/$BRANCH 2>/dev/null || echo 0)"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
LINES+=("repo: $LOCAL_SHA on $BRANCH")
if [ "$BEHIND" != "0" ]; then
  STATUS="🟡"; ISSUES+=("$BEHIND commits behind origin — pull needed")
fi
if [ "$DIRTY" != "0" ]; then
  LINES+=("repo: $DIRTY uncommitted local changes")
fi

# ---------- 2. Web deploy up? ----------
HTTP="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE" 2>/dev/null || echo 000)"
if [ "$HTTP" = "200" ]; then
  LINES+=("web: reelintel.ai up")
else
  STATUS="🔴"; ISSUES+=("reelintel.ai returned $HTTP")
fi

# ---------- 3. Published model (public bucket, no auth) ----------
if [ -n "$SUPA_URL" ]; then
  MANIFEST="$(curl -s --max-time 10 "$SUPA_URL/storage/v1/object/public/models-published/current.json" 2>/dev/null)"
  MODEL_VER="$(printf '%s' "$MANIFEST" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("version_name","?"))' 2>/dev/null || echo '?')"
  MODEL_AT="$(printf '%s' "$MANIFEST" | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("published_at") or "")[:10])' 2>/dev/null || echo '')"
  if [ "$MODEL_VER" != "?" ] && [ -n "$MODEL_VER" ]; then
    LINES+=("model: $MODEL_VER (published $MODEL_AT)")
  else
    STATUS="🟡"; ISSUES+=("no published model manifest readable")
  fi
fi

# ---------- 4. Verified regulations count (public read via RLS) ----------
if [ -n "$SUPA_URL" ] && [ -n "$SUPA_KEY" ]; then
  REGS="$(curl -s --max-time 10 -o /dev/null -w '%header{content-range}' \
    "$SUPA_URL/rest/v1/regulations?select=id&status=eq.verified" \
    -H "apikey: $SUPA_KEY" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null | sed 's/.*\///')"
  case "$REGS" in
    ''|*[!0-9]*) : ;; # unreadable — skip silently
    *) LINES+=("regs: $REGS verified live") ;;
  esac
fi

# ---------- 5. Compose + POST ----------
TITLE="ReelIntel status: $LOCAL_SHA · model ${MODEL_VER:-?} · site $HTTP"
DETAIL="$(printf '%s; ' "${LINES[@]}")"
if [ "${#ISSUES[@]}" -gt 0 ]; then
  DETAIL="$DETAIL ISSUES: $(printf '%s; ' "${ISSUES[@]}")"
fi
NEXT="All nominal — nothing needed."
if [ "${#ISSUES[@]}" -gt 0 ]; then
  NEXT="${ISSUES[0]}"
fi

PAYLOAD="$(python3 - "$TITLE" "$DETAIL" "$STATUS" "$NEXT" <<'PY'
import json, sys
print(json.dumps({
  "entity": "reelintel",
  "from": "scheduled-status-reporter",
  "kind": "update",
  "title": sys.argv[1][:120],
  "detail": sys.argv[2][:500],
  "project": "App development",
  "status": sys.argv[3],
  "next": sys.argv[4][:200],
}))
PY
)"

# Skip silently if the Command Center isn't running.
curl -s -X POST "$CC_URL" -H 'Content-Type: application/json' \
  -d "$PAYLOAD" --max-time 5 >/dev/null 2>&1 || true

exit 0

# ---------------------------------------------------------------
# INSTALL (one-time, on the Mac):
#   chmod +x scripts/command-center-report.sh
#   (crontab -l 2>/dev/null; echo "*/30 * * * * $HOME/know-your-catch/scripts/command-center-report.sh") | crontab -
# Runs every 30 minutes. Change */30 to */15 for every 15 minutes.
# Remove with: crontab -e  (delete the line)
# ---------------------------------------------------------------
