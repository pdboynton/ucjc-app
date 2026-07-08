# UCJC Apostolic — Progressive Web App

A full-featured Progressive Web App (PWA) for the United Churches of Jesus Christ Apostolic. Built as a single-file web application with Firebase backend, OneSignal push notifications, and Median.co native wrapper support.

---

## Project File Structure

```
/ (project root)
├── index.html          ← Entire PWA: all HTML, CSS, and JS in one file
├── sw.js               ← Service Worker: caching, offline support, push capture
├── manifest.json       ← PWA manifest: name, icons, display mode, shortcuts
├── vercel.json         ← Vercel deployment config: routing + serverless functions
├── package.json        ← Node.js engine version declaration (Node 20 for Vercel)
│
├── api/
│   └── live.js         ← Vercel serverless function: YouTube live stream detector
│
├── functions/
│   ├── index.js        ← Firebase Cloud Function: schedules OneSignal push reminders
│   └── package.json    ← Cloud Function dependencies (firebase-admin, firebase-functions)
│
├── notices/            ← Folder for Notices & Flyers images (not included in repo)
│   ├── Notice1.jpg
│   ├── Notice2.jpg
│   ├── ...
│   └── Notice12.jpg    ← Up to 12 images; missing files are silently skipped
│
├── map.jpg             ← Static venue map fallback image (optional)
├── logo.png            ← App logo
├── icon-192.png        ← PWA home screen icon (192×192)
└── icon-512.png        ← PWA splash screen icon (512×512)
```

---

## Configuration Constants

All configuration lives near the top of `index.html` (around line 3077). The following values must be updated for a new deployment:

| Constant | Location | Purpose |
|---|---|---|
| `FIREBASE_CONFIG` | `index.html` | Firebase project credentials (apiKey, authDomain, projectId, etc.) |
| `ONESIGNAL_APP_ID` | `index.html` | OneSignal Web Push App ID |
| `ONESIGNAL_SAFARI_WEB_ID` | `index.html` | OneSignal Safari Web Push ID |
| `GCAL_KEY` | `index.html` | Google API key (used for Calendar + YouTube) |
| `CALENDAR_ID` | `index.html` | Google Calendar ID for event data |
| `YT_PLAYLIST` | `index.html` | YouTube playlist ID for the Videos section |
| `CHURCH_SHEET_URL` | `index.html` | Public Google Sheets CSV URL for Find a Church data |
| `FORM_URL` | `index.html` | Fillout.com form URL for the Convocation Feedback survey |
| `onesignal.rest_key` | Firebase Functions config | OneSignal REST API key (server-side only — set via `firebase functions:config:set`) |

---

## Screens & Features

### 1. Home / Dashboard (`#screen-home`)
**Auto-populates from:** Google Calendar (all-day event), Firebase Auth (user name), Firestore `/notifications`, OneSignal PushLogDB (IndexedDB)

- **Welcome banner** — Greets the user by first name (from Firebase Auth profile). The subgreeting line shows the name of the current/upcoming all-day calendar event (e.g. "61st Annual Holy Convocation"), populated dynamically from the Google Calendar all-day event's `summary` field.
- **Countdown card** — Counts down to the next upcoming all-day event. Label reads `"{Event Name} Begins In"`. Automatically hides when the event is in progress or has passed. Data source: Google Calendar.
- **Live Stream banner** — Hidden by default. Appears automatically when `@ucjcapostolic` is detected as live by `/api/live.js`. Polling interval: 60 seconds. Clicking opens the live stream URL in a new tab.
- **Convocation Feedback survey banner** — Always visible. Opens a fullscreen modal iframe to the Fillout.com form. To hide: add `hidden` to the element's class (`id="home-form-banner"`).
- **Latest Update card** — Shows the most recent notification from either Firestore `/notifications` or the local OneSignal push log (whichever is more recent). Clicking navigates to the Updates / Announcements screen.
- **Quick-action grid** — Links to Schedule, Chat, Updates, Directory, Venue Map, and Give.
- **Today's Sessions** — Timed sessions from Google Calendar that fall on today's date and within the active all-day event's date range.
- **Venue Map card** — Displays a cached map image generated from the active event's `location` field using OpenStreetMap tiles. Falls back to `map.jpg` if the generated image is unavailable. Shows a greyed-out placeholder if neither is available.

