---
name: forecast-scoring
description: Tune the Fishability score / grade or add a metric row to the forecast matrix. Use when changing scoring thresholds, colours, safe-boating bands, or the hourly/10-day grid.
---

# Fishability scoring & forecast matrix

All scoring + colour logic lives in `src/forecast-extras.js`. The forecast UI
(`WeatherForecastScreen`, `HomeConditions`) and the shared grid
(`ForecastMatrix`) consume it.

## Scoring model (forecast-extras.js)
- `subScores(h)` → `{ wind, seas, period }`, each 0–100. **Wind is in knots** and
  **factors gusts** (`wind*0.65 + gust*0.35`). Period is context-aware: short
  period on calm seas (≤2.5 ft) is fine; only penalized when seas are up.
- `fishabilityHour(h)` weights wind 0.42 / seas 0.36 / period 0.22, then a ±5
  solunar `bite` nudge. **Weighted toward caution** to match Windy's read.
- `fishabilityColor(score)` = continuous ramp (`FISH_STOPS`); `fishabilityGrade`
  = A+…F. Keep the legend gradient in `screens1.jsx` in sync with `FISH_STOPS`.
- Safe-boating bands for the "Why?" scales: `WIND_BANDS` (kt), `WAVE_BANDS` (ft),
  `PERIOD_BANDS` (s) in `screens1.jsx` — Beaufort + NWS small-craft advisory.

To make it more/less cautious: shift `subScores` curves, the weights, and the
`FISH_STOPS`/`WIND_STOPS` colour thresholds together. Validate against a Windy
screenshot for the same spot/time.

## Adding a metric row
`ForecastMatrix` is ONE component used by both the 24-hour and 10-day tabs — edit
the shared `ROWS` array so both stay identical (the only difference is the time
axis). Every column object (hourly item OR 6-hour block) must carry the same
field names; if you add a field, also add it to `sixHourBlocks` aggregation in
`forecast-extras.js`. Use `bg` for a heat-fill (auto-blended into neighbours) or
`render` for custom cells (bite boxes, wave silhouette).

## Data must stay fresh
`HomeConditions` and `WeatherForecastScreen` refetch every 15 min and on app
foreground (visibilitychange). Both grade the **current** conditions from the
live `current` + marine-current readings so Home and the forecast hero match.
Keep that alignment if you touch either fetch.

## Units
Wind is **knots** app-wide (forecast fetches `wind_speed_unit=kn`). Catch-log
weather still stores mph internally but displays converted to kt.
