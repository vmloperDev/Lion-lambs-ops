// src/sheetsSync.ts
// Calls the /api/sheets-append Vercel function when a booking becomes Confirmed or Flown.
// Fire-and-forget — a failure logs to console but never blocks the user.

import type { BookingRecord, BookingStatus } from './types'

const TRIGGER_STATUSES = new Set<BookingStatus>(['Confirmed', 'Flown'])

export function shouldSyncToSheets(status: BookingStatus): boolean {
  return TRIGGER_STATUSES.has(status)
}

export async function syncBookingToSheets(booking: BookingRecord): Promise<void> {
  if (!shouldSyncToSheets(booking.status)) return

  try {
    const res = await fetch('/api/sheets-append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        createdAt: booking.createdAt,
        clientName: booking.clientName,
        travelStart: booking.travelStart,
        travelEnd: booking.travelEnd,
        packageName: booking.packageName,
        sellingPrice: booking.sellingPrice,
        nettCost: booking.nettCost,
        invoiceAmountPaid: booking.invoiceAmountPaid,
        status: booking.status,
        currency: booking.currency || 'PHP',
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.warn('[sheetsSync] Failed to append row:', body)
    }
  } catch (err) {
    // Network errors are silent — never block the user
    console.warn('[sheetsSync] Network error:', err)
  }
}
