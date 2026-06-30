/**
 * /api/live.js — Vercel Serverless Function
 * UCJC Holy Convocation — YouTube Live Stream Detector
 *
 * Strategy
 * ─────────
 * When @ucjcapostolic is streaming, YouTube issues a server-side
 * HTTP 302 redirect from  youtube.com/@ucjcapostolic/live
 * to                      youtube.com/watch?v=<VIDEO_ID>
 * When not live the page loads at the /live URL with no redirect,
 * or redirects to the channel home page.
 *
 * This function fetches the channel's /live page with redirect:follow,
 * then checks the final URL for a /watch?v= pattern.
 *
 * As a belt-and-suspenders fallback it also scans the response body
 * for YouTube's internal JSON markers, which survive even if YouTube
 * ever switches to client-side (non-HTTP) redirects.
 *
 * Caching
 * ───────
 * The response carries  Cache-Control: s-maxage=55, stale-while-revalidate=30
 * so Vercel's Edge Network serves a cached JSON response for 55 s.
 * Across all users checking every 60 s, only ONE real outbound request
 * reaches YouTube per minute rather than one per active device.
 *
 * Response shape
 * ──────────────
 * Live:     { "live": true,  "url": "https://www.youtube.com/watch?v=..." }
 * Not live: { "live": false }
 * Error:    { "live": false, "error": "check_failed" }   (HTTP 200 — safe for clients)
 */

const CHANNEL_HANDLE = 'ucjcapostolic';
const LIVE_URL       = `https://www.youtube.com/@${CHANNEL_HANDLE}/live`;
const FETCH_TIMEOUT  = 10_000; // ms — YouTube should respond within 10 s

/** Shared CORS headers — allows the PWA, Median wrapper, or any origin to call this. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Parse a video ID out of a YouTube watch URL.
 * Returns null if the URL does not contain a valid video ID.
 * @param {string} urlStr
 * @returns {string|null}
 */
function extractVideoId(urlStr) {
  try {
    const u = new URL(urlStr);
    // Standard: youtube.com/watch?v=ID
    const v = u.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    // Short: youtu.be/ID
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('?')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
  } catch (_) {}
  return null;
}

/**
 * Scan the page body for YouTube's internal JSON signals.
 * Used as a fallback when the URL alone is not conclusive.
 * @param {string} body
 * @returns {{ live: boolean, videoId: string|null }}
 */
function scanBody(body) {
  // YouTube embeds canonical URL and live status in inline JSON
  const isLive =
    body.includes('"isLive":true') ||
    body.includes('"liveBroadcastContent":"live"') ||
    body.includes('"isLiveNow":true');

  // Extract video ID from canonical URL embedded in the HTML
  const canonical = body.match(
    /"(?:canonical_url|canonicalUrl)"\s*:\s*"(https:\\?\/\\?\/(?:www\.)?youtube\.com\\?\/watch\\?[^"]+)"/
  );
  let videoId = null;
  if (canonical) {
    // Unescape JSON string escaping (\\/ → /)
    const url = canonical[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    videoId = extractVideoId(url);
  }

  // Alternative: look for videoId directly in the JSON payload
  if (!videoId) {
    const vidMatch = body.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/);
    if (vidMatch) videoId = vidMatch[1];
  }

  return { live: isLive, videoId };
}

/**
 * Main handler.
 * @param {import('@vercel/node').VercelRequest}  req
 * @param {import('@vercel/node').VercelResponse} res
 */
module.exports = async function handler(req, res) {
  // ── CORS preflight ────────────────────────────────────────────────
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Fetch the channel's /live page ───────────────────────────────
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let response, body, finalUrl;
  try {
    response = await fetch(LIVE_URL, {
      method:   'GET',
      redirect: 'follow',           // follow HTTP 302 redirects
      signal:   controller.signal,
      headers: {
        // Present as a real browser — YouTube may return different content
        // or block requests that look like bots.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/125.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });
    clearTimeout(timer);

    finalUrl = response.url;       // URL after following all redirects
    body     = await response.text();
  } catch (err) {
    clearTimeout(timer);
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    console.error('[live] fetch failed:', reason);
    // Return "not live" rather than a 5xx so clients degrade gracefully
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ live: false, error: 'check_failed' });
  }

  // ── Primary check: did YouTube redirect to a watch URL? ───────────
  const videoIdFromUrl = extractVideoId(finalUrl);
  if (videoIdFromUrl) {
    const watchUrl = `https://www.youtube.com/watch?v=${videoIdFromUrl}`;
    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
    return res.status(200).json({ live: true, url: watchUrl });
  }

  // ── Fallback: scan the response body for live markers ────────────
  // Covers cases where YouTube uses JS-based navigation instead of
  // a plain HTTP redirect, or embeds live data in the initial HTML.
  const { live: liveInBody, videoId: videoIdFromBody } = scanBody(body);

  if (liveInBody && videoIdFromBody) {
    const watchUrl = `https://www.youtube.com/watch?v=${videoIdFromBody}`;
    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
    return res.status(200).json({ live: true, url: watchUrl });
  }

  if (liveInBody) {
    // Live signal found but no clean video ID — return the /live page URL
    // so at worst the user lands on the channel's live tab
    res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
    return res.status(200).json({ live: true, url: LIVE_URL });
  }

  // ── Not live ─────────────────────────────────────────────────────
  // Cache "not live" for the same window; the poller will re-check at
  // the next interval regardless.
  res.setHeader('Cache-Control', 's-maxage=55, stale-while-revalidate=30');
  return res.status(200).json({ live: false });
};
