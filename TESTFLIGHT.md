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
npm run ios:init        # cap add ios + cap sync
npm run ios:assets      # generates every iOS icon + splash size
                        # from resources/icon.png + splash.png
npm run ios:open        # opens Xcode
```

`npm run ios:init` creates `ios/App/App.xcworkspace`. Open that — **not**
the `.xcodeproj`.

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

iOS rejects the build if any feature is exercised without its usage
string. ReelIntel uses Camera, Photo Library, and Location, so all
three are required:

```xml
<key>NSCameraUsageDescription</key>
<string>ReelIntel uses the camera so you can photograph your catch.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>ReelIntel reads photos you select to log a catch and pull
location and time from the photo's metadata.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>ReelIntel can save shared catch report images to your Photos.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>ReelIntel uses your location to record where each catch was
made and to pull regional regulations.</string>
```

Add a `UISupportedInterfaceOrientations` entry restricted to portrait
since the UI is portrait-only:

```xml
<key>UISupportedInterfaceOrientations</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
</array>
```

---

## 5. Apple privacy manifest

iOS 17+ apps that use certain APIs must ship a
`PrivacyInfo.xcprivacy` file. Create
`ios/App/App/PrivacyInfo.xcprivacy` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>CA92.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>C617.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>35F9.1</string></array>
    </dict>
  </array>
</dict>
</plist>
```

In Xcode, drag the file into the **App** group so it's added to the
app target.

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

Under **TestFlight** → **Test Information**:

- **Beta App Description**:
  > ReelIntel helps Gulf-of-America anglers identify their catch, check
  > current regulations, log catches with photo/GPS/conditions, and
  > track their personal bests. This beta is gathering feedback on the
  > identification flow, regulation alerts, and catch logging UX.
- **Feedback Email**: your address.
- **Marketing URL** (optional): your landing page or repo.
- **Privacy Policy URL** (required for external testers): you'll need
  to host a privacy policy. Internal testers don't require one.
- **What to Test** (per build): e.g. *"Try logging a catch from both
  camera and photo library. Confirm location and time pull from the
  uploaded photo's EXIF where available. Browse Regulation Alerts to
  see your starred fish surface at the top."*

Under **Test Information → Beta App Review** (only for external
testing groups beyond your team):
- **Sign-in required**: No.
- **Contact**: name, email, phone.
- **Notes**: anything Apple's reviewer needs to know (e.g. "Cloud sync
  is currently no-op; offline-first only").

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
- [ ] `npm run ios:assets` populated `ios/App/App/Assets.xcassets/AppIcon.appiconset`
- [ ] `Info.plist` has all four usage description strings
- [ ] `PrivacyInfo.xcprivacy` added to the app target
- [ ] Xcode "Automatically manage signing" green
- [ ] Build runs on a real iPhone (Lightning/USB-C-attached) before archive
- [ ] Archive uploaded to App Store Connect
- [ ] Internal testers added
- [ ] What-to-Test note filled in

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
