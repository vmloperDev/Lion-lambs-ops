// api/sheets-append.ts
// Vercel Serverless Function — appends a confirmed/flown booking row to Google Sheets.
// Each month gets its own tab (e.g. "Jan 2026") based on the booking's createdAt date.
// The tab is created automatically if it doesn't exist yet, with a styled header row.
//
// ENV VARS required (set in Vercel dashboard → Settings → Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   — e.g. lion-lamb@your-project.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY             — the private key from your service account JSON
//   GOOGLE_SHEET_ID                — the ID from your sheet URL:
//                                    https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit

import type { VercelRequest, VercelResponse } from '@vercel/node'

// ── Minimal Google Sheets JWT auth ──────────────────────────────────────────

async function getAccessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

  const unsigned = `${encode(header)}.${encode(payload)}`

  const keyData = privateKey.replace(/\\n/g, '\n')
  const pemBody = keyData
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const binaryKey = Buffer.from(pemBody, 'base64')
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(unsigned),
  )

  const jwt = `${unsigned}.${Buffer.from(signature).toString('base64url')}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Token exchange failed: ${err}`)
  }

  const { access_token } = await tokenRes.json() as { access_token: string }
  return access_token
}

// ── Derive month tab name from a createdAt value ─────────────────────────────

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

// ── Color helpers ────────────────────────────────────────────────────────────

function hex(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: 1 }
}

// Header: deep navy
const HEADER_BG    = hex(15, 40, 80)    // #0F2850
const HEADER_FG    = hex(255, 255, 255) // white
// Alternating row tint
const ROW_TINT     = hex(235, 241, 251) // #EBF1FB light blue tint
const ROW_WHITE    = hex(255, 255, 255)
// Status colors
const GREEN_FG     = hex(27, 124, 55)   // #1B7C37
const RED_FG       = hex(182, 28, 28)   // #B61C1C
const GREEN_BG     = hex(220, 242, 228) // #DCF2E4
const RED_BG       = hex(250, 220, 220) // #FADCDC

// ── Column config: pixel widths ──────────────────────────────────────────────
// A=Date  B=Client  C=Travel  D=Package  E=Selling  F=Nett  G=Profit  H=Balance  I=Status
const COL_WIDTHS = [110, 180, 200, 260, 130, 130, 130, 120, 110]

const HEADER_ROW = [
  'Date Created',
  'Client Name',
  'Travel Date',
  'Package',
  'Selling Price',
  'Nett Cost',
  'Est. Profit',
  'Balance',
  'Status',
]

// ── Build header + column formatting requests ────────────────────────────────

function buildHeaderRequests(sheetId: number) {
  return [
    // 1. Header background + bold white text, center-aligned, larger font
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_BG,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            textFormat: {
              bold: true,
              fontSize: 10,
              foregroundColor: HEADER_FG,
              fontFamily: 'Arial',
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
      },
    },
    // 2. Freeze header row
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // 3. Header row height — taller for breathing room
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 40 },
        fields: 'pixelSize',
      },
    },
    // 4. Set column widths
    ...COL_WIDTHS.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    })),
  ]
}

// ── Build data row formatting requests ───────────────────────────────────────

