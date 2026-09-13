// api/_lib/sheetsCore.ts
//
// Shared Google Sheets logic. Originally this all lived inside
// api/sheets-append.ts, but the new api/cron-resync.ts needs the exact same
// tab-syncing / reconcile / formatting code — duplicating it would mean any
// future bug fix has to be made twice (and inevitably drifts). Everything
// here is pure logic with no HTTP-request-handling in it; both API routes
// import from this file and stay thin wrappers around it.
//
// NOTE: this file has no default export, so Vercel does not treat it as its
// own route — it's just a shared module.

// ── JWT auth ──────────────────────────────────────────────────────────────────
// Generalized to accept a scope, since cron-resync.ts needs a Firestore scope
// (https://www.googleapis.com/auth/datastore) in addition to the Sheets scope
// (https://www.googleapis.com/auth/spreadsheets) that sheets-append.ts uses.
// Tokens are cached per-scope so the two don't stomp on each other's cache.

const _tokenCache = new Map<string, { token: string; expiry: number }>()

export async function getAccessToken(email: string, privateKey: string, scope: string): Promise<string> {
  const cached = _tokenCache.get(scope)
  if (cached && Date.now() < cached.expiry - 60_000) return cached.token

  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${encode(header)}.${encode(payload)}`

  const keyData = privateKey.replace(/\\n/g, '\n')
  const pemBody = keyData
    .replace('-----BEGIN RSA PRIVATE KEY-----', '').replace('-----END RSA PRIVATE KEY-----', '')
    .replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', Buffer.from(pemBody, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(unsigned))
  const jwt = `${unsigned}.${Buffer.from(sig).toString('base64url')}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json() as { access_token: string }
  _tokenCache.set(scope, { token: access_token, expiry: Date.now() + 3600 * 1000 })
  return access_token
}

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
export const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'

// ── Shared Firestore lock ─────────────────────────────────────────────────────
// Originally this lived only in cron-resync.ts, guarding against two full
// resync cycles overlapping. But the instant per-booking sync in
// sheets-append.ts reads column J then writes back (read-modify-write) with
// NO coordination at all against the cron cycle doing the exact same
// read-modify-write on the exact same tab. If a booking is saved right as
// the 20-min cron fires, both requests can read column J before either has
// written anything back, both conclude "this booking ID isn't here yet", and
// both append a brand-new row for the same booking — one with whatever data
// was current when that request started, the other with the freshly-saved
// version. That's a duplicate row, not a sync failure, which is why it
// doesn't show up as an error anywhere.
// Moving the lock here so BOTH endpoints acquire the SAME lock before ANY
// read-modify-write against the sheet closes that window entirely.
const LOCK_STALE_MS = 5 * 60 * 1000 // a lock older than this is treated as an abandoned/crashed run, not a real overlap

export async function tryAcquireLock(
  token: string,
  projectId: string,
  lockDoc = '_syncMeta/cronLock',
): Promise<{ acquired: boolean; reason?: string }> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
  const getRes = await fetch(`${base}/${lockDoc}`, { headers: { Authorization: `Bearer ${token}` } })

  if (getRes.ok) {
    const doc = await getRes.json() as { fields?: { lockedAt?: { timestampValue?: string } } }
    const lockedAt = doc.fields?.lockedAt?.timestampValue
    if (lockedAt && Date.now() - new Date(lockedAt).getTime() < LOCK_STALE_MS) {
      return { acquired: false, reason: 'Another sync is currently in progress.' }
    }
    // Lock exists but is stale — fall through and reclaim it.
  } else if (getRes.status !== 404) {
    throw new Error(`Couldn't check the sync lock in Firestore (GET → ${getRes.status}: ${await getRes.text()}). This usually means the service account is missing Firestore access — see CRON_SETUP.md Step 1.`)
  }

  const putRes = await fetch(`${base}/${lockDoc}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { lockedAt: { timestampValue: new Date().toISOString() } } }),
  })
  if (!putRes.ok) {
    throw new Error(`Couldn't write the sync lock in Firestore (PATCH → ${putRes.status}: ${await putRes.text()}). This usually means the service account is missing Firestore access — see CRON_SETUP.md Step 1.`)
  }
  return { acquired: true }
}

