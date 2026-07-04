// src/sheetsSync.ts
// Two sync modes:
//
// 1. INSTANT sync — when a single booking is saved/changed, it's sent immediately
//    as a single-booking POST. Uses a sequential queue so rapid saves don't pile up.
//    A booking that's deleted in the app is also removed from the sheet instantly
//    (see deleteBookingFromSheets).
//
// 2. PERIODIC re-sync — every 10 minutes, ALL confirmed/flown bookings are sent
//    in ONE batch POST (grouped by month tab server-side). A single request per
//    re-sync cycle means zero concurrency, zero races, zero missing rows.
//    This pass also SELF-HEALS: it carries `reconcile: true`, so the server
//    removes any sheet row whose _id isn't in this complete booking list
//    (e.g. a row deleted directly in the sheet gets re-added by the upsert
//    logic, and a row for a booking that no longer exists in the app gets
//    removed) and overwrites any row whose cells were hand-edited in the sheet.

import type { BookingRecord, BookingStatus } from './types'
import { getBookingClientTotal, getBookingBreakdownNettTotal } from './utils'

const TRIGGER_STATUSES = new Set<BookingStatus>(['Confirmed', 'Flown'])

export function shouldSyncToSheets(status: BookingStatus): boolean {
  return TRIGGER_STATUSES.has(status)
}

// ── Shared payload builder ────────────────────────────────────────────────────

function toPayload(booking: BookingRecord) {
  const clientTotal    = getBookingClientTotal(booking)
  const nettTotal      = getBookingBreakdownNettTotal(booking)
  const estProfit      = clientTotal - nettTotal
  const amountPaid     = parseFloat(booking.invoiceAmountPaid || '0')
  const invoiceBalance = Math.max(clientTotal - amountPaid, 0)

  return {
    bookingId:         booking.id,
    createdAt:         booking.createdAt,
    clientName:        booking.clientName,
    travelStart:       booking.travelStart,
    travelEnd:         booking.travelEnd,
    packageName:       booking.packageName,
    sellingPrice:      String(clientTotal),
    nettCost:          String(nettTotal),
    estProfit:         String(estProfit),
    invoiceAmountPaid: booking.invoiceAmountPaid,
    invoiceBalance:    String(invoiceBalance),
    status:            booking.status,
    currency:          booking.currency || 'PHP',
  }
}

// ── 1. Instant sync — sequential queue with startup-burst debounce ───────────
// On app load Firestore fires every confirmed/flown booking as 'added' at once.
// Without debouncing, each one enqueues its own POST → 33 sequential API calls
// → 66+ Sheets reads in seconds → 429.
//
// Fix: collect all calls that arrive within the first STARTUP_WINDOW_MS (3s).
// If more than BATCH_THRESHOLD arrive in that window they're flushed as one
// batch POST (same path as the periodic re-sync). After the window closes, or
// for single saves that arrive later, we fall back to individual POSTs as before.

const STARTUP_WINDOW_MS  = 3_000   // collect burst for 3 seconds
const BATCH_THRESHOLD    = 5       // ≥5 bookings → send as a batch

let _startupWindowOpen   = true
let _startupBuffer: ReturnType<typeof toPayload>[] = []
let _startupTimer: ReturnType<typeof setTimeout> | null = null
let syncQueue: Promise<void> = Promise.resolve()

// Close the startup window after STARTUP_WINDOW_MS. If we collected enough
// bookings, flush them as one batch; otherwise drain individually as usual.
function _scheduleStartupFlush() {
  if (_startupTimer !== null) return
  _startupTimer = setTimeout(() => {
    _startupWindowOpen = false
    const buffered = _startupBuffer.splice(0)
    if (buffered.length === 0) return

    if (buffered.length >= BATCH_THRESHOLD) {
      // Flush as a single batch POST — same shape as the periodic re-sync
      console.log(`[sheetsSync] Startup batch: sending ${buffered.length} bookings in one request`)
      syncQueue = syncQueue.then(() => _postWithRetry(
        { bookings: buffered },
        /* isBatch */ true,
      ))
    } else {
      // Small number — queue individually (avoids the batch overhead)
      for (const payload of buffered) {
        const p = payload
        syncQueue = syncQueue.then(() => _postWithRetry(p, false))
      }
    }
  }, STARTUP_WINDOW_MS)
}