function buildDataRowRequests(sheetId: number, rowIndex: number, isPaid: boolean) {
  // Alternate tint: even rows (0-based after header) get tint
  const isEven = rowIndex % 2 === 0
  const rowBg = isEven ? ROW_TINT : ROW_WHITE

  return [
    // Row height — generous so text has room
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
        cell: {
          userEnteredFormat: { horizontalAlignment: 'RIGHT' },
        },
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

// ── Ensure a tab exists; create it with styled header if not ─────────────────

async function ensureTab(
  token: string,
  spreadsheetId: string,
  tabName: string,
  existingSheets: { title: string; sheetId: number }[],
): Promise<number> {
  const found = existingSheets.find(s => s.title === tabName)
  if (found) return found.sheetId

  // Create the tab
  const createRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: tabName } } }],
      }),
    },
  )
  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Failed to create tab "${tabName}": ${err}`)
  }
  const createData = await createRes.json() as {
    replies: { addSheet: { properties: { sheetId: number } } }[]
  }
  const newSheetId = createData.replies[0].addSheet.properties.sheetId

  // Write header values
  const headerRange = encodeURIComponent(`${tabName}!A1:I1`)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${headerRange}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [HEADER_ROW] }),
    },
  )

  // Apply header styling + column widths
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: buildHeaderRequests(newSheetId) }),
    },
  )

  return newSheetId
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    GOOGLE_SHEET_ID,
  } = process.env

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    return res.status(500).json({ error: 'Missing Google Sheets environment variables.' })
  }

  const {
    createdAt,
    clientName,
    travelStart,
    travelEnd,
    packageName,
    sellingPrice,
    nettCost,
    estProfit,
    invoiceAmountPaid,
    invoiceBalance,
    status,
    currency = 'PHP',
  } = req.body as Record<string, string>

  if (!clientName || !status) {
    return res.status(400).json({ error: 'Missing required booking fields.' })
  }

  const gross = parseFloat(sellingPrice || '0')
  const nett  = parseFloat(nettCost || '0')
  const lltp  = estProfit !== undefined ? parseFloat(estProfit) : gross - nett
  const paid  = parseFloat(invoiceAmountPaid || '0')
  const balance = invoiceBalance !== undefined ? parseFloat(invoiceBalance) : Math.max(gross - paid, 0)
  const isPaid  = paid >= gross && gross > 0

  const fmt = (n: number) =>
    n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
  ]

  const tabName = getMonthTabName(createdAt || new Date().toISOString())

  try {
    const token = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)

    // Fetch spreadsheet metadata
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const meta = await metaRes.json() as { sheets?: { properties: { title: string; sheetId: number } }[] }
    const existingSheets = (meta.sheets || []).map(s => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
    }))

    // Ensure month tab exists
    const sheetId = await ensureTab(token, GOOGLE_SHEET_ID, tabName, existingSheets)

    // Read existing rows to check for duplicates
    const existingRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!A:I')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const existing = await existingRes.json() as { values?: string[][] }
    const rows = existing.values || []

    const travelDateStr = travelStart && travelEnd
      ? `${fmtDate(travelStart)} – ${fmtDate(travelEnd)}`
      : fmtDate(travelStart || travelEnd)

    // Skip row 0 (header) when searching
    const existingRowIndex = rows.findIndex((r, i) =>
      i > 0 && r[1] === clientName && r[2] === travelDateStr,
    )

    if (existingRowIndex !== -1) {
      // Update in place
      const updateRange = encodeURIComponent(`${tabName}!A${existingRowIndex + 1}:I${existingRowIndex + 1}`)
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        },
      )
      if (!updateRes.ok) {
        const err = await updateRes.text()
        throw new Error(`Sheets update error: ${err}`)
      }
    } else {
      // Append new row
      const range = encodeURIComponent(`${tabName}!A:I`)
      const sheetsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        },
      )
      if (!sheetsRes.ok) {
        const err = await sheetsRes.text()
        throw new Error(`Sheets API error: ${err}`)
      }
    }

    // Row index to format (0-based). New rows land at end of current rows.
    const targetRowIndex = existingRowIndex > 0 ? existingRowIndex : rows.length

    // ── Apply row formatting + resort + column widths ───────────────────────
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            // Style the written row
            ...buildDataRowRequests(sheetId, targetRowIndex, isPaid),
            // Re-apply column widths every sync so existing tabs stay consistent
            ...COL_WIDTHS.map((px, i) => ({
              updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
                properties: { pixelSize: px },
                fields: 'pixelSize',
              },
            })),
            // Sort data rows by date column A ascending (skip header row 0)
            {
              sortRange: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
                sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }],
              },
            },
          ],
        }),
      },
    )

    return res.status(200).json({ ok: true, tab: tabName })
  } catch (err) {
    console.error('[sheets-append]', err)
    return res.status(500).json({ error: String(err) })
  }
}