export async function releaseLock(token: string, projectId: string, lockDoc = '_syncMeta/cronLock'): Promise<void> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
  await fetch(`${base}/${lockDoc}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
}

// Used by the instant-sync endpoint: rather than skip like the cron job does
// (a skipped instant sync would mean a user's save silently never reaches
// Sheets), poll briefly for the lock to free up — instant syncs and cron
// cycles both finish in a few seconds, so a short poll is enough to close the
// race without making anyone's save feel slow. If the lock is STILL held
// after the timeout (cron cycle running unusually long), proceed anyway
// rather than blocking the user's save indefinitely — a rare, brief overlap
// is a far smaller risk than a save silently never syncing at all.
export async function acquireLockWithRetry(
  token: string,
  projectId: string,
  lockDoc = '_syncMeta/cronLock',
  maxWaitMs = 12_000,
  pollMs = 750,
): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < maxWaitMs) {
    const result = await tryAcquireLock(token, projectId, lockDoc)
    if (result.acquired) return true
    await new Promise(r => setTimeout(r, pollMs))
  }
  return false
}

// ── Tab name ──────────────────────────────────────────────────────────────────

// A tab name is only ever trusted if it resolves to a year in this window.
// This exists because of a real bug we hit: a createdAt string with a
// truncated/zero-padded year (e.g. "0007-07-01" instead of "2007-07-01")
// gets split into y=7, and `new Date(7, m-1, 1)` triggers JS's legacy
// two-digit-year rule — any year 0-99 passed to the Date constructor is
// silently reinterpreted as 1900+y, turning "0007" into 1907. That produced
// the stray "Jul 1907"-style tabs with a single orphaned row in them.
// Rather than trust whatever the parser lands on, we sanity-check the
// resulting year and fall back to today's date (filing the booking into
// the current month) if it's outside a plausible operating range.
export const MIN_SANE_YEAR = 2015
export const MAX_SANE_YEAR = 2100

export function getMonthTabName(createdAt: string, context?: string): string {
  let d: Date
  const n = Number(createdAt)
  if (!isNaN(n) && String(createdAt).length >= 10) {
    d = n > 1e10 ? new Date(n) : new Date(n * 1000)
  } else if (/^\d{4}-\d{2}-\d{2}/.test(createdAt)) {
    const [y, m] = createdAt.split('-').map(Number)
    d = new Date(y, m - 1, 1)
  } else {
    d = new Date(createdAt)
  }

  const year = d.getFullYear()
  if (isNaN(d.getTime()) || year < MIN_SANE_YEAR || year > MAX_SANE_YEAR) {
    console.warn(
      `[sheetsCore] Rejected suspicious createdAt "${createdAt}"${context ? ` for ${context}` : ''} ` +
      `(resolved to year ${year}) — filing under today's month tab instead.`,
    )
    d = new Date()
  }

  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function fmtAmount(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtDate(iso: string): string {
  if (!iso) return ''
  let d: Date
  const n = Number(iso)
  if (!isNaN(n) && String(iso).length >= 10) {
    d = n > 1e10 ? new Date(n) : new Date(n * 1000)
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, day] = iso.split('-').map(Number)
    d = new Date(y, m - 1, day)
  } else {
    d = new Date(iso)
  }
  // Same corrupted-year guard as getMonthTabName (see comment there) — if
  // the resolved year is outside a sane window, show the raw stored value
  // instead of a confident-looking but wrong date like "Jul 3, 1907".
  const year = d.getFullYear()
  if (isNaN(d.getTime()) || year < MIN_SANE_YEAR || year > MAX_SANE_YEAR) return `⚠ ${iso}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Colors ────────────────────────────────────────────────────────────────────

function hex(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: 1 }
}

const HEADER_BG = hex(15, 40, 80)
const HEADER_FG = hex(255, 255, 255)
const ROW_TINT  = hex(235, 241, 251)
const ROW_WHITE = hex(255, 255, 255)
const GREEN_FG  = hex(27, 124, 55)
const RED_FG    = hex(182, 28, 28)
const GREEN_BG  = hex(220, 242, 228)
const RED_BG    = hex(250, 220, 220)

// ── Column config ─────────────────────────────────────────────────────────────

// TA Comm / Agent were added as columns K and L, pushing the hidden _id
// sentinel from J (index 9) to M (index 11). Every hardcoded column-letter
// range and row-index in this file (delete/reconcile/sync) was updated to
// match — search for "_id" in this file's comments if adding more columns.
const COL_WIDTHS  = [110, 180, 200, 260, 130, 130, 130, 120, 110, 120, 160, 1]
const HEADER_ROW  = ['Date Created', 'Client Name', 'Travel Date', 'Package', 'Gross', 'NETT', 'LLTP', 'Balance', 'Status', 'TA Comm', 'Agent', '_id']
// The _id column is always the last one in HEADER_ROW — used to actually
// hide it below, rather than just squeezing it to 1px (see comment there).
const ID_COL_INDEX = HEADER_ROW.length - 1

// ── Formatting request builders ───────────────────────────────────────────────

function buildHeaderRequests(sheetId: number) {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_BG,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            textFormat: { bold: true, fontSize: 10, foregroundColor: HEADER_FG, fontFamily: 'Arial' },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 40 },
        fields: 'pixelSize',
      },
    },
    ...COL_WIDTHS.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    })),
    // The 1px width above was never a real hide — Sheets enforces a minimum
    // rendered column width regardless of the requested pixelSize, so the
    // _id column was always visible as a thin sliver (worse now that it's
    // sitting further out at column M). This actually collapses it via the
    // same "hide column" mechanism as right-clicking a column → Hide column.
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: ID_COL_INDEX, endIndex: ID_COL_INDEX + 1 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    },
  ]
}

function buildDataRowRequests(sheetId: number, rowIndex: number, isPaid: boolean) {
  const rowBg = rowIndex % 2 === 0 ? ROW_TINT : ROW_WHITE
  return [
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
        properties: { pixelSize: 56 },
        fields: 'pixelSize',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: rowBg,
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            textFormat: { fontSize: 9, fontFamily: 'Arial', bold: false, foregroundColor: hex(30, 30, 30) },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,wrapStrategy,textFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 4, endColumnIndex: 8 },
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: isPaid ? RED_BG : GREEN_BG,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            textFormat: { bold: true, fontSize: 9, fontFamily: 'Arial', foregroundColor: isPaid ? RED_FG : GREEN_FG },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
      },
    },
    {
      // TA Comm (column K) is a currency amount like Gross/NETT/etc — right
      // align it too. Agent (column L) stays left-aligned (default), it's a name.
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 9, endColumnIndex: 10 },
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
  ]
}

// ── Sheets API helpers ────────────────────────────────────────────────────────

export async function sheetsGet(token: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function sheetsPut(token: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${url} → ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function sheetsPost(token: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`)
  return res.json()
}

