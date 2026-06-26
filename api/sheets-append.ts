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

// ── Ensure tab exists — race-safe ─────────────────────────────────────────────
// If two requests race to create the same tab, the loser catches the error,
// re-fetches the sheet list, and returns the winner's tab — no "_conflict_N" suffix.

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

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:J1')}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [HEADER_ROW] }),
      },
    )
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: buildHeaderRequests(sheetId) }),
      },
    )
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

    const sheetId = await ensureTab(token, GOOGLE_SHEET_ID, tabName, existingSheets)

    // Read column J (bookingId key) and columns A:C (fallback name match) in parallel
    // to avoid two serial round-trips on every sync.
    const [idColRes, nameColRes] = await Promise.all([
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!J:J')}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!A:C')}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    ])
    const idColData   = await idColRes.json()   as { values?: string[][] }
    const nameColData = await nameColRes.json()  as { values?: string[][] }

    const idCol    = (idColData.values   || []).map(r => r[0] || '')
    const nameRows =  nameColData.values || []

    // Primary match: bookingId in column J
    let existingRowIndex = bookingId ? idCol.findIndex((id, i) => i > 0 && id === bookingId) : -1

    // Fallback: match by clientName + travelDate for rows written before bookingId was added
    if (existingRowIndex === -1) {
      existingRowIndex = nameRows.findIndex((r, i) => i > 0 && r[1] === clientName && r[2] === travelDate)
    }

    if (existingRowIndex !== -1) {
      // Update existing row in place
      const updateRange = encodeURIComponent(`${tabName}!A${existingRowIndex + 1}:J${existingRowIndex + 1}`)
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
      // Append new row
      const sheetsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!A:J')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        },
      )
      if (!sheetsRes.ok) throw new Error(`Sheets append error: ${await sheetsRes.text()}`)
    }

    // Row index to format. New rows land at idCol.length (idCol includes header at index 0).
    const targetRowIndex = existingRowIndex > 0 ? existingRowIndex : idCol.length

    // Apply original row styling: 56px height, alternating tint, right-aligned numbers, colored status
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: buildDataRowRequests(sheetId, targetRowIndex, isPaid) }),
      },
    )

    return res.status(200).json({ ok: true, tab: tabName })
  } catch (err) {
    console.error('[sheets-append]', err)
    return res.status(500).json({ error: String(err) })
  }
}
