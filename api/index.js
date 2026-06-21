/* ================================================================
   UCJC Holy Convocation — Cloud Functions
   functions/index.js
   ================================================================

   PURPOSE
   ───────
   The client app's local reminder system (setTimeout + Service
   Worker showNotification) only fires while the app/tab is actually
   open and running. That's fine while someone is actively using the
   app, but it cannot reliably wake the device hours later when the
   app is closed — especially inside the Median-wrapped native app,
   where background JavaScript execution is suspended/killed by the
   OS, just like any other native app.

   This function closes that gap by scheduling a REAL push
   notification through OneSignal's REST API, using their `send_after`
   parameter — OneSignal holds the notification server-side and
   delivers it through APNs (iOS) / FCM (Android) / Web Push at the
   exact future time, regardless of whether the app is open,
   backgrounded, or fully closed. This works automatically for BOTH
   the Median-wrapped native app AND any web/PWA install, because
   both link the same Firebase UID as the OneSignal "external_id"
   (already implemented in index.html via OneSignal.login(uid) for
   web, and median.onesignal.setExternalUserId(uid) for the native
   wrapper) — OneSignal delivers to whichever subscription(s) exist
   under that external_id automatically.

   WHY THIS HAS TO BE A CLOUD FUNCTION (NOT CLIENT-SIDE)
   ───────────────────────────────────────────────────────
   Scheduling a push via OneSignal's REST API requires a secret REST
   API Key. That key must never be embedded in browser/app JavaScript
   — anyone could extract it from the page and use it to send push to
   your entire audience. Cloud Functions run server-side, so the key
   stays out of any client-delivered code.

   TRIGGER
   ───────
   Fires on every write (create/update/delete) to:
     users/{uid}/bookmarks/{eventId}
   which is exactly the document the client already writes to when a
   user bookmarks a session and/or toggles its reminder — no client
   changes were needed beyond what already existed.

   BEHAVIOR
   ────────
   - reminderEnabled:true + future event  → schedules (or reschedules)
     a OneSignal push for (event start − reminderMinutes)
   - reminderEnabled:false, bookmark deleted, or event already in the
     past → cancels any previously scheduled push for that bookmark
   - Stores the returned OneSignal notification id back onto the
     bookmark doc (oneSignalNotificationId) so it can be cancelled
     later if the reminder is changed or removed
================================================================ */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
admin.initializeApp();

/* Same OneSignal Web Push App ID already configured in index.html. */
const ONESIGNAL_APP_ID = 'a1acf09d-ff98-49ba-927b-c726d8d28753';

/* ⚠️ SETUP REQUIRED — set this before deploying:
     firebase functions:config:set onesignal.rest_key="YOUR_REST_API_KEY"
   Get the REST API Key from: OneSignal Dashboard → Settings →
   Keys & IDs → REST API Key. This is a SECRET — never put it in any
   client-side file, only here (server-side Cloud Function config). */
const ONESIGNAL_REST_API_KEY = functions.config().onesignal?.rest_key;

const ONESIGNAL_NOTIFICATIONS_URL = 'https://onesignal.com/api/v1/notifications';

/* ── Cancel a previously scheduled (not-yet-delivered) push ───────── */
async function cancelOneSignalNotification(notificationId) {
  if (!notificationId || !ONESIGNAL_REST_API_KEY) return;
  try {
    const resp = await fetch(
      `${ONESIGNAL_NOTIFICATIONS_URL}/${notificationId}?app_id=${ONESIGNAL_APP_ID}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}` }
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn('OneSignal cancel non-OK response:', resp.status, text);
    }
  } catch (e) {
    console.warn('Failed to cancel OneSignal notification', notificationId, e);
  }
}

