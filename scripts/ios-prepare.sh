#!/bin/bash
# Idempotent: merges the four NS*UsageDescription strings + portrait
# orientation into ios/App/App/Info.plist, copies the privacy manifest
# into the iOS project, and registers it on the App target. Safe to
# re-run.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INFO_PLIST="ios/App/App/Info.plist"
PRIVACY_SRC="ios-templates/PrivacyInfo.xcprivacy"
PRIVACY_DEST="ios/App/App/PrivacyInfo.xcprivacy"

if [ ! -f "$INFO_PLIST" ]; then
  echo "ERROR: $INFO_PLIST not found. Run 'npm run ios:init' first." >&2
  exit 1
fi

# plutil -insert errors if the key exists; -replace errors if it
# doesn't. Try the cheaper insert first, fall back to replace.
upsert_string() {
  local key="$1" value="$2"
  if plutil -insert "$key" -string "$value" "$INFO_PLIST" 2>/dev/null; then
    echo "  + $key"
  else
    plutil -replace "$key" -string "$value" "$INFO_PLIST"
    echo "  ~ $key"
  fi
}

upsert_json() {
  local key="$1" value="$2"
  if plutil -insert "$key" -json "$value" "$INFO_PLIST" 2>/dev/null; then
    echo "  + $key"
  else
    plutil -replace "$key" -json "$value" "$INFO_PLIST"
    echo "  ~ $key"
  fi
}

echo "→ Patching Info.plist"
upsert_string "NSCameraUsageDescription" \
  "ReelIntel uses the camera so you can photograph your catch."
upsert_string "NSPhotoLibraryUsageDescription" \
  "ReelIntel reads photos you select to log a catch and pull location and time from the photo's metadata."
upsert_string "NSPhotoLibraryAddUsageDescription" \
  "ReelIntel can save shared catch report images to your Photos."
upsert_string "NSLocationWhenInUseUsageDescription" \
  "ReelIntel uses your location to record where each catch was made and to pull regional regulations."

upsert_json "UISupportedInterfaceOrientations" \
  '["UIInterfaceOrientationPortrait"]'
upsert_json "UISupportedInterfaceOrientations~ipad" \
  '["UIInterfaceOrientationPortrait","UIInterfaceOrientationPortraitUpsideDown"]'

echo "→ Copying PrivacyInfo.xcprivacy"
cp "$PRIVACY_SRC" "$PRIVACY_DEST"
echo "  $PRIVACY_DEST"

echo "→ Registering PrivacyInfo.xcprivacy in App target"
if ! gem list -i xcodeproj >/dev/null 2>&1; then
  echo "  xcodeproj gem missing — installing into user gems"
  gem install --user-install xcodeproj
fi
ruby "$ROOT/scripts/ios-add-privacy.rb"

echo
echo "✔ ios:prepare complete."
echo "  Next: npm run ios:ship  (archive + upload to App Store Connect)"
