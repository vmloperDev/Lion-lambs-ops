// api/sheets-append.ts
// Vercel Serverless Function — upserts a confirmed/flown booking row to Google Sheets.
// Each month gets its own tab (e.g. "Jan 2026") based on the booking's createdAt date.
// Rows are matched by bookingId stored in a hidden column J — reliable regardless
// of whether the client name or travel dates have been edited.
//
// ENV VARS required (set in Vercel dashboard → Settings → Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   — e.g. lion-lamb@your-project.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY             — the private key from your service account JSON
//   GOOGLE_SHEET_ID                — the ID from your sheet URL:
//                                    https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit

import type { VercelRequest, VercelResponse } from '@vercel/node'

// ── JWT auth ─────────────────────────────────────────────────────────────────

async function getAccessToken(email: string, privateKey: string): Promise<string> {
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

// ── Colors + layout ───────────────────────────────────────────────────────────

function hex(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: 1 }
}

const HEADER_BG = hex(15, 40, 80)
const HEADER_FG = hex(255, 255, 255)

// A=Date B=Client C=Travel D=Package E=Gross F=Nett G=LLTP H=Balance I=Status  J=ID(hidden)
const COL_WIDTHS = [110, 180, 200, 260, 130, 130, 130, 120, 110, 1]

const HEADER_ROW = ['Date Created', 'Client Name', 'Travel Date', 'Package', 'Gross', 'NETT', 'LLTP', 'Balance', 'Status', '_id']

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

// ── Ensure tab exists — race-safe ─────────────────────────────────────────────
// If two requests try to create the same tab simultaneously, the second one
// will fail. We catch that, re-fetch the sheet list, and return the tab that
// the first request created — instead of letting Google append "_conflict_N".

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

    // Write header row
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName + '!A1:J1')}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [HEADER_ROW] }),
      },
    )

    // Apply header styling
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

  // Creation failed — likely a race. Re-fetch and find the tab.
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

  // Column J holds the bookingId as a hidden stable key for future updates
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

    await ensureTab(token, GOOGLE_SHEET_ID, tabName, existingSheets)

    // Read column J (bookingId) to find an existing row for this booking
    const idColRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!J:J')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const idColData = await idColRes.json() as { values?: string[][] }
    const idCol = (idColData.values || []).map(r => r[0] || '')

    // Fall back to matching by clientName+travelDate for rows written before bookingId was added
    const existingByName = async () => {
      const existingRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(tabName + '!A:C')}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const existingData = await existingRes.json() as { values?: string[][] }
      const rows = existingData.values || []
      return rows.findIndex((r, i) => i > 0 && r[1] === clientName && r[2] === travelDate)
    }

    // Row index in the sheet (0-based); -1 means not found → append
    let existingRowIndex = bookingId ? idCol.findIndex((id, i) => i > 0 && id === bookingId) : -1
    if (existingRowIndex === -1 && bookingId) {
      // bookingId not found — check if it exists under the old name+date match
      existingRowIndex = await existingByName()
    }

    if (existingRowIndex !== -1) {
      // Update in place
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

    return res.status(200).json({ ok: true, tab: tabName })
  } catch (err) {
    console.error('[sheets-append]', err)
    return res.status(500).json({ error: String(err) })
  }
}
