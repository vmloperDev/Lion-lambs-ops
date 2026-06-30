// api/sheets-append.ts
// Vercel Serverless Function — syncs confirmed/flown bookings to Google Sheets.
//
// DESIGN: accepts either a single booking OR a batch of bookings for the same
// month tab. The periodic re-sync sends all bookings for a tab together, so
// there is exactly ONE function invocation per tab per sync cycle — eliminating
// every race condition that previously caused missing rows and broken headers.
//
// ENV VARS required (Vercel dashboard → Settings → Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_SHEET_ID

import type { VercelRequest, VercelResponse } from '@vercel/node'

// ── JWT auth ──────────────────────────────────────────────────────────────────

let _cachedToken = ''
let _tokenExpiry = 0

async function getAccessToken(email: string, privateKey: string): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken
  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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
  _cachedToken = access_token
  _tokenExpiry = Date.now() + 3600 * 1000
  return access_token
}

// ── Tab name ──────────────────────────────────────────────────────────────────

function getMonthTabName(createdAt: string): string {
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
  if (isNaN(d.getTime())) d = new Date()
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
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

const COL_WIDTHS  = [110, 180, 200, 260, 130, 130, 130, 120, 110, 1]
const HEADER_ROW  = ['Date Created', 'Client Name', 'Travel Date', 'Package', 'Gross', 'NETT', 'LLTP', 'Balance', 'Status', '_id']

// ── Formatting request builders ───────────────────────────────────────────────

function buildHeaderRequests(sheetId: number) {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
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
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 9 },
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
            backgroundColor: isPaid ? GREEN_BG : RED_BG,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            textFormat: { bold: true, fontSize: 9, fontFamily: 'Arial', foregroundColor: isPaid ? GREEN_FG : RED_FG },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
      },
    },
  ]
}

// ── Sheets API helpers ────────────────────────────────────────────────────────

async function sheetsGet(token: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sheetsPut(token: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${url} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sheetsPost(token: string, url: string, body: unknown) {
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
async function sortMonthTabs(
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
  // We place month tabs after all non-month tabs so the order becomes:
  // [other tabs...] [Jan 2025] [Feb 2025] … [Jun 2026]
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

type BookingPayload = {
  bookingId: string
  createdAt: string
  clientName: string
  travelStart: string
  travelEnd: string
  packageName: string
  sellingPrice: string
  nettCost: string
  estProfit: string
  invoiceAmountPaid: string
  invoiceBalance: string
  status: string
  currency: string
}

// ── Build a sheet row from a booking payload ──────────────────────────────────

function buildRow(b: BookingPayload, fmtDate: (v: string) => string, fmt: (n: number) => string) {
  const gross   = parseFloat(b.sellingPrice   || '0')
  const nett    = parseFloat(b.nettCost       || '0')
  const lltp    = b.estProfit !== undefined ? parseFloat(b.estProfit) : gross - nett
  const paid    = parseFloat(b.invoiceAmountPaid || '0')
  const balance = b.invoiceBalance !== undefined ? parseFloat(b.invoiceBalance) : Math.max(gross - paid, 0)
  const isPaid  = paid >= gross && gross > 0
  const cur     = b.currency || 'PHP'

  const travelDate = b.travelStart && b.travelEnd
    ? `${fmtDate(b.travelStart)} – ${fmtDate(b.travelEnd)}`
    : fmtDate(b.travelStart || b.travelEnd)

  const row = [
    fmtDate(b.createdAt),
    b.clientName,
    travelDate,
    b.packageName || '',
    `${cur} ${fmt(gross)}`,
    `${cur} ${fmt(nett)}`,
    `${cur} ${fmt(lltp)}`,
    balance > 0 ? `${cur} ${fmt(balance)}` : '—',
    isPaid ? 'PAID' : 'NOT PAID',
    b.bookingId || '',
  ]

  return { row, isPaid, gross }
}

// ── Delete a single row by booking ID from a specific tab ─────────────────────
// Returns true if a matching row was found and removed.
async function deleteRowById(
  token: string,
  spreadsheetId: string,
  tabName: string,
  sheetId: number,
  bookingId: string,
): Promise<boolean> {
  const idColData = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!J:J')}`,
  ) as { values?: string[][] }
  const idCol = (idColData.values || []).map(r => r[0] || '')
  const rowIdx = idCol.findIndex((id, i) => i > 0 && id === bookingId)
  if (rowIdx === -1) return false

  await sheetsPost(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
        },
      }],
    },
  )
  return true
}

