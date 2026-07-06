# Chrome Web Store listing

## Product details

**Name:** RosterLab ESPN Connector

**Summary:** Sync an ESPN fantasy baseball league to RosterLab without copying
session cookies.

**Category:** Sports

**Language:** English

**Homepage:** https://www.joshuasuzuki.com/fantasy/

**Privacy policy:** https://www.joshuasuzuki.com/fantasy/connector/privacy.html

## Detailed description

Connect your ESPN fantasy baseball league to RosterLab from the ESPN session
already open in your browser.

1. Choose "Connect with ESPN" in RosterLab.
2. Sign in on ESPN if needed.
3. Open the baseball league you want to analyze.
4. RosterLab imports its settings, teams, rosters, standings, ownership, and
   available projections.

Your ESPN password, verification codes, and cookie values stay on ESPN. The
extension does not request cookie access and does not send league data through a
RosterLab server. Temporary connection state is removed after the sync,
cancellation, failure, or ten minutes from the start of the connection.

RosterLab is not affiliated with or endorsed by ESPN. The connector relies on
ESPN's unsupported fantasy read endpoints and may need updates if ESPN changes
them.

## Single-purpose statement

The extension's only purpose is to move fantasy baseball league data from the
user's authenticated ESPN browser session into the user's open RosterLab tab.

## Permission justifications

**storage:** Keeps the originating tab ID, ESPN tab ID, random request and
operation IDs, selected league coordinates, and timestamps in memory while the
Manifest V3 service worker sleeps.

**alarms:** Removes unfinished connection state ten minutes after it starts.

**joshuasuzuki.com/fantasy:** Receives a user-initiated connection request and
returns league data to that same RosterLab tab.

**ESPN fantasy baseball pages:** Detects the league URL selected by the user.
The content script reads only the current page URL.

**ESPN fantasy read API:** Chrome grants host permissions by origin, so this
permission covers the full `lm-api-reads.fantasy.espn.com` origin. The extension
code builds and requests only the fixed fantasy baseball league endpoint using
the ESPN session already held by Chrome.

## Data-use disclosure

- Handles website content: ESPN fantasy baseball league data.
- Handles authentication information: No. Browser networking attaches the ESPN
  session to the request, but the extension does not read or store the session
  values.
- Collects or transmits data to the developer: No.
- Uses data for advertising, credit, lending, or sale: No.
- Uses remote code: No.
