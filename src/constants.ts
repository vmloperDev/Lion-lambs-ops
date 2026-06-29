import type { BookingFormData, BookingListFilter, BookingRecord } from './types'

export const bookingStorageKey = 'lion-lamb-bookings'
export const bookingsCollectionKey = 'bookings'
export const dtrCollectionKey = 'dtr_entries'

export const bookingListFilters: Array<{ label: string; value: BookingListFilter }> = [
  { label: 'All', value: 'All' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Confirmed', value: 'Confirmed' },
]

export const emptyBookingForm: BookingFormData = {
  clientName: '',
  contactNumber: '',
  clientEmail: '',
  clientFacebook: '',
  currency: 'PHP',
  packageName: '',
  destination: '',
  travelStart: '',
  travelEnd: '',
  pax: '',
  quotationNo: '',
  lineItems: '',
  invoiceLineItemsJson: '',
  breakdownLineItemsJson: '',
  breakdownPaxTiers: '',
  breakdownColLabels: '',
  itemDescription: '',
  quantity: '1',
  unitPrice: '',
  supplier: '',
  supplierContact: '',
  supplierPaymentMethod: '',
  nettCost: '',
  sellingPrice: '',
  paymentMethod: '',
  paymentRecords: '',
  invoiceAmountPaid: '',
  invoicePaymentDate: '',
  invoicePaymentStatus: 'Unpaid',
  invoiceFullyPaidDate: '',
  invoiceReference: '',
  optionDate: '',
  flightDetails: '',
  accommodation: '',
  hotelAddress: '',
  emergencyContact: '',
  inclusions: '',
  exclusions: '',
  itinerary: '',
  voucherRowsJson: '',
  specialInstructions: '',
  preparedBy: '',
  createdByName: '',
  status: 'Pending',
  notes: '',
}

const previousProjects = [
  { id: 'QT-2026-0001', title: 'Boracay Summer Package', client: 'Juan Dela Cruz', status: 'Pending', date: 'June 10, 2026', amount: '18000' },
  { id: 'INV-2026-0002', title: 'Baguio Family Tour', client: 'Maria Santos', status: 'Confirmed', date: 'June 9, 2026', amount: '26500' },
  { id: 'QT-2026-0003', title: 'Japan Visa Assistance', client: 'Ramon Cruz', status: 'Pending', date: 'June 8, 2026', amount: '7500' },
]

export const sampleBookings: BookingRecord[] = previousProjects.map((project) => ({
  ...emptyBookingForm,
  id: project.id,
  createdAt: project.date,
  clientName: project.client,
  packageName: project.title,
  quotationNo: project.id,
  itemDescription: project.title,
  quantity: '1',
  unitPrice: project.amount,
  sellingPrice: project.amount,
  status: project.status as BookingFormData['status'],
}))
