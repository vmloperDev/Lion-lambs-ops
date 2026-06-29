// api/sheets-append.ts
// Vercel Serverless Function — upserts a confirmed/flown booking row to Google Sheets.
// Each month gets its own tab (e.g. "Jan 2026") based on the booking's createdAt date.
// Rows are matched by bookingId stored in hidden column J — reliable even if client
// name or travel dates are edited later.
//
// ENV VARS required (set in Vercel dashboard → Settings → Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   — e.g. lion-lamb@your-project.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY             — the private key from your service account JSON
//   GOOGLE_SHEET_ID                — the ID from your sheet URL:
//                                    https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit

import type { VercelRequest, VercelResponse } from '@vercel/node'

// ── JWT auth ─────────────────────────────────────────────────────────────────
// Token is cached for the lifetime of the serverless function instance.
// A fresh token is fetched if less than 60s remains before expiry.

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
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(unsigned))
  const jwt = `${unsigned}.${Buffer.from(signature).toString('base64url')}`

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

// ── Tab name ─────────────────────────────────────────────────────────────────

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

// ── Color helpers ─────────────────────────────────────────────────────────────

function hex(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: 1 }
}

// Header: deep navy
const HEADER_BG = hex(15, 40, 80)     // #0F2850
const HEADER_FG = hex(255, 255, 255)  // white
// Alternating row tint
const ROW_TINT  = hex(235, 241, 251)  // #EBF1FB light blue tint
const ROW_WHITE = hex(255, 255, 255)
// Status colors
const GREEN_FG  = hex(27, 124, 55)    // #1B7C37
const RED_FG    = hex(182, 28, 28)    // #B61C1C
const GREEN_BG  = hex(220, 242, 228)  // #DCF2E4
const RED_BG    = hex(250, 220, 220)  // #FADCDC

// ── Column config ─────────────────────────────────────────────────────────────
// A=Date  B=Client  C=Travel  D=Package  E=Gross  F=Nett  G=LLTP  H=Balance  I=Status  J=ID(hidden)
const COL_WIDTHS = [110, 180, 200, 260, 130, 130, 130, 120, 110, 1]

const HEADER_ROW = ['Date Created', 'Client Name', 'Travel Date', 'Package', 'Gross', 'NETT', 'LLTP', 'Balance', 'Status', '_id']

// ── Header formatting ─────────────────────────────────────────────────────────

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

// ── Data row formatting ───────────────────────────────────────────────────────

function buildDataRowRequests(sheetId: number, rowIndex: number, isPaid: boolean) {
  // Alternate tint: even data rows (0-based after header) get the blue tint
  const rowBg = rowIndex % 2 === 0 ? ROW_TINT : ROW_WHITE

  return [
    // 56px row height — generous so wrapped text has room
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
        properties: { pixelSize: 56 },
        fields: 'pixelSize',
      },
    },
    // Base row style: wrap, vertical middle, alternating bg, 9pt Arial
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
    // Numeric columns (E–H) right-aligned
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 4, endColumnIndex: 8 },
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    // Status cell (col I) — center, bold, colored bg + text
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: isPaid ? GREEN_BG : RED_BG,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            textFormat: {
              bold: true,
              fontSize: 9,
              fontFamily: 'Arial',
              foregroundColor: isPaid ? GREEN_FG : RED_FG,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
      },
    },
  ]
}

// ── Parse row number from Sheets range string ─────────────────────────────────
// Google returns updatedRange like "Jan 2026!A3:J3". We extract the row number (3)
// and convert to 0-based index (2) for the batchUpdate formatting requests.

function rowIndexFromRange(range: string): number | null {
  // Range format: "Tab Name!A<row>:J<row>"
  const match = range.match(/!(?:[A-Z]+)(\d+)/)
  if (!match) return null
  const oneBasedRow = parseInt(match[1], 10)
  if (isNaN(oneBasedRow) || oneBasedRow < 2) return null // row 1 is the header
  return oneBasedRow - 1 // convert to 0-based
}

// ── Ensure tab exists — race-safe ─────────────────────────────────────────────
// If two requests race to create the same tab, the loser catches the error,
// re-fetches the sheet list, and returns the winner's tab — no "_conflict_N" suffix.
// After creating a tab we write + format the header row before returning, so the
// very first data row never races with an unformatted header.

