import type {
  BookingFormData, BookingLineItem, BookingRecord,
  BreakdownLineItem, DtrEntry, InvoiceLineItem,
  PasswordStrength, PaxBreakdown,
} from './types'
import { emptyBookingForm, bookingStorageKey, sampleBookings } from './constants'

// ── Auth / display helpers ──────────────────────────────────────────────────

export function getDisplayName(emailAddress: string) {
  const username = emailAddress.split('@')[0] || 'Team Member'
  return username
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getPasswordStrength(passwordValue: string): PasswordStrength {
  let score = 0
  if (passwordValue.length >= 8) score += 1
  if (/[A-Z]/.test(passwordValue) && /[a-z]/.test(passwordValue)) score += 1
  if (/\d/.test(passwordValue) || /[^A-Za-z0-9]/.test(passwordValue)) score += 1
  if (score >= 3) return { label: 'Strong', score: 3 }
  if (score === 2) return { label: 'Fair', score: 2 }
  return { label: 'Weak', score: 1 }
}

// ── Booking helpers ─────────────────────────────────────────────────────────

export function normalizeBooking(booking: BookingRecord): BookingRecord {
  // Legacy records (and anything synced before this rename) may still carry
  // the old "Pending" status — treat it as "Quotation" going forward.
  const rawStatus = booking.status as string
  const migratedStatus = rawStatus === 'Pending' ? 'Quotation' : rawStatus
  return {
    ...emptyBookingForm,
    ...booking,
    status: (['Quotation', 'Invoice', 'Confirmed', 'Flown'] as const).includes(migratedStatus as 'Quotation' | 'Invoice' | 'Confirmed' | 'Flown') ? (migratedStatus as BookingRecord['status']) : 'Quotation',
    id: booking.id,
    createdAt: booking.createdAt || new Date().toISOString(),
  }
}

export function getStoredBookings(storageKey = bookingStorageKey, useSamples = true) {
  const storedBookings = window.localStorage.getItem(storageKey)
  if (!storedBookings) return useSamples ? sampleBookings : []
  try {
    return (JSON.parse(storedBookings) as BookingRecord[]).map(normalizeBooking)
  } catch {
    return sampleBookings
  }
}

export function getUserBookingsCollectionPath(userId: string) {
  return `users/${userId}/bookings`
}

export function getBookingOwnerPath(booking: BookingRecord | undefined | null, fallbackUserId: string) {
  return getUserBookingsCollectionPath(booking?.ownerId || fallbackUserId)
}

// ── Amount / quantity formatters ────────────────────────────────────────────

export function parseAmount(value?: string) {
  return Number((value ?? '').replace(/[^\d.]/g, '')) || 0
}

export function parseQuantity(value?: string) {
  const quantity = Number((value ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
}

export function formatAmount(value?: string, currency = 'PHP') {
  const amount = parseAmount(value)
  if (!Number.isFinite(amount) || amount <= 0) return `${currency} 0.00`
  return `${currency} ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function computePaymentStatus(totalPrice: number, amountPaid: number): string {
  if (totalPrice > 0 && amountPaid >= totalPrice) return 'Paid'
  if (amountPaid > 0) return 'Partially Paid'
  return 'Unpaid'
}

export function formatProjectDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || 'No date'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Returns a YYYY-MM-DD string for <input type="date"> using the browser's
// LOCAL calendar date. `new Date().toISOString().slice(0,10)` looks
// equivalent but isn't — toISOString() converts to UTC first, so for
// timezones ahead of UTC (e.g. Philippines, UTC+8) any time between
// midnight and 8am local is still "yesterday" in UTC. That's why a project
// created just after midnight on Jul 1 could get silently dated Jun 30.
// Always build the string from local getFullYear/getMonth/getDate instead.
export function toDateInputValue(value?: Date | string): string {
  const date = value ? (typeof value === 'string' ? new Date(value) : value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ── Pax helpers ─────────────────────────────────────────────────────────────

export function readPaxBreakdown(value?: string): PaxBreakdown {
  try {
    if (value) {
      const parsed = JSON.parse(value)
      return { adult: parsed.adult || '', senior: parsed.senior || '', child: parsed.child || '', infant: parsed.infant || '' }
    }
  } catch {}
  return { adult: '', senior: '', child: '', infant: '' }
}

export function sumPaxBreakdown(pax: PaxBreakdown) {
  return parseAmount(pax.adult) + parseAmount(pax.senior) + parseAmount(pax.child) + parseAmount(pax.infant)
}

export function formatPaxBreakdownLabel(pax: PaxBreakdown) {
  const parts: string[] = []
  if (parseAmount(pax.adult) > 0) parts.push(`${pax.adult} Adult`)
  if (parseAmount(pax.senior) > 0) parts.push(`${pax.senior} Senior`)
  if (parseAmount(pax.child) > 0) parts.push(`${pax.child} Child`)
  if (parseAmount(pax.infant) > 0) parts.push(`${pax.infant} Infant`)
  return parts.join(', ')
}

// The booking's single shared group headcount — set once, then every
// Pax-Tier Pricing row inherits it (see getItemPaxCounts below) instead of
// each row carrying its own separately-typed counts.
export function readGroupPax(booking: BookingFormData): PaxBreakdown {
  return readPaxBreakdown(booking.groupPax)
}

// Same [Adult, Child, Senior, Infant] order used everywhere else (matches
// the price2Pax/price5Pax/priceGroup/priceInfant fields index-for-index).
export function getGroupPaxCounts(booking: BookingFormData): string[] {
  const pax = readGroupPax(booking)
  return [pax.adult, pax.child, pax.senior, pax.infant]
}

export const PAX_CATEGORY_KEYS = ['adult', 'child', 'senior', 'infant'] as const

// Categories a row has opted OUT of — it no longer inherits the group's
// headcount for those, e.g. a service that doesn't apply to the child.
export function readExcludedPax(item?: BreakdownLineItem): string[] {
  try {
    const parsed = JSON.parse(item?.excludedPax || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ── Line item helpers ───────────────────────────────────────────────────────

export function createLineItemId() {
  return `LI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Random (non-sequential) quotation number — QT-<year>-<5 random digits>.
// Doesn't count off bookings.length, so it stays unique even after
// deletions, duplicates across devices, etc.
export function generateQuotationNo() {
  const year = new Date().getFullYear()
  const randomDigits = String(Math.floor(Math.random() * 100000)).padStart(5, '0')
  return `QT-${year}-${randomDigits}`
}

export function getLines(value: string | undefined, fallback: string[]) {
  const lines = (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.length > 0 ? lines : fallback
}

export function readInvoiceItems(booking: BookingFormData): InvoiceLineItem[] {
  try {
    if (booking.invoiceLineItemsJson) {
      const items: InvoiceLineItem[] = JSON.parse(booking.invoiceLineItemsJson)
      const filtered = items.filter(item => item.isPackageRow || item.source === 'breakdown')
      let packageRowSeen = false
      return filtered.filter(item => {
        if (item.isPackageRow) { if (packageRowSeen) return false; packageRowSeen = true }
        return true
      })
    }
  } catch {}
  return [{ description: booking.packageName || 'Basic Package', quantity: booking.quantity || '1', unitPrice: booking.unitPrice || booking.sellingPrice, nettCost: '0', isPackageRow: true }]
}

// ── Invoice "Package" + "Addons" — the dedicated, newer invoice fields ────────
// These are edited in their own UI table (separate from the legacy
// invoiceLineItemsJson rows) and are what the printed invoice document
// actually renders. This is the single source of truth for them so every
// other total (payment balance, "PAID?" logic, dashboard totals, Sheets
// sync) reads the SAME numbers the client sees on the invoice — addons can
// never again be visible on the document but silently excluded from totals.

export type InvoicePackageRow = { name: string; qty: string; price: string }
export type InvoiceAddonRow = { id?: string; name?: string; qty?: string; price?: string; nett?: string; showInDocument?: boolean }

export function readInvoicePackage(booking: BookingFormData): InvoicePackageRow {
  try {
    const p = JSON.parse(booking.invoicePackage || '')
    if (p && typeof p === 'object') return { name: p.name || '', qty: p.qty || '1', price: p.price || '' }
  } catch {}
  return { name: '', qty: '1', price: '' }
}

export function readInvoiceAddons(booking: BookingFormData): InvoiceAddonRow[] {
  try {
    const a = JSON.parse(booking.invoiceAddons || '')
    if (Array.isArray(a)) return a
  } catch {}
  return []
}

// Builds the package + addon line items exactly as the printed invoice does
// (including the showInDocument filter — an addon hidden from the document
// is also excluded from what the client is billed for it). Returns null if
// neither the package nor any addon has been filled in, so callers know to
// fall back to the legacy invoiceLineItemsJson rows instead.
export function readInvoicePackageAndAddonLines(booking: BookingFormData): BookingLineItem[] | null {
  const invPkg = readInvoicePackage(booking)
  const invAddons = readInvoiceAddons(booking)
  const hasNewInvoiceData = !!(invPkg.name || invPkg.price) || invAddons.some(a => a.name || a.price)
  if (!hasNewInvoiceData) return null

  const paxTotal = getBreakdownPaxTotal(booking)
  const brkItemsForAddons = readBreakdownItems(booking)

  // Each addon prints as ONE combined line — if it mirrors a Breakdown row
  // priced per pax tier (e.g. Adult ₱222, Child ₱3), its Qty is the sum of
  // that row's OWN tier headcounts (e.g. 2 Adult + 3 Child = Qty 5) and its
  // Unit Price is the total averaged back over that Qty.
  const addonRows: BookingLineItem[] = invAddons
    .filter(a => (a.name || a.price) && a.showInDocument !== false)
    .map(a => {
      const linkedBrk = brkItemsForAddons.find(b => b.mirrorId === `item-${a.id}`)
      if (linkedBrk) {
        return buildCombinedTierLine(a.name || linkedBrk.description || 'Addon', linkedBrk, paxTotal, booking)
      }
      const originalQty = parseQuantity(a.qty || '1'), price = parseAmount(a.price), n = parseAmount(a.nett)
      const amount = originalQty * price
      // The Breakdown's pax headcount becomes this addon's Qty (its price
      // is treated as a per-person rate) whenever a headcount is set —
      // total dollar amount is preserved either way.
      const q = paxTotal > 0 ? paxTotal : originalQty
      const u = q > 0 ? amount / q : price
      return { description: a.name || 'Addon', quantity: q, unitPrice: u, nettCost: n, total: amount, nettTotal: q * n, profit: amount - q * n }
    })

  // Once any addon is shown on the Invoice, the Package row itself carries
  // no client price of its own (the addons ARE the priced breakdown of the
  // package — showing both would double-charge). With no addons shown, the
  // Package instead prices itself off the Breakdown sheet's total — but
  // that Breakdown total is already a TOTAL (rate × headcount for every
  // Inclusion), not a per-person rate. Dividing it back by the pax count
  // turns it into the Package's Unit Price (the SUBTOTAL, i.e. combined
  // per-person rate); multiplying that by Qty (the pax count) below then
  // reconstructs the same Breakdown total as the printed Amount — exactly
  // like "Unit Price = Subtotal, Amount = Unit Price × Qty" on the
  // Quotation.
  const hasOtherItems = addonRows.length > 0
  const breakdownTotal = getBreakdownTotal(booking)
  const pkgQty = paxTotal > 0 ? paxTotal : parseQuantity(invPkg.qty || '1')
  const pkgUnitPrice = hasOtherItems
    ? 0
    : breakdownTotal > 0
    ? (pkgQty > 0 ? breakdownTotal / pkgQty : breakdownTotal)
    : parseAmount(invPkg.price)

  // The Package row's per-pax-tier rates print UN-combined — "Adult Rate"
  // (Qty 5), "Child Rate" (Qty 1) — under a plain package-name header with
  // no Qty/Unit Price of its own. The package always shows on the Invoice —
  // there's no "Show to Invoice" toggle for it anymore.
  const pkgTierRows = buildPackageTierLines(booking)
  const packageRows: BookingLineItem[] = pkgTierRows.length > 0
    ? [
        {
          description: invPkg.name || booking.packageName || 'Package',
          quantity: 0, unitPrice: 0, nettCost: 0, total: 0, nettTotal: 0, profit: 0,
          hideQty: true, hidePrice: true,
        },
        ...pkgTierRows,
      ]
    : [{
        description: invPkg.name || booking.packageName || 'Package',
        quantity: pkgQty,
        unitPrice: pkgUnitPrice,
        nettCost: 0,
        total: hasOtherItems ? 0 : pkgQty * pkgUnitPrice,
        nettTotal: 0,
        profit: hasOtherItems ? 0 : pkgQty * pkgUnitPrice,
        hidePrice: hasOtherItems,
        hideQty: true,
      }]

  return [...packageRows, ...addonRows]
}

// Combines a Breakdown item's pricing into a SINGLE printed line — for a
// current row (flat Unit Price), Qty is the combined pax headcount across
// all four tiers. For an older per-tier row, Qty is the sum of headcounts
// across whichever tiers have both a price and a headcount set (e.g. 2
// Adult + 3 Child = Qty 5). Either way, Unit Price is the item's total
// averaged back over that Qty, so the printed Amount still matches the
// internal Breakdown sheet exactly.
export function buildCombinedTierLine(description: string, item: BreakdownLineItem, fallbackQty: number, booking: BookingFormData): BookingLineItem {
  const amount = getBreakdownItemTotal(item, booking)
  const flatPrice = parseAmount(item.unitPrice)
  let q: number
  if (flatPrice > 0) {
    q = getBreakdownItemQty(item, booking)
  } else {
    const colPax = getItemPaxCounts(item, booking)
    const fields: (keyof BreakdownLineItem)[] = ['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant']
    const tierRows = fields
      .map((field, i) => ({ price: parseAmount(item[field] as string), count: parseQuantity(colPax[i] || '0') }))
      .filter((t) => t.price > 0 && t.count > 0)
    // This row's own effective (inherited, minus any excluded categories)
    // headcount is the correct fallback when no tier has both a price and
    // a count set — e.g. a rate isn't filled in yet for any tier. Only
    // fall back to the group total (or 1) if this row has excluded every
    // category.
    const ownPaxTotal = sumPaxBreakdown(getItemPaxBreakdown(item, booking))
    q = tierRows.length > 0
      ? tierRows.reduce((sum, t) => sum + t.count, 0)
      : (ownPaxTotal > 0 ? ownPaxTotal : (fallbackQty > 0 ? fallbackQty : 1))
  }
  const u = q > 0 ? amount / q : 0
  return { description, quantity: q, unitPrice: u, nettCost: 0, total: amount, nettTotal: 0, profit: amount }
}

// The four Adult/Child/Senior/Infant per-person rates exactly as they print
// on the Breakdown document's SUBTOTAL row: for each tier, the sum of that
// tier's rate across every Inclusion row (Add-ons are excluded — they're
// priced on their own line on the Quotation/Invoice, not folded into the
// package's rate). Rows priced with a single flat Unit Price instead of
// per-tier rates don't contribute to any one column here. This is what an
// Inclusion's cost actually buys: it raises the overall per-person "Adult
// Rate" / "Child Rate" etc. by its own tier price — e.g. Hotel ₱555 + Fuel
// Surcharge ₱200 + LTT ₱150, all entered under Adult, become a combined
// ₱905 Adult Rate. There's no separate "package" rate anymore — the
// package's price IS this combined Inclusion total.
export function getBreakdownTierSubtotals(booking: BookingFormData): number[] {
  const inclusionItems = readBreakdownItems(booking).filter((item) => !item.isPackageRow && item.itemType !== 'addon')
  const fields: (keyof BreakdownLineItem)[] = ['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant']
  return fields.map((field, i) =>
    inclusionItems.reduce((sum, item) => {
      if (parseAmount(item.unitPrice) > 0) return sum
      // A row that's excluded this tier (via excludedPax) shouldn't have
      // its rate counted toward that column's subtotal, even if a price
      // is still filled in — excluding a category is meant to zero it out
      // everywhere it's priced, not just its headcount.
      if (readExcludedPax(item).includes(PAX_CATEGORY_KEYS[i])) return sum
      return sum + parseAmount(item[field] as string)
    }, 0)
  )
}

// The package's per-pax-tier rates — these stay UN-combined, one printed
// line per pax type that has both a rate and a headcount set, e.g. "Adult
// Rate" (Qty 5), "Child Rate" (Qty 1). Counts come from the booking's
// shared group headcount; the RATE for each tier is the combined Inclusion
// subtotal for that tier (see getBreakdownTierSubtotals) — so adding/
// pricing an Inclusion under "Adult" automatically raises the printed
// "Adult Rate" instead of requiring it to be re-typed by hand anywhere.
export function buildPackageTierLines(booking: BookingFormData): BookingLineItem[] {
  const paxLabels = ['Adult', 'Child', 'Senior', 'Infant']
  const colPax = getGroupPaxCounts(booking)
  const subtotals = getBreakdownTierSubtotals(booking)
  return subtotals
    .map((price, i) => ({ label: paxLabels[i], price, count: parseQuantity(colPax[i] || '0') }))
    .filter((t) => t.price > 0 && t.count > 0)
    .map((t) => ({
      description: `${t.label} Rate`,
      quantity: t.count, unitPrice: t.price, nettCost: 0,
      total: t.count * t.price, nettTotal: 0, profit: t.count * t.price,
    }))
}

// Whether a Pax-Tier Pricing row has a per-person rate entered in ANY of
// the four Adult/Child/Senior/Infant price columns (legacy rows), or has
// the newer flat Unit Price filled in (current rows, priced once and
// multiplied by the combined pax headcount instead of per tier).
export function breakdownItemHasRate(item: BreakdownLineItem): boolean {
  const fields: (keyof BreakdownLineItem)[] = ['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant']
  return fields.some((field) => parseAmount(item[field] as string) > 0) || parseAmount(item.unitPrice) > 0
}

// Rows that already have at least one pax-tier rate filled in float to the
// top, ahead of still-blank rows — a stable sort, so rows keep their
// relative order within each of those two groups. Used by the Pax-Tier
// Pricing editor and by the printed Breakdown/Quotation documents so the
// row order (and therefore what a reader sees first) matches everywhere;
// the totals themselves are unaffected since those are summed regardless
// of row order.
export function sortBreakdownItemsByRate<T extends BreakdownLineItem>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aHas = breakdownItemHasRate(a.item) ? 0 : 1
      const bHas = breakdownItemHasRate(b.item) ? 0 : 1
      return aHas !== bHas ? aHas - bHas : a.index - b.index
    })
    .map((entry) => entry.item)
}

export function readBreakdownItems(booking: BookingFormData): BreakdownLineItem[] {
  try {
    if (booking.breakdownLineItemsJson) return JSON.parse(booking.breakdownLineItemsJson)
  } catch {}
  return [{ description: 'Group Package', quantity: '1', unitPrice: booking.unitPrice || booking.sellingPrice, nettCost: booking.nettCost, sendToInvoice: false, sendToPO: false, isPackageRow: true }]
}

// The four pax-tier group-size counts (Adult, Child, Senior, Infant) shown
// in the Breakdown document's column headers / subtotal row. These come
// straight from the booking's single shared group headcount.
export function getBreakdownColPax(booking: BookingFormData): string[] {
  return getGroupPaxCounts(booking)
}

// A Pax-Tier Pricing row's effective Adult/Child/Senior/Infant headcount —
// inherited from the booking's single shared groupPax, with any category
// the row has explicitly opted out of (via excludedPax) zeroed out. e.g. a
// service that only 2 of the group's 3 people are taking just removes that
// one category rather than needing its own count retyped. Returned in the
// same [Adult, Child, Senior, Infant] order as the price2Pax/price5Pax/
// priceGroup/priceInfant fields so the two arrays line up index-for-index.
export function getItemPaxCounts(item: BreakdownLineItem | undefined, booking: BookingFormData): string[] {
  const shared = getGroupPaxCounts(booking)
  const excluded = readExcludedPax(item)
  return shared.map((value, i) => (excluded.includes(PAX_CATEGORY_KEYS[i]) ? '' : value))
}

// The effective headcount for a row, as a PaxBreakdown object (used when
// mirroring a row's pax to its linked P.O. item).
export function getItemPaxBreakdown(item: BreakdownLineItem | undefined, booking: BookingFormData): PaxBreakdown {
  const [adult, child, senior, infant] = getItemPaxCounts(item, booking)
  return { adult, child, senior, infant }
}

// Total amount for a single Pax-Tier Pricing row (a "service" row, not the
// package row). Current rows are priced per pax type — Adult/Child/Senior/
// Infant rate × that row's OWN headcount for each tier. A row can also
// still be priced with a single flat Unit Price × its own combined
// headcount (older rows, or a quick flat-rate entry), which takes
// precedence over the per-tier fields when both are present.
export function getBreakdownItemTotal(item: BreakdownLineItem, booking: BookingFormData): number {
  const flatPrice = parseAmount(item.unitPrice)
  if (flatPrice > 0) {
    return getBreakdownItemQty(item, booking) * flatPrice
  }
  const colPax = getItemPaxCounts(item, booking)
  const fields: (keyof BreakdownLineItem)[] = ['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant']
  return fields.reduce((sum, field, i) => sum + parseAmount(item[field] as string) * parseQuantity(colPax[i]), 0)
}

// A service row's Qty: whatever's manually typed into its own Qty field,
// or (when left blank) that row's own effective (inherited) pax headcount.
export function getBreakdownItemQty(item: BreakdownLineItem, booking: BookingFormData): number {
  const rawQty = Number((item.quantity ?? '').replace(/[^\d.]/g, ''))
  if (Number.isFinite(rawQty) && rawQty > 0) return rawQty
  const paxTotal = sumPaxBreakdown(getItemPaxBreakdown(item, booking))
  return paxTotal > 0 ? paxTotal : 1
}

// The Breakdown sheet's grand total (sum of every Inclusion row's pax-tier
// total). This is what the Package's client price falls back to on the
// Quotation/Invoice whenever no addon or other priced item is shown on
// that document — see readInvoicePackageAndAddonLines below.
export function getBreakdownTotal(booking: BookingFormData): number {
  return readBreakdownItems(booking)
    .filter((item) => !item.isPackageRow && item.itemType !== 'addon')
    .reduce((sum, item) => sum + getBreakdownItemTotal(item, booking), 0)
}

// The booking's single shared group headcount (Adult + Child + Senior +
// Infant), summed. This is what addon rows use as their Qty on the printed
// Quotation/Invoice — the price entered for an addon is treated as a
// per-person rate, multiplied out by the group size, instead of a flat
// one-off amount.
export function getBreakdownPaxTotal(booking: BookingFormData): number {
  return sumPaxBreakdown(readGroupPax(booking))
}

export function mapInvoiceItemsToBookingLines(items: InvoiceLineItem[], packageName = 'Basic Package', breakdownTotal = 0): BookingLineItem[] {
  const otherItemsPresent = items.some((it) => !it.isPackageRow)
  return items.map((it) => {
    const q = parseQuantity(it.quantity), n = it.isPackageRow ? 0 : parseAmount(it.nettCost)
    let u = parseAmount(it.unitPrice)
    let hidePrice = false
    if (it.isPackageRow) {
      if (otherItemsPresent) { u = 0; hidePrice = true }
      else if (breakdownTotal > 0) { u = breakdownTotal }
    }
    return { description: it.description || (it.isPackageRow ? packageName || 'Basic Package' : 'Item'), quantity: q, unitPrice: u, nettCost: n, total: q * u, nettTotal: q * n, profit: q * (u - n), hidePrice }
  })
}

export function mapBreakdownItemsToBookingLines(items: BreakdownLineItem[], packageName = 'Basic Package'): BookingLineItem[] {
  return items.map((it) => {
    const q = parseQuantity(it.quantity), u = parseAmount(it.unitPrice), n = it.isPackageRow ? 0 : parseAmount(it.nettCost)
    return { description: it.description || (it.isPackageRow ? packageName || 'Basic Package' : 'Item'), quantity: q, unitPrice: u, nettCost: n, total: q * u, nettTotal: q * n, profit: q * (u - n) }
  })
}

export function getBookingLineItems(booking: BookingFormData): BookingLineItem[] {
  // Prefer the dedicated Package + Addons fields (what the printed invoice
  // actually shows) — this is what fixes addons being invisible to totals.
  const newStyleLines = readInvoicePackageAndAddonLines(booking)
  if (newStyleLines && newStyleLines.length > 0) return newStyleLines

  const invoiceItems = readInvoiceItems(booking)
  if (invoiceItems.length > 0) return mapInvoiceItemsToBookingLines(invoiceItems, booking.packageName, getBreakdownTotal(booking))
  const quantity = parseQuantity(booking.quantity)
  const unitPrice = parseAmount(booking.unitPrice || booking.sellingPrice)
  return [{ description: readBreakdownItems(booking).find(i => i.isPackageRow)?.description || booking.packageName || 'Basic Package', quantity, unitPrice, nettCost: 0, total: quantity * unitPrice, nettTotal: 0, profit: quantity * unitPrice }]
}

export function sumLineItems(items: BookingLineItem[], field: 'total' | 'nettTotal' | 'profit') {
  return items.reduce((sum, item) => sum + item[field], 0)
}

export function getBookingClientTotal(booking: BookingFormData) {
  return sumLineItems(getBookingLineItems(booking), 'total')
}

export function getBookingBreakdownNettTotal(booking: BookingFormData) {
  return sumLineItems(mapBreakdownItemsToBookingLines(readBreakdownItems(booking)), 'nettTotal')
}

// ── DTR helpers ─────────────────────────────────────────────────────────────

export function timeStrToMinutes(value: string): number | null {
  if (!value) return null
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1]), minutes = Number(match[2])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  return hours * 60 + minutes
}