// ── Tab ordering ─────────────────────────────────────────────────────────────
// Parses a tab title like "Jan 2026" → Date so we can sort chronologically.

function parseTabDate(title: string): number {
  const d = new Date(title + ' 1')
  return isNaN(d.getTime()) ? Infinity : d.getTime()
}

// Reorders all month-style tabs (e.g. "Jan 2026") chronologically oldest→newest,
// leaving any non-month tabs (e.g. "Dashboard") untouched at their current position.
export async function sortMonthTabs(
  token: string,
  spreadsheetId: string,
  sheets: { title: string; sheetId: number }[],
): Promise<void> {
  const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/

  const monthSheets  = sheets.filter(s => MONTH_RE.test(s.title))
  const otherSheets  = sheets.filter(s => !MONTH_RE.test(s.title))

  if (monthSheets.length < 2) return // nothing to sort

  const sorted = [...monthSheets].sort((a, b) => parseTabDate(a.title) - parseTabDate(b.title))

  // Build the full desired order: non-month tabs first (in their original positions),
  // then month tabs in chronological order at the end.
  const desiredOrder = [...otherSheets, ...sorted]

  const requests = desiredOrder.map((s, idx) => ({
    updateSheetProperties: {
      properties: { sheetId: s.sheetId, index: idx },
      fields: 'index',
    },
  }))

  await sheetsPost(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { requests },
  )
}

// ── Booking payload type ──────────────────────────────────────────────────────

export type BookingPayload = {
  bookingId: string
  createdAt: string
  clientName: string
  travelStart: string
  travelEnd: string
  packageName: string
  sellingPrice: string
  breakdownGrossTotal: string
  nettCost: string
  lltpAmount: string
  hasLltp: string
  invoiceAmountPaid: string
  invoiceBalance: string
  status: string
  currency: string
  acr: string
  taCommAmount: string
  taCommAgent: string
}

export const MONTH_TAB_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/

// ── Build a sheet row from a booking payload ──────────────────────────────────

// Shown in both the NETT and LLTP cells whenever a booking has no LLTP rate
// entered at all (Adult/Child/Senior/Infant, top of Pax-Tier Pricing) — with
// nothing entered there's no way to split the Breakdown's combined total
// into a real supplier NETT vs. LLTP, so a plain number would be misleading.
const NO_LLTP_MESSAGE = 'No LLTP entered — cannot be calculated'

function buildRow(b: BookingPayload) {
  // `gross` (sellingPrice) is the REAL invoice total — Breakdown + addons —
  // and stays the basis for balance/paid-status math below, since that's
  // real money the client owes. The Gross COLUMN shown in the sheet is a
  // different number: Breakdown-only, addon-free, so it always ties out
  // with NETT + LLTP (both of which are also addon-free). Older queued
  // payloads without breakdownGrossTotal fall back to sellingPrice as before.
  const gross   = parseFloat(b.sellingPrice   || '0')
  const grossForSheet = b.breakdownGrossTotal !== undefined ? parseFloat(b.breakdownGrossTotal) : gross
  // Older queued payloads (from before this field existed) won't have
  // `hasLltp` set — treat that as "yes" so existing bookings keep showing
  // their numbers instead of suddenly flipping to the no-LLTP message.
  const hasLltp = b.hasLltp !== 'false'
  const nett    = parseFloat(b.nettCost   || '0')
  const lltp    = parseFloat(b.lltpAmount || '0')
  const paid    = parseFloat(b.invoiceAmountPaid || '0')
  const balance = b.invoiceBalance !== undefined ? parseFloat(b.invoiceBalance) : Math.max(gross - paid, 0)
  const isPaid  = paid >= gross && gross > 0
  const cur     = b.currency || 'PHP'

  // The sheet is always in pesos. Bookings quoted in a foreign currency carry
  // a manually-entered ACR (Airline Conversion Rate — the same rate shown as
  // "ACR" on the Quotation/Invoice/PO) that converts 1 unit of that currency
  // to PHP. Amounts already in PHP pass through unchanged; a foreign-currency
  // booking with no ACR set yet still shows its native currency rather than a
  // silently wrong peso figure.
  const acrRate = parseFloat(b.acr || '')
  const hasAcr  = cur !== 'PHP' && acrRate > 0
  const toSheetAmount = (amount: number) =>
    cur === 'PHP'
      ? `PHP ${fmtAmount(amount)}`
      : hasAcr
        ? `PHP ${fmtAmount(amount * acrRate)}`
        : `${cur} ${fmtAmount(amount)}`

  const travelDate = b.travelStart && b.travelEnd
    ? `${fmtDate(b.travelStart)} – ${fmtDate(b.travelEnd)}`
    : fmtDate(b.travelStart || b.travelEnd)

  const taCommAmount = parseFloat(b.taCommAmount || '0')

  const row = [
    fmtDate(b.createdAt),
    b.clientName || '(No client name)',
    travelDate,
    b.packageName || '',
    toSheetAmount(grossForSheet),
    hasLltp ? toSheetAmount(nett) : NO_LLTP_MESSAGE,
    hasLltp ? toSheetAmount(lltp) : NO_LLTP_MESSAGE,
    balance > 0 ? toSheetAmount(balance) : '—',
    isPaid ? 'PAID' : 'PARTIALLY PAID',
    taCommAmount > 0 ? toSheetAmount(taCommAmount) : '—',
    b.taCommAgent || '',
    b.bookingId || '',
  ]

  return { row, isPaid, gross }
}

