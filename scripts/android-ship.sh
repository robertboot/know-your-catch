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

# Gradle needs a JDK in a WINDOW, not simply a new one: this wrapper
# (8.14) refuses anything older than 17 and cannot read the class files
# of anything newer than 21 — Android Studio's bundled Java 25 failed
# with "Unsupported class file major version 69", which names neither.
# macOS also ships a stub `java` that only offers to install one.
java_major() {
  local home="$1"
  [ -x "$home/bin/java" ] || return 1
  "$home/bin/java" -version 2>&1 | head -1 \
    | sed -E 's/.*version "([0-9]+).*/\1/' | grep -E '^[0-9]+$' || return 1
}
MIN_JAVA=17
MAX_JAVA=21
usable() { [ -n "$1" ] && [ "$1" -ge "$MIN_JAVA" ] && [ "$1" -le "$MAX_JAVA" ]; }

CURRENT_JAVA="$(java_major "${JAVA_HOME:-/nonexistent}" || true)"
if ! usable "$CURRENT_JAVA"; then
  for candidate in \
    "$(/usr/libexec/java_home -v 21 2>/dev/null || true)" \
    "$(/usr/libexec/java_home -v 17 2>/dev/null || true)" \
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home" \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
    [ -n "$candidate" ] || continue
    found="$(java_major "$candidate" || true)"
    if usable "$found"; then
      export JAVA_HOME="$candidate"
      CURRENT_JAVA="$found"
      echo "→ Using Java $found at $JAVA_HOME"
      break
    fi
  done
fi
if ! usable "$CURRENT_JAVA"; then
  echo "ERROR: need a Java between $MIN_JAVA and $MAX_JAVA; found '${CURRENT_JAVA:-none}'." >&2
  echo "       Install one with:  brew install --cask temurin@21" >&2
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
