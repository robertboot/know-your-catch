# Build 14 — Sign in with Apple + cross-device sync

Runbook for the config work required before build 14 can ship.
Every step below has to be completed for the sign-in flow to
work end-to-end. Do them in order.

---

## Overview

Build 14 code is already written and committed. The pieces:

- `@capacitor-community/apple-sign-in` installed
- Supabase schema: `catches`, `pbs`, `catch-photos` storage bucket
- `src/auth.js` — signInWithApple + session management
- `src/cloudsync.js` — pull on sign-in, debounced upserts on state change
- `src/photos-store.js` — extended for cloud upload of full-res JPEGs
- `src/auth-ui.jsx` — SignInPrompt + AccountCloudCard + SyncPill
- `App.jsx` wired: session state, sync hook on update(), pill in header, gates on Logbook + PBs

None of this works until the config below is done.

---

## Config checklist (in order)

### 1. Apple Developer portal — enable Sign in with Apple on the app ID

- Go to https://developer.apple.com/account/resources/identifiers/list
- Sign in with the developer account tied to Team ID `74KJ5HVF4F`
- Click **App IDs** → find `com.reelintel.app` → click to edit
- Scroll to **Capabilities** → tick **Sign In with Apple**
- Save

### 2. Apple Developer portal — create the Services ID

Services IDs represent your app for OAuth-style flows (which is what
Supabase uses server-side).

- Same page (Identifiers). Click **+**
- Select **Services IDs** → Continue
- Description: `ReelIntel Web Sign-In`
- Identifier: `com.reelintel.services`
- Continue → Register
- Back to the list, click `com.reelintel.services` to edit
- Tick **Sign In with Apple**
- Click **Configure**:
  - Primary App ID: `com.reelintel.app`
  - Domains and Subdomains: `hfptpsmdfemduhkueyoz.supabase.co`
  - Return URLs: `https://hfptpsmdfemduhkueyoz.supabase.co/auth/v1/callback`
- Save + Save again on the Services ID page

### 3. Apple Developer portal — create the Sign in with Apple Key

Supabase needs a signed key to verify Apple identity tokens.

- Go to https://developer.apple.com/account/resources/authkeys/list
- Click **+**
- Key Name: `ReelIntel Sign in with Apple`
- Tick **Sign in with Apple** → Configure → Primary App ID:
  `com.reelintel.app` → Save
- Continue → Register
- **Download** the `.p8` file (Apple lets you download once —
  save it as `AuthKey_XXXXXXXXXX.p8`)
- Note the **Key ID** (10 chars, on the download page)

### 4. Note your Team ID

Top-right of the Apple Developer portal. 10 characters. Should be
`74KJ5HVF4F` for ReelIntel.

### 5. Supabase dashboard — enable Apple provider

- Open https://supabase.com/dashboard/project/hfptpsmdfemduhkueyoz/auth/providers
- Find **Apple** → toggle on
- Fill in:
  - **Client IDs**: `com.reelintel.services,com.reelintel.app`
    (both the Services ID for the server-side path and the bundle ID
    for the native flow)
  - **Secret Key (for OAuth)**:
    - **Team ID**: from step 4
    - **Key ID**: from step 3
    - **Secret Key (.p8 file contents)**: open the `.p8` file in a
      text editor, paste the whole thing including the
      `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`
      lines
- Save

### 6. Xcode — enable Sign in with Apple capability

- Open `ios/App/App.xcworkspace` (if that doesn't exist, open
  `ios/App/App.xcodeproj` — Capacitor 8 SPM setup)
- Select the **App** target
- **Signing & Capabilities** tab
- Click **+ Capability** (top-left of that tab)
- Add **Sign in with Apple**
- Verify it appears in the list; no config needed beyond adding it
- Cmd+S. Xcode should auto-generate the entitlement.

### 7. Verify Info.plist is untouched

Sign in with Apple does **not** need a URL scheme. If a previous
draft added one for `reelintel://`, remove it — it's not used.

### 8. Rebuild + resign

- Back in Terminal, from the repo root:
  ```bash
  npm run ios:build          # rebuild web bundle
  npm run ios:open           # opens Xcode
  ```
- In Xcode, Product → Clean Build Folder → then Product → Run on a
  device or simulator to smoke test.

### 9. Test the flow on a device

- Tap **Sign In with Apple** on Logbook or Settings
- Apple's native sheet appears with Face ID / Touch ID / passcode
- Approve → the sheet closes → the app shows the signed-in state:
  - Settings' "Cloud sync" card shows your Apple email + "Sign out"
  - Logbook loses the "Sign in to sync…" banner
  - Header pill (on non-home routes) shows "☁ Synced"

### 10. Cross-device round-trip

- On iPhone: log a fresh catch
- On iPad (or a second simulator): sign in with the same Apple ID
- Within a few seconds the iPhone's catch should appear in the iPad's
  Logbook

If any step above fails, stop and grab the error message.

---

## Troubleshooting

### "Sign in with Apple failed" on the phone

- Verify the app has the Sign in with Apple capability in Xcode
  (Signing & Capabilities tab; not just added on developer.apple.com)
- Delete + reinstall the app (entitlement caches per-install)

### Session doesn't land after Apple approves

- Check Supabase logs at
  https://supabase.com/dashboard/project/hfptpsmdfemduhkueyoz/logs/auth-logs
- Common causes:
  - Wrong Client IDs in the Supabase Apple provider
    → must include the bundle ID `com.reelintel.app` (native flow)
    → must include the Services ID `com.reelintel.services`
       (web flow / server-side verification)
  - Wrong .p8 key contents in Supabase
  - Return URL mismatch on the Services ID

### Signed in but Logbook stays empty

- Check the browser dev tools console for RLS errors
- Verify `catches.user_id` defaults to `auth.uid()` (should — see
  migration `reelintel_catches_pbs_sync_schema`)

### Photos don't sync

- Verify the `catch-photos` bucket exists at
  https://supabase.com/dashboard/project/hfptpsmdfemduhkueyoz/storage/buckets
- Verify RLS policies:
  ```sql
  select policyname, cmd from pg_policies where tablename = 'objects' and policyname like 'reelintel_catch_photos%';
  ```
- Should see `reelintel_catch_photos_public_read` (SELECT) and
  `reelintel_catch_photos_owner_write` (ALL for authenticated).

---

## Ship

Once steps 1–9 are green:

```bash
npm run ios:ship
```

Auto-bumps build number to 14. Testers will see the "Sign in with
Apple" button on Logbook / PBs / Settings. Anyone with catches
already in localStorage keeps them locally; signing in adds cross-
device sync going forward.
