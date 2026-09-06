# ReelIntel — TestFlight prep

Everything needed to get a buildable iOS archive uploaded to App Store
Connect and into the hands of TestFlight beta testers. Steps that
have to run on a Mac (Xcode + CocoaPods) are flagged **macOS**.

---

## 0. Apple Developer account

You need an active **Apple Developer Program** membership ($99/yr).
Once enrolled:

- In **App Store Connect → My Apps → +** create a new app:
  - Name: **ReelIntel**
  - Primary Language: English (U.S.)
  - Bundle ID: `com.reelintel.app` (must match `capacitor.config.json`)
  - SKU: `reelintel-ios`
  - User Access: Full Access
- Apple ID for your TestFlight reviewer + a small list of internal
  testers (your email + anyone testing).

---

## 1. Repo prep (already done in this branch)

- `package.json` → version bumped to `1.0.0-beta.1`, name → `reelintel`,
  iOS scripts added.
- `src/data.js` → `DATA_VERSION = '1.0.0-beta.1'` (shows on home footer).
- `capacitor.config.json` → `appId: com.reelintel.app`, `appName: ReelIntel`.
- `resources/icon.png` → 1024×1024 RGB, no alpha (App Store grade).
- `resources/splash.png` + `splash-dark.png` → 2732×2732 (Capacitor's
  "fits any device" master).
- `@capacitor/assets` added as a dev dependency for icon/splash
  generation.

---

## 2. Native iOS project (one-time setup, **macOS**)

```bash
npm install
npm run ios:init        # cap add ios + cap sync (uses KYC_BASE=./ so
                        #   assets resolve inside the WKWebView)
npm run ios:assets      # generates every iOS icon + splash size
                        # from resources/icon.png + splash.png
npm run ios:open        # opens Xcode
```

`npm run ios:init` creates `ios/App/App.xcworkspace`. Open that — **not**
the `.xcodeproj`.

**Heads-up on the base path:** `npm run build` produces a bundle with
`base: /know-your-catch/` (for the raw.githack stable URL). The iOS
WebView serves from `capacitor://localhost/`, so we need relative
paths. `npm run ios:build` (called by `ios:sync` and `ios:init`) sets
`KYC_BASE=./` to bake relative asset URLs into `dist/index.html`. Use
those scripts — never `cap sync ios` directly after a plain
`npm run build`, or the iOS bundle will 404 on every asset.

---

## 3. Xcode signing (**macOS**)

In Xcode, with the **App** target selected:

- **Signing & Capabilities → Team**: select your Apple Developer team.
- **Bundle Identifier**: should already be `com.reelintel.app`.
- Let Xcode **"Automatically manage signing"** create the provisioning
  profile. If it errors, register the bundle ID in
  [developer.apple.com/account](https://developer.apple.com/account/resources/identifiers/list)
  first, then retry.

Build a fresh debug run on a simulator or device to confirm signing
works (Cmd-R).

---

## 4. Info.plist privacy strings (**macOS** — `ios/App/App/Info.plist`)

Pre-staged in `ios-templates/Info.plist.fragment.xml`. Open that file
and paste every `<key>…</key><…/…>` block into `ios/App/App/Info.plist`
between the top-level `<dict>…</dict>`.

Contains the four required `NS*UsageDescription` strings (Camera, Photo
Library read, Photo Library add, Location When In Use) plus a
portrait-only `UISupportedInterfaceOrientations` array. iOS rejects the
upload if any feature is exercised without its usage string.

---

## 5. Apple privacy manifest

iOS 17+ apps that use certain APIs must ship a
`PrivacyInfo.xcprivacy` file. Pre-staged in
`ios-templates/PrivacyInfo.xcprivacy`.

```bash
cp ios-templates/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy
```

Then in Xcode, drag the file into the **App** group so it's added to
the app target. Declares the three categories Capacitor's WKWebView
exercises (UserDefaults, FileTimestamp, SystemBootTime) with their
documented reasons — no third-party tracking, no data collection.

---

## 6. Build numbers

For every TestFlight upload the build number must be unique and
monotonic. Two ways:

- In Xcode → **General → Version** = `1.0.0` and **Build** = `1`
  (bump Build to `2`, `3`, … on each upload).
- Or set them from the command line before archiving:
  ```bash
  cd ios/App
  agvtool new-marketing-version 1.0.0
  agvtool new-version -all 1
  ```

---

## 7. Archive + upload (**macOS**)

```bash
npm run ios:sync       # rebuild web, copy to iOS
npm run ios:open
```

In Xcode:

1. Top bar → device → **Any iOS Device (arm64)**.
2. **Product → Archive**.
3. When the Organizer opens → **Distribute App → App Store Connect →
   Upload**. Use automatic signing.
4. Wait for "Upload succeeded".

The build will appear under **App Store Connect → ReelIntel → TestFlight**
in 5–30 minutes after Apple's processing.

---

## 8. App Store Connect — TestFlight metadata

All ready-to-paste copy lives in **`ios-templates/test-notes.md`** —
beta description, "What to Test" for build 1, reviewer notes, feedback
email, and known-gap callouts. Open that file alongside the App Store
Connect tab and paste straight in.

Under **TestFlight → Test Information** the fields you'll fill in:

- **Beta App Description** — paste from `test-notes.md`.
- **Feedback Email** — `Robertb1023@me.com`.
- **Marketing URL** (optional) — your landing page or repo URL.
- **Privacy Policy URL** (required for *external* testers, optional
  for internal) — host the policy somewhere (GitHub Pages, your
  landing page) and link it.

Under **Test Information → Beta App Review** (only for external
testing groups beyond your team):
- **Sign-in required**: No.
- **Contact**: name, email, phone.
- **Notes**: paste the "Beta App Review notes" block from
  `test-notes.md`.

---

## 9. Inviting testers

- **Internal Testing** (your team, no Apple review needed):
  Add up to 100 App Store Connect users. They get the build the moment
  it finishes processing.
- **External Testing** (anyone else, first build needs Apple review,
  ~24 hours; subsequent builds in the same submission don't):
  - Create a group ("Beta Anglers"), add an Apple ID or email per
    tester (up to 10,000).
  - Each external tester needs the **TestFlight** iOS app to install.

---

## 10. Quick pre-flight checklist

- [ ] Apple Developer membership active
- [ ] App created in App Store Connect with bundle ID `com.reelintel.app`
- [ ] Repo at `1.0.0-beta.1` (this branch)
- [ ] `npm install` ran on macOS without errors
- [ ] `npm run ios:init` created `ios/App/App.xcworkspace`
- [ ] `dist/index.html` references `./assets/...` (relative — confirms
      `ios:build` used `KYC_BASE=./`)
- [ ] `npm run ios:assets` populated `ios/App/App/Assets.xcassets/AppIcon.appiconset`
- [ ] `Info.plist` has all four usage description strings (from
      `ios-templates/Info.plist.fragment.xml`)
- [ ] `PrivacyInfo.xcprivacy` copied from `ios-templates/` into
      `ios/App/App/` and added to the app target
- [ ] Xcode "Automatically manage signing" green
- [ ] Build runs on a real iPhone (Lightning/USB-C-attached) before archive
- [ ] Archive uploaded to App Store Connect
- [ ] Internal testers added
- [ ] What-to-Test note filled in (from `ios-templates/test-notes.md`)

---

## 11. Known gaps to flag to testers

These are intentional, but call them out so beta feedback doesn't
chase them:

- Cloud sync (`src/cloudsync.js`) is plumbed but not active — all data
  stays on-device. The Logbook is your canonical record; export from
  Settings before reinstalling.
- Regulation data is a bundled seed for the federal Gulf 2026 cycle
  plus Alabama state-water overrides. Other state waters fall back to
  seed defaults marked "Confirm Source".
- The "More" tab routes to Settings; future tabs (forecast, sharing,
  community) live there for now.
- Photo metadata reading depends on iOS having Location enabled for
  Camera (Settings → Privacy → Location Services → Camera). Screenshots
  and AirDropped photos usually have GPS stripped — manual entry is
  available on every catch entry.

---

## 12. After the first build

When a tester reports a bug or you push a fix:

```bash
git pull origin claude/upload-app-assets-NUxRr
npm run ios:sync          # build web, copy to iOS
# bump build number in Xcode (or agvtool new-version -all N+1)
# Product → Archive → Upload again
```

New build appears in TestFlight automatically once Apple finishes
processing it (5–30 min). Testers see the update prompt next time they
open the app.
