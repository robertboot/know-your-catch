#!/bin/bash
# Build a signed Android App Bundle for Google Play, from the terminal.
#
# Play takes an .aab, not an .apk, and refuses an unsigned one. The
# signing key lives in android/key.properties + a keystore file, both
# deliberately untracked: whoever holds them owns every future update of
# this app, and a key committed once is a key leaked forever. If the app
# is ever signed with a different key, Play will not accept it as the
# same app - so back the keystore up somewhere that is not this laptop.
#
# Bumps versionCode automatically, because Play rejects a bundle whose
# versionCode it has already seen.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GRADLE_FILE="android/app/build.gradle"
KEY_PROPS="android/key.properties"
LOG="$ROOT/build/android-bundle.log"

if [ ! -d android ]; then
  echo "ERROR: no android/ project. Run 'npx cap add android' first." >&2
  exit 1
fi

if [ ! -f "$KEY_PROPS" ]; then
  cat >&2 <<'MSG'
ERROR: android/key.properties not found, so the bundle cannot be signed.

Create the upload key once:

  keytool -genkey -v -keystore android/upload-keystore.jks \
    -keyalg RSA -keysize 2048 -validity 10000 -alias upload

then write android/key.properties:

  storeFile=upload-keystore.jks
  storePassword=<the password you just chose>
  keyAlias=upload
  keyPassword=<the same password>

Both files are gitignored. Back the .jks up off this machine - lose it
and no future update can be published under this listing.
MSG
  exit 1
fi

# Gradle needs a JDK 17+, and macOS ships a stub `java` that only offers
# to install one. Android Studio bundles a JetBrains Runtime, which is the
# JDK Google tests the build tools against — use it unless JAVA_HOME
# already points at something modern enough.
java_major() {
  local home="$1"
  [ -x "$home/bin/java" ] || return 1
  "$home/bin/java" -version 2>&1 | head -1 \
    | sed -E 's/.*version "([0-9]+).*/\1/' | grep -E '^[0-9]+$' || return 1
}
NEED=17
CURRENT_JAVA="$(java_major "${JAVA_HOME:-/nonexistent}" || true)"
if [ -z "$CURRENT_JAVA" ] || [ "$CURRENT_JAVA" -lt "$NEED" ]; then
  for candidate in \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
    if [ -x "$candidate/bin/java" ]; then
      export JAVA_HOME="$candidate"
      echo "→ Using Android Studio's Java ($(java_major "$JAVA_HOME"))"
      break
    fi
  done
fi
CURRENT_JAVA="$(java_major "${JAVA_HOME:-/nonexistent}" || true)"
if [ -z "$CURRENT_JAVA" ] || [ "$CURRENT_JAVA" -lt "$NEED" ]; then
  echo "ERROR: no Java $NEED or newer found. Install Android Studio (it bundles one)," >&2
  echo "       or set JAVA_HOME to a JDK $NEED+." >&2
  exit 1
fi

# Play rejects a versionCode it has already accepted, so every bundle
# gets a fresh one.
CURRENT="$(grep -E '^[[:space:]]*versionCode' "$GRADLE_FILE" | head -1 | grep -oE '[0-9]+')"
NEXT=$((CURRENT + 1))
perl -0pi -e "s/(versionCode\s+)$CURRENT\b/\${1}$NEXT/" "$GRADLE_FILE"
echo "→ versionCode $CURRENT → $NEXT"

echo "→ Building the web bundle and syncing it into the Android project"
npm run android:sync >/dev/null

mkdir -p build
echo "→ Assembling the signed bundle (this takes 2-5 min)"
if ! (cd android && ./gradlew --quiet bundleRelease) >"$LOG" 2>&1; then
  echo >&2
  echo "ERROR: gradle failed. Lines that mention an error:" >&2
  grep -E 'error:|FAILURE|What went wrong' -A 3 "$LOG" | tail -30 >&2
  echo >&2
  echo "Full log: $LOG" >&2
  exit 1
fi

AAB="android/app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$AAB" ]; then
  echo "ERROR: gradle reported success but $AAB is missing." >&2
  exit 1
fi

echo
echo "✔ Signed bundle ready: $AAB"
echo "  $(du -h "$AAB" | cut -f1)"
echo
echo "  Upload it at play.google.com/console → your app → Testing →"
echo "  Internal testing → Create new release → Upload."
