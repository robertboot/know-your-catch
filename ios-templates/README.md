# iOS native templates

These files are pre-staged for the TestFlight build. They get copied
into the generated `ios/App/App/` directory **after** `npm run ios:init`
runs on macOS for the first time.

Why pre-staged: the `ios/` directory is created by Capacitor on the Mac
during `cap add ios` and is gitignored by Capacitor's default. Keeping
the bits we hand-edit (`Info.plist` additions, `PrivacyInfo.xcprivacy`)
in version control here means the Mac steps stay copy/paste — no
re-typing from `TESTFLIGHT.md`.

## What to do on the Mac

After `npm run ios:init`:

1. **Info.plist** — open `ios/App/App/Info.plist` in Xcode and merge in
   the keys from `Info.plist.fragment.xml`. The four `NS*UsageDescription`
   strings are required; iOS rejects the build without them.

2. **PrivacyInfo.xcprivacy** — copy `PrivacyInfo.xcprivacy` to
   `ios/App/App/PrivacyInfo.xcprivacy`, then in Xcode drag it into the
   **App** group so it gets added to the App target.

3. **Build number** — bump `CFBundleVersion` (Build) in Xcode for every
   TestFlight upload. Marketing version stays `1.0.0` until 1.0.1 ships.

Nothing in this directory is shipped to the App Store — it's source
material that gets baked into the native iOS project.
