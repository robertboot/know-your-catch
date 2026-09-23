# Building Know Your Catch for iOS / TestFlight / App Store

The app is a Capacitor-wrapped Vite + React SPA. The web build (`dist/`)
runs in an iOS WebView; native features (GPS, Camera) use Capacitor
plugins through `src/native.js`, with web fallbacks so the dev URL
keeps working.

## Requirements (one-time)

- macOS with **Xcode 15+** (App Store).
- **Apple Developer Program** membership (~$99/year, required for
  TestFlight + App Store distribution).
- **CocoaPods**: `sudo gem install cocoapods` or `brew install cocoapods`.
- Node 20+ and `npm`.

## First-time iOS project setup

Run **on a Mac**, in the repo root:

```bash
npm install
KYC_BASE=./ npm run build     # web build for native (relative paths)
npx cap add ios               # generates the ios/App Xcode project (one-off)
npx cap sync ios              # copies web build + installs Pods
open ios/App/App.xcworkspace  # opens Xcode
```

In Xcode → **Signing & Capabilities**:

1. Pick your **Team** (Apple ID linked to your Developer Program).
2. Set **Bundle Identifier** if you want something other than
   `com.knowyourcatch.app`.
3. Add the required usage strings to `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Take a photo of the fish you caught to add to your log.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Record where each catch was logged so you can revisit your spots.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Pick a photo from your library to attach to a logged catch.</string>
```

Without these, iOS will refuse to grant Camera / Location and the app
will silently fail those features.

## Iterate

```bash
KYC_BASE=./ npm run build
npx cap sync ios
```

Then **Cmd-R** in Xcode to run on a connected iPhone or the Simulator.

## Ship to TestFlight

In Xcode: **Product → Archive → Distribute App → App Store Connect →
Upload**. After processing (~10 min) it shows up in TestFlight; add
internal testers and they install via the TestFlight app.

## App Store review — known considerations

- **Photo identification is currently a stub.** Apple typically rejects
  "ID my fish" apps that don't actually identify. List v1 as a
  **fishing log + Gulf regulations companion**; add real photo-ID later
  as an update (the integration point is `src/identifyPhoto.js`).
- **Regulation data carries an explicit disclaimer** ("seed / not
  official — verify with the agency"). Keep that visible. Provide the
  official-source link on every rule (already wired).
- **Privacy nutrition labels** in App Store Connect: declare *Camera*
  and *Location* as collected (only on device — not linked to identity,
  not used for tracking).

## Why Capacitor (and not a rewrite)

Capacitor keeps the React codebase intact. The same components, screens,
regulations service, photo manifest, and admin all run unchanged in the
WebView, with native GPS / Camera / Filesystem plugins swapped in at
runtime. Build the web version (`dist/`), `cap sync`, ship. No port,
no parallel codebase.