---

### 2. Schedule (`#screen-schedule`)
**Auto-populates from:** Google Calendar

- Fetches all events from the Google Calendar for the current/upcoming all-day event's date range. Events outside that range (e.g. from previous years) are excluded automatically.
- Date tabs across the top auto-generate from event dates.
- **Hashtag filtering** — Events in the calendar description can include any of the following hashtags to tag sessions. Tags are stripped from the displayed description but appear as filter pills: `#men`, `#women`, `#youth`, `#youngadult`, `#ordination`, `#consecration`, `#rehearsal`, `#pastors`, `#bishops`. Multiple filters can be selected simultaneously (OR logic — any matching tag shows the event).
- **Line breaks** — Line breaks in Google Calendar event descriptions are preserved in the session detail modal.
- **Bookmarking** — Tapping the bookmark icon saves the session to `users/{uid}/bookmarks/{eventId}` in Firestore.

---

### 3. Updates / Announcements (`#screen-announcements`)
**Auto-populates from:** Firestore `/notifications` + OneSignal push log (IndexedDB — `ucjc-onesignal-log`)

- **Recent Updates section** — Merges two data sources:
  1. **Firestore `/notifications`** — Admin writes `{ title, body, type, createdAt }` documents here via Firebase Console or any admin tool. Document `type` can be `announcement`, `calendar`, `urgent`, or `prayer` to control the icon displayed.
  2. **OneSignal PushLogDB** (IndexedDB) — Captures pushes received on this device.
  - Both sources are filtered to the last 24 hours, merged, deduplicated by title+body, and sorted newest-first.
- **Convocation Feedback banner** — Same as on the Home screen (`id="annc-form-banner"`). To hide: add `hidden` to the class.
- **Notices & Flyers grid** — Auto-probes `notices/Notice1.jpg` through `notices/Notice12.jpg`. Any missing files are silently skipped. The entire section is hidden if no images exist. Clicking an image opens a fullscreen pinch/zoom lightbox.
- **Videos section** — Fetches the YouTube playlist specified by `YT_PLAYLIST`. Cached for performance.

#### To post a Firestore notification (visible to all users within 24 hours):
Firebase Console → Firestore → `notifications` → Add document:
```
title:     "Your Title Here"        (string)
body:      "Full message text"      (string)
type:      "announcement"           (string: announcement | calendar | urgent | prayer)
createdAt: <timestamp>              (timestamp — click the calendar icon)
```

---

### 4. My Plan (`#screen-my-schedule`)
**Auto-populates from:** Firestore `users/{uid}/bookmarks/`

