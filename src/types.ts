import type { User as FirebaseUser } from 'firebase/auth'

export type Screen =
  | 'splash'
  | 'login'
  | 'signup'
  | 'verify-email'
  | 'home'
  | 'data-form'
  | 'booking-detail'
  | 'document-folder'
  | 'invoice-editor'
  | 'quotation-preview'
  | 'invoice-preview'
  | 'purchase-order-preview'
  | 'voucher-preview'
  | 'breakdown-preview'
  | 'dtr'

export type PasswordStrength = {
  label: 'Weak' | 'Fair' | 'Strong'
  score: 1 | 2 | 3
}

export type BookingStatus = 'Quotation' | 'Invoice' | 'Confirmed' | 'Flown'
export type BookingListFilter = BookingStatus | 'All'

export type PaxBreakdown = { adult: string; senior: string; child: string; infant: string }

export type InvoiceLineItem = {
  id?: string
  description: string
  quantity: string
  unitPrice: string
  nettCost: string
  isPackageRow?: boolean
  source?: 'manual' | 'breakdown'
  sourceKey?: string
  mirrorId?: string
}

export type BreakdownLineItem = {
  id?: string
  description: string
  details?: string
  vendor?: string
  contactNumber?: string
  paymentMethod?: string
  agent?: string
  quantity: string
  paxBreakdown?: string
  unitPrice: string
  nettCost: string
  sendToInvoice: boolean
  sendToPO?: boolean
  sendToQuotation?: boolean
  isPackageRow?: boolean
  // 'inclusion' = internal cost shown only on the Breakdown document (never
  // Quotation/Invoice) — its cost is meant to already be folded into the
  // Package's flat per-pax rate. 'addon' = client-facing extra shown on
  // BOTH the Quotation and Invoice, but never printed on the Breakdown.
  // No manual override exists — a row with no itemType saved (e.g. very
  // old data) is treated as 'inclusion' by default.
  itemType?: 'inclusion' | 'addon'
  price2Pax?: string
  price5Pax?: string
  priceGroup?: string
  priceInfant?: string
  mirrorId?: string
  // JSON string array of PaxBreakdown category keys ('adult'|'child'|
  // 'senior'|'infant') that this row opts OUT of — everything not listed
  // here inherits the booking's single shared groupPax headcount. e.g. a
  // service that doesn't apply to the child in the group would carry
  // '["child"]' here.
  excludedPax?: string
  // Add-on rows only: JSON object mapping a PaxBreakdown category key to a
  // reduced headcount for just this row, e.g. '{"adult":"1"}' when the
  // group has 5 adults but only 1 is taking this add-on. Only meaningful
  // when itemType is 'addon' — Inclusion rows ignore this and always use
  // the full shared count (minus excludedPax). A category's override is
  // always clamped between 0 and the shared group count for that
  // category, and is cleared (falls back to the full shared count) once
  // it's raised back up to the group total, so it never grows stale if
  // the group total above is later reduced.
  paxOverride?: string
  // JSON string array of BreakdownAlternative — other priced options for
  // this same service (e.g. a second, cheaper airline quote) that are kept
  // on file but NOT currently active. Only the row's own fields above
  // (vendor/price2Pax/etc.) are ever read by calculations or documents —
  // switching the active option copies an alternative's values onto those
  // fields (and archives the previous ones back into this list) rather
  // than changing how totals/documents are computed.
  alternatives?: string
}

// A single alternative priced option kept on a Breakdown row (see
// `BreakdownLineItem.alternatives`). Mirrors the subset of a row's own
// fields that differ between suppliers/options.
export type BreakdownAlternative = {
  id: string
  label?: string
  vendor?: string
  contactNumber?: string
  paymentMethod?: string
  agent?: string
  details?: string
  price2Pax?: string
  price5Pax?: string
  priceGroup?: string
  priceInfant?: string
}

export type POLineItem = {
  id: string
  vendor: string
  contactNo: string
  paymentMethod: string
  agent: string
  serviceItem: string
  description: string
  adultPax: string
  childPax: string
  seniorPax: string
  infantPax: string
  supplierNett: string
  showInDocument?: boolean
}

