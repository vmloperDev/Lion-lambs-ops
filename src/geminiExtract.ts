// Gemini-powered auto-fill: takes raw pasted text (chat/email/anything) and
// extracts whatever structured booking fields it can confidently find.
// Only fields explicitly present in the source text are returned — the model
// is instructed to omit anything it isn't sure about rather than guess.

export type ExtractedBookingFields = {
  clientName?: string
  contactNumber?: string
  clientEmail?: string
  packageName?: string
  destination?: string
  travelStart?: string // ISO yyyy-mm-dd
  travelEnd?: string   // ISO yyyy-mm-dd
  pax?: string
  itemDescription?: string
  quantity?: string
  unitPrice?: string
  sellingPrice?: string
  supplier?: string
  supplierContact?: string
  paymentMethod?: string
  flightDetails?: string
  accommodation?: string
  hotelAddress?: string
  emergencyContact?: string
  specialInstructions?: string
  notes?: string
}

const EXTRACTABLE_FIELDS: Array<keyof ExtractedBookingFields> = [
  'clientName', 'contactNumber', 'clientEmail', 'packageName', 'destination',
  'travelStart', 'travelEnd', 'pax', 'itemDescription', 'quantity', 'unitPrice',
  'sellingPrice', 'supplier', 'supplierContact', 'paymentMethod', 'flightDetails',
  'accommodation', 'hotelAddress', 'emergencyContact', 'specialInstructions', 'notes',
]

const GEMINI_MODEL = 'gemini-2.5-flash'

function buildPrompt(sourceText: string): string {
  return `You are a data-extraction assistant for a travel agency's booking form.
Below is raw text from a client conversation (could be a chat log, email, or messy notes).
Extract ONLY the fields you can find explicit evidence for in the text. Today's date is ${new Date().toISOString().slice(0, 10)}, use it to resolve relative dates like "next month" or "this Saturday".

Rules:
- Return ONLY valid JSON. No markdown fences, no preamble, no explanation.
- Only include a key if the source text actually contains that information. Omit keys you are not confident about — do NOT guess or invent values.
- Dates must be formatted as YYYY-MM-DD.
- "pax" is the number of travelers/passengers, as a string of digits (e.g. "4").
- "unitPrice" and "sellingPrice" are numeric strings without currency symbols or commas (e.g. "12500").
- "packageName" is the tour/package name or a short description of what's being booked (e.g. "3D2N Boracay Package").
- "itemDescription" is what the line item / service being booked is, if different/more specific than packageName.
- Valid keys are exactly: ${EXTRACTABLE_FIELDS.join(', ')}.

Source text:
"""
${sourceText}
"""

Return the JSON object now.`
}

export class GeminiExtractError extends Error {}

export async function extractBookingFieldsFromText(
  sourceText: string,
): Promise<{ fields: ExtractedBookingFields; rawFieldCount: number }> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined

  if (!apiKey) {
    throw new GeminiExtractError(
      'No Gemini API key configured. Add VITE_GEMINI_API_KEY to your .env file.',
    )
  }

  if (!sourceText.trim()) {
    throw new GeminiExtractError('Paste some text first.')
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(sourceText) }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    },
  )

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new GeminiExtractError(
      `Gemini API error (${response.status}): ${errBody || response.statusText}`,
    )
  }

  const data = await response.json()
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) {
    throw new GeminiExtractError('Gemini returned an empty response. Try again.')
  }

  let parsed: Record<string, unknown>
  try {
    const cleaned = text.replace(/^```json\s*|^```\s*|```\s*$/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new GeminiExtractError('Could not parse the extracted data. Try rephrasing or pasting again.')
  }

  const fields: ExtractedBookingFields = {}
  let rawFieldCount = 0

  for (const key of EXTRACTABLE_FIELDS) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) {
      fields[key] = value.trim()
      rawFieldCount++
    }
  }

  return { fields, rawFieldCount }
}
