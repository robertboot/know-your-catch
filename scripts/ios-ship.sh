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
