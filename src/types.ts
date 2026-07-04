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
  sendToBreakdown?: boolean
  isPackageRow?: boolean
  // 'inclusion' = internal cost shown only on the Breakdown document (never
  // Quotation/Invoice) — its cost is meant to already be folded into the
  // Package's flat per-pax rate. 'addon' = client-facing extra shown on
  // BOTH the Quotation and Invoice, but never printed on the Breakdown.
  // Rows created before this distinction existed have no itemType, and are
  // treated the same as 'inclusion' (their old behavior — always shown on
  // Breakdown, manual Quotation/Invoice toggles) so nothing already saved
  // changes appearance.
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
