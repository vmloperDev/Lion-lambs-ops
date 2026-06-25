// api/sheets-append.ts
// Vercel Serverless Function — appends a confirmed/flown booking row to Google Sheets.
// Each month gets its own tab (e.g. "Jan 2026") based on the booking's createdAt date.
// The tab is created automatically if it doesn't exist yet, with a header row.
//
// ENV VARS required (set in Vercel dashboard → Settings → Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   — e.g. lion-lamb@your-project.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY             — the private key from your service account JSON
//                                    (paste the full "-----BEGIN RSA PRIVATE KEY-----\n..." value)
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
// Returns e.g. "Jan 2026"

function getMonthTabName(createdAt: string): string {
  let d: Date
  const n = Number(createdAt)
  if (!isNaN(n) && String(createdAt).length >= 10) {
    d = n > 1e10 ? new Date(n) : new Date(n * 1000)
  } else if (/^\d{4}-\d{2}-\d{2}/.test(createdAt)) {
    // ISO date string — parse as local to avoid timezone shifting the day
    const [y, m] = createdAt.split('-').map(Number)
    d = new Date(y, m - 1, 1)
  } else {
    d = new Date(createdAt)
  }
  if (isNaN(d.getTime())) d = new Date()
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) // "Jan 2026"
}

// ── Ensure a tab exists; create it with a header row if not ─────────────────
// Returns the sheetId (numeric) of the tab.

const HEADER_ROW = ['Date Created', 'Client Name', 'Travel Date', 'Package', 'Selling Price', 'Nett Cost', 'Est. Profit', 'Balance', 'Status']

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

  // Write header row
  const headerRange = encodeURIComponent(`${tabName}!A1:I1`)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${headerRange}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [HEADER_ROW] }),
    },
  )

  // Bold + freeze the header row
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
        ],
      }),
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
  const nett = parseFloat(nettCost || '0')
  const lltp = estProfit !== undefined ? parseFloat(estProfit) : gross - nett
  const paid = parseFloat(invoiceAmountPaid || '0')
  const balance = invoiceBalance !== undefined ? parseFloat(invoiceBalance) : Math.max(gross - paid, 0)
  const isPaid = paid >= gross && gross > 0

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
    balance > 0 ? `${currency} ${fmt(balance)}` : '0',
    isPaid ? 'PAID' : 'NOT PAID',
  ]

  // Determine which month tab this booking belongs to
  const tabName = getMonthTabName(createdAt || new Date().toISOString())

  try {
    const token = await getAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)

    // Fetch spreadsheet metadata to get existing tabs
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const meta = await metaRes.json() as { sheets?: { properties: { title: string; sheetId: number } }[] }
    const existingSheets = (meta.sheets || []).map(s => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
    }))

    // Ensure the month tab exists (creates it + header if missing)
    const sheetId = await ensureTab(token, GOOGLE_SHEET_ID, tabName, existingSheets)

    // Read existing rows in this tab to check for duplicates
    const existingRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!A:I')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const existing = await existingRes.json() as { values?: string[][] }
    const rows = existing.values || []

    const travelDateStr = travelStart && travelEnd
      ? `${fmtDate(travelStart)} – ${fmtDate(travelEnd)}`
      : fmtDate(travelStart || travelEnd)

    // Match on client name + travel date (skip row 0 which is the header)
    const existingRowIndex = rows.findIndex((r, i) =>
      i > 0 && r[1] === clientName && r[2] === travelDateStr,
    )

    if (existingRowIndex !== -1) {
      // Update the existing row in place
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
      // Append a new row
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

    // Which row index to target for status formatting
    const targetRowIndex = existingRowIndex > 0
      ? existingRowIndex
      : rows.length // new row appended at end

    // ── Formatting ──────────────────────────────────────────────────────────
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            // 1. Wrap text on all data rows
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
                cell: {
                  userEnteredFormat: {
                    wrapStrategy: 'WRAP',
                    backgroundColor: { red: 1, green: 1, blue: 1, alpha: 1 },
                  },
                },
                fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.backgroundColor',
              },
            },
            // 2. Status cell — bold, colored text
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: targetRowIndex,
                  endRowIndex: targetRowIndex + 1,
                  startColumnIndex: 8,
                  endColumnIndex: 9,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 1, green: 1, blue: 1, alpha: 1 },
                    textFormat: {
                      bold: true,
                      foregroundColor: isPaid
                        ? { red: 0.106, green: 0.490, blue: 0.216, alpha: 1 } // #1B7C37 green
                        : { red: 0.714, green: 0.110, blue: 0.110, alpha: 1 }, // #B61C1C red
                    },
                  },
                },
                fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat',
              },
            },
            // 3. Sort data rows by date column A ascending
            {
              sortRange: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
                sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }],
              },
            },
            // 4. Auto-resize all columns
            {
              autoResizeDimensions: {
                dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 9 },
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
