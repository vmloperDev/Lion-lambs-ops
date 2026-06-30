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

export type BookingStatus = 'Pending' | 'Confirmed' | 'Flown'
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
  quantity: string
  paxBreakdown?: string
  unitPrice: string
  nettCost: string
  sendToInvoice: boolean
  sendToPO?: boolean
  isPackageRow?: boolean
  price2Pax?: string
  price5Pax?: string
  priceGroup?: string
  priceInfant?: string
  mirrorId?: string
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
  packageName: string
  destination: string
  travelStart: string
  travelEnd: string
  pax: string
  quotationNo: string
  lineItems: string
  invoiceLineItemsJson: string
  invoicePackage: string   // JSON: {name, qty, price}
  quotationPaxRates: string // JSON: [{count,rate}] for [Adult, Child, Senior, Infant]
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
}

export type BookingLineItem = {
  description: string
  quantity: number
  unitPrice: number
  nettCost: number
  total: number
  nettTotal: number
  profit: number
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
