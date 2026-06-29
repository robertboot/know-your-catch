# TestFlight metadata — ready-to-paste

Paste these strings into **App Store Connect → ReelIntel → TestFlight**.

---

## Beta App Description

> ReelIntel helps Gulf-of-America anglers identify their catch, check
> current regulations, log catches with photo/GPS/conditions, and
> track their personal bests. This beta is gathering feedback on the
> identification flow, regulation alerts, and catch logging UX.

## What to Test (1.0.0 build 1)

> Try logging a catch from both camera and photo library — confirm
> location and time pull from the uploaded photo's EXIF where
> available, and that you can drop a pin on the map when EXIF is
> missing. Try the Identify flow with a clear in-hand photo; tap "Log
> this catch" on the result screen and confirm the identification
> photo lands as Photo 1 in the catch entry. Browse Regulation Alerts
> and confirm starred species surface at the top. From Settings →
> Storage, run "Compact photos" and confirm the size meter drops.

## Beta App Review notes (external testers only)

> Cloud sync is plumbed in `src/cloudsync.js` but not active for this
> build — all data stays on-device. The "More" tab routes to Settings;
> future tabs (forecast, sharing, community) will land there. Regulation
> data is a bundled seed for the federal Gulf 2026 cycle plus Alabama
> state-water overrides; other state waters fall back to seed defaults
> marked "Confirm Source".

## Feedback email

`Robertb1023@me.com`

## Known gaps to flag to testers

- Cloud sync is plumbed but dormant — Logbook is the only canonical
  record. Use **Settings → Export backup** before reinstalling.
- Photo metadata reading depends on iOS having Location enabled for
  Camera (Settings → Privacy → Location Services → Camera). Screenshots
  and AirDropped photos usually have GPS stripped — manual entry is
  available on every catch.
- Regulation seed covers federal Gulf 2026 and Alabama state waters;
  other state waters show "Confirm Source".