// ── Reconcile a tab against the app's current set of eligible booking IDs ─────
// Removes any row whose _id is no longer expected in this tab — this is what
// "self-heals" deletions that happened directly in the sheet (or while the
// app was offline, so the real-time delete handler never fired). Only called
// during the periodic full re-sync, which is the only request that carries a
// complete picture of what *should* exist.
async function reconcileTab(
  token: string,
  spreadsheetId: string,
  tabName: string,
  sheetId: number,
  keepIds: Set<string>,
): Promise<number> {
  const idColData = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!J:J')}`,
  ) as { values?: string[][] }
  const idCol = (idColData.values || []).map(r => r[0] || '')

  // Collect 0-based row indices to delete, descending so removing one doesn't
  // shift the index of the next one still pending removal.
  const toDelete: number[] = []
  for (let i = 1; i < idCol.length; i++) {
    const id = idCol[i]
    if (id && !keepIds.has(id)) toDelete.push(i)
  }
  if (toDelete.length === 0) return 0

  toDelete.sort((a, b) => b - a)
  await sheetsPost(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      requests: toDelete.map(rowIdx => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
        },
      })),
    },
  )
  return toDelete.length
}

// ── Core: sync one tab's worth of bookings ────────────────────────────────────
// All bookings for a given month tab are processed together in one function
// call. This means: one tab creation, one header write, one header format,
// then row-by-row upserts (update if id found, append if new).
// No concurrent calls to the same tab = no races.

