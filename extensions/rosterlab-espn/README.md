# RosterLab ESPN Connector

This Manifest V3 extension connects RosterLab to the ESPN fantasy baseball
session already active in Chrome or Edge. The user signs in on ESPN and opens a
league. The extension requests that league from ESPN's read API and returns the
response to the originating RosterLab tab.

The extension does not use Chrome's cookie API. It does not inspect ESPN login
forms, and no RosterLab server receives ESPN credentials or league data.

## Local installation

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this `extensions/rosterlab-espn` directory.
5. Open `https://www.joshuasuzuki.com/fantasy/` and choose **Connect with ESPN**.

The production manifest intentionally matches only the deployed RosterLab URL,
so the extension does not activate on localhost.

## Permissions

- `storage` keeps an in-memory connection record while the service worker sleeps.
- `alarms` expires unfinished connections ten minutes after they start.
- RosterLab page access bridges the user's button click and the resulting data.
- ESPN baseball page access identifies the league the user opens.
- ESPN read-API access covers its API origin because Chrome permissions are
  origin-wide. The code fetches a fixed baseball league URL with the browser's
  existing ESPN session.

There is no `cookies`, `scripting`, history, or all-sites permission.

## Tests and package

From the repository root:

```sh
./scripts/verify.sh
scripts/package-rosterlab-extension.sh
```

The packaging script creates a versioned zip in `dist/` containing runtime
files only. Upload that zip to the Chrome Web Store. Before publication, set
`connectorInstallUrl` in `fantasy/config.js` to the approved listing URL.

The public privacy policy is at
`https://www.joshuasuzuki.com/fantasy/connector/privacy.html`.