export type BookingFormData = {
  clientName: string
  contactNumber: string
  clientEmail: string
  // The travel agent tied to this booking as a whole (distinct from a
  // Pax-Tier Pricing row's "Supplier Agent", which is a supplier/vendor
  // contact). This is who a "TA Comm" line item's commission is owed to,
  // and is what syncs to the Google Sheet's Agent column alongside the
  // TA Comm amount.
  agentName: string
  currency: string
  acr: string  // Airline Conversion Rate: PHP value of 1 unit of `currency`, used to convert foreign-currency invoice/quotation totals to PHP
  packageName: string
  destination: string
  travelStart: string
  travelEnd: string
  pax: string
  // Single group headcount (JSON PaxBreakdown) for the whole booking — set
  // once here, then every Pax-Tier Pricing row (Inclusion/Add-on) inherits
  // it automatically instead of having its own separately-typed counts. A
  // row can opt out of a category via its own `excludedPax` list (see
  // BreakdownLineItem) if that particular service doesn't apply to
  // everyone in the group.
  groupPax: string
  quotationNo: string
  lineItems: string
  invoiceLineItemsJson: string
  invoicePackage: string   // JSON: {name, qty, price}
  quotationPaxRates: string // JSON: [{count,rate}] for [Adult, Child, Senior, Infant]
  quotationPaxAddons: string // JSON: [{id,paxType,name,price}] — optional addons tied to a pax type; merged by name onto Invoice/PO/Breakdown
  invoiceAddons: string    // JSON: [{name, qty, price, nett}]
  breakdownLineItemsJson: string
  breakdownPaxTiers: string
  breakdownColLabels: string
  // Flat internal profit line entered once at the top of Pax-Tier Pricing —
  // JSON PaxBreakdown of a per-category (Adult/Child/Senior/Infant) rate,
  // same shape as groupPax. Folded into the Breakdown's cost subtotal
  // exactly like a normal Inclusion (see getBreakdownTotal — rate ×
  // that category's shared headcount), then backed back out of the NETT
  // figure synced to Google Sheets (see getBookingReportingNettTotal)
  // since it isn't a real supplier expense.
  lltpRates: string
  itemDescription: string
  quantity: string
  unitPrice: string
  supplier: string
  supplierContact: string
  supplierPaymentMethod: string
  nettCost: string
  sellingPrice: string
  paymentMethod: string
  paymentRecords: string
  invoiceAmountPaid: string
  invoicePaymentDate: string
  invoicePaymentStatus: string
  invoiceFullyPaidDate: string
  invoiceReference: string
  optionDate: string
  flightDetails: string
  accommodation: string
  hotelName: string
  hotelAddress: string
  emergencyContact: string
  inclusions: string
  exclusions: string
  itinerary: string
  voucherRowsJson: string
  specialInstructions: string
  preparedBy: string
  createdByName: string
  status: BookingStatus
  notes: string
  poLineItemsJson: string  // JSON: POLineItem[]
}

export type BookingRecord = BookingFormData & {
  id: string
  createdAt: string
  ownerId?: string
  // True when this project was created via "Duplicate project" from an
  // existing one, rather than a fresh "New Inquiry" — shown as a
  // DUPLICATED tag on the dashboard so it's clear at a glance.
  isDuplicate?: boolean
}

export type BookingLineItem = {
  description: string
  quantity: number
  unitPrice: number
  nettCost: number
  total: number
  nettTotal: number
  profit: number
  // When true, the printed Quotation/Invoice hides this row's Unit Price
  // and Amount (used for the Package row once addons/other priced items
  // are shown on the same document, so the client isn't charged twice).
  hidePrice?: boolean
  // When true, the printed Quotation/Invoice hides this row's Qty column
  // (used for the Package row, since a single "1" there is meaningless).
  hideQty?: boolean
}

export type DtrEntry = {
  id: string
  employeeName: string
  date: string
  amIn: string
  amOut: string
  pmIn: string
  pmOut: string
  notes: string
  createdAt: string
  updatedAt: string
  loggedBy: string
}

export type { FirebaseUser }
