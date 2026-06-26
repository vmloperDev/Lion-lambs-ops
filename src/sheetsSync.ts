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

let syncQueue: Promise<void> = Promise.resolve()
const pendingIds = new Set<string>() // dedupe: skip if same booking already queued

export function syncBookingToSheets(booking: BookingRecord): void {
  if (!shouldSyncToSheets(booking.status)) return

  // If this exact booking is already waiting in the queue, skip — the queued
  // call will use fresh data anyway since we pass the booking object by value.
  // But if it's not queued, add it.
  if (pendingIds.has(booking.id)) return
  pendingIds.add(booking.id)

  syncQueue = syncQueue.then(async () => {
    pendingIds.delete(booking.id)
    try {
      await doSync(booking)
    } catch (err) {
      console.warn('[sheetsSync] Unhandled error:', err)
    }
    // Small gap between requests — keeps us well under Google's 60 writes/min
    await new Promise(r => setTimeout(r, 500))
  })
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
          bookingId:        booking.id,           // used as stable row key
          createdAt:        booking.createdAt,
          clientName:       booking.clientName,
          travelStart:      booking.travelStart,
          travelEnd:        booking.travelEnd,
          packageName:      booking.packageName,
          sellingPrice:     String(clientTotal),
          nettCost:         String(nettTotal),
          estProfit:        String(estProfit),
          invoiceAmountPaid: booking.invoiceAmountPaid,
          invoiceBalance:   String(invoiceBalance),
          status:           booking.status,
          currency:         booking.currency || 'PHP',
        }),
      })

      if (res.status === 429) {
        // Rate limited — wait and retry
        const wait = attempt * 15000 // 15s, 30s
        console.warn(`[sheetsSync] Rate limited, retrying in ${wait / 1000}s...`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }

      if (!res.ok) {
        const body = await res.text()
        console.warn('[sheetsSync] Failed:', body)
      }
      return // success (or non-retryable failure)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000 * attempt))
    }
  }
  if (lastError) console.warn('[sheetsSync] Gave up after 3 attempts:', lastError)
}
