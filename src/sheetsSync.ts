// src/sheetsSync.ts
// Two sync modes:
//
// 1. INSTANT sync — when a single booking is saved/changed, it's sent immediately
//    as a single-booking POST. Uses a sequential queue so rapid saves don't pile up.
//    A booking that's deleted in the app is also removed from the sheet instantly
//    (see deleteBookingFromSheets).
//
// 2. PERIODIC re-sync — moved OUT of the client and into api/cron-resync.ts,
//    triggered on a schedule by an external scheduler (see CRON_SETUP.md).
//    It's no longer this module's job to run it — see the big comment further
//    down where `startPeriodicReSync` used to live for why.

import type { BookingRecord, BookingStatus } from './types'
import { getBookingClientTotal, getBookingReportingNettTotal, getBookingTaCommInfo } from './utils'

const TRIGGER_STATUSES = new Set<BookingStatus>(['Confirmed', 'Flown'])
const SYNC_SECRET = import.meta.env.VITE_SHEETS_SYNC_SECRET as string | undefined

function syncHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (SYNC_SECRET) headers['x-sync-secret'] = SYNC_SECRET
  return headers
}

export function shouldSyncToSheets(status: BookingStatus): boolean {
  return TRIGGER_STATUSES.has(status)
}

// ── Surfacing sync problems to the UI ─────────────────────────────────────────
// This module used to only console.warn on failures/skips, which meant a
// booking could silently fail to reach the sheet with nothing in the app
// telling the user. App.tsx registers a handler here (e.g. wired to the
// existing `dataError`-style banner) so real problems become visible.
//
// The handler used to be a single `(message: string) => void` — each new
// issue overwrote the last one in the UI, so if two different things failed
// back to back, only the second was ever seen. It's now called with the full
// rolling list (newest first, capped) so nothing silently disappears from view.
export type SyncIssue = { message: string; at: number; key?: string }
type SyncIssueHandler = (issues: SyncIssue[]) => void
let _onSyncIssue: SyncIssueHandler | null = null
const MAX_TRACKED_ISSUES = 5
let _recentIssues: SyncIssue[] = []

export function setSheetsSyncIssueHandler(handler: SyncIssueHandler | null): void {
  _onSyncIssue = handler
  if (handler) handler(_recentIssues)
}

// `key` identifies the *kind* of failure (e.g. "delete-429"), not the exact
// text. Repeated hits of the same kind (very common with something like a
// Sheets 429 that keeps firing on every delete while the quota is exhausted)
// just refresh the existing banner's message/timestamp instead of stacking a
// new one, so the list can't fill the screen with near-duplicates. Issues
// with no key (e.g. one-off warnings from the server) always get their own
// entry, same as before.
function reportIssue(message: string, key?: string): void {
  console.warn(`[sheetsSync] ${message}`)
  const now = Date.now()
  if (key) {
    const existingIdx = _recentIssues.findIndex((issue) => issue.key === key)
    if (existingIdx !== -1) {
      const updated = { message, at: now, key }
      _recentIssues = [updated, ..._recentIssues.filter((_, i) => i !== existingIdx)]
      _onSyncIssue?.(_recentIssues)
      return
    }
  }
  _recentIssues = [{ message, at: now, key }, ..._recentIssues].slice(0, MAX_TRACKED_ISSUES)
  _onSyncIssue?.(_recentIssues)
}

// ── Last successful sync ──────────────────────────────────────────────────────
// Lets the UI show "Last synced 2 min ago" so a stuck/silent sync (e.g. every
// attempt hitting the same error) is visible even if no error banner is up.
type SyncSuccessHandler = (at: number) => void
let _onSyncSuccess: SyncSuccessHandler | null = null

export function setSheetsSyncSuccessHandler(handler: SyncSuccessHandler | null): void {
  _onSyncSuccess = handler
}

function reportSuccess(): void {
  _onSyncSuccess?.(Date.now())
}

// ── Shared payload builder ────────────────────────────────────────────────────

