# App Review Notes — ReelIntel (Guideline 2.1 response)

Paste everything below into **App Store Connect → your app → the version →
App Review Information → Notes**. Fill the two demo-account blanks with the
throwaway reviewer account you created. Attach the screen recording in the
same section (or reply to the rejection message in App Store Connect with the
recording attached).

---

**DEMO ACCOUNT**
Email: __________________   (your throwaway reviewer account)
Password: __________________
Note: an account is optional. The app is fully usable without signing in —
tap "Continue without an account" on the first screen. The demo account is
provided only so you can review the registration, login, and account-deletion
flows.

**1. Screen recording** — attached. Recorded on a physical iPhone running the
latest iOS. It launches the app, goes through the core flow (browse
regulations, log a catch, identify a fish from a photo, view the forecast),
then shows account registration, login, and account deletion.

**2. Devices / OS tested**
- iPhone 15 Pro — iOS 18 (physical device, via TestFlight)
- iPhone SE (2nd gen) — iOS 18 (physical device, via TestFlight)
(Adjust to the exact devices you tested on.)

**3. What the app does & who it's for**
ReelIntel is a fishing companion for recreational anglers in the Gulf of
Mexico and Florida. It solves three problems saltwater anglers face on the
water: (a) knowing the current, legally-correct regulations — season
open/closed, size and bag limits — for the exact species and state waters
they're fishing; (b) identifying a fish from a photo; and (c) deciding when
and where conditions are good to fish. It combines a searchable species &
regulations guide, an on-device + AI photo fish-ID, a personal catch logbook,
and a marine weather/forecast "fishability" score. Target audience:
recreational saltwater anglers in AL, MS, LA, TX, and FL, plus Gulf federal
waters.

**4. How to set up and reach the main features**
No login or sample files required — on first launch tap "Continue without an
account" to enter the app. Then:
- **Regulations:** tap a species (or search) to see season status, size and
  bag limits for each jurisdiction.
- **Identify a fish:** tap the camera/identify button, take or choose a photo;
  the app returns the most likely species.
- **Logbook:** log a catch (species, length, photo); it's saved on-device.
- **Forecast:** open the forecast screen for the marine conditions and
  fishability score for your location.
Creating an account (email + password) only adds cloud backup/sync of your
logbook across devices. Account deletion is in Settings → Account → Delete
account, which permanently removes the account and all associated data.

**5. External services used**
- **Supabase** — user authentication (email/password), database, photo
  storage, and backend functions (cloud backup/sync and account deletion).
- **Anthropic (Claude API)** — AI assist for fish photo identification and for
  keeping regulation data current. Called from our backend, not the device.
- **Open-Meteo** (open-meteo.com, marine-api.open-meteo.com) — weather and
  marine forecast data.
- **NOAA** — Tides & Currents (tidesandcurrents.noaa.gov), CoastWatch/ERDDAP
  ocean data (coastwatch.pfeg.noaa.gov), and NOAA Fisheries for federal
  regulations.
- **NASA** — satellite ocean layers (sea-surface temperature, chlorophyll) via
  ERDDAP.
- **State wildlife agencies** — Alabama, Mississippi (dmr.ms.gov), Louisiana
  (wlf.louisiana.gov), Texas (tpwd.texas.gov), and Florida (FWC) as the
  authoritative sources for state-waters regulations.
- An on-device fish-identification model also runs locally with no external
  service.

**6. Regional differences**
The app is designed for the U.S. Gulf of Mexico and Florida and functions
consistently across regions. The only variation is intentional content: the
regulations shown are specific to the jurisdiction the user selects (Alabama,
Mississippi, Louisiana, Texas, Florida state waters, and Gulf federal waters).
All app features work the same everywhere; there are no region-locked
features.

**7. Regulated industry / third-party material**
The app does not require special credentials. All fishing-regulation data is
sourced from public government publications (NOAA Fisheries and the state
wildlife agencies listed above), and all weather/ocean data is from public
NOAA/NASA/Open-Meteo APIs. Regulations are presented as informational
reference with attribution to the issuing agency; the app is not an official
government service and does not issue licenses or permits.