// ── Totals row ──────────────────────────────────────────────────────────────
// A synthetic last row per tab that sums Gross/NETT/LLTP/Balance across every
// real booking row above it. Identified by a sentinel value in column J (the
// same column real bookings use for their _id) so it's never mistaken for an
// orphaned booking row and swept away by reconcileTab, and never matched as
// "this is booking X" by the update-vs-append lookup.
//
// This is kept as a plain computed STRING (not a live `=SUM(...)` formula).
// The data cells are formatted display strings like "PHP 12,345.00", not
// numbers — a spreadsheet SUM() would just read those as text and add up to
// zero. Recomputing the total in JS and writing the result as text keeps it
// using the exact same formatting as every data row, and sidesteps having to
// depend on how Google Sheets does or doesn't auto-expand a formula's range
// when rows are inserted right at its boundary (that behaviour isn't
// reliable enough to build the "totals row always stays put + stays right"
// guarantee on).
export const TOTALS_ID_SENTINEL = '__TOTALS__'

export function parseSheetAmount(cell: string | undefined): number {
  if (!cell) return 0
  const n = parseFloat(cell.replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

// The 4 running totals this feature tracks, in column order (E,F,G,H).
type Totals = [gross: number, nett: number, lltp: number, balance: number]

function rowAmounts(row: string[] | undefined): Totals {
  return [
    parseSheetAmount(row?.[4]),
    parseSheetAmount(row?.[5]),
    parseSheetAmount(row?.[6]),
    parseSheetAmount(row?.[7]),
  ]
}

function addTotals(a: Totals, b: Totals, sign: 1 | -1 = 1): Totals {
  return [a[0] + sign * b[0], a[1] + sign * b[1], a[2] + sign * b[2], a[3] + sign * b[3]]
}

function buildTotalsRow(totals: Totals): string[] {
  const [gross, nett, lltp, balance] = totals
  return [
    'TOTAL', '', '', '',
    `PHP ${fmtAmount(gross)}`,
    `PHP ${fmtAmount(nett)}`,
    `PHP ${fmtAmount(lltp)}`,
    `PHP ${fmtAmount(balance)}`,
    '',
    '', '',
    TOTALS_ID_SENTINEL,
  ]
}

function buildTotalsRowFormatRequests(sheetId: number, rowIndex: number) {
  const GOLD_BG = hex(253, 233, 168)
  const NAVY_FG = hex(15, 40, 80)
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: GOLD_BG,
            verticalAlignment: 'MIDDLE',
            textFormat: { bold: true, fontSize: 10, fontFamily: 'Arial', foregroundColor: NAVY_FG },
            borders: {
              top: { style: 'SOLID_MEDIUM', color: NAVY_FG },
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,textFormat,borders)',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 4, endColumnIndex: 8 },
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    },
  ]
}