function toPayload(booking: BookingRecord) {
  const clientTotal    = getBookingClientTotal(booking)
  const nettTotal      = getBookingReportingNettTotal(booking)
  const estProfit      = clientTotal - nettTotal
  const amountPaid     = parseFloat(booking.invoiceAmountPaid || '0')
  const invoiceBalance = Math.max(clientTotal - amountPaid, 0)
  const taComm          = getBookingTaCommInfo(booking)

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
    acr:               booking.acr || '',
    taCommAmount:      String(taComm.amount),
    taCommAgent:       taComm.agent,
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

// BUG FIX: these were only ever "true" once, on module load. The debounce
// they guard is meant to catch the burst of `added` events Firestore fires
// whenever a full onSnapshot listener (re)subscribes — which happens not
// just on first page load, but also on token refresh, tab refocus after
// being offline, or sign-out/sign-in. Without re-arming, only the very
// first burst got batched; every later resubscribe burst (which can easily
// be 20-30+ bookings) went out as individual sequential POSTs instead,
// which is exactly the 429-storm this debounce exists to prevent.
// App.tsx calls this at the start of its onSnapshot effect, every time the
// listener (re)subscribes, so the burst-batching applies every time.
export function resetSyncStartupWindow(): void {
  _startupWindowOpen = true
  _startupBuffer = []
  if (_startupTimer !== null) {
    clearTimeout(_startupTimer)
    _startupTimer = null
  }
}

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
  let sawRateLimit = false
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('/api/sheets-append', {
        method: 'POST',
        headers: syncHeaders(),
        body: JSON.stringify(body),
      })

      if (res.status === 429) {
        sawRateLimit = true
        if (attempt < maxAttempts) {
          const wait = attempt * 15_000
          console.warn(`[sheetsSync] Rate limited, retrying in ${wait / 1000}s…`)
          await new Promise(r => setTimeout(r, wait))
          continue
        }
        // Last attempt also hit 429 — fall through to the reporting below
        // instead of silently dropping this booking. This used to just
        // exit the loop here with `lastError` still empty (that's only set
        // in the `catch` block for network failures), so a booking that
        // got rate-limited on every single retry vanished with no warning
        // and no further retry — a real, hard-to-notice source of "some
        // bookings never made it to the sheet."
        break
      }

      if (!res.ok) {
        const text = await res.text()
        reportIssue(`A booking failed to sync to Google Sheets (server said: ${text || res.status}).`, 'push-failed')
      } else {
        const data = await res.json() as { tabs?: string[]; warnings?: string[] }
        if (isBatch) console.log('[sheetsSync] Startup batch complete. Tabs:', data.tabs?.join(', ') ?? '—')
        data.warnings?.forEach((w) => reportIssue(w))
        reportSuccess()
      }
      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 5_000 * attempt))
    }
  }
  if (sawRateLimit) {
    reportIssue(`A booking couldn't sync to Google Sheets — still rate-limited after 3 tries. It will retry automatically on the next change or the next scheduled re-sync.`, 'push-rate-limited')
  } else if (lastError) {
    reportIssue(`Couldn't reach Google Sheets after 3 tries (${lastError}). It will retry automatically on the next change or the next scheduled re-sync.`, 'push-network-fail')
  }
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
    let sawRateLimit = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('/api/sheets-append', {
          method: 'POST',
          headers: syncHeaders(),
          body: JSON.stringify(body),
        })
        if (res.status === 429) {
          sawRateLimit = true
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, attempt * 15_000))
            continue
          }
          // Exhausted every attempt still rate-limited — same bug as the
          // push path: this used to just fall out of the loop here with
          // `lastError` still empty, so it silently gave up with no
          // warning and no further retry. The periodic re-sync is a real
          // fallback for this (see comment above), but the user should
          // still be told a delete didn't go through instantly.
          break
        }
        if (!res.ok) {
          reportIssue(`Deleting a booking from Google Sheets failed (server said: ${await res.text()}). The next scheduled re-sync (every 20 minutes) will clean it up.`, 'delete-failed')
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
    if (sawRateLimit) {
      reportIssue(`Deleting a booking from Google Sheets failed — still rate-limited after 3 tries. The next scheduled re-sync (every 20 minutes) will clean it up.`, 'delete-rate-limited')
    } else if (lastError) {
      reportIssue(`Couldn't reach Google Sheets to delete a row after 3 tries (${lastError}). The next scheduled re-sync (every 20 minutes) will clean it up.`, 'delete-network-fail')
    }
    await new Promise(r => setTimeout(r, 300))
  })
}

// ── 2. Periodic re-sync — REMOVED from the client ─────────────────────────────
// This used to be a `window.setInterval` here that ran a full batch re-sync
// every 10 minutes FROM EVERY OPEN BROWSER TAB independently. Two real
// problems came from that:
//   1. Every open browser ran its own full resync with no coordination —
//      4 people with the app open meant 4x the Google Sheets API calls for
//      the exact same data, multiplying rate-limit risk for no benefit.
//   2. If nobody had the app open, self-heal and orphan-row cleanup never
//      ran at all, no matter how long the app sat closed.
// The periodic resync (with self-heal/reconcile) now lives entirely in
// api/cron-resync.ts, triggered on a fixed schedule by an external scheduler
// (see CRON_SETUP.md) — exactly ONE execution, regardless of how many
// browsers are open or whether any are open at all. `startPeriodicReSync`
// and its `window.setInterval` are gone; nothing in the client needs to call
// it anymore. The app instead subscribes to a small Firestore status
// document that the cron job writes after each run — see the
// `_syncMeta/syncStatus` listener in App.tsx — to show "last synced" and any
// warnings in the UI, the same as before.