- Shows only bookmarked sessions that belong to the **currently active event** (sessions outside the active all-day event's date range are excluded). Users see a helpful message if they have bookmarks from a different event.
- Each card shows the full day of week and date (e.g. "Wednesday, June 18").
- **Session reminders** — Toggle on the reminder switch and select a time offset. The Firebase Cloud Function (`functions/index.js`) schedules a OneSignal push notification via `send_after` for `(session start − reminder minutes)`. This works even when the app is closed, via APNs (iOS) or FCM (Android). Requires Firebase Blaze plan.

---

### 5. Subscribers Directory (`#screen-directory`)
**Auto-populates from:** Firestore `users/` collection

- Lists all registered users who have set their profile as visible.
- Searchable by name or home church.
- Direct messaging is currently **disabled** (commented out). To re-enable: see the commented-out DM tab/panel HTML and restore `onclick="startDM(...)"` on subscriber cards.

---

### 6. Chat (`#screen-chat`)
**Data stored in:** Firestore `chat/global/messages` and `chatGroups/`

All chat groups use the `chatGroups` Firestore collection. The app detects group type via flag fields.

#### Chat tabs (visible):
- **Prayer Requests** — Write-only for regular users (submit a prayer request). Users with the `isPrayerGroup: true` group membership see a full bidirectional chat. Data stored in `chatGroups/{prayerGroupId}/messages`. Submissions tagged `type: 'prayer_request'`.
- **Departments** — Four sub-tabs: Men, Women, Youth, Young Adult. Same write-only / member-chat pattern as Prayer. Each department is a separate `chatGroups` document with `isDepartmentGroup: true` and `departmentKey: 'men'|'women'|'youth'|'youngadult'`.
- **Contact Admin** — Write-only for regular users. Admin members see all submissions. Group document uses `isAdminGroup: true`.
- **Dynamic group chats** — Any `chatGroups` document with `active: true` and none of the special flags creates a member-only group chat tab automatically.

#### Disabled (commented out, infrastructure intact):
- **Group Chat** — The global channel (`chat/global/messages`). Re-enable by removing the HTML comment blocks around the tab button and panel, and reverting `currentChatPanel` to `'global'`.
- **Direct Messages** — Re-enable by removing HTML comment blocks around the DM tab and panel, restoring `onclick="startDM(...)"` on subscriber cards, and reverting `currentChatPanel` to `'dms'`.

#### Firestore structure for chat groups:
```
chatGroups/{groupId}
  name:              string
  description:       string (optional)
  active:            boolean
  createdAt:         timestamp
  isAdminGroup:      boolean (optional) — Contact Admin
  isPrayerGroup:     boolean (optional) — Prayer Requests
  isDepartmentGroup: boolean (optional) — Departments
  departmentKey:     string  (optional) — 'men' | 'women' | 'youth' | 'youngadult'
  /members/{uid}
    joinedAt:        timestamp
  /messages/{id}
    senderId:        string
    senderName:      string
    homeChurch:      string
    text:            string
    type:            string (optional) — 'prayer_request' | 'department_request' | 'public_submission'
    createdAt:       timestamp
```

---

### 7. Profile & Settings (`#screen-profile`)
**Data stored in:** Firestore `users/{uid}`

- Displays and edits: display name, home church, role, phone.
- Push notification toggle — calls OneSignal permission prompt (web) or `median.onesignal.register()` (Median native wrapper).
- Default session reminder time selector.
- Theme toggle (dark/light).
- Change password.

---

### 8. Venue Map (modal overlay)
**Auto-populates from:** Active Google Calendar all-day event `location` field

- On app load, the active event's `location` field is geocoded via Nominatim (OpenStreetMap). An OSM tile canvas is generated and saved to IndexedDB (`MapDB` store, keyed by SHA-256 hash of the address).
- Subsequent loads read from IndexedDB — fully offline once generated.
- Fallback: `map.jpg` in the project root is shown if no generated map exists.
- Supports pinch-to-zoom, scroll-wheel zoom, and click-and-drag panning.
- Zoom control buttons (+/−/FIT) are fully functional on both touch and mouse.

---

### 9. Find a Church (`#screen-find-church`)
**Data source:** Public Google Sheet CSV at `CHURCH_SHEET_URL`

Google Sheet column format (0-indexed):
| Column | Content |
|---|---|
| 0 | Church Name |
| 1 | Address |
| 2 | Phone |
| 3 | Latitude |
| 4 | Longitude |

- PapaParse fetches the CSV once per session on first visit to this screen.
- User taps "Use My Location" (browser geolocation) or types a city/zip code (geocoded via Nominatim).
- Haversine formula calculates distances. Results are sorted nearest-first and filtered by the selected radius (5–50 miles).
- Map: Leaflet + OpenStreetMap tiles. Markers placed for each result.
- Radius dropdown re-filters without re-fetching.

**To update church data:** Edit the Google Sheet. Changes are reflected the next time a user visits the screen (data is fetched fresh each session, not cached across sessions).

---

### 10. RSVP — 4th of July Cookout
**Data stored in:** Firestore `events/july4cookout/rsvps/{uid}`

- Currently **disabled** (banners are commented out). Re-enable by removing the HTML comment blocks around the RSVP card on the home and announcements screens.
- Each user submits one document: `{ uid, name, guestCount, attending: true|false, submittedAt }`.
- A live Firestore listener shows a running total of attending guests across all RSVPs in real time.
- Users who are not attending submit with `attending: false, guestCount: 0` — these are excluded from the guest headcount but shown in the "not attending" count.

---

### 11. Live Stream Detection
**Powered by:** `api/live.js` (Vercel Serverless Function)

- The PWA calls `GET /api/live` every 60 seconds while the app is in the foreground.
- Checks are paused when the tab/app is backgrounded (saves battery and network).
- The serverless function fetches `youtube.com/@ucjcapostolic/live`, follows HTTP redirects, and checks if the final URL is a `/watch?v=VIDEO_ID` URL.
- Returns `{ live: true, url: "https://youtube.com/watch?v=..." }` or `{ live: false }`.
- When live: a red pulsing "🔴 Live Now" banner appears on the Home screen and a "Watch Live Stream" button appears in the drawer Tools section. Both link to the live video directly.
- Vercel edge cache: `s-maxage=55` — only one real outbound YouTube request per 55 seconds regardless of concurrent users.

---

### 12. Push Notifications
**Powered by:** OneSignal Web SDK v5 + Median JS Bridge

Two delivery paths chosen automatically at runtime:

| Environment | Detection | Mechanism |
|---|---|---|
| Median-wrapped native app | `window.median` or `window.gonative` present | `median.onesignal.register()` + `setExternalUserId(uid)` |
| Browser / installed PWA | Fallback | OneSignal Web SDK v5 (`OneSignalDeferred` queue) |

- **Identity linking:** Firebase UID is set as OneSignal `external_id` on sign-in via `OneSignal.login(uid)` (web) or `median.onesignal.setExternalUserId(uid)` (native). This allows targeting specific users from the OneSignal dashboard.
- **Foreground interception:** Pushes received while the app is open appear as in-app toasts. They are also logged to IndexedDB (`ucjc-onesignal-log` database, `notifications` store) for the Updates screen history.
- **Background capture:** `sw.js` has its own `push` listener that logs to the same IndexedDB store even when the app is closed.
- **Session reminders** (scheduled pushes): handled by the Firebase Cloud Function, not the client — see My Plan above.

---

### 13. Convocation Feedback Survey
**Powered by:** Fillout.com — `FORM_URL` in `index.html`

- Banners on both the Home screen (`id="home-form-banner"`) and the Updates screen (`id="annc-form-banner"`) open a fullscreen iframe modal.
- The iframe `src` is set lazily (only when the user taps the banner) to avoid loading Fillout on every page load.
- The form resets on each open (src is cleared on modal close).
- **To hide the banner:** Add `hidden` to the element's `class` attribute. A comment above each banner element explains this.
- **To re-enable date-gating** (show only during last 2 days of event): see the commented-out `updateFormBanner()` function and its call site in `initializeConvocationCountdown()`.

---

## Firebase Firestore Collections Reference

| Collection | Purpose | Who writes |
|---|---|---|
| `users/{uid}` | User profiles | Users (self), admin |
| `users/{uid}/bookmarks/{eventId}` | Bookmarked sessions + reminder settings | Users (self) |
| `users/{uid}/notes/{eventId}` | Session notes | Users (self) |
| `notifications/{id}` | Push notification history (read-only for clients) | Admin via Firebase Console |
| `events/july4cookout/rsvps/{uid}` | Cookout RSVP responses | Users (self) |
| `chat/global/messages` | Global group chat (disabled) | Members |
| `chatGroups/{groupId}/members/{uid}` | Group membership | Admin |
| `chatGroups/{groupId}/messages/{id}` | Group chat messages | Any auth user (create); members only (read) |

---

## Service Worker (`sw.js`)

- Cache name: `ucjc-convocation-v4` — increment this value to force all clients to update to a new version.
- Pre-caches: `/`, `/index.html`, `/logo.png`, `/map.jpg`, `/icon-192.png`, `/icon-512.png`.
- Network-first fetch strategy with cache fallback for offline support.
- OneSignal SDK is loaded via `importScripts()` wrapped in `try/catch` — if the CDN is unreachable, the SW still registers and handles push display itself.
- Local reminder notifications (from the My Plan bookmark system) are triggered via `postMessage({ type: 'SCHEDULE_REMINDER', ... })` from the main thread.

---

## Deployment (Vercel)

1. Push all files to a Git repository connected to Vercel, or run `vercel deploy` from the project root.
2. No build step required — `vercel.json` sets `"buildCommand": null` and `"outputDirectory": "."`.
3. `api/live.js` is auto-detected as a serverless function by Vercel from its location in the `/api` directory.
4. Node version is pinned to 20.x via `package.json` `engines` field.

**Required environment / config:**
```bash
# OneSignal REST key for the Cloud Function (server-side only — never in client code)
firebase functions:config:set onesignal.rest_key="YOUR_REST_API_KEY"
firebase deploy --only functions
```

Requires Firebase **Blaze (pay-as-you-go)** plan for Cloud Functions outbound network calls.

---

## Files That Auto-Populate at Runtime

| File / Source | What it populates |
|---|---|
| Google Calendar (via `CALENDAR_ID` + `GCAL_KEY`) | Banner title, event dates, venue/location, countdown, Schedule screen, Today's Sessions, My Plan date filter |
| Firestore `users/{uid}` | User name, avatar, home church, push preference, theme |
| Firestore `users/{uid}/bookmarks/` | My Plan session list, bookmark indicators on schedule cards |
| Firestore `users/{uid}/notes/` | Notes tab inside session detail modal |
| Firestore `notifications/` | Updates screen Recent Updates section, Home screen Latest Update card |
| Firestore `chatGroups/` | Chat tab bar (dynamic group tabs), Prayer/Dept/Admin channel routing |
| Firestore `events/july4cookout/rsvps/` | RSVP tally on home + announcements cards and inside RSVP modal |
| OneSignal PushLogDB (IndexedDB `ucjc-onesignal-log`) | Updates screen Recent Updates, Home Latest Update card |
| MapDB (IndexedDB) | Venue map tile image on home screen and in map modal |
| YouTube playlist (`YT_PLAYLIST`) | Videos section on Updates / Announcements screen |
| Google Sheet CSV (`CHURCH_SHEET_URL`) | Find a Church screen church list and map markers |
| `/api/live.js` (Vercel function) | Live stream banner on Home screen and drawer button |
| `notices/Notice1.jpg` – `notices/Notice12.jpg` | Notices & Flyers grid on Updates screen |
| `map.jpg` (project root) | Fallback venue map image if OSM-generated map is unavailable |

---

## Notices & Flyers Setup

Place image files in a `notices/` subfolder alongside `index.html`:

```
notices/Notice1.jpg
notices/Notice2.jpg
...
notices/Notice12.jpg
```

- Any filename in the sequence that does not exist is silently skipped — no broken image icons, no empty gaps.
- If none of the 12 files exist, the entire Notices & Flyers section is hidden.
- Supported format: `.jpg` (filenames are case-sensitive on Linux servers).
- Tapping an image opens a fullscreen pinch/zoom lightbox with no labels or captions.