/* ── Schedule a new push via send_after ────────────────────────────
   Uses include_aliases.external_id (current OneSignal REST API
   targeting format) to reach whichever subscription(s) — web push,
   or the Median-wrapped native app's OneSignal registration — are
   currently linked to this Firebase UID.
   NOTE: if your OneSignal account/API version expects the older
   field name instead, swap `include_aliases: { external_id: [uid] },
   target_channel: 'push'` for the legacy equivalent:
   `include_external_user_ids: [uid]`. */
async function scheduleOneSignalNotification(uid, { title, body, sendAfter, eventId }) {
  if (!ONESIGNAL_REST_API_KEY) {
    console.error('ONESIGNAL_REST_API_KEY not configured — run: firebase functions:config:set onesignal.rest_key="..."');
    return null;
  }

  const payload = {
    app_id: ONESIGNAL_APP_ID,
    include_aliases: { external_id: [uid] },
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    send_after: sendAfter.toISOString(),
    data: { type: 'reminder', eventId }
  };

  try {
    const resp = await fetch(ONESIGNAL_NOTIFICATIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    const json = await resp.json();
    if (json.id) return json.id;
    console.error('OneSignal schedule error:', json);
    return null;
  } catch (e) {
    console.error('OneSignal request failed:', e);
    return null;
  }
}

/* ── Main trigger ──────────────────────────────────────────────── */
exports.onBookmarkReminderWrite = functions.firestore
  .document('users/{uid}/bookmarks/{eventId}')
  .onWrite(async (change, context) => {
    const { uid, eventId } = context.params;
    const before = change.before.exists ? change.before.data() : null;
    const after  = change.after.exists  ? change.after.data()  : null;

    // Bookmark deleted entirely — cancel any pending push, nothing more to do.
    if (!after) {
      if (before?.oneSignalNotificationId) {
        await cancelOneSignalNotification(before.oneSignalNotificationId);
      }
      return null;
    }

    const reminderEnabled = !!after.reminderEnabled;
    const reminderMinutes = after.reminderMinutes || 15;
    const startISO        = after.start;

    // Reminder turned off, or missing required data — cancel any pending push.
    if (!reminderEnabled || !startISO) {
      if (before?.oneSignalNotificationId) {
        await cancelOneSignalNotification(before.oneSignalNotificationId);
        await change.after.ref
          .update({ oneSignalNotificationId: admin.firestore.FieldValue.delete() })
          .catch(() => {});
      }
      return null;
    }

    const startTime = new Date(startISO);
    const sendAfter  = new Date(startTime.getTime() - reminderMinutes * 60000);
    const now        = new Date();

    // Too late to schedule a future push — skip, and clean up any stale one.
    if (sendAfter <= now) {
      if (before?.oneSignalNotificationId) {
        await cancelOneSignalNotification(before.oneSignalNotificationId);
        await change.after.ref
          .update({ oneSignalNotificationId: admin.firestore.FieldValue.delete() })
          .catch(() => {});
      }
      return null;
    }

    // Only (re)schedule if something relevant actually changed — avoids
    // re-scheduling on every unrelated field update to the bookmark doc
    // (e.g. notes, rating) which would otherwise fire on every write.
    const settingsChanged =
      !before ||
      before.reminderMinutes !== reminderMinutes ||
      before.start !== startISO ||
      !before.oneSignalNotificationId;

    if (!settingsChanged) return null;

    // Cancel any previous scheduled push before scheduling the new one.
    if (before?.oneSignalNotificationId) {
      await cancelOneSignalNotification(before.oneSignalNotificationId);
    }

    const title = '⏰ UCJC Reminder';
    const body  = `${after.title || 'Your session'} starts in ${reminderMinutes} minute${reminderMinutes === 1 ? '' : 's'}${after.location ? ' · ' + after.location : ''}`;

    const notificationId = await scheduleOneSignalNotification(uid, {
      title, body, sendAfter, eventId
    });

    if (notificationId) {
      await change.after.ref.update({ oneSignalNotificationId: notificationId });
    }

    return null;
  });
