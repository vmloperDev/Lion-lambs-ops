import { useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  type AuthError,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  FileText,
  FolderKanban,
  ListChecks,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Plane,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { auth, db } from './firebase'
import agencySeal from './assets/brand/agency-seal.png'
import logo from './assets/brand/logo.png'
import travelHero from './assets/brand/travel-hero.jpg'
import travelBanner from './assets/brand/travel-banner.png'
import './App.css'

type Screen =
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
type PasswordStrength = {
  label: 'Weak' | 'Fair' | 'Strong'
  score: 1 | 2 | 3
}
type BookingStatus = 'Inquiry' | 'Breakdown' | 'Quotation' | 'Purchase Order' | 'Invoice' | 'Confirmed'
type BookingListFilter = BookingStatus | 'All'
type BookingFormData = {
  clientName: string
  contactNumber: string
  clientEmail: string
  packageName: string
  destination: string
  travelStart: string
  travelEnd: string
  pax: string
  quotationNo: string
  lineItems: string
  itemDescription: string
  quantity: string
  unitPrice: string
  supplier: string
  supplierContact: string
  nettCost: string
  sellingPrice: string
  paymentMethod: string
  paymentRecords: string
  invoiceAmountPaid: string
  invoicePaymentDate: string
  invoicePaymentStatus: string
  invoiceReference: string
  optionDate: string
  flightDetails: string
  accommodation: string
  hotelAddress: string
  emergencyContact: string
  inclusions: string
  exclusions: string
  itinerary: string
  specialInstructions: string
  preparedBy: string
  status: BookingStatus
  notes: string
}
type BookingRecord = BookingFormData & {
  id: string
  createdAt: string
}
type BookingLineItem = {
  description: string
  quantity: number
  unitPrice: number
  nettCost: number
  total: number
  nettTotal: number
  profit: number
  currency: string
}
type EditableLineItem = {
  description: string
  quantity: string
  unitPrice: string
  nettCost: string
  currency: string
}

const bookingStorageKey = 'lion-lamb-bookings'
const bookingsCollectionKey = 'bookings'
const lineItemDescriptionOptions = [
  'Philippine Travel Tour',
  'Add-on Luggage - One Way',
  'Add-on Luggage - Road Trip',
  'Tipping',
  'Visa',
]
const currencyOptions = ['PHP', 'USD']
const bookingListFilters: Array<{ label: string; value: BookingListFilter }> = [
  { label: 'All', value: 'All' },
  { label: 'Inquiries', value: 'Inquiry' },
  { label: 'Breakdown', value: 'Breakdown' },
  { label: 'Quotations', value: 'Quotation' },
  { label: 'P.O.', value: 'Purchase Order' },
  { label: 'Invoices', value: 'Invoice' },
  { label: 'Confirmed', value: 'Confirmed' },
]
const emptyBookingForm: BookingFormData = {
  clientName: '',
  contactNumber: '',
  clientEmail: '',
  packageName: '',
  destination: '',
  travelStart: '',
  travelEnd: '',
  pax: '',
  quotationNo: '',
  lineItems: '',
  itemDescription: '',
  quantity: '1',
  unitPrice: '',
  supplier: '',
  supplierContact: '',
  nettCost: '',
  sellingPrice: '',
  paymentMethod: '',
  paymentRecords: '',
  invoiceAmountPaid: '',
  invoicePaymentDate: '',
  invoicePaymentStatus: 'Unpaid',
  invoiceReference: '',
  optionDate: '',
  flightDetails: '',
  accommodation: '',
  hotelAddress: '',
  emergencyContact: '',
  inclusions: '',
  exclusions: '',
  itinerary: '',
  specialInstructions: '',
  preparedBy: '',
  status: 'Inquiry',
  notes: '',
}

const previousProjects = [
  {
    id: 'QT-2026-0001',
    title: 'Boracay Summer Package',
    client: 'Juan Dela Cruz',
    status: 'Quotation',
    date: 'June 10, 2026',
    amount: '₱18,000',
  },
  {
    id: 'INV-2026-0002',
    title: 'Baguio Family Tour',
    client: 'Maria Santos',
    status: 'Invoice',
    date: 'June 9, 2026',
    amount: '₱26,500',
  },
  {
    id: 'QT-2026-0003',
    title: 'Japan Visa Assistance',
    client: 'Ramon Cruz',
    status: 'Draft',
    date: 'June 8, 2026',
    amount: '₱7,500',
  },
]

const sampleBookings: BookingRecord[] = previousProjects.map((project) => ({
  id: project.id,
  createdAt: project.date,
  clientName: project.client,
  contactNumber: '',
  clientEmail: '',
  packageName: project.title,
  destination: '',
  travelStart: '',
  travelEnd: '',
  pax: '',
  quotationNo: project.id,
  lineItems: '',
  itemDescription: project.title,
  quantity: '1',
  unitPrice: '',
  supplier: '',
  supplierContact: '',
  nettCost: '',
  sellingPrice: project.amount,
  paymentMethod: '',
  paymentRecords: '',
  invoiceAmountPaid: '',
  invoicePaymentDate: '',
  invoicePaymentStatus: 'Unpaid',
  invoiceReference: '',
  optionDate: '',
  flightDetails: '',
  accommodation: '',
  hotelAddress: '',
  emergencyContact: '',
  inclusions: '',
  exclusions: '',
  itinerary: '',
  specialInstructions: '',
  preparedBy: '',
  status: project.status === 'Draft' ? 'Inquiry' : (project.status as BookingStatus),
  notes: '',
}))

function getDisplayName(emailAddress: string) {
  const username = emailAddress.split('@')[0] || 'Team Member'

  return username
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getPasswordStrength(passwordValue: string): PasswordStrength {
  let score = 0

  if (passwordValue.length >= 8) score += 1
  if (/[A-Z]/.test(passwordValue) && /[a-z]/.test(passwordValue)) score += 1
  if (/\d/.test(passwordValue) || /[^A-Za-z0-9]/.test(passwordValue)) score += 1

  if (score >= 3) return { label: 'Strong', score: 3 }
  if (score === 2) return { label: 'Fair', score: 2 }

  return { label: 'Weak', score: 1 }
}

function getStoredBookings(storageKey = bookingStorageKey, useSamples = true) {
  const storedBookings = window.localStorage.getItem(storageKey)

  if (!storedBookings) {
    return useSamples ? sampleBookings : []
  }

  try {
    return (JSON.parse(storedBookings) as BookingRecord[]).map(normalizeBooking)
  } catch {
    return sampleBookings
  }
}

function normalizeBooking(booking: BookingRecord): BookingRecord {
  return {
    ...emptyBookingForm,
    ...booking,
    status: booking.status || 'Inquiry',
    id: booking.id,
    createdAt: booking.createdAt || new Date().toISOString(),
  }
}

function formatAmount(value?: string, currency?: string) {
  const amount = parseAmount(value)
  const code = currency || 'PHP'

  if (!Number.isFinite(amount) || amount <= 0) {
    return `${code} 0.00`
  }

  return `${code} ${amount.toLocaleString(code === 'USD' ? 'en-US' : 'en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function parseAmount(value?: string) {
  return Number((value ?? '').replace(/[^\d.]/g, '')) || 0
}

function parseQuantity(value?: string) {
  const quantity = Number((value ?? '').replace(/[^\d.]/g, ''))

  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
}

function serializeLineItems(items: EditableLineItem[]) {
  return items
    .filter((item) =>
      [item.description, item.quantity, item.unitPrice, item.nettCost].some((value) =>
        value.trim(),
      ),
    )
    .map((item) =>
      [
        item.description.trim(),
        item.quantity.trim() || '1',
        item.unitPrice.trim() || '0',
        item.nettCost.trim() || '0',
        item.currency.trim() || 'PHP',
      ].join(' | '),
    )
    .join('\n')
}

function getEditableLineItems(booking: BookingFormData): EditableLineItem[] {
  const rows = getLines(booking.lineItems, [])
    .filter((line) => line.includes('|'))
    .map((line) => {
      const [description, quantity, unitPrice, nettCost, currency] = line
        .split('|')
        .map((part) => part.trim())

      return {
        description,
        quantity: quantity || '1',
        unitPrice: unitPrice || '',
        nettCost: nettCost || '',
        currency: currency || 'PHP',
      }
    })

  if (rows.length > 0) {
    return rows
  }

  return [
    {
      description: booking.itemDescription || booking.packageName,
      quantity: booking.quantity || '1',
      unitPrice: booking.unitPrice || booking.sellingPrice,
      nettCost: booking.nettCost,
      currency: 'PHP',
    },
  ]
}

function getBookingLineItems(booking: BookingFormData): BookingLineItem[] {
  const parsedItems = getLines(booking.lineItems, [])
    .filter((line) => line.includes('|'))
    .map((line) => {
    const [description, quantity, unitPrice, nettCost, currency] = line
      .split('|')
      .map((part) => part.trim())
    const parsedQuantity = parseQuantity(quantity)
    const parsedUnitPrice = parseAmount(unitPrice)
    const parsedNettCost = parseAmount(nettCost)

    return {
      description: description || booking.itemDescription || booking.packageName,
      quantity: parsedQuantity,
      unitPrice: parsedUnitPrice,
      nettCost: parsedNettCost,
      total: parsedQuantity * parsedUnitPrice,
      nettTotal: parsedQuantity * parsedNettCost,
      profit: parsedQuantity * (parsedUnitPrice - parsedNettCost),
      currency: currency || 'PHP',
    }
  })

  if (parsedItems.length > 0) {
    return parsedItems
  }

  const quantity = parseQuantity(booking.quantity)
  const unitPrice = parseAmount(booking.unitPrice || booking.sellingPrice)
  const nettCost = parseAmount(booking.nettCost)

  return [
    {
      description: booking.itemDescription || booking.packageName,
      quantity,
      unitPrice,
      nettCost,
      total: quantity * unitPrice,
      nettTotal: quantity * nettCost,
      profit: quantity * (unitPrice - nettCost),
      currency: 'PHP',
    },
  ]
}

function sumLineItems(items: BookingLineItem[], field: 'total' | 'nettTotal' | 'profit') {
  return items.reduce((sum, item) => sum + item[field], 0)
}

function getLineItemCurrencies(items: BookingLineItem[]) {
  const currencies = Array.from(new Set(items.map((item) => item.currency || 'PHP')))

  return currencies.length > 0 ? currencies : ['PHP']
}

function getPrimaryLineItemCurrency(items: BookingLineItem[]) {
  return items[0]?.currency || 'PHP'
}

function getBookingClientTotal(booking: BookingFormData) {
  return sumLineItems(getBookingLineItems(booking), 'total')
}

function getUserBookingsCollectionPath(userId: string) {
  return `users/${userId}/${bookingsCollectionKey}`
}

function formatProjectDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value || 'No date'
  }

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function getLines(value: string | undefined, fallback: string[]) {
  const lines = (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.length > 0 ? lines : fallback
}

function App() {
  const [screen, setScreen] = useState<Screen>('splash')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('vmloper.dev@gmail.com')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [dataMessage, setDataMessage] = useState('')
  const [isPdfExporting, setIsPdfExporting] = useState(false)
  const [bookings, setBookings] = useState<BookingRecord[]>(getStoredBookings)
  const [bookingForm, setBookingForm] = useState<BookingFormData>(emptyBookingForm)
  const [invoiceForm, setInvoiceForm] = useState({
    paymentMethod: '',
    paymentRecords: '',
    invoiceAmountPaid: '',
    invoicePaymentDate: '',
    invoicePaymentStatus: 'Unpaid',
    invoiceReference: '',
  })
  const [activeBookingFilter, setActiveBookingFilter] =
    useState<BookingListFilter>('All')
  const [selectedBookingId, setSelectedBookingId] = useState('')
  const [editingBookingId, setEditingBookingId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const passwordStrength = getPasswordStrength(password)

  useEffect(() => {
    return onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      setAuthUser(user)
      if (user?.emailVerified) {
        setBookings(getStoredBookings(`${bookingStorageKey}-${user.uid}`, false))
      }
      setIsAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    const userStorageKey = authUser?.uid
      ? `${bookingStorageKey}-${authUser.uid}`
      : bookingStorageKey

    window.localStorage.setItem(userStorageKey, JSON.stringify(bookings))
  }, [authUser?.uid, bookings])

  useEffect(() => {
    if (!authUser?.emailVerified) {
      return undefined
    }

    const bookingsQuery = query(
      collection(db, getUserBookingsCollectionPath(authUser.uid)),
      orderBy('createdAt', 'desc'),
    )

    return onSnapshot(
      bookingsQuery,
      (snapshot) => {
        const firestoreBookings = snapshot.docs.map((bookingDoc) =>
          normalizeBooking({
            ...(bookingDoc.data() as BookingRecord),
            id: bookingDoc.id,
          }),
        )

        setBookings(firestoreBookings)
        setDataError('')
      },
      () => {
        setDataError(
          'Could not load cloud bookings. Check Firestore setup and rules.',
        )
      },
    )
  }, [authUser])

  useEffect(() => {
    if (isAuthLoading) {
      return
    }

    const timer = window.setTimeout(() => {
      if (!authUser) {
        setScreen('login')
        return
      }

      setScreen(authUser.emailVerified ? 'home' : 'verify-email')
    }, 2600)

    return () => window.clearTimeout(timer)
  }, [authUser, isAuthLoading])

  function getAuthErrorMessage(error: unknown) {
    const code =
      typeof error === 'object' && error && '