async function _postWithRetry(body: object, isBatch: boolean): Promise<void> {
  let lastError = ''
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('/api/sheets-append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 429) {
        const wait = attempt * 15_000
        console.warn(`[sheetsSync] Rate limited, retrying in ${wait / 1000}s…`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }

      if (!res.ok) {
        const text = await res.text()
        console.warn('[sheetsSync] Server error:', text)
      } else if (isBatch) {
        const data = await res.json() as { tabs?: string[] }
        console.log('[sheetsSync] Startup batch complete. Tabs:', data.tabs?.join(', ') ?? '—')
      }
      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 5_000 * attempt))
    }
  }
  if (lastError) console.warn('[sheetsSync] Gave up after 3 attempts:', lastError)
}

export function syncBookingToSheets(booking: BookingRecord): void {
  if (!shouldSyncToSheets(booking.status)) return

  const payload = toPayload(booking)

  if (_startupWindowOpen) {
    // Buffer during the startup window — we'll decide batch vs individual when
    // the window closes (see _scheduleStartupFlush above).
    _startupBuffer.push(payload)
    _scheduleStartupFlush()
    return
  }

  // Normal path: outside the startup window — queue individually.
  syncQueue = syncQueue.then(async () => {
    await _postWithRetry(payload, false)
    // Small gap after each request to stay under Google's rate limit
    await new Promise(r => setTimeout(r, 300))
  })
}

// ── 1b. Instant delete — booking removed from the app ─────────────────────────
// Fired immediately when a booking doc is deleted in Firestore so its row
// disappears from the sheet right away rather than waiting for the next
// periodic reconcile pass (which still catches it as a fallback if this
// request fails or the app was offline when the deletion happened).

export function deleteBookingFromSheets(booking: Pick<BookingRecord, 'id' | 'createdAt'>): void {
  if (!booking.id) return
  const body = { action: 'delete', bookingId: booking.id, createdAt: booking.createdAt }

  syncQueue = syncQueue.then(async () => {
    let lastError = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('/api/sheets-append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, attempt * 15_000))
          continue
        }
        if (!res.ok) {
          console.warn('[sheetsSync] Delete failed:', await res.text())
        } else {
          const data = await res.json() as { deleted?: boolean }
          console.log(`[sheetsSync] Delete ${data.deleted ? 'removed row for' : 'found no row for'} ${booking.id}`)
        }
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt < 3) await new Promise(r => setTimeout(r, 5_000 * attempt))
      }
    }
    if (lastError) console.warn('[sheetsSync] Delete gave up after 3 attempts:', lastError)
    await new Promise(r => setTimeout(r, 300))
  })
}

// ── 2. Periodic re-sync — single batch request ────────────────────────────────
// Sends ALL confirmed/flown bookings in one POST so the server can process each
// month tab atomically with no concurrent invocations racing each other.

export function startPeriodicReSync(
  getBookings: () => BookingRecord[],
): () => void {
  const INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

  async function runReSync() {
    const eligible = getBookings().filter(b => shouldSyncToSheets(b.status))
    if (eligible.length === 0) return

    console.log(`[sheetsSync] Periodic re-sync — sending ${eligible.length} bookings in one batch`)

    let lastError = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('/api/sheets-append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookings: eligible.map(toPayload), reconcile: true }),
        })

        if (res.status === 429) {
          const wait = attempt * 30_000
          console.warn(`[sheetsSync] Re-sync rate limited, retrying in ${wait / 1000}s…`)
          await new Promise(r => setTimeout(r, wait))
          continue
        }

        if (!res.ok) {
          const body = await res.text()
          console.warn('[sheetsSync] Re-sync server error:', body)
        } else {
          const data = await res.json() as { tabs?: string[]; healed?: number }
          console.log('[sheetsSync] Re-sync complete. Tabs updated:', data.tabs?.join(', ') ?? '—')
          if (data.healed) console.log(`[sheetsSync] Self-heal: removed ${data.healed} orphan row(s) (deleted in sheet or app)`)
        }
        return
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt < 3) await new Promise(r => setTimeout(r, 10_000 * attempt))
      }
    }
    if (lastError) console.warn('[sheetsSync] Re-sync gave up after 3 attempts:', lastError)
  }

  const id = window.setInterval(() => { void runReSync() }, INTERVAL_MS)
  return () => window.clearInterval(id)
}