async function ensureTab(
  token: string,
  spreadsheetId: string,
  tabName: string,
  existingSheets: { title: string; sheetId: number }[],
): Promise<number> {
  const found = existingSheets.find(s => s.title === tabName)
  if (found) return found.sheetId

  const createRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    },
  )

  if (createRes.ok) {
    const createData = await createRes.json() as { replies: { addSheet: { properties: { sheetId: number } } }[] }
    const sheetId = createData.replies[0].addSheet.properties.sheetId

    // Step 1: write header row values
    const headerWriteRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:J1')}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [HEADER_ROW] }),
      },
    )
    if (!headerWriteRes.ok) throw new Error(`Header write failed: ${await headerWriteRes.text()}`)

    // Step 2: format header row — must complete before any data row is written,
    // otherwise concurrent appends may land on row 1 before formatting is applied.
    const headerFmtRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: buildHeaderRequests(sheetId) }),
      },
    )
    if (!headerFmtRes.ok) throw new Error(`Header format failed: ${await headerFmtRes.text()}`)

    return sheetId
  }

  // Creation failed — likely a concurrent race. Re-fetch and find the tab.
  const retryMeta = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const retryData = await retryMeta.json() as { sheets?: { properties: { title: string; sheetId: number } }[] }
  const retryFound = (retryData.sheets || []).find(s => s.properties.title === tabName)
  if (retryFound) return retryFound.properties.sheetId

  throw new Error(`Failed to create or find tab "${tabName}": HTTP ${createRes.status}`)
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = process.env
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    return res.status(500).json({ error: 'Missing Google Sheets environment variables.' })
  }

  const {
    bookingId, createdAt, clientName, travelStart, travelEnd,
    packageName, sellingPrice, nettCost, estProfit,
    invoiceAmountPaid, invoiceBalance, status, currency = 'PHP',
  } = req.body as Record<string, string>

  if (!clientName || !status) {
    return res.status(400).json({ error: 'Missing required booking fields.' })
  }

  const gross   = parseFloat(sellingPrice || '0')
  const nett    = parseFloat(nettCost || '0')
  const lltp    = estProfit !== undefined ? parseFloat(estProfit) : gross - nett
  const paid    = parseFloat(invoiceAmountPaid || '0')
  const balance = invoiceBalance !== undefined ? parseFloat(invoiceBalance) : Math.max(gross - paid, 0)
  const isPaid  = paid >= gross && gross > 0

  const fmt = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const fmtDate = (iso: string | number) => {
    if (!iso && iso !== 0) return ''
    let d: Date
    const n = typeof iso === 'string' ? Number(iso) : iso
    if (typeof iso === 'number' || (!isNaN(n) && String(iso).length >= 10)) {
      d = n > 1e10 ? new Date(n) : new Date(n * 1000)
    } else if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, day] = iso.split('-').map(Number)
      d = new Date(y, m - 1, day)
    } else {
      d = new Date(iso)
    }
    if (isNaN(d.getTime())) return String(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const travelDate = travelStart && travelEnd
    ? `${fmtDate(travelStart)} – ${fmtDate(travelEnd)}`
    : fmtDate(travelStart || travelEnd)

  // Column J stores the bookingId as a hidden stable key for future updates
  const row = [
    fmtDate(createdAt),
    clientName,
    travelDate,
    packageName || '',
    `${currency} ${fmt(gross)}`,
    `${currency} ${fmt(nett)}`,
    `${currency} ${fmt(lltp)}`,
    balance > 0 ? `${currency} ${fmt(balance)}` : '—',
    isPaid ? 'PAID' : 'NOT PAID',
    bookingId || '',
  ]

  const tabName = getMonthTabName(createdAt || new Date().toISOString())

  try {
    const token = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)

    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const meta = await metaRes.json() as { sheets?: { properties: { title: string; sheetId: number } }[] }
    const existingSheets = (meta.sheets || []).map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId }))

    // ensureTab fully completes header write + format before returning,
    // so the first data append always lands below a properly formatted row 1.
    const sheetId = await ensureTab(token, GOOGLE_SHEET_ID, tabName, existingSheets)

    // Read column J (bookingId key) to find existing rows for update.
    const idColRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!J:J')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const idColData = await idColRes.json() as { values?: string[][] }
    const idCol = (idColData.values || []).map(r => r[0] || '')

    // Primary match: bookingId in column J (skip row 0 = header)
    const existingRowIndex = bookingId ? idCol.findIndex((id, i) => i > 0 && id === bookingId) : -1

    let targetRowIndex: number

    if (existingRowIndex !== -1) {
      // ── Update existing row in place ──────────────────────────────────────
      // existingRowIndex is already 0-based (matching idCol array position).
      targetRowIndex = existingRowIndex

      const updateRange = encodeURIComponent(`${tabName}!A${targetRowIndex + 1}:J${targetRowIndex + 1}`)
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        },
      )
      if (!updateRes.ok) throw new Error(`Sheets update error: ${await updateRes.text()}`)
    } else {
      // ── Append new row ────────────────────────────────────────────────────
      // We derive the actual row index from the API response rather than
      // guessing from idCol.length — this is safe even when multiple bookings
      // are appended concurrently because each response reflects where that
      // specific append actually landed.
      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!A:J')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        },
      )
      if (!appendRes.ok) throw new Error(`Sheets append error: ${await appendRes.text()}`)

      // Parse the actual row from the response (e.g. "Jan 2026!A3:J3" → index 2)
      const appendData = await appendRes.json() as { updates?: { updatedRange?: string } }
      const parsedIndex = appendData.updates?.updatedRange
        ? rowIndexFromRange(appendData.updates.updatedRange)
        : null

      // Fallback: next row after current idCol length (idCol includes header at [0])
      targetRowIndex = parsedIndex ?? idCol.length
    }

    // Safety guard: never format row 0 (the header) as a data row.
    // This can't happen in normal flow but guards against any edge case.
    if (targetRowIndex < 1) {
      console.warn(`[sheets-append] targetRowIndex ${targetRowIndex} would overwrite header — skipping format`)
      return res.status(200).json({ ok: true, tab: tabName, warning: 'skipped formatting to protect header' })
    }

    // Apply data row styling: 56px height, alternating tint, right-aligned numbers, colored status
    const fmtRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: buildDataRowRequests(sheetId, targetRowIndex, isPaid) }),
      },
    )
    if (!fmtRes.ok) throw new Error(`Row format error: ${await fmtRes.text()}`)

    return res.status(200).json({ ok: true, tab: tabName })
  } catch (err) {
    console.error('[sheets-append]', err)
    return res.status(500).json({ error: String(err) })
  }
}
