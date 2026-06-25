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
  return {
    ...emptyBookingForm,
    ...booking,
    status: booking.status || 'Inquiry',
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

// ── Line item helpers ───────────────────────────────────────────────────────

export function createLineItemId() {
  return `LI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

export function readBreakdownItems(booking: BookingFormData): BreakdownLineItem[] {
  try {
    if (booking.breakdownLineItemsJson) return JSON.parse(booking.breakdownLineItemsJson)
  } catch {}
  return [{ description: 'Group Package', quantity: '1', unitPrice: booking.unitPrice || booking.sellingPrice, nettCost: booking.nettCost, sendToInvoice: false, sendToPO: false, isPackageRow: true }]
}

export function mapInvoiceItemsToBookingLines(items: InvoiceLineItem[], packageName = 'Basic Package'): BookingLineItem[] {
  return items.map((it) => {
    const q = parseQuantity(it.quantity), u = parseAmount(it.unitPrice), n = it.isPackageRow ? 0 : parseAmount(it.nettCost)
    return { description: it.description || (it.isPackageRow ? packageName || 'Basic Package' : 'Item'), quantity: q, unitPrice: u, nettCost: n, total: q * u, nettTotal: q * n, profit: q * (u - n) }
  })
}

export function mapBreakdownItemsToBookingLines(items: BreakdownLineItem[], packageName = 'Basic Package'): BookingLineItem[] {
  return items.map((it) => {
    const q = parseQuantity(it.quantity), u = parseAmount(it.unitPrice), n = it.isPackageRow ? 0 : parseAmount(it.nettCost)
    return { description: it.description || (it.isPackageRow ? packageName || 'Basic Package' : 'Item'), quantity: q, unitPrice: u, nettCost: n, total: q * u, nettTotal: q * n, profit: q * (u - n) }
  })
}

export function getBookingLineItems(booking: BookingFormData): BookingLineItem[] {
  const invoiceItems = readInvoiceItems(booking)
  if (invoiceItems.length > 0) return mapInvoiceItemsToBookingLines(invoiceItems, booking.packageName)
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