export function pairMinutes(inTime: string, outTime: string): number {
  const inMin = timeStrToMinutes(inTime), outMin = timeStrToMinutes(outTime)
  if (inMin === null || outMin === null || outMin <= inMin) return 0
  return outMin - inMin
}

export function getDtrEntryMinutes(entry: Pick<DtrEntry, 'amIn' | 'amOut' | 'pmIn' | 'pmOut'>) {
  return pairMinutes(entry.amIn, entry.amOut) + pairMinutes(entry.pmIn, entry.pmOut)
}

export function formatMinutesAsHm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

export function formatTimeForDisplay(value: string): string {
  const totalMinutes = timeStrToMinutes(value)
  if (totalMinutes === null) return '—'
  const hours24 = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`
}

export function getCurrentTimeStr(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export function getTodayDateStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function getIsoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  const day = d.getDay() === 0 ? 7 : d.getDay()
  const thursday = new Date(d); thursday.setDate(d.getDate() + (4 - day))
  const yearStart = new Date(thursday.getFullYear(), 0, 1)
  const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export function getWeekRangeLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  const day = d.getDay() === 0 ? 7 : d.getDay()
  const mon = new Date(d); mon.setDate(d.getDate() - (day - 1))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const fmt = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(mon)} – ${fmt(sun)}`
}

// ── Clock display helpers ───────────────────────────────────────────────────

export function formatLiveClockParts(now: Date): { time: string; period: 'AM' | 'PM' } {
  const hours24 = now.getHours()
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return { time: `${hours12}:${minutes}:${seconds}`, period: hours24 >= 12 ? 'PM' : 'AM' }
}

export function formatLiveDateShort(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