// ── Delete a single row by booking ID, searching across tabs ─────────────────
// This used to check one tab per Sheets API call: the likely tab first, then
// (if that missed — e.g. a stale/missing createdAt) every OTHER tab in the
// spreadsheet ONE AT A TIME. For a business with a year+ of history that's a
// dozen-plus sequential reads for a single delete, which on its own can blow
// through Google's 60-reads/min-per-user quota — especially with several
// deletes happening close together. A `values:batchGet` call can fetch the ID
// column for every tab in ONE request instead, so a delete now costs exactly
// 1 read no matter how many month tabs exist. `sheets` should list the likely
// tab first (if known) so a same-named duplicate ID elsewhere can't shadow
// the right row, though that's a rare edge case in practice.
export async function findAndDeleteRowById(
  token: string,
  spreadsheetId: string,
  sheets: { title: string; sheetId: number }[],
  bookingId: string,
): Promise<boolean> {
  if (sheets.length === 0) return false

  // E:L instead of just L:L — we need the amount columns (E-H) too, both for
  // the row being deleted (to subtract it out of the total) and for the
  // totals row itself (to read the current total and write the new one).
  const rangesQuery = sheets.map(s => `ranges=${encodeURIComponent(s.title + '!E:L')}`).join('&')
  const data = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${rangesQuery}`,
  ) as { valueRanges?: { values?: string[][] }[] }
  const valueRanges = data.valueRanges || []

  for (let i = 0; i < sheets.length; i++) {
    const rows = valueRanges[i]?.values || []
    const idCol = rows.map(r => r[7] || '') // column L is index 7 within the E:L range
    const rowIdx = idCol.findIndex((id, rowNum) => rowNum > 0 && id === bookingId)
    if (rowIdx === -1) continue

    const totalsRowIdx = idCol.findIndex(id => id === TOTALS_ID_SENTINEL)
    // Row values here are relative to column E (index 0 = col E), matching
    // what rowAmounts expects to find at indices 0-3 — but rowAmounts reads
    // a full A:J-style row (E at index 4). Shift the deleted/total rows so
    // their E-H amounts land at indices 4-7 as rowAmounts expects.
    const toFullRow = (r: string[] | undefined): string[] =>
      ['', '', '', '', r?.[0] ?? '', r?.[1] ?? '', r?.[2] ?? '', r?.[3] ?? '']

    await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        requests: [{
          deleteDimension: {
            range: { sheetId: sheets[i].sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
          },
        }],
      },
    )

    // Keep the totals row accurate: subtract the deleted row's amounts from
    // the running total and rewrite it. deleteDimension shifted everything
    // below the deleted row up by one, so if the totals row was after it,
    // its new position is totalsRowIdx - 1.
    if (totalsRowIdx !== -1 && totalsRowIdx > rowIdx) {
      const newTotals = addTotals(rowAmounts(toFullRow(rows[totalsRowIdx])), rowAmounts(toFullRow(rows[rowIdx])), -1)
      const newTotalsRowIdx = totalsRowIdx - 1
      await sheetsPut(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheets[i].title}!E${newTotalsRowIdx + 1}:H${newTotalsRowIdx + 1}`)}?valueInputOption=RAW`,
        { values: [[
          `PHP ${fmtAmount(newTotals[0])}`,
          `PHP ${fmtAmount(newTotals[1])}`,
          `PHP ${fmtAmount(newTotals[2])}`,
          `PHP ${fmtAmount(newTotals[3])}`,
        ]] },
      )
    }
    return true
  }
  return false
}

// ── Reconcile a tab against the app's current set of eligible booking IDs ─────
// Removes any row whose _id is no longer expected in this tab — this is what
// "self-heals" deletions that happened directly in the sheet (or while the
// app was offline, so the real-time delete handler never fired). Only called
// during the periodic full re-sync, which is the only request that carries a
// complete picture of what *should* exist.
export async function reconcileTab(
  token: string,
  spreadsheetId: string,
  tabName: string,
  sheetId: number,
  keepIds: Set<string>,
): Promise<number> {
  const idColData = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!L:L')}`,
  ) as { values?: string[][] }
  const idCol = (idColData.values || []).map(r => r[0] || '')

  // Collect 0-based row indices to delete, descending so removing one doesn't
  // shift the index of the next one still pending removal.
  const toDelete: number[] = []

  // ── Duplicate detection ─────────────────────────────────────────────────
  // A row-level lock now prevents NEW duplicates (see acquireLockWithRetry
  // in this file), but this catches any that already exist — e.g. from
  // before the lock was added, or any other future path that manages to
  // race. Previously this function only asked "is this ID expected at all?"
  // — two rows sharing the same valid, still-expected ID both passed that
  // check and sat there forever. Now: if an ID appears more than once,
  // every occurrence EXCEPT THE LAST is queued for deletion. The last one
  // is kept because it was written most recently (an update always rewrites
  // the row it found via `existingIdx`, and a fresh append always lands
  // after everything read so far) — so between two duplicates, the later
  // row index is the more likely one to hold the correct, current data.
  const firstSeenAt = new Map<string, number>()
  for (let i = 1; i < idCol.length; i++) {
    const id = idCol[i]
    if (!id || id === TOTALS_ID_SENTINEL) continue
    if (firstSeenAt.has(id)) {
      // Not the first time we've seen this ID — the PREVIOUS occurrence(s)
      // are the stale duplicate(s); queue them, keep tracking this newer one.
      toDelete.push(firstSeenAt.get(id)!)
    }
    firstSeenAt.set(id, i)
  }

  for (let i = 1; i < idCol.length; i++) {
    const id = idCol[i]
    if (id && id !== TOTALS_ID_SENTINEL && !keepIds.has(id)) toDelete.push(i)
  }
  if (toDelete.length === 0) return 0

  const uniqueToDelete = [...new Set(toDelete)]
  uniqueToDelete.sort((a, b) => b - a)
  await sheetsPost(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      requests: uniqueToDelete.map(rowIdx => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
        },
      })),
    },
  )
  return uniqueToDelete.length
}

