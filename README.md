# joshuasuzuki.com

Personal website and RosterLab fantasy baseball analyzer built with vanilla
HTML, CSS, and JavaScript.

## Architecture
- Static site hosted on S3
- Served via CloudFront
- Custom domain: joshuasuzuki.com
- Backend APIs via AWS API Gateway + Lambdas (contact form + admin)
- Optional Manifest V3 browser connector for private ESPN fantasy leagues
- RosterLab private ESPN imports via a stateless API Gateway + Lambda relay
- Cache-backed, cited Firecrawl research for current baseball player news

## Projects
- `/fantasy/`: RosterLab fantasy baseball trade analysis
- `/fantasy/football/`: Redraft football trade calculator
- `/sunset/`: Afterglow sunset quality forecast

## Internal tooling (not deployed)
- `.cursor/canvases/`: Cursor analytics demo canvas + handoff doc, refreshed daily by
  `scripts/cursor-analytics-refresh.mjs` (see `.cursor/canvases/cursor-analytics-canvas-handoff.md`)
