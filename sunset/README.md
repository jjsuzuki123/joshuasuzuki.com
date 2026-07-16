# Afterglow

Afterglow is a static, location-based sunset quality forecast. It runs entirely in
the browser and calls public Open-Meteo endpoints without an API key.

## Model

**SCRP v3.1 — Solar Corridor Radiative Potential**

Afterglow estimates the potential for vivid sunset color with a deterministic
radiative model:

\[
Q = 100 \cdot G^{\alpha} \cdot T^{\beta} \cdot D^{\gamma}
\]

with \(\alpha=0.66\), \(\beta=0.28\), \(\gamma=0.06\), and

\[
G = I \cdot (0.26 + 0.74 \cdot R)
\]

| Symbol | Meaning |
| --- | --- |
| \(I\) | Solar-corridor illumination (low-cloud clearance along the sunset azimuth, plus local trend) |
| \(R\) | Elevated reflectance canvas (mid/high at sunset and ~20 min after along the corridor) |
| \(T\) | Atmospheric transmittance (Beer–Lambert proxy from visibility, humidity, AOD) |
| \(D\) | Dry-window factor (precipitation probability near sunset) |

The 0.26 sky-glow floor in \(G\) acknowledges residual Rayleigh color of a clear
solar disk. Elevated cloud scales that floor toward full afterglow potential.
Meteorological gates (fog, thunderstorms, sealed low cloud, extreme extinction)
can still cap \(Q\).

Diagnostic component bars in the UI show favorability and narrative importance.
They are **not** an additive decomposition of \(Q\).

## Data

- Forecast API: low, mid, and high cloud cover, visibility, humidity,
  precipitation probability, weather code, and local sunset time
- Air Quality API: aerosol optical depth at 550 nm
- Geocoding API: city and place search

### Solar corridor sampling

1. Compute true-north sunset azimuth from latitude and date (spherical astronomy
   with standard −0.833° refraction).
2. Place sample points at 12, 35, 75, and 130 km along that bearing.
3. Fetch layered cloud cover for all corridor points in one multi-location
   Open-Meteo request (observer timezone).
4. Interpolate low cloud to the observer’s exact local sunset (illumination).
5. Interpolate mid/high cloud again at sunset + 20 minutes (afterglow canvas peak).

Near-field low cloud dominates illumination (solar-disk blocking). Distant
elevated cloud is weighted more for reflectance duration, especially when the
local sky is empty. If the corridor request fails, the model falls back to
observer-point scoring.

Confidence combines input completeness, forecast lead time, temporal sample
alignment, and spatial coherence of corridor low cloud. It is a data-quality
indicator, not a calibrated probability of beauty.

## Scientific grounding

- Low-angle sunlight and tropospheric scattering as the source of twilight color
  (Corfidi, NOAA/NWS, *The Colors of Sunset and Twilight*)
- Mid/high cloud as the preferred reflectance surface for post-sunset color
- Directional corridor / ray geometry used by operational sunset models
  (e.g. Sunsethue whitepaper)
- Tropospheric AOD and humidity as extinction terms (CAMS / PhotoWeather guidance)

SCRP is a transparent engineering model for operational forecasts. It is not a
full 3-D radiative-transfer simulation and does not claim subjective aesthetic
certainty.

## Performance

No framework, runtime dependencies, web fonts, or image payloads. Observer
weather and air-quality requests run in parallel; corridor cloud is a second
batched request. A 20-minute local cache (`afterglow:forecast:v3.1`) renders
immediately on repeat visits.

```sh
node scripts/sunset-score-engine.test.js
```