// ── Core: sync one tab's worth of bookings ────────────────────────────────────
// All bookings for a given month tab are processed together in one function
// call: one tab creation, one header write, one header format, then ALL
// upserts batched into at most a few more calls — a tab's call count no
// longer scales with how many bookings are in it.
//
// Two modes:
//  - `fullRewrite: true` — used by the periodic resync, which always has the
//    COMPLETE set of bookings for this tab. Wipes the whole data block and
//    rewrites it fresh, sorted newest → oldest by created date, with a
//    totals row after the last one. This is what actually enforces the
//    chronological ordering — it can only be done safely when the full
//    picture is known.
//  - default (incremental) — used by the instant single-booking sync, which
//    only ever sees the ONE booking that was just saved. Existing rows are
//    updated in place; a brand-new row is inserted directly ABOVE the totals
//    row (instead of appended past it) so the totals row always stays the
//    last thing on the sheet, and the totals themselves are recomputed by
//    adjusting the previous running total rather than needing every row.
export async function syncTab(
  token: string,
  spreadsheetId: string,
  tabName: string,
  bookings: BookingPayload[],
  existingSheets: { title: string; sheetId: number }[],
  opts: { fullRewrite?: boolean } = {},
): Promise<{ createdNewSheet: boolean }> {
  let sheet = existingSheets.find(s => s.title === tabName)
  let createdNewSheet = false

  // ── 1. Create the tab if it doesn't exist ───────────────────────────────
  if (!sheet) {
    createdNewSheet = true
    const createData = await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: tabName } } }] },
    ) as { replies: { addSheet: { properties: { sheetId: number } } }[] }
    sheet = { title: tabName, sheetId: createData.replies[0].addSheet.properties.sheetId }
    existingSheets.push(sheet)

    await sheetsPut(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:L1')}?valueInputOption=RAW`,
      { values: [HEADER_ROW] },
    )
    await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: buildHeaderRequests(sheet.sheetId) },
    )
  }

  const sheetId = sheet.sheetId

  // ── 1b. Self-heal an existing tab's header row ────────────────────────────
  // A tab created before the TA Comm / Agent columns existed only got its
  // header written ONCE, back when it was first created (see step 1 above)
  // — nothing else in this function ever revisits row 1, so an old tab would
  // otherwise keep showing the stale 9-column header forever, even though
  // every row written into it from here on already has the new 11-column
  // layout. Skipped for a tab we just created above, since it already got
  // the current header directly.
  if (!createdNewSheet) {
    const headerData = await sheetsGet(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:L1')}`,
    ) as { values?: string[][] }
    const currentHeader = headerData.values?.[0] || []
    const headerIsCurrent = HEADER_ROW.every((h, i) => currentHeader[i] === h)
    if (!headerIsCurrent) {
      await sheetsPut(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:L1')}?valueInputOption=RAW`,
        { values: [HEADER_ROW] },
      )
      await sheetsPost(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: buildHeaderRequests(sheetId) },
      )
    }
  }

  // ── 2. Read everything currently below the header — data rows AND the
  // totals row if one already exists — so we know update-vs-insert per
  // booking, and can find/adjust the totals row.
  const dataData = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A2:L')}`,
  ) as { values?: string[][] }
  const existingRows = dataData.values || []
  const totalsLocalIdx = existingRows.findIndex(r => (r[11] || '') === TOTALS_ID_SENTINEL)
  const hasTotalsRow = totalsLocalIdx !== -1
  const existingDataRows = hasTotalsRow ? existingRows.slice(0, totalsLocalIdx) : existingRows
  const idCol = existingDataRows.map(r => r[11] || '')

  const formatRequests: object[] = []

  // ── 3a. Full rewrite — clear the whole data block, write it back fresh,
  // sorted newest → oldest, with a totals row at the end. ───────────────────
  if (opts.fullRewrite) {
    const sorted = [...bookings].sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime()
      const db = new Date(b.createdAt || 0).getTime()
      return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da)
    })

    let runningTotals: Totals = [0, 0, 0, 0]
    const rows: string[][] = sorted.map((booking, i) => {
      const { row, isPaid } = buildRow(booking)
      runningTotals = addTotals(runningTotals, rowAmounts(row))
      formatRequests.push(...buildDataRowRequests(sheetId, i + 1, isPaid)) // +1 for header row
      return row
    })
    const totalsRowIndex = rows.length + 1 // 0-based; +1 for header
    rows.push(buildTotalsRow(runningTotals))
    formatRequests.push(...buildTotalsRowFormatRequests(sheetId, totalsRowIndex))

    // Old row count may be larger or smaller than the new one, so clear the
    // whole block first (values only — dimensions untouched) rather than
    // risk stale rows dangling past the freshly written data.
    if (existingRows.length > 0) {
      await sheetsPost(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A2:L')}:clear`,
        {},
      )
    }
    await sheetsPut(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A2:L${rows.length + 1}`)}?valueInputOption=RAW`,
      { values: rows },
    )
    if (formatRequests.length > 0) {
      await sheetsPost(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: formatRequests },
      )
    }
    return { createdNewSheet }
  }

  // ── 3b. Incremental — update existing rows in place; insert brand-new
  // rows directly below the header (so newest-first order holds without
  // waiting for the next full resync). ──────────────────────────────────────
  const updates: { existingIdx: number; row: string[]; isPaid: boolean }[] = []
  const newEntries: { row: string[]; isPaid: boolean; createdAt: string }[] = []
  let runningTotals: Totals = hasTotalsRow ? rowAmounts(existingRows[totalsLocalIdx]) : [0, 0, 0, 0]

  for (const booking of bookings) {
    const { row, isPaid } = buildRow(booking)
    const existingIdx = booking.bookingId ? idCol.findIndex(id => id === booking.bookingId) : -1

    if (existingIdx !== -1) {
      runningTotals = addTotals(runningTotals, rowAmounts(existingDataRows[existingIdx]), -1) // remove old amounts
      runningTotals = addTotals(runningTotals, rowAmounts(row)) // add new amounts
      updates.push({ existingIdx, row, isPaid })
    } else {
      runningTotals = addTotals(runningTotals, rowAmounts(row))
      newEntries.push({ row, isPaid, createdAt: booking.createdAt || "" })
    }
  }

  // Newest first among the batch of brand-new rows, mirroring the fullRewrite order.
  newEntries.sort((a, b) => {
    const da = new Date(a.createdAt || 0).getTime()
    const db = new Date(b.createdAt || 0).getTime()
    return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da)
  })
  const newRows = newEntries.map((entry) => entry.row)
  const newRowIsPaid = newEntries.map((entry) => entry.isPaid)

  // New rows land directly below the header (row index 1), pushing every
  // existing row — data and totals alike — down by newRows.length. Because
  // that shifts the rows we are about to update in place, this insertion
  // MUST happen before any values/formatting are written at absolute row
  // indices below.
  const insertAtIndex = 1 // 0-based sheet row; row 0 is the header
  if (newRows.length > 0 && (existingDataRows.length > 0 || hasTotalsRow)) {
    await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: insertAtIndex, endIndex: insertAtIndex + newRows.length },
            inheritFromBefore: false,
          },
        }],
      },
    )
  }
  const existingRowOffset = newRows.length // every pre-existing row shifted down by this many

  const rowUpdates: { range: string; values: string[][] }[] = updates.map(({ existingIdx, row }) => {
    const sheetRowIndex = existingIdx + 1 + existingRowOffset // 0-based; +1 for header, + shift from inserted rows
    return { range: `${tabName}!A${sheetRowIndex + 1}:L${sheetRowIndex + 1}`, values: [row] }
  })
  updates.forEach(({ existingIdx, isPaid }) => {
    const sheetRowIndex = existingIdx + 1 + existingRowOffset
    formatRequests.push(...buildDataRowRequests(sheetId, sheetRowIndex, isPaid))
  })

  if (rowUpdates.length > 0) {
    await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      { valueInputOption: "RAW", data: rowUpdates },
    )
  }

  if (newRows.length > 0) {
    await sheetsPut(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A${insertAtIndex + 1}:L${insertAtIndex + newRows.length}`)}?valueInputOption=RAW`,
      { values: newRows },
    )
    newRows.forEach((_, i) => {
      formatRequests.push(...buildDataRowRequests(sheetId, insertAtIndex + i, newRowIsPaid[i]))
    })
  }

  // ── Keep the totals row present, accurate, and at the very bottom ────────
  const finalDataRowCount = existingDataRows.length + newRows.length
  if (finalDataRowCount > 0) {
    const totalsRowIndex = finalDataRowCount + 1 // 0-based; +1 for header
    if (!hasTotalsRow) {
      await sheetsPost(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: [{ insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: totalsRowIndex, endIndex: totalsRowIndex + 1 }, inheritFromBefore: false } }] },
      )
    }
    await sheetsPut(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A${totalsRowIndex + 1}:L${totalsRowIndex + 1}`)}?valueInputOption=RAW`,
      { values: [buildTotalsRow(runningTotals)] },
    )
    formatRequests.push(...buildTotalsRowFormatRequests(sheetId, totalsRowIndex))
  }

  // ── 4. Apply all row formatting in one batchUpdate call ───────────────────
  if (formatRequests.length > 0) {
    await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: formatRequests },
    )
  }

  return { createdNewSheet }
}

