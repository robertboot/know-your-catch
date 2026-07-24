#!/bin/bash
# Build → archive → upload, all from the terminal. Uses Xcode's
# automatic signing — the keychain must already have your Apple ID
# signed in (Xcode → Settings → Accounts, one-time).
#
# Bumps the build number automatically so every upload to App Store
# Connect is unique (Apple rejects duplicates).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCHEME="App"
ARCHIVE="$ROOT/build/App.xcarchive"
EXPORT_DIR="$ROOT/build/export"
EXPORT_OPTS="$ROOT/scripts/ExportOptions.plist"

# Apple Developer Team ID for code signing. Env var wins so a second
# developer on the project can override without touching the file.
# (Team IDs aren't secrets — they're embedded in every signed binary
# and visible to anyone with the IPA.)
DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-74KJ5HVF4F}"

# Capacitor 8 with Swift Package Manager only generates an .xcodeproj
# (no .xcworkspace). Older Cocoapods-era projects have the workspace.
# Pick whichever exists.
if [ -e "ios/App/App.xcworkspace" ]; then
  XCODE_TARGET=(-workspace "ios/App/App.xcworkspace")
elif [ -e "ios/App/App.xcodeproj" ]; then
  XCODE_TARGET=(-project "ios/App/App.xcodeproj")
else
  echo "ERROR: no Xcode project under ios/App/. Run 'npm run ios:init' first." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "ERROR: xcodebuild not on PATH. Install Xcode + command-line tools." >&2
  exit 1
fi

# Re-sync the web bundle. ios:build sets KYC_BASE=./ so the WKWebView
# can resolve assets at capacitor://localhost/.
echo "→ Re-syncing web bundle"
npm run ios:sync >/dev/null

# Pull the staged app icon from the admin console (if any). The
# admin uploads a 1024x1024 PNG to the brand-assets bucket at a
# fixed key; we overwrite resources/icon.png with that source so
# the capacitor-assets step regenerates the icon set from it.
# Silent fallback to the tracked resources/icon.png if nothing's
# staged. Runs ONLY here (not on regular vite build / dev server).
STAGED_ICON_URL="https://hfptpsmdfemduhkueyoz.supabase.co/storage/v1/object/public/brand-assets/ios-app-icon.png"
echo "→ Checking for staged app icon"
if curl -fsSL -o resources/icon.png.new "$STAGED_ICON_URL" 2>/dev/null; then
  mv resources/icon.png.new resources/icon.png
  echo "  staged icon fetched from admin console"
else
  rm -f resources/icon.png.new
  echo "  no staged icon; using tracked resources/icon.png"
fi

# Re-generate the AppIcon + splash from resources/*.png so a stale
# Assets.xcassets can't ship a wrong / default gray icon. The generator
# is idempotent — safe to run every time.
echo "→ Refreshing native assets from resources/"
npm run ios:assets >/dev/null

# Bump CFBundleVersion (build number) to one above whatever's in the
# project. Marketing version stays at whatever package.json says.
echo "→ Bumping build number"
cd ios/App
CURRENT_BUILD="$(agvtool what-version -terse 2>/dev/null || echo 0)"
NEXT_BUILD=$((CURRENT_BUILD + 1))
agvtool new-version -all "$NEXT_BUILD" >/dev/null
echo "  build $CURRENT_BUILD → $NEXT_BUILD"
cd "$ROOT"

# Clean any prior archive so xcodebuild doesn't trip.
rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p build

echo "→ Archiving (this takes 2-4 min)"
xcodebuild \
  "${XCODE_TARGET[@]}" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  archive

echo "→ Uploading to App Store Connect"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTS" \
  -allowProvisioningUpdates

echo
echo "✔ Upload submitted."
echo "  Build $NEXT_BUILD will appear in App Store Connect → TestFlight"
echo "  in 5-30 minutes once Apple finishes processing."
