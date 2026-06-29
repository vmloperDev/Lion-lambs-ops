// src/sheetsSync.ts
// Two sync modes:
//
// 1. INSTANT sync — when a single booking is saved/changed, it's sent immediately
//    as a single-booking POST. Uses a sequential queue so rapid saves don't pile up.
//
// 2. PERIODIC re-sync — every 10 minutes, ALL confirmed/flown bookings are sent
//    in ONE batch POST (grouped by month tab server-side). A single request per
//    re-sync cycle means zero concurrency, zero races, zero missing rows.

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

// ── 1. Instant sync — sequential queue ───────────────────────────────────────
// Serialises rapid saves (e.g. user hits save three times quickly) so they
// don't arrive at the server out of order.

let syncQueue: Promise<void> = Promise.resolve()

export function syncBookingToSheets(booking: BookingRecord): void {
  if (!shouldSyncToSheets(booking.status)) return

  syncQueue = syncQueue.then(async () => {
    let lastError = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('/api/sheets-append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toPayload(booking)),
        })

        if (res.status === 429) {
          const wait = attempt * 15_000
          console.warn(`[sheetsSync] Rate limited, retrying in ${wait / 1000}s…`)
          await new Promise(r => setTimeout(r, wait))
          continue
        }

        if (!res.ok) {
          const body = await res.text()
          console.warn('[sheetsSync] Server error:', body)
        }
        return
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt < 3) await new Promise(r => setTimeout(r, 5_000 * attempt))
      }
    }
    if (lastError) console.warn('[sheetsSync] Gave up after 3 attempts:', lastError)

    // Small gap after each request to stay under Google's rate limit
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
          body: JSON.stringify({ bookings: eligible.map(toPayload) }),
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
          const data = await res.json() as { tabs?: string[] }
          console.log('[sheetsSync] Re-sync complete. Tabs updated:', data.tabs?.join(', ') ?? '—')
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