// ── Full resync cycle ──────────────────────────────────────────────────────────
// Groups every eligible (Confirmed/Flown) booking by month tab, syncs each tab
// (with per-tab error isolation so one bad tab can't take the rest down),
// reconciles each against the sheet's current rows (self-heal), sweeps any
// month tab that's fully emptied out, then re-sorts all month tabs
// chronologically. Used by BOTH the client-triggered manual/legacy path in
// sheets-append.ts and the new server-side cron-resync.ts — there is only one
// copy of this logic so a future fix only has to be made once.
export async function runFullResyncCycle(
  token: string,
  spreadsheetId: string,
  allBookings: BookingPayload[],
): Promise<{ tabs: string[]; failedTabs: string[]; healed: number; warnings: string[] }> {
  const warnings: string[] = []

  const meta = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
  ) as { sheets?: { properties: { title: string; sheetId: number } }[] }
  const existingSheets = (meta.sheets || []).map(s => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
  }))

  if (allBookings.length === 0) {
    return { tabs: [], failedTabs: [], healed: 0, warnings: [] }
  }

  // Group by month tab. A booking missing a clientName used to be silently
  // dropped entirely — now it's synced under a placeholder and reported.
  const byTab = new Map<string, BookingPayload[]>()
  for (const b of allBookings) {
    if (!b.status) continue
    if (!b.clientName) {
      warnings.push(`Booking ${b.bookingId || '(no id)'} has no client name — synced to Sheets as "(No client name)". Fill it in to fix the row.`)
    }
    const tab = getMonthTabName(b.createdAt || new Date().toISOString(), `booking ${b.bookingId || '(no id)'}`)
    if (!byTab.has(tab)) byTab.set(tab, [])
    byTab.get(tab)!.push(b)
  }

  // Process each tab sequentially with a short pause between tabs to stay
  // comfortably under Google's 60 writes/min quota. Each tab is wrapped in
  // its own try/catch so one bad tab (a transient API hiccup, a bad value)
  // can't abort every tab after it in the same cycle — a failure is isolated,
  // reported, and retried next cycle while every other tab still succeeds.
  //
  // TIME BUDGET: Vercel kills a function outright once it exceeds its
  // configured maxDuration — the function process is terminated mid-flight,
  // which means code AFTER the current await (including the overlap-lock
  // release in cron-resync.ts's `finally` block) never runs. That's a real
  // bug we hit: with a 10s delay between every tab, anything beyond 2-3
  // month tabs could exceed the duration limit, get killed mid-run, and
  // leave next cycle's run permanently seeing "a previous run is still in
  // progress" until the lock's stale-timeout finally clears it.
  // Fix: track elapsed time and STOP starting new tabs once the budget is
  // used up, returning gracefully with whatever was completed. Untouched
  // tabs simply get picked up on the next cycle — nothing is lost, it just
  // spreads a very large backlog (e.g. after deleting every tab at once)
  // across a few extra cycles instead of risking a forced kill.
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 40_000 // leaves headroom under a 60s maxDuration for setup/teardown calls
  const TAB_DELAY_MS = 4_000    // ~7 calls/tab ÷ ~5.5s/tab ≈ under Google's 60 calls/min/user quota
  const timeRemaining = () => TIME_BUDGET_MS - (Date.now() - startedAt)

  const results: string[] = []
  const failedTabs: string[] = []
  const deferredTabs: string[] = []
  let healedCount = 0
  let firstTab = true
  for (const [tabName, tabBookings] of byTab) {
    if (timeRemaining() < TAB_DELAY_MS) {
      deferredTabs.push(tabName)
      continue
    }
    if (!firstTab) await new Promise(r => setTimeout(r, TAB_DELAY_MS))
    firstTab = false

    try {
      await syncTab(token, spreadsheetId, tabName, tabBookings, existingSheets, { fullRewrite: true })
      results.push(tabName)

      const tabSheet = existingSheets.find(s => s.title === tabName)
      if (tabSheet) {
        const keepIds = new Set(tabBookings.map(b => b.bookingId).filter(Boolean))
        const removed = await reconcileTab(token, spreadsheetId, tabName, tabSheet.sheetId, keepIds)
        if (removed > 0) {
          console.log(`[sheetsCore] Healed ${removed} orphan row(s) from "${tabName}"`)
          healedCount += removed
        }
      }
    } catch (err) {
      const failedIds = tabBookings.map(b => b.clientName || b.bookingId || '(unknown)').join(', ')
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[sheetsCore] Tab "${tabName}" failed, skipping to next tab:`, message)
      failedTabs.push(tabName)
      warnings.push(
        `"${tabName}" failed to sync (${message}). Bookings affected: ${failedIds}. Will retry next cycle.`
      )
    }
  }
  if (deferredTabs.length > 0) {
    console.log(`[sheetsCore] Time budget reached — deferring to next cycle: ${deferredTabs.join(', ')}`)
    warnings.push(`Ran out of time this cycle before reaching: ${deferredTabs.join(', ')}. Will continue next cycle.`)
  }

  // Sweep any month tab that ISN'T in byTab — i.e. has zero currently-eligible
  // bookings (everything that used to be there got cancelled/deleted/moved).
  // These are never visited by the loop above, so without this sweep their
  // rows would be orphaned forever. Rare in practice (a booking never becomes
  // ineligible again once Confirmed/Flown), but throttled + capped the same
  // way so it can never burst a pile of requests if several tabs empty out
  // in the same cycle. Also respects the same time budget as the main loop.
  const MAX_EMPTIED_TABS_PER_CYCLE = 5
  const handledTabs = new Set(byTab.keys())
  const emptiedTabs = existingSheets
    .filter(s => MONTH_TAB_RE.test(s.title) && !handledTabs.has(s.title))
    .slice(0, MAX_EMPTIED_TABS_PER_CYCLE)

  for (const sheet of emptiedTabs) {
    if (timeRemaining() < TAB_DELAY_MS) {
      console.log(`[sheetsCore] Time budget reached — deferring emptied-tab cleanup for "${sheet.title}" to next cycle`)
      break
    }
    await new Promise(r => setTimeout(r, TAB_DELAY_MS))
    try {
      const removed = await reconcileTab(token, spreadsheetId, sheet.title, sheet.sheetId, new Set())
      if (removed > 0) {
        console.log(`[sheetsCore] Healed ${removed} orphan row(s) from fully-emptied tab "${sheet.title}"`)
        healedCount += removed
      }

      // This tab now has zero currently-eligible bookings (that's why it's in
      // emptiedTabs at all) and every row has just been cleared above — so
      // rather than leave a bare header-only tab sitting in the sheet, remove
      // the whole tab. If a booking comes back to this month later, syncTab
      // just recreates it fresh. Google refuses to delete the very last
      // remaining sheet in a spreadsheet — that 400 is caught below and
      // reported as a warning rather than crashing the whole cycle.
      await sheetsPost(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: [{ deleteSheet: { sheetId: sheet.sheetId } }] },
      )
      console.log(`[sheetsCore] Deleted empty tab "${sheet.title}"`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[sheetsCore] Failed to clean up emptied tab "${sheet.title}":`, message)
      warnings.push(`Couldn't clean up "${sheet.title}" (no bookings currently belong there): ${message}`)
    }
  }

  // Re-fetch (new tabs may have been created) and sort chronologically.
  const metaAfter = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
  ) as { sheets?: { properties: { title: string; sheetId: number } }[] }
  await sortMonthTabs(token, spreadsheetId,
    (metaAfter.sheets || []).map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId }))
  )

  return { tabs: results, failedTabs, healed: healedCount, warnings }
}

