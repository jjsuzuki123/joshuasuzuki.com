# Afterglow

Afterglow is a static, location-based sunset quality forecast. It runs entirely in
the browser and calls public Open-Meteo endpoints without an API key.

## Data

- Forecast API: low, mid, and high cloud cover, visibility, humidity,
  precipitation probability, weather code, and local sunset time
- Air Quality API: aerosol optical depth at 550 nm
- Geocoding API: city and place search

The app linearly interpolates hourly values to the exact local sunset. It also
samples low cloud one hour earlier to detect a clearing or closing horizon.

## Score

The quality index is a weighted 0 to 100 score:

| Input | Weight |
| --- | ---: |
| Mid and high cloud canvas | 32% |
| Low-cloud horizon opening | 28% |
| Visibility | 14% |
| Dry sunset window | 11% |
| Humidity | 8% |
| Aerosol balance | 7% |

Partial mid and high cloud cover scores best because elevated clouds can catch
light after the surface is in shadow. Low cloud, fog, poor visibility, and active
precipitation lower the score. Dense fog, thunderstorms, very low visibility, and
a near-solid low cloud deck also cap the final result.

If aerosol data is unavailable, the model removes its weight and normalizes the
remaining components. Confidence reflects forecast distance, input completeness,
and the distance between sunset and the closest hourly samples. It is a data
quality indicator, not a calibrated probability.

## Performance

The app has no framework, runtime dependencies, web fonts, or image payloads.
Weather and air-quality requests run in parallel. A 20-minute local cache renders
immediately on repeat visits and refreshes in the background. Static files are
served through the site's existing CloudFront distribution.

Run the score tests from the repository root:

```sh
node scripts/sunset-score-engine.test.js
```
