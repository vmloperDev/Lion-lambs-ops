// api/cron-resync.ts
//
// This is the single "alarm clock" for the periodic full resync + self-heal,
// replacing the old design where every open browser tab ran its own
// independent 10-minute timer (client-side `startPeriodicReSync`, now
// removed from src/sheetsSync.ts). Whether 0 browsers or 40 browsers have the
// app open makes no difference anymore — this is the only place a full
// resync ever runs from.
//
// WHY THIS EXISTS (see CRON_SETUP.md for the full story):
//   - Multiple open browsers used to each run their own full resync every
//     10 minutes, multiplying Google Sheets API calls with no coordination.
//   - If NOBODY had the app open, self-heal and auto-delete-catch-up never
//     ran at all — a hand-edited/deleted sheet row could sit wrong forever.
// This endpoint fixes both: exactly one execution, on a fixed schedule,
// regardless of how many people are using the app right now.
//
// HOW IT'S TRIGGERED:
//   Vercel's native `vercel.json` cron only allows once-per-day on the
//   Hobby plan — too infrequent for this. So instead, an EXTERNAL scheduler
//   (e.g. cron-job.org, a scheduled GitHub Actions workflow, etc.) calls this
//   URL every 20 minutes with a secret header. See CRON_SETUP.md for the
//   exact setup steps.
//
// ENV VARS required, IN ADDITION to the ones sheets-append.ts already needs:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   (already exists — reused, see note below)
//   GOOGLE_PRIVATE_KEY             (already exists — reused, see note below)
//   GOOGLE_SHEET_ID                (already exists — reused)
//   FIREBASE_PROJECT_ID            (NEW — your Firebase project ID; this is
//                                   NOT secret, it's the same value visible in
//                                   your client-side firebase.ts config)
//   CRON_RESYNC_SECRET             (NEW — a secret string YOU generate; give
//                                   this to your external scheduler so it can
//                                   prove it's allowed to trigger this route)
//
// IMPORTANT ONE-TIME SETUP: the existing Google service account
// (GOOGLE_SERVICE_ACCOUNT_EMAIL) was only ever granted access to your Google
// Sheet, not to your Firestore data. Reusing the same service account here
// (rather than creating a whole separate credential) means you just need to
// grant it ONE additional IAM role in Google Cloud Console:
//     IAM & Admin → find the service account → Edit → Add Role
//     → "Cloud Datastore User" (this covers Firestore in Native mode too)
// Full walkthrough is in CRON_SETUP.md.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getAccessToken, FIRESTORE_SCOPE, runFullResyncCycle, tryAcquireLock, releaseLock, type BookingPayload } from './_lib/sheetsCore.js'
import { getBookingClientTotal, getBookingReportingNettTotal, getBookingLltpAmount, bookingHasLltpInput, getBreakdownTotal, getBookingTaCommInfo } from '../src/utils.js'
import type { BookingFormData } from '../src/types.js'

// ── Firestore REST helpers ─────────────────────────────────────────────────────
// We talk to Firestore over its plain REST API (same JWT-signing approach
// already used for Sheets in sheetsCore.ts) rather than pulling in the
// `firebase-admin` package — one less dependency, one less thing that can be
// misconfigured, and it keeps this project's existing "raw REST + Web Crypto"
// style consistent across both integrations.

type FirestoreValue = {
  stringValue?: string
  integerValue?: string
  doubleValue?: number
  booleanValue?: boolean
  nullValue?: null
  timestampValue?: string
  arrayValue?: { values?: FirestoreValue[] }
  mapValue?: { fields?: Record<string, FirestoreValue> }
}

function fromFirestoreValue(v: FirestoreValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue
  if (v.integerValue !== undefined) return Number(v.integerValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.booleanValue !== undefined) return v.booleanValue
  if (v.timestampValue !== undefined) return v.timestampValue
  if (v.nullValue !== undefined) return null
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fromFirestoreValue)
  if (v.mapValue !== undefined) return fromFirestoreFields(v.mapValue.fields || {})
  return undefined
}

function fromFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) out[key] = fromFirestoreValue(value)
  return out
}

function toFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const out: Record<string, FirestoreValue> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) out[key] = { nullValue: null }
    else if (typeof value === 'string') out[key] = { stringValue: value }
    else if (typeof value === 'number') out[key] = { doubleValue: value }
    else if (typeof value === 'boolean') out[key] = { booleanValue: value }
    else if (Array.isArray(value)) out[key] = { arrayValue: { values: value.map(v => toFirestoreFields({ v })['v']) } }
    else out[key] = { stringValue: String(value) }
  }
  return out
}

async function firestoreFetch(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return res
}

// ── Fetch every booking across every user, the same way the app's own
// `collectionGroup(db, 'bookings')` listener does client-side ─────────────────
async function fetchAllBookings(token: string, projectId: string): Promise<(Record<string, unknown> & { id: string })[]> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`

  const res = await firestoreFetch(token, `${base}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: { from: [{ collectionId: 'bookings', allDescendants: true }] },
    }),
  })
  if (!res.ok) throw new Error(`Firestore runQuery failed: ${res.status} ${await res.text()}`)
  const rows = await res.json() as { document?: { name: string; fields?: Record<string, FirestoreValue> } }[]

  const bookings: (Record<string, unknown> & { id: string })[] = []
  for (const row of rows) {
    if (!row.document) continue // heartbeat-only entry, no actual document
    const id = row.document.name.split('/').pop() || ''
    bookings.push({ id, ...fromFirestoreFields(row.document.fields || {}) })
  }
  // A single runQuery call reliably returns everything for any realistic
  // size of this app's booking collection. If this business ever grows into
  // tens of thousands of bookings, this is the spot to add cursor-based
  // pagination (Firestore's runQuery doesn't paginate automatically the way
  // its list-documents endpoint does).
  return bookings
}

