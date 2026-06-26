// src/sheetsSync.ts
// Calls the /api/sheets-append Vercel function when a booking is Confirmed or Flown.
// Uses a sequential queue so concurrent snapshot updates never race each other —
// requests go one at a time with a small gap to stay under Google's rate limit.

import type { BookingRecord, BookingStatus } from './types'
import { getBookingClientTotal, getBookingBreakdownNettTotal } from './utils'

const TRIGGER_STATUSES = new Set<BookingStatus>(['Confirmed', 'Flown'])

export function shouldSyncToSheets(status: BookingStatus): boolean {
  return TRIGGER_STATUSES.has(status)
}

// ── Sequential queue ─────────────────────────────────────────────────────────
// Prevents concurrent API calls that cause missing rows and duplicate tabs.
// Each booking sync is queued and runs one after the other.
//
// NOTE: deduplication was removed. The old guard dropped bookings that fired
// twice on first load (Firestore sends all docs as 'added' on initial snapshot,
// and a rapid second update could be silently skipped). The queue already
// serialises requests; dedup was causing the "not everything is sent" bug.

let syncQueue: Promise<void> = Promise.resolve()

export function syncBookingToSheets(booking: BookingRecord): void {
  if (!shouldSyncToSheets(booking.status)) return

  syncQueue = syncQueue.then(async () => {
    try {
      await doSync(booking)
    } catch (err) {
      console.warn('[sheetsSync] Unhandled error:', err)
    }
    // Small gap between requests — keeps us under Google's 60 writes/min.
    // 200 ms is enough headroom; the API calls themselves take ~500–800 ms each.
    await new Promise(r => setTimeout(r, 200))
  })
}

// ── Periodic re-sync ──────────────────────────────────────────────────────────
// Runs every 10 minutes and re-pushes all Confirmed/Flown bookings to the sheet.
// This self-heals the spreadsheet if someone deletes, edits, or moves a row
// within the same month tab. Each booking is matched by its bookingId in
// column J, so existing rows are overwritten in place — no duplicates created.
//
// Call startPeriodicReSync(bookings) from a useEffect in App.tsx, passing the
// live bookings array. Returns a cleanup function to clear the interval.

export function startPeriodicReSync(
  getBookings: () => BookingRecord[],
): () => void {
  const INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

  function runReSync() {
    const bookings = getBookings()
    const eligible = bookings.filter(b => shouldSyncToSheets(b.status))
    console.log(`[sheetsSync] Periodic re-sync — pushing ${eligible.length} bookings`)
    eligible.forEach(b => syncBookingToSheets(b))
  }

  const id = window.setInterval(runReSync, INTERVAL_MS)
  return () => window.clearInterval(id)
}

async function doSync(booking: BookingRecord): Promise<void> {
  const clientTotal = getBookingClientTotal(booking)
  const nettTotal   = getBookingBreakdownNettTotal(booking)
  const estProfit   = clientTotal - nettTotal
  const amountPaid  = parseFloat(booking.invoiceAmountPaid || '0')
  const invoiceBalance = Math.max(clientTotal - amountPaid, 0)

  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('/api/sheets-append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      })

      if (res.status === 429) {
        const wait = attempt * 15000
        console.warn(`[sheetsSync] Rate limited, retrying in ${wait / 1000}s...`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }

      if (!res.ok) {
        const body = await res.text()
        console.warn('[sheetsSync] Failed:', body)
      }
      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000 * attempt))
    }
  }
  if (lastError) console.warn('[sheetsSync] Gave up after 3 attempts:', lastError)
}