// ── Single-booking sync (instant path) ─────────────────────────────────────────
// Used by the instant per-booking push when someone saves a booking in the app.
export async function syncSingleBooking(
  token: string,
  spreadsheetId: string,
  booking: BookingPayload,
  existingSheets: { title: string; sheetId: number }[],
): Promise<{ tabName: string; warnings: string[] }> {
  const warnings: string[] = []
  if (!booking.clientName) {
    warnings.push(`Booking ${booking.bookingId || '(no id)'} has no client name — synced to Sheets as "(No client name)". Fill it in to fix the row.`)
  }
  const tabName = getMonthTabName(booking.createdAt || new Date().toISOString(), `booking ${booking.bookingId || '(no id)'}`)
  const { createdNewSheet } = await syncTab(token, spreadsheetId, tabName, [booking], existingSheets)

  // Sorting only matters when the set of tabs actually changed (a brand new
  // month tab was just created) — an update to a booking in an existing tab
  // can't have changed tab order. This used to unconditionally re-fetch the
  // whole spreadsheet's sheet list and run sortMonthTabs on EVERY single
  // push, even plain edits to an already-Confirmed booking — 2 extra Sheets
  // API calls (1 read + a conditional write) that add up fast against
  // Google's 60-reads/min-per-user quota when several bookings are being
  // saved around the same time. Skipping them for the common no-new-tab
  // case cuts an instant push's read count by roughly a third.
  if (createdNewSheet) {
    const metaAfter = await sheetsGet(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    ) as { sheets?: { properties: { title: string; sheetId: number } }[] }
    await sortMonthTabs(token, spreadsheetId,
      (metaAfter.sheets || []).map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId }))
    )
  }

  return { tabName, warnings }
}