// ── Overlap lock ────────────────────────────────────────────────────────────────
// Prevents two resync cycles from ever running at the same time — whether
// because the external scheduler double-fired, or because one cycle ran
// long enough to still be going when the next one was due. A lock older
// than the shared LOCK_STALE_MS (see sheetsCore.ts) is treated as abandoned
// (e.g. a previous run crashed without cleaning up) so the job can never get
// permanently stuck. This now uses the SAME lock doc as the instant-sync
// endpoint (sheets-append.ts), so a cron cycle and a user's booking save can
// never read-modify-write the sheet at the same time — that overlap was the
// root cause of duplicate rows.
const STATUS_DOC = '_syncMeta/syncStatus'

async function writeStatus(token: string, projectId: string, status: Record<string, unknown>): Promise<void> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
  await firestoreFetch(token, `${base}/${STATUS_DOC}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFirestoreFields({ ...status, lastSyncAt: new Date().toISOString() }) }),
  }).catch(err => console.error('[cron-resync] Failed to write status doc:', err))
}

// ── Map a raw Firestore booking doc into the payload shape Sheets needs ────────
// Mirrors `toPayload()` in src/sheetsSync.ts exactly, reusing the SAME total-
// calculation functions from src/utils.ts (rather than re-deriving gross/nett/
// profit math a second time here) so the numbers in the sheet can never drift
// from what the app itself would compute for the same booking.
function toBookingPayload(raw: Record<string, unknown> & { id: string }): BookingPayload {
  const booking = raw as unknown as BookingFormData & { id: string; createdAt: string }
  const clientTotal    = getBookingClientTotal(booking)
  const breakdownGrossTotal = getBreakdownTotal(booking)
  const nettTotal       = getBookingReportingNettTotal(booking)
  const lltpAmount      = getBookingLltpAmount(booking)
  const hasLltp         = bookingHasLltpInput(booking)
  const amountPaid      = parseFloat((booking.invoiceAmountPaid as string) || '0')
  const invoiceBalance  = Math.max(clientTotal - amountPaid, 0)
  const taComm           = getBookingTaCommInfo(booking)

  return {
    bookingId: raw.id,
    createdAt: (raw.createdAt as string) || '',
    clientName: (raw.clientName as string) || '',
    travelStart: (raw.travelStart as string) || '',
    travelEnd: (raw.travelEnd as string) || '',
    packageName: (raw.packageName as string) || '',
    sellingPrice: String(clientTotal),
    breakdownGrossTotal: String(breakdownGrossTotal),
    nettCost: String(nettTotal),
    lltpAmount: String(lltpAmount),
    hasLltp: String(hasLltp),
    invoiceAmountPaid: (raw.invoiceAmountPaid as string) || '',
    invoiceBalance: String(invoiceBalance),
    status: (raw.status as string) || '',
    currency: (raw.currency as string) || 'PHP',
    acr: (raw.acr as string) || '',
    taCommAmount: String(taComm.amount),
    taCommAgent: taComm.agent,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID
  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID
  const CRON_RESYNC_SECRET = process.env.CRON_RESYNC_SECRET

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID || !FIREBASE_PROJECT_ID) {
    return res.status(500).json({ error: 'Missing required environment variables (see CRON_SETUP.md).' })
  }

  // This route can read every user's bookings and rewrite the whole sheet —
  // a much bigger blast radius than a public URL should have. Refuse to run
  // at all if no secret is configured, rather than silently leaving it open.
  if (!CRON_RESYNC_SECRET) {
    return res.status(500).json({ error: 'CRON_RESYNC_SECRET is not configured — refusing to run an unsecured cron endpoint.' })
  }
  const authHeader = req.headers['authorization']
  const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query?.secret as string | undefined)
  if (providedSecret !== CRON_RESYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let sheetsToken: string
  let firestoreToken: string
  try {
    sheetsToken = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, 'https://www.googleapis.com/auth/spreadsheets')
    firestoreToken = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, FIRESTORE_SCOPE)
  } catch (err) {
    console.error('[cron-resync] Auth failed:', err)
    return res.status(500).json({ error: `Google auth failed: ${String(err)}` })
  }

  let lockResult: { acquired: boolean; reason?: string }
  try {
    lockResult = await tryAcquireLock(firestoreToken, FIREBASE_PROJECT_ID)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron-resync] Failed to acquire sync lock:', message)
    return res.status(500).json({ error: message })
  }
  if (!lockResult.acquired) {
    console.log('[cron-resync] Another run is still active — skipping this invocation.')
    return res.status(200).json({ ok: true, skipped: true, reason: lockResult.reason })
  }

  try {
    const rawBookings = await fetchAllBookings(firestoreToken, FIREBASE_PROJECT_ID)
    const eligible = rawBookings
      .filter(b => b.status === 'Confirmed' || b.status === 'Flown')
      .map(toBookingPayload)

    const result = await runFullResyncCycle(sheetsToken, GOOGLE_SHEET_ID, eligible)

    await writeStatus(firestoreToken, FIREBASE_PROJECT_ID, {
      ok: result.failedTabs.length === 0,
      tabs: result.tabs.join(', '),
      failedTabs: result.failedTabs.join(', '),
      healed: result.healed,
      warnings: result.warnings.join(' | '),
      totalEligibleBookings: eligible.length,
    })

    return res.status(200).json({ ok: true, ...result, totalEligibleBookings: eligible.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron-resync] Full resync failed:', message)
    await writeStatus(firestoreToken, FIREBASE_PROJECT_ID, { ok: false, warnings: message })
    return res.status(500).json({ error: message })
  } finally {
    await releaseLock(firestoreToken, FIREBASE_PROJECT_ID)
  }
}
