// api/sheets-append.ts
// Vercel Serverless Function — the instant-sync + legacy manual-batch endpoint.
//
// The periodic FULL re-sync (with reconcile/self-heal) now lives in
// api/cron-resync.ts, triggered on a schedule by an external scheduler
// (Vercel Hobby only allows once-per-day native cron, so this project uses
// an outside scheduler instead — see CRON_SETUP.md). This file still handles:
//   - Instant single-booking sync when someone saves a booking in the app
//   - Instant single-booking delete when someone deletes a booking in the app
//   - The legacy `{ bookings: [...], reconcile: true }` batch shape, kept
//     working in case anything still calls it directly (e.g. manual testing)
//
// ENV VARS required (Vercel dashboard → Settings → Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_SHEET_ID
//   SHEETS_SYNC_SECRET (optional but recommended — see auth note below)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getAccessToken, SHEETS_SCOPE, FIRESTORE_SCOPE, sheetsGet, findAndDeleteRowById, runFullResyncCycle,
  syncSingleBooking, getMonthTabName, acquireLockWithRetry, releaseLock, type BookingPayload,
} from './_lib/sheetsCore.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID
  const SHEETS_SYNC_SECRET = process.env.SHEETS_SYNC_SECRET

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    return res.status(500).json({ error: 'Missing Google Sheets environment variables.' })
  }

  // ── Basic request auth ────────────────────────────────────────────────────
  // Without this, this endpoint is a public URL that accepts ANY POST body —
  // anyone who finds it could inject or delete rows in your sheet, including
  // via `action: 'delete'` or `reconcile: true`. If SHEETS_SYNC_SECRET is set
  // in Vercel's env vars, requests must include a matching x-sync-secret
  // header (the app sends this automatically via VITE_SHEETS_SYNC_SECRET).
  // NOTE: because this is a VITE_ variable it ships inside the client bundle,
  // so it only deters casual/automated abuse of a stumbled-upon URL — it is
  // not a substitute for real per-user auth.
  // Left OFF (unenforced) if SHEETS_SYNC_SECRET isn't set, so this doesn't
  // break your current deployment until you configure it.
  if (SHEETS_SYNC_SECRET) {
    const provided = req.headers['x-sync-secret']
    if (provided !== SHEETS_SYNC_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  // ── Overlap lock (same lock cron-resync.ts uses) ──────────────────────────
  // Without this, a booking save landing at the same moment the 20-min cron
  // resync is running can read column J before either write lands, both
  // conclude "this booking isn't in the sheet yet", and both append a row —
  // a duplicate, one with stale data and one with the fresh save. Every
  // operation below does a read-then-write against the sheet, so all of
  // them need to go through the lock. FIREBASE_PROJECT_ID is optional here
  // (older deployments that haven't set up cron-resync.ts yet won't have
  // it) — if it's missing, we skip locking and log a warning rather than
  // breaking instant sync outright, but duplicates remain possible until
  // it's configured.
  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID
  let firestoreToken: string | null = null
  let lockHeld = false

  try {
    const token = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SHEETS_SCOPE)

    if (FIREBASE_PROJECT_ID) {
      try {
        firestoreToken = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, FIRESTORE_SCOPE)
        lockHeld = await acquireLockWithRetry(firestoreToken, FIREBASE_PROJECT_ID)
        if (!lockHeld) {
          console.warn('[sheets-append] Proceeding without the sync lock — a cron cycle held it longer than expected.')
        }
      } catch (err) {
        console.error('[sheets-append] Could not acquire sync lock, proceeding without it:', err)
      }
    } else {
      console.warn('[sheets-append] FIREBASE_PROJECT_ID not set — running without overlap protection against the cron resync. See CRON_SETUP.md.')
    }

    // Fetch current sheet list once — shared across all operations below
    const meta = await sheetsGet(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}?fields=sheets.properties`,
    ) as { sheets?: { properties: { title: string; sheetId: number } }[] }
    const existingSheets = (meta.sheets || []).map(s => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
    }))

    // ── Legacy batch mode: { bookings: BookingPayload[], reconcile?: true } ──
    // Kept for backwards compatibility / manual testing. The real periodic
    // resync now runs from api/cron-resync.ts instead of a client timer.
    if (Array.isArray(req.body?.bookings)) {
      const allBookings = req.body.bookings as BookingPayload[]
      const result = await runFullResyncCycle(token, GOOGLE_SHEET_ID, allBookings)
      return res.status(200).json({ ok: true, ...result })
    }

    // ── Delete mode: { action: 'delete', bookingId, createdAt } ───────────────
    // Fired immediately when a booking is deleted inside the app, so its row
    // disappears from the sheet right away instead of waiting for the next
    // periodic reconcile pass.
    if (req.body?.action === 'delete') {
      const { bookingId, createdAt } = req.body as { bookingId: string; createdAt?: string }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId.' })

      // Search the likely tab first (cheap correctness win if a same booking
      // ID somehow existed in two tabs — rare, but free to guard against),
      // then every other tab — all in a SINGLE Sheets API call via batchGet
      // rather than one call per tab (see findAndDeleteRowById for why).
      const primaryTab = getMonthTabName(createdAt || new Date().toISOString(), `booking ${bookingId}`)
      const orderedSheets = [
        ...existingSheets.filter(s => s.title === primaryTab),
        ...existingSheets.filter(s => s.title !== primaryTab),
      ]
      const deleted = await findAndDeleteRowById(token, GOOGLE_SHEET_ID, orderedSheets, bookingId)

      return res.status(200).json({ ok: true, deleted })
    }

    // ── Single booking mode: { bookingId, clientName, … } ─────────────────────
    const b = req.body as BookingPayload
    if (!b.status) {
      return res.status(400).json({ error: 'Missing required booking fields (status).' })
    }

    const { tabName, warnings } = await syncSingleBooking(token, GOOGLE_SHEET_ID, b, existingSheets)
    return res.status(200).json({ ok: true, tab: tabName, warnings })
  } catch (err) {
    console.error('[sheets-append]', err)
    return res.status(500).json({ error: String(err) })
  } finally {
    if (lockHeld && firestoreToken && FIREBASE_PROJECT_ID) {
      await releaseLock(firestoreToken, FIREBASE_PROJECT_ID)
    }
  }
}