async function syncTab(
  token: string,
  spreadsheetId: string,
  tabName: string,
  bookings: BookingPayload[],
  existingSheets: { title: string; sheetId: number }[],
  fmtDate: (v: string) => string,
  fmt: (n: number) => string,
) {
  // ── 1. Ensure tab exists with header ──────────────────────────────────────
  let sheetId: number
  const found = existingSheets.find(s => s.title === tabName)

  if (found) {
    sheetId = found.sheetId

    // Tab exists — check if row 1 actually has the header (it may have been
    // deleted along with all content but the tab itself left behind).
    const row1Data = await sheetsGet(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:J1')}`,
    ) as { values?: string[][] }

    const firstCell = row1Data.values?.[0]?.[0] ?? ''
    if (firstCell !== 'Date Created') {
      // Header is missing or wrong — rewrite it and reformat
      await sheetsPut(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:J1')}?valueInputOption=RAW`,
        { values: [HEADER_ROW] },
      )
      await sheetsPost(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: buildHeaderRequests(sheetId) },
      )
    }
  } else {
    // Tab doesn't exist — create it, write header, format header (all awaited
    // sequentially so data rows can never land before the header is ready).
    const createData = await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: tabName } } }] },
    ) as { replies: { addSheet: { properties: { sheetId: number } } }[] }

    sheetId = createData.replies[0].addSheet.properties.sheetId

    await sheetsPut(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:J1')}?valueInputOption=RAW`,
      { values: [HEADER_ROW] },
    )
    await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: buildHeaderRequests(sheetId) },
    )
  }

  // ── 2. Read current column J (booking IDs) to detect existing rows ─────────
  const idColData = await sheetsGet(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!J:J')}`,
  ) as { values?: string[][] }

  // idCol[0] = header "_id", idCol[1..] = booking IDs. Index = 0-based row.
  const idCol = (idColData.values || []).map(r => r[0] || '')

  // ── 3. Upsert each booking sequentially ───────────────────────────────────
  // We process in order and maintain a local running row count so that new
  // appends within this same batch get the right index even before the sheet
  // reflects them (we trust the append response's updatedRange for that).
  const formatRequests: object[] = []

  for (const booking of bookings) {
    const { row, isPaid } = buildRow(booking, fmtDate, fmt)
    const existingIdx = booking.bookingId
      ? idCol.findIndex((id, i) => i > 0 && id === booking.bookingId)
      : -1

    let targetRowIndex: number

    if (existingIdx !== -1) {
      // Update in place
      targetRowIndex = existingIdx
      await sheetsPut(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A${targetRowIndex + 1}:J${targetRowIndex + 1}`)}?valueInputOption=RAW`,
        { values: [row] },
      )
    } else {
      // Append and read back the actual row it landed on
      const appendData = await sheetsPost(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A:J')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: [row] },
      ) as { updates?: { updatedRange?: string } }

      const rangeStr = appendData.updates?.updatedRange ?? ''
      const match = rangeStr.match(/!(?:[A-Z]+)(\d+)/)
      const oneBasedRow = match ? parseInt(match[1], 10) : null

      if (oneBasedRow && oneBasedRow >= 2) {
        targetRowIndex = oneBasedRow - 1
      } else {
        // Fallback: use current known length (safe because we process sequentially)
        targetRowIndex = idCol.length
      }

      // Keep our local idCol in sync so subsequent bookings in this batch
      // get correct fallback indices if the append response ever fails to parse
      idCol.push(booking.bookingId || '')
    }

    // Guard: never format row 0 (the header)
    if (targetRowIndex >= 1) {
      formatRequests.push(...buildDataRowRequests(sheetId, targetRowIndex, isPaid))
    }
  }

  // ── 4. Apply all row formatting in one batchUpdate call ───────────────────
  if (formatRequests.length > 0) {
    await sheetsPost(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: formatRequests },
    )
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = process.env
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    return res.status(500).json({ error: 'Missing Google Sheets environment variables.' })
  }

  const fmt = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const fmtDate = (iso: string): string => {
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
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  try {
    const token = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)

    // Fetch current sheet list once — shared across all tab operations below
    const meta = await sheetsGet(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}?fields=sheets.properties`,
    ) as { sheets?: { properties: { title: string; sheetId: number } }[] }
    const existingSheets = (meta.sheets || []).map(s => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
    }))

    // ── Batch mode: { bookings: BookingPayload[] } ─────────────────────────
    // The periodic re-sync sends all confirmed/flown bookings grouped by tab.
    // Each tab group is processed in one sequential call — no races.
    if (Array.isArray(req.body?.bookings)) {
      const allBookings = req.body.bookings as BookingPayload[]

      if (allBookings.length === 0) {
        return res.status(200).json({ ok: true, tabs: [] })
      }

      // Group by month tab
      const byTab = new Map<string, BookingPayload[]>()
      for (const b of allBookings) {
        if (!b.clientName || !b.status) continue
        const tab = getMonthTabName(b.createdAt || new Date().toISOString())
        if (!byTab.has(tab)) byTab.set(tab, [])
        byTab.get(tab)!.push(b)
      }

      // reconcile=true only on the periodic full re-sync (it's the only caller
      // that sends every eligible booking, so it's the only one that can safely
      // tell which sheet rows are orphans vs. just not part of this request).
      const shouldReconcile = req.body?.reconcile === true

      // Process each tab sequentially with a 2s pause between tabs to stay comfortably
      // under Google's 60 writes/min rate limit across multi-tab re-syncs.
      const results: string[] = []
      let healedCount = 0
      let firstTab = true
      for (const [tabName, tabBookings] of byTab) {
        if (!firstTab) await new Promise(r => setTimeout(r, 10000))
        firstTab = false
        await syncTab(token, GOOGLE_SHEET_ID, tabName, tabBookings, existingSheets, fmtDate, fmt)
        results.push(tabName)

        if (shouldReconcile) {
          // Look up (or re-resolve, if the tab was just created) the sheetId
          const tabSheet = existingSheets.find(s => s.title === tabName)
          if (tabSheet) {
            const keepIds = new Set(tabBookings.map(b => b.bookingId).filter(Boolean))
            const removed = await reconcileTab(token, GOOGLE_SHEET_ID, tabName, tabSheet.sheetId, keepIds)
            if (removed > 0) {
              console.log(`[sheets-append] Healed ${removed} orphan row(s) from "${tabName}"`)
              healedCount += removed
            }
          }
        }
      }

      // Re-fetch sheet list (new tabs may have been created) then sort chronologically
      const metaAfter = await sheetsGet(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}?fields=sheets.properties`,
      ) as { sheets?: { properties: { title: string; sheetId: number } }[] }
      await sortMonthTabs(token, GOOGLE_SHEET_ID,
        (metaAfter.sheets || []).map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId }))
      )

      return res.status(200).json({ ok: true, tabs: results, healed: healedCount })
    }

    // ── Delete mode: { action: 'delete', bookingId, createdAt } ───────────────
    // Fired immediately when a booking is deleted inside the app, so its row
    // disappears from the sheet right away instead of waiting for the next
    // periodic reconcile pass.
    if (req.body?.action === 'delete') {
      const { bookingId, createdAt } = req.body as { bookingId: string; createdAt?: string }
      if (!bookingId) return res.status(400).json({ error: 'Missing bookingId.' })

      const primaryTab = getMonthTabName(createdAt || new Date().toISOString())
      const tried = new Set<string>()
      let deleted = false

      // Try the tab the booking should be in first (cheap, common case).
      const primarySheet = existingSheets.find(s => s.title === primaryTab)
      if (primarySheet) {
        tried.add(primaryTab)
        deleted = await deleteRowById(token, GOOGLE_SHEET_ID, primaryTab, primarySheet.sheetId, bookingId)
      }

      // Fallback: createdAt may be missing/stale — scan remaining tabs.
      if (!deleted) {
        for (const sheet of existingSheets) {
          if (tried.has(sheet.title)) continue
          deleted = await deleteRowById(token, GOOGLE_SHEET_ID, sheet.title, sheet.sheetId, bookingId)
          if (deleted) break
        }
      }

      return res.status(200).json({ ok: true, deleted })
    }

    // ── Single booking mode (backwards compat): { bookingId, clientName, … } ─
    const b = req.body as BookingPayload
    if (!b.clientName || !b.status) {
      return res.status(400).json({ error: 'Missing required booking fields.' })
    }

    const tabName = getMonthTabName(b.createdAt || new Date().toISOString())
    await syncTab(token, GOOGLE_SHEET_ID, tabName, [b], existingSheets, fmtDate, fmt)

    // Re-fetch and sort after single-booking sync too
    const metaAfterSingle = await sheetsGet(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}?fields=sheets.properties`,
    ) as { sheets?: { properties: { title: string; sheetId: number } }[] }
    await sortMonthTabs(token, GOOGLE_SHEET_ID,
      (metaAfterSingle.sheets || []).map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId }))
    )

    return res.status(200).json({ ok: true, tab: tabName })
  } catch (err) {
    console.error('[sheets-append]', err)
    return res.status(500).json({ error: String(err) })
  }
}
