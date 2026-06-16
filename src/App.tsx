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
  Sparkles,
  UserRound,
  X,
  Check,
  EyeOff,
  Eye
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

// New modular types for separate sections
type InvoiceLineItem = {
  id?: string
  description: string // drop-down options or Package Name
  quantity: string
  unitPrice: string
  nettCost: string
  isPackageRow?: boolean
  source?: 'manual' | 'breakdown'
  sourceKey?: string
}

type BreakdownLineItem = {
  id?: string
  description: string // drop-down choices
  details?: string    // free-text details column
  quantity: string
  unitPrice: string
  nettCost: string
  sendToInvoice: boolean
  isPackageRow?: boolean
  // Pax-tier columns for the quotation breakdown template
  price2Pax?: string
  price5Pax?: string
  priceGroup?: string
  priceInfant?: string
}

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
  
  // Legacy backups kept structural, but serializing our new lists here
  lineItems: string 
  invoiceLineItemsJson: string
  breakdownLineItemsJson: string
  breakdownPaxTiers: string // JSON: [col1Pax, col2Pax, col3Pax, col4Pax]
  breakdownColLabels: string // JSON: [col1Label, col2Label, col3Label, col4Label]

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
}

const bookingStorageKey = 'lion-lamb-bookings'
const bookingsCollectionKey = 'bookings'

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
  invoiceLineItemsJson: '',
  breakdownLineItemsJson: '',
  breakdownPaxTiers: '',
  breakdownColLabels: '',
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
    amount: '18000',
  },
  {
    id: 'INV-2026-0002',
    title: 'Baguio Family Tour',
    client: 'Maria Santos',
    status: 'Invoice',
    date: 'June 9, 2026',
    amount: '26500',
  },
  {
    id: 'QT-2026-0003',
    title: 'Japan Visa Assistance',
    client: 'Ramon Cruz',
    status: 'Draft',
    date: 'June 8, 2026',
    amount: '7500',
  },
]

const sampleBookings: BookingRecord[] = previousProjects.map((project) => ({
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
  status: project.status === 'Draft' ? 'Inquiry' : (project.status as BookingStatus),
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

function formatAmount(value?: string) {
  const amount = parseAmount(value)
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'PHP 0.00'
  }
  return `PHP ${amount.toLocaleString('en-PH', {
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

function createLineItemId() {
  return `LI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getLines(value: string | undefined, fallback: string[]) {
  const lines = (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.length > 0 ? lines : fallback
}

const ALL_INVOICE_OPTIONS = [
  'Add-on Luggage - One Way',
  'Add-on Luggage - Round Trip',
  'Fuel Surcharge',
  'Travel Insurance',
  'Airport Transport (Manila/Clark)',
  'Tipping',
  'Visa',
  'Other'
]

function computeInclusionsExclusions(invoiceLineItemsJson: string): { inclusions: string; exclusions: string } {
  let items: InvoiceLineItem[] = []
  try {
    if (invoiceLineItemsJson) items = JSON.parse(invoiceLineItemsJson)
  } catch {}

  // Inclusions: non-package, non-"Other" items that were added
  const addedDescriptions = items
    .filter((item) => !item.isPackageRow && item.description !== 'Other')
    .map((item) => item.description)

  // Exclusions: options from the full list that were NOT added (and not "Other")
  const addedSet = new Set(addedDescriptions)
  const excludedDescriptions = ALL_INVOICE_OPTIONS
    .filter((opt) => opt !== 'Other' && !addedSet.has(opt))

  return {
    inclusions: addedDescriptions.join('\n'),
    exclusions: excludedDescriptions.join('\n'),
  }
}

function readInvoiceItems(booking: BookingFormData): InvoiceLineItem[] {
  try {
    if (booking.invoiceLineItemsJson) {
      return JSON.parse(booking.invoiceLineItemsJson)
    }
  } catch {}
  return [
    {
      description: booking.packageName || 'Basic Package',
      quantity: booking.quantity || '1',
      unitPrice: booking.unitPrice || booking.sellingPrice,
      nettCost: '0',
      isPackageRow: true,
    },
  ]
}

function readBreakdownItems(booking: BookingFormData): BreakdownLineItem[] {
  try {
    if (booking.breakdownLineItemsJson) {
      return JSON.parse(booking.breakdownLineItemsJson)
    }
  } catch {}
  return [
    {
      description: 'Group Package',
      quantity: '1',
      unitPrice: booking.unitPrice || booking.sellingPrice,
      nettCost: booking.nettCost,
      sendToInvoice: false,
      isPackageRow: true,
    },
  ]
}

function mapInvoiceItemsToBookingLines(items: InvoiceLineItem[], packageName = 'Basic Package'): BookingLineItem[] {
  return items.map((it) => {
    const q = parseQuantity(it.quantity)
    const u = parseAmount(it.unitPrice)
    const n = it.isPackageRow ? 0 : parseAmount(it.nettCost)
    return {
      description: it.isPackageRow ? packageName || 'Basic Package' : it.description,
      quantity: q,
      unitPrice: u,
      nettCost: n,
      total: q * u,
      nettTotal: q * n,
      profit: q * (u - n),
    }
  })
}

function mapBreakdownItemsToBookingLines(items: BreakdownLineItem[]): BookingLineItem[] {
  return items.map((it) => {
    const q = parseQuantity(it.quantity)
    const u = parseAmount(it.unitPrice)
    const n = parseAmount(it.nettCost)
    return {
      description: it.description,
      quantity: q,
      unitPrice: u,
      nettCost: n,
      total: q * u,
      nettTotal: q * n,
      profit: q * (u - n),
    }
  })
}

function getBookingLineItems(booking: BookingFormData): BookingLineItem[] {
  const invoiceItems = readInvoiceItems(booking)
  if (invoiceItems.length > 0) {
    return mapInvoiceItemsToBookingLines(invoiceItems, booking.packageName)
  }

  const quantity = parseQuantity(booking.quantity)
  const unitPrice = parseAmount(booking.unitPrice || booking.sellingPrice)

  return [
    {
      description: booking.packageName || 'Basic Package',
      quantity,
      unitPrice,
      nettCost: 0,
      total: quantity * unitPrice,
      nettTotal: 0,
      profit: quantity * unitPrice,
    },
  ]
}

function sumLineItems(items: BookingLineItem[], field: 'total' | 'nettTotal' | 'profit') {
  return items.reduce((sum, item) => sum + item[field], 0)
}

function getBookingClientTotal(booking: BookingFormData) {
  return sumLineItems(getBookingLineItems(booking), 'total')
}

function getBookingBreakdownNettTotal(booking: BookingFormData) {
  return sumLineItems(mapBreakdownItemsToBookingLines(readBreakdownItems(booking)), 'nettTotal')
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
  const [activeBookingFilter, setActiveBookingFilter] = useState<BookingListFilter>('All')
  const [selectedBookingId, setSelectedBookingId] = useState('')
  const [editingBookingId, setEditingBookingId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const passwordStrength = getPasswordStrength(password)

  // Options lists
  const invoiceOptions = [
    'Add-on Luggage - One Way',
    'Add-on Luggage - Round Trip',
    'Fuel Surcharge',
    'Travel Insurance',
    'Airport Transport (Manila/Clark)',
    'Tipping',
    'Visa',
    'Other'
  ]

  const breakdownOptions = [
    'Group Package',
    'Airfare',
    'Land Arrangement',
    'Hotel',
    'Airport Transfer (Outbound)',
    'Airport Transfer (Manila/Clark)',
    'Optional Tours',
    'Ph Tax',
    'Add-on Luggage - One Way',
    'Add-on Luggage - Round Trip',
    'Fuel Surcharge',
    'Travel Insurance',
    'Tipping',
    'Visa',
    'Travel Kit',
    'LLTP',
    'TA Comm',
    'Other'
  ]

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
        setDataError('Could not load cloud bookings. Check Firestore setup and rules.')
      },
    )
  }, [authUser])

  useEffect(() => {
    if (isAuthLoading) return
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
    const code = typeof error === 'object' && error && 'code' in error ? (error as AuthError).code : ''
    if (code) {
      switch (code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
          return 'Email or password is incorrect.'
        case 'auth/user-not-found':
          return 'User does not exist.'
        case 'auth/email-already-in-use':
          return 'That email already has an account.'
        case 'auth/too-many-requests':
          return 'Too many attempts. Please wait a moment before trying again.'
        case 'auth/invalid-email':
          return 'Enter a valid email address.'
        case 'auth/missing-email':
          return 'Enter your email address first.'
        case 'auth/operation-not-allowed':
          return 'This sign-in method is not enabled in Firebase Authentication.'
        case 'auth/invalid-api-key':
        case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
          return 'Firebase API key is invalid. Check the values in your .env file.'
        case 'auth/weak-password':
          return 'Use a password with at least 6 characters.'
        default:
          return `Sign-in failed: ${code}`
      }
    }
    return 'Sign-in failed. Please try again.'
  }

  async function handleEmailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const isSignUp = screen === 'signup'
    if (!email.trim()) { setAuthError('Enter your email address to continue.'); return }
    if (!password.trim()) { setAuthError('Enter your password to continue.'); return }
    if (isSignUp && !name.trim()) { setAuthError('Enter your full name to create an account.'); return }
    if (isSignUp && password !== confirmPassword) { setAuthError('Password and confirm password do not match.'); return }
    if (isSignUp && passwordStrength.score === 1) { setAuthError('Use a stronger password before creating the account.'); return }

    try {
      setIsAuthLoading(true)
      if (isSignUp) {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(credential.user, { displayName: name.trim() || getDisplayName(email) })
        await sendEmailVerification(credential.user)
        setAuthUser(credential.user)
        setAuthMessage('Verification email sent. Check your inbox.')
        setScreen('verify-email')
      } else {
        const credential = await signInWithEmailAndPassword(auth, email, password)
        if (!credential.user.emailVerified) {
          setAuthUser(credential.user)
          setAuthError('Verify your email before opening the dashboard.')
          setAuthMessage('')
          setScreen('verify-email')
          return
        }
        setAuthError('')
        setAuthMessage('')
        setScreen('home')
      }
    } catch (error) {
      setAuthError(getAuthErrorMessage(error))
    } finally {
      setIsAuthLoading(false)
    }
  }

  async function handlePasswordReset() {
    if (!email.trim()) { setAuthError('Enter your email address first.'); setAuthMessage(''); return }
    try {
      setIsAuthLoading(true)
      await sendPasswordResetEmail(auth, email)
      setAuthError('')
      setAuthMessage('If an account exists, a reset email will be sent.')
    } catch (error) {
      setAuthError(getAuthErrorMessage(error))
      setAuthMessage('')
    } finally {
      setIsAuthLoading(false)
    }
  }

  async function handleResendVerification() {
    if (!auth.currentUser) {
      setAuthError('Log in again before requesting a new verification email.'); setAuthMessage(''); setScreen('login')
      return
    }
    try {
      setIsAuthLoading(true)
      await sendEmailVerification(auth.currentUser)
      setAuthError('')
      setAuthMessage('Verification email sent again. Check your inbox.')
    } catch (error) {
      setAuthError(getAuthErrorMessage(error))
      setAuthMessage('')
    } finally {
      setIsAuthLoading(false)
    }
  }

  async function handleVerificationRefresh() {
    if (!auth.currentUser) { setScreen('login'); return }
    try {
      setIsAuthLoading(true)
      await auth.currentUser.reload()
      const refreshedUser = auth.currentUser
      setAuthUser(refreshedUser)
      if (refreshedUser?.emailVerified) {
        setAuthError(''); setAuthMessage(''); setScreen('home')
      } else {
        setAuthError('Email is not verified yet.'); setAuthMessage('')
      }
    } finally {
      setIsAuthLoading(false)
    }
  }

  async function handleLogout() {
    await signOut(auth)
    setPassword('')
    setConfirmPassword('')
    setScreen('login')
  }

  function handleNewBooking() {
    setEditingBookingId('')
    const freshForm = {
      ...emptyBookingForm,
      quotationNo: `QT-${new Date().getFullYear()}-${String(bookings.length + 1).padStart(4, '0')}`,
      quantity: '1',
    }
    // Seed initial JSON representations
    const initialInvoice: InvoiceLineItem[] = [
      { id: createLineItemId(), description: '', quantity: '1', unitPrice: '', nettCost: '', isPackageRow: true }
    ]
    const initialBreakdown: BreakdownLineItem[] = [
      { id: createLineItemId(), description: 'Group Package', quantity: '1', unitPrice: '', nettCost: '', sendToInvoice: false, isPackageRow: true }
    ]
    freshForm.invoiceLineItemsJson = JSON.stringify(initialInvoice)
    freshForm.breakdownLineItemsJson = JSON.stringify(initialBreakdown)
    
    setBookingForm(freshForm)
    setScreen('data-form')
  }

  function handleEditBooking() {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)
    if (!selectedBooking) {
      setScreen('home')
      return
    }
    setEditingBookingId(selectedBooking.id)
    const normalized = normalizeBooking(selectedBooking)
    
    // Fallback parsing if JSON objects don't exist yet
    if (!normalized.invoiceLineItemsJson) {
      const fallbackInv: InvoiceLineItem[] = [
        { id: createLineItemId(), description: normalized.packageName, quantity: normalized.quantity || '1', unitPrice: normalized.unitPrice || normalized.sellingPrice, nettCost: '0', isPackageRow: true }
      ]
      normalized.invoiceLineItemsJson = JSON.stringify(fallbackInv)
    }
    if (!normalized.breakdownLineItemsJson) {
      const fallbackBrk: BreakdownLineItem[] = [
        { id: createLineItemId(), description: 'Group Package', quantity: '1', unitPrice: normalized.unitPrice || normalized.sellingPrice, nettCost: normalized.nettCost || '0', sendToInvoice: false, isPackageRow: true }
      ]
      normalized.breakdownLineItemsJson = JSON.stringify(fallbackBrk)
    }

    setBookingForm(normalized)
    setScreen('data-form')
  }

  function updateBookingField<Field extends keyof BookingFormData>(
    field: Field,
    value: BookingFormData[Field],
  ) {
    setDataError('')
    setDataMessage('')
    setBookingForm((currentForm) => {
      const updated = { ...currentForm, [field]: value }
      
      // Keep package calculations aligned if fields shift globally
      if (field === 'packageName' || field === 'quantity' || field === 'unitPrice') {
        try {
          const invItems: InvoiceLineItem[] = readInvoiceItems(updated)
          const brkItems: BreakdownLineItem[] = readBreakdownItems(updated)
          
          const nextInv = invItems.map(item => item.isPackageRow ? { ...item, description: updated.packageName, quantity: updated.quantity || '1', unitPrice: updated.unitPrice } : item)
          const invoiceTotal = sumLineItems(mapInvoiceItemsToBookingLines(nextInv, updated.packageName), 'total')
          const nextBrk = brkItems.map(item => item.isPackageRow ? { ...item, description: 'Group Package', quantity: '1', unitPrice: String(invoiceTotal) } : item)
          
          updated.invoiceLineItemsJson = JSON.stringify(nextInv)
          updated.breakdownLineItemsJson = JSON.stringify(nextBrk)
        } catch(e){}
      }
      return updated
    })
  }

  // Functional parsing helpers for the dynamic interface tables
  function getInvoiceItemsList(): InvoiceLineItem[] {
    return readInvoiceItems(bookingForm).map((item) => ({
      ...item,
      id: item.id || createLineItemId(),
      description: item.isPackageRow ? bookingForm.packageName : item.description,
    }))
  }

  function getBreakdownItemsList(): BreakdownLineItem[] {
    const invoiceTotal = sumLineItems(mapInvoiceItemsToBookingLines(readInvoiceItems(bookingForm), bookingForm.packageName), 'total')
    return readBreakdownItems(bookingForm).map((item) => ({
      ...item,
      id: item.id || createLineItemId(),
      ...(item.isPackageRow ? { description: 'Group Package', quantity: '1', unitPrice: String(invoiceTotal), sendToInvoice: false } : {}),
    }))
  }

  function saveInvoiceItemsList(items: InvoiceLineItem[]) {
    setBookingForm(prev => {
      const normalizedItems = items.map((item) => ({ ...item, id: item.id || createLineItemId() }))
      const updated = { ...prev, invoiceLineItemsJson: JSON.stringify(normalizedItems) }
      const packageInvRow = normalizedItems.find(i => i.isPackageRow)
      if (packageInvRow) {
        updated.quantity = packageInvRow.quantity
        updated.unitPrice = packageInvRow.unitPrice
      }

      try {
        const invoiceTotal = sumLineItems(mapInvoiceItemsToBookingLines(normalizedItems, updated.packageName), 'total')
        const brkItems = readBreakdownItems(updated)
        const nextBrk = brkItems.map((item) =>
          item.isPackageRow ? { ...item, id: item.id || createLineItemId(), description: 'Group Package', quantity: '1', unitPrice: String(invoiceTotal), sendToInvoice: false } : { ...item, id: item.id || createLineItemId() },
        )
        updated.breakdownLineItemsJson = JSON.stringify(nextBrk)
      } catch(e){}
      return updated
    })
  }

  function saveBreakdownItemsList(items: BreakdownLineItem[]) {
    setBookingForm(prev => {
      const invoiceItems = readInvoiceItems(prev).map((item) => ({ ...item, id: item.id || createLineItemId() }))
      const invoiceTotal = sumLineItems(mapInvoiceItemsToBookingLines(invoiceItems, prev.packageName), 'total')
      const normalizedBreakdown = items.map((item) => ({
        ...item,
        id: item.id || createLineItemId(),
        ...(item.isPackageRow ? { description: 'Group Package', quantity: '1', unitPrice: String(invoiceTotal), sendToInvoice: false } : {}),
      }))
      const manualInvoiceItems = invoiceItems.filter((item) => item.source !== 'breakdown')
      const breakdownInvoiceItems: InvoiceLineItem[] = normalizedBreakdown
        .filter((item) => item.sendToInvoice && !item.isPackageRow)
        .map((item) => ({
          id: `INV-${item.id}`,
          source: 'breakdown',
          sourceKey: item.id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          nettCost: item.nettCost,
        }))

      return {
        ...prev,
        invoiceLineItemsJson: JSON.stringify([...manualInvoiceItems, ...breakdownInvoiceItems]),
        breakdownLineItemsJson: JSON.stringify(normalizedBreakdown),
      }
    })
  }

  function addInvoiceItemRow() {
    const current = getInvoiceItemsList()
    current.push({ id: createLineItemId(), description: invoiceOptions[0], quantity: '1', unitPrice: '', nettCost: '', source: 'manual' })
    saveInvoiceItemsList(current)
  }

  function removeInvoiceItemRow(index: number) {
    const current = getInvoiceItemsList()
    if (current[index]?.isPackageRow) return // lock baseline row protection
    current.splice(index, 1)
    saveInvoiceItemsList(current)
  }

  function changeInvoiceItemField(index: number, field: keyof InvoiceLineItem, value: string) {
    const current = getInvoiceItemsList()
    current[index] = { ...current[index], [field]: value }
    saveInvoiceItemsList(current)
  }

  function addBreakdownItemRow() {
    const current = getBreakdownItemsList()
    current.push({ id: createLineItemId(), description: breakdownOptions[0], quantity: '1', unitPrice: '', nettCost: '', sendToInvoice: false })
    saveBreakdownItemsList(current)
  }

  function removeBreakdownItemRow(index: number) {
    const current = getBreakdownItemsList()
    if (current[index]?.isPackageRow) return
    current.splice(index, 1)
    saveBreakdownItemsList(current)
  }

  function changeBreakdownItemField(index: number, field: keyof BreakdownLineItem, value: any) {
    const current = getBreakdownItemsList()
    current[index] = { ...current[index], [field]: value }
    saveBreakdownItemsList(current)
  }

  function validateBookingForm() {
    if (!bookingForm.clientName.trim()) return 'Enter the client name before saving.'
    if (!bookingForm.packageName.trim()) return 'Enter the package or project name before saving.'
    return ''
  }

  async function handleSaveBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const isEditing = Boolean(editingBookingId)
    const validationError = validateBookingForm()
    if (validationError) {
      setDataError(validationError)
      setDataMessage('')
      return
    }

    // Capture calculated totals inside submission mapping parameters
    const finalInvoiceList = getInvoiceItemsList()
    const baseInvRow = finalInvoiceList.find(i => i.isPackageRow)
    const calculatedUnitPrice = baseInvRow ? parseAmount(baseInvRow.unitPrice) : parseAmount(bookingForm.unitPrice)
    
    const autoIncEx = computeInclusionsExclusions(bookingForm.invoiceLineItemsJson)
    const booking: BookingRecord = {
      ...bookingForm,
      inclusions: autoIncEx.inclusions,
      exclusions: autoIncEx.exclusions,
      unitPrice: String(calculatedUnitPrice),
      sellingPrice: String(getBookingClientTotal(bookingForm)),
      id: editingBookingId || `BK-${Date.now()}`,
      createdAt: bookings.find((currentBooking) => currentBooking.id === editingBookingId)?.createdAt || new Date().toISOString(),
    }

    setBookings((currentBookings) =>
      isEditing
        ? currentBookings.map((currentBooking) => currentBooking.id === booking.id ? booking : currentBooking)
        : [booking, ...currentBookings],
    )

    try {
      if (!authUser) throw new Error('Missing signed-in user')
      await setDoc(doc(db, getUserBookingsCollectionPath(authUser.uid), booking.id), {
        ...booking,
        ownerId: authUser.uid,
        createdBy: authUser.uid,
        createdByEmail: authUser.email || '',
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      
      setDataError('')
      setDataMessage(isEditing ? 'Booking changes saved successfully.' : 'Inquiry saved successfully.')
      setSelectedBookingId(booking.id)
      setEditingBookingId('')
      setScreen(isEditing ? 'booking-detail' : 'home')
    } catch {
      setDataError(isEditing ? 'Booking updated locally, but cloud update failed.' : 'Booking saved locally, but cloud save failed.')
      setDataMessage('')
      setSelectedBookingId(booking.id)
      setEditingBookingId('')
      setScreen(isEditing ? 'booking-detail' : 'home')
    }
  }

  function openBookingDetail(bookingId: string) {
    setSelectedBookingId(bookingId)
    setScreen('booking-detail')
  }

  function updateSelectedBookingStatus(status: BookingStatus) {
    setBookings((currentBookings) =>
      currentBookings.map((booking) => booking.id === selectedBookingId ? { ...booking, status } : booking)
    )

    if (selectedBookingId) {
      if (!authUser) {
        setDataError('Log in again before updating cloud records.')
        return
      }
      void setDoc(doc(db, getUserBookingsCollectionPath(authUser.uid), selectedBookingId), {
        status,
        updatedAt: new Date().toISOString(),
      }, { merge: true }).catch(() => {
        setDataError('Status updated locally, but cloud update failed.')
      })
    }
  }

  function openQuotationPreview() { setScreen('quotation-preview') }
  
  function openInvoiceEditor() {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)
    if (!selectedBooking) {
      setScreen('home')
      return
    }
    setInvoiceForm({
      paymentMethod: selectedBooking.paymentMethod || '',
      paymentRecords: selectedBooking.paymentRecords || '',
      invoiceAmountPaid: selectedBooking.invoiceAmountPaid || '',
      invoicePaymentDate: selectedBooking.invoicePaymentDate || '',
      invoicePaymentStatus: selectedBooking.invoicePaymentStatus || 'Unpaid',
      invoiceReference: selectedBooking.invoiceReference || '',
    })
    setScreen('invoice-editor')
  }

  function updateInvoiceField<Field extends keyof typeof invoiceForm>(
    field: Field,
    value: (typeof invoiceForm)[Field],
  ) {
    setInvoiceForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  async function handleSaveInvoiceUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBookings((currentBookings) =>
      currentBookings.map((booking) =>
        booking.id === selectedBookingId ? { ...booking, ...invoiceForm, status: 'Invoice' } : booking
      )
    )

    try {
      if (!authUser) throw new Error('Missing signed-in user')
      await setDoc(doc(db, getUserBookingsCollectionPath(authUser.uid), selectedBookingId), {
        ...invoiceForm,
        status: 'Invoice',
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      setDataError('')
      setDataMessage('Invoice payment details saved successfully.')
      setScreen('invoice-preview')
    } catch {
      setDataError('Invoice saved locally, but cloud update failed.')
      setDataMessage('')
      setScreen('invoice-preview')
    }
  }

  async function handleDeleteBooking() {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)
    if (!selectedBooking) { setScreen('home'); return }

    const confirmed = window.confirm(`Delete ${selectedBooking.packageName || 'this project'}? This cannot be undone.`)
    if (!confirmed) return

    setBookings((currentBookings) => currentBookings.filter((booking) => booking.id !== selectedBookingId))
    try {
      if (!authUser) throw new Error('Missing signed-in user')
      await deleteDoc(doc(db, getUserBookingsCollectionPath(authUser.uid), selectedBookingId))
      setDataError('')
      setDataMessage('Project deleted successfully.')
    } catch {
      setDataError('Project deleted locally, but cloud delete failed.')
      setDataMessage('')
    }
    setSelectedBookingId('')
    setScreen('home')
  }

  function openPurchaseOrderPreview() { setScreen('purchase-order-preview') }
  function openVoucherPreview() { setScreen('voucher-preview') }
  function openBreakdownPreview() { setScreen('breakdown-preview') }
  function openDocumentFolder() { setScreen('document-folder') }

  function openDocumentByTitle(title: string) {
    if (title === 'Breakdown') { openBreakdownPreview(); return }
    if (title === 'Quotation') { openQuotationPreview(); return }
    if (title === 'Invoice') { openInvoiceEditor(); return }
    if (title === 'Purchase Order') { openPurchaseOrderPreview(); return }
    if (title === 'Service Voucher') { openVoucherPreview() }
  }

  async function handlePrintPreview() {
    const printableArea = document.querySelector<HTMLElement>('.print-document')
    if (!printableArea) { window.print(); return }
    try {
      setIsPdfExporting(true)
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(printableArea, { backgroundColor: '#ffffff', scale: 2, useCORS: true })
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const imgWidth = pageWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      const imageData = canvas.toDataURL('image/png')
      let remainingHeight = imgHeight
      let yPosition = 0

      pdf.addImage(imageData, 'PNG', 0, yPosition, imgWidth, imgHeight)
      remainingHeight -= pageHeight
      while (remainingHeight > 0) {
        yPosition -= pageHeight
        pdf.addPage()
        pdf.addImage(imageData, 'PNG', 0, yPosition, imgWidth, imgHeight)
        remainingHeight -= pageHeight
      }
      const currentBooking = bookings.find((booking) => booking.id === selectedBookingId)
      const fileName = `${currentBooking?.quotationNo || currentBooking?.id || 'lion-lamb-document'}.pdf`
      pdf.save(fileName.replace(/[^\w.-]+/g, '_'))
    } catch {
      setDataError('PDF download failed. Use Ctrl+P and turn off browser headers and footers.')
      window.print()
    } finally {
      setIsPdfExporting(false)
    }
  }

  if (screen === 'splash') {
    return (
      <main className="splash-screen">
        <div className="splash-center">
          <img src={logo} alt="Lion and Lamb Travel logo" />
        </div>
        <h1>Lion and Lamb Travel</h1>
      </main>
    )
  }

  if (screen === 'login' || screen === 'signup') {
    const isSignUp = screen === 'signup'
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-form-panel">
            <div className="auth-brand">
              <img src={logo} alt="Lion and Lamb Travel logo" />
              <div>
                <strong>Lion and Lamb Travel</strong>
                <span>Operations Desk</span>
              </div>
            </div>
            <div className="auth-heading">
              <p>{isSignUp ? 'Create access' : 'Welcome back'}</p>
              <h1>{isSignUp ? 'Sign up for an account' : 'Log in to your account'}</h1>
              <span>
                {isSignUp ? 'Create your operations account for booking management.' : 'Access quotations, invoices, and customer projects.'}
              </span>
            </div>
            <form onSubmit={handleEmailAuth} className="login-form">
              {isSignUp && (
                <label>
                  <UserRound size={17} />
                  <input type="text" value={name} onChange={(event) => { setName(event.target.value); setAuthError(''); setAuthMessage('') }} placeholder="Full name" autoComplete="name" />
                </label>
              )}
              <label>
                <Mail size={17} />
                <input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setAuthError(''); setAuthMessage('') }} placeholder="Email" autoComplete="email" />
              </label>
              {!isSignUp && (
                <div className="password-row-meta">
                  <span>Password</span>
                  <button type="button" onClick={handlePasswordReset} disabled={isAuthLoading}>Forgot password?</button>
                </div>
              )}
              <label>
                <LockKeyhole size={17} />
                <input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setAuthError(''); setAuthMessage('') }} placeholder="Password" autoComplete={isSignUp ? 'new-password' : 'current-password'} />
              </label>
              {isSignUp && (
                <>
                  <label>
                    <LockKeyhole size={17} />
                    <input type="password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setAuthError(''); setAuthMessage('') }} placeholder="Confirm password" autoComplete="new-password" />
                  </label>
                  {password && (
                    <div className={`password-strength score-${passwordStrength.score}`}>
                      <div><span></span><span></span><span></span></div>
                      <strong>{passwordStrength.label}</strong>
                    </div>
                  )}
                </>
              )}
              {authError && <p className="auth-error">{authError}</p>}
              {authMessage && <p className="auth-success">{authMessage}</p>}
              <div className="form-meta">
                <span>{isSignUp ? 'Already part of the team?' : 'Firebase keeps trusted sessions signed in.'}</span>
                <button type="button" onClick={() => { setScreen(isSignUp ? 'login' : 'signup'); setAuthError(''); setAuthMessage('') }}>
                  {isSignUp ? 'Log in instead' : 'Create account'}
                </button>
              </div>
              <button className="login-btn" type="submit" disabled={isAuthLoading}>
                {isAuthLoading ? 'Please wait' : isSignUp ? 'Sign Up' : 'Log In'}
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
          <aside className="auth-image-panel">
            <img src={travelHero} alt="Travel destinations collage" />
            <div className="image-overlay">
              <div className="floating-icon"><Plane size={26} /></div>
              <h2>Organize every client journey.</h2>
              <p>Prepare quotations, invoices, and travel records from one professional workspace.</p>
            </div>
          </aside>
        </section>
      </main>
    )
  }

  if (screen === 'verify-email') {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-form-panel">
            <div className="auth-brand">
              <img src={logo} alt="Lion and Lamb Travel logo" />
              <div><strong>Lion and Lamb Travel</strong><span>Operations Desk</span></div>
            </div>
            <div className="auth-heading">
              <p>Email verification</p>
              <h1>Check your inbox</h1>
              <span>We sent a verification link to {authUser?.email ?? email}. Verify that email before opening the dashboard.</span>
            </div>
            <div className="verify-actions">
              {authError && <p className="auth-error">{authError}</p>}
              {authMessage && <p className="auth-success">{authMessage}</p>}
              <button className="login-btn" type="button" onClick={handleVerificationRefresh} disabled={isAuthLoading}>
                {isAuthLoading ? 'Checking' : 'I verified my email'}
                <RefreshCw size={18} />
              </button>
              <button className="secondary-auth-btn" type="button" onClick={handleResendVerification} disabled={isAuthLoading}>Resend verification email</button>
              <button className="secondary-auth-btn" type="button" onClick={handleLogout} disabled={isAuthLoading}>Use another account</button>
            </div>
          </div>
          <aside className="auth-image-panel">
            <img src={travelHero} alt="Travel destinations collage" />
            <div className="image-overlay">
              <div className="floating-icon"><Mail size={26} /></div>
              <h2>Secure access for the team.</h2>
              <p>Only verified email accounts can open the operations dashboard.</p>
            </div>
          </aside>
        </section>
      </main>
    )
  }

  if (screen === 'data-form') {
    const isEditingBooking = Boolean(editingBookingId)
    const currentInvoiceItems = getInvoiceItemsList()
    const currentBreakdownItems = getBreakdownItemsList()
    const displayTotalClient = getBookingClientTotal(bookingForm)
    const displayTotalNett = getBookingBreakdownNettTotal(bookingForm)
    const displayTotalProfit = displayTotalClient - displayTotalNett

    return (
      <main className="data-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>{isEditingBooking ? 'Edit Booking' : 'Data Gathering'}</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              type="button"
              onClick={() => { setEditingBookingId(''); setScreen(isEditingBooking ? 'booking-detail' : 'home') }}
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        <form className="data-form" onSubmit={handleSaveBooking}>
          <header className="data-form-header">
            <div>
              <p>{isEditingBooking ? 'Update master record' : 'New inquiry'}</p>
              <h1>{isEditingBooking ? 'Edit Booking Info' : 'Data Gathering Form'}</h1>
              <span>Configure client, travel, pricing, and document details from a single workspace.</span>
            </div>
            <button type="submit" className="save-booking-btn">
              <Save size={18} />
              {isEditingBooking ? 'Save Changes' : 'Save Inquiry'}
            </button>
          </header>

          {dataError && <p className="data-alert error">{dataError}</p>}
          {dataMessage && <p className="data-alert info">{dataMessage}</p>}

          {/* 01 · CLIENT */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>01 · Client</p>
              <h2>Client info</h2>
            </div>
            <div className="field-grid three">
              <label>
                Client name
                <input required value={bookingForm.clientName} onChange={(e) => updateBookingField('clientName', e.target.value)} placeholder="Ms. Joanna Pico" />
              </label>
              <label>
                Contact number
                <input value={bookingForm.contactNumber} onChange={(e) => updateBookingField('contactNumber', e.target.value)} placeholder="09xxxxxxxxx" />
              </label>
              <label>
                Email address
                <input type="email" value={bookingForm.clientEmail} onChange={(e) => updateBookingField('clientEmail', e.target.value)} placeholder="client@email.com" />
              </label>
            </div>
          </section>

          {/* 02 · TRAVEL */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>02 · Travel</p>
              <h2>Package details</h2>
            </div>
            <div className="field-grid three">
              <label>
                Package name
                <input required value={bookingForm.packageName} onChange={(e) => updateBookingField('packageName', e.target.value)} placeholder="3D2N Clark and Olongapo" />
              </label>
              <label>
                Destination
                <input value={bookingForm.destination} onChange={(e) => updateBookingField('destination', e.target.value)} placeholder="Clark, Boracay, Hong Kong" />
              </label>
              <label>
                No. of pax
                <input value={bookingForm.pax} onChange={(e) => updateBookingField('pax', e.target.value)} placeholder="2 adults, 1 infant" />
              </label>
              <label>
                Travel start
                <input type="date" value={bookingForm.travelStart} onChange={(e) => updateBookingField('travelStart', e.target.value)} />
              </label>
              <label>
                Travel end
                <input type="date" value={bookingForm.travelEnd} onChange={(e) => updateBookingField('travelEnd', e.target.value)} />
              </label>
              <label>
                Booking status
                <select value={bookingForm.status} onChange={(e) => updateBookingField('status', e.target.value as BookingStatus)}>
                  <option>Inquiry</option>
                  <option>Breakdown</option>
                  <option>Quotation</option>
                  <option>Purchase Order</option>
                  <option>Invoice</option>
                  <option>Confirmed</option>
                </select>
              </label>
            </div>
            <label className="textarea-field">
              Item description
              <textarea rows={6} value={bookingForm.itemDescription} onChange={(e) => updateBookingField('itemDescription', e.target.value)} placeholder="e.g. This package includes round trip airfare, 3 nights accommodation, daily breakfast, airport transfers, island hopping with snorkeling equipment, and a certified tour guide for the entire stay." />
              <span className="field-help">Appears as a sub-row under the package name in the quotation and invoice.</span>
            </label>
          </section>

          {/* 03 · QUOTATION */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>03 · Quotation</p>
              <h2>Reference and base price</h2>
            </div>
            <div className="field-grid three">
              <label>
                Quotation no.
                <input value={bookingForm.quotationNo} onChange={(e) => updateBookingField('quotationNo', e.target.value)} placeholder="QT-2026-0001" />
              </label>
              <label>
                Option date
                <input type="date" value={bookingForm.optionDate} onChange={(e) => updateBookingField('optionDate', e.target.value)} />
              </label>
              <label>
                Prepared by
                <input value={bookingForm.preparedBy} onChange={(e) => updateBookingField('preparedBy', e.target.value)} placeholder="Agent Name" />
              </label>
            </div>

            <div className="line-items-panel">
              <div className="line-items-heading">
                <div>
                  <p>Base price</p>
                  <h3>Client quotation price</h3>
                  <span>This is the total the client sees on the quotation. Add optional invoice add-ons in section 04.</span>
                </div>
              </div>
              <div className="line-items-table">
                <div className="line-items-row header">
                  <span>Package name</span>
                  <span>Qty</span>
                  <span>Client price (PHP)</span>
                </div>
                <div className="line-items-row">
                  <input disabled value={bookingForm.packageName || '(Set package name in section 02)'} className="disabled-field" />
                  <input
                    type="number" min="1"
                    value={bookingForm.quantity || '1'}
                    onChange={(e) => updateBookingField('quantity', e.target.value)}
                    placeholder="1"
                  />
                  <input
                    type="text"
                    value={bookingForm.unitPrice}
                    onChange={(e) => updateBookingField('unitPrice', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <p className="field-help">Supplier nett costs are handled in section 04 (invoice add-ons) and section 05 (internal breakdown).</p>
            </div>
          </section>

          {/* 04 · INVOICE LINE ITEMS */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>04 · Invoice</p>
              <h2>Client-visible line items</h2>
            </div>
            <p className="field-help">The package row is locked and auto-filled. Add optional service rows below — these appear on the client invoice.</p>

            <div className="line-items-panel">
              <div className="line-items-heading">
                <div>
                  <p>Invoice items</p>
                  <h3>Services and add-ons</h3>
                  <span>Client sees these rows on the final invoice PDF.</span>
                </div>
                <button type="button" onClick={addInvoiceItemRow}>
                  <Plus size={15} /> Add item
                </button>
              </div>

              <div className="line-items-table">
                <div className="line-items-row header">
                  <span>Service / item</span>
                  <span>Qty</span>
                  <span>Unit price</span>
                  <span>Nett cost</span>
                  <span>Total</span>
                  <span></span>
                </div>

                {currentInvoiceItems.map((item, index) => {
                  const q = parseQuantity(item.quantity)
                  const u = parseAmount(item.unitPrice)
                  const rowTotal = q * u
                  return (
                    <div key={index} className="line-item-data-row">
                      <div className="line-items-row">
                        {item.isPackageRow ? (
                          <input disabled className="disabled-field" value={bookingForm.packageName || 'Basic Package'} />
                        ) : (
                          <select value={item.description} onChange={(e) => changeInvoiceItemField(index, 'description', e.target.value)}>
                            {invoiceOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        )}
                        <input
                          type="number" min="1"
                          value={item.quantity}
                          onChange={(e) => changeInvoiceItemField(index, 'quantity', e.target.value)}
                        />
                        <input
                          type="text"
                          value={item.unitPrice}
                          onChange={(e) => changeInvoiceItemField(index, 'unitPrice', e.target.value)}
                          placeholder="0.00"
                        />
                        {item.isPackageRow ? (
                          <input disabled className="disabled-field" value="N/A" />
                        ) : (
                          <input
                            type="text"
                            value={item.nettCost}
                            onChange={(e) => changeInvoiceItemField(index, 'nettCost', e.target.value)}
                            placeholder="0.00"
                          />
                        )}
                        <div className={`line-item-profit ${rowTotal > 0 ? 'positive' : 'zero'}`}>
                          {formatAmount(String(rowTotal))}
                        </div>
                        <button
                          type="button"
                          className="remove-line-btn"
                          onClick={() => removeInvoiceItemRow(index)}
                          disabled={item.isPackageRow}
                          title={item.isPackageRow ? 'Package row cannot be removed' : 'Remove row'}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="line-items-summary">
                <article>
                  <span>Invoice total</span>
                  <strong>{formatAmount(String(displayTotalClient))}</strong>
                </article>
                <article>
                  <span>Items</span>
                  <strong>{currentInvoiceItems.length} row{currentInvoiceItems.length !== 1 ? 's' : ''}</strong>
                </article>
                <article>
                  <span>Status</span>
                  <strong>{bookingForm.status}</strong>
                </article>
              </div>
            </div>
          </section>

          {/* 05a · INTERNAL COSTING */}
          <section className="form-section internal-section">
            <div className="form-section-heading">
              <p>05a · Internal Costing</p>
              <h2>Supplier nett vs client price</h2>
            </div>
            <p className="field-help">For internal use only. Track what you pay the supplier vs what you charge the client. Toggle "Send to invoice" to push a row to the client invoice.</p>

            <div className="line-items-panel">
              <div className="line-items-heading">
                <div>
                  <p>Costing sheet</p>
                  <h3>Per-service profit tracking</h3>
                  <span>These rows are hidden from the client.</span>
                </div>
                <button type="button" onClick={addBreakdownItemRow}>
                  <Plus size={15} /> Add row
                </button>
              </div>

              <div className="line-items-table">
                <div className="line-items-row breakdown-row header">
                  <span>Service / item</span>
                  <span>Qty</span>
                  <span>Client price</span>
                  <span>Supplier nett</span>
                  <span>Send to invoice</span>
                  <span></span>
                </div>

                {currentBreakdownItems.map((item, index) => (
                  <div key={index} className="line-item-data-row">
                    <div className="line-items-row breakdown-row">
                      {item.isPackageRow ? (
                        <input disabled className="disabled-field" value={`Auto: ${bookingForm.packageName || 'Basic Package'}`} />
                      ) : (
                        <select value={item.description} onChange={(e) => changeBreakdownItemField(index, 'description', e.target.value)}>
                          {breakdownOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      )}
                      <input
                        type="number" min="1"
                        disabled={item.isPackageRow}
                        className={item.isPackageRow ? 'disabled-field' : ''}
                        value={item.quantity}
                        onChange={(e) => changeBreakdownItemField(index, 'quantity', e.target.value)}
                      />
                      <input
                        type="text"
                        disabled={item.isPackageRow}
                        className={item.isPackageRow ? 'disabled-field' : ''}
                        value={item.unitPrice}
                        onChange={(e) => changeBreakdownItemField(index, 'unitPrice', e.target.value)}
                        placeholder="0.00"
                      />
                      <input
                        type="text"
                        value={item.nettCost}
                        onChange={(e) => changeBreakdownItemField(index, 'nettCost', e.target.value)}
                        placeholder="0.00"
                      />
                      <button
                        type="button"
                        className={`send-to-invoice-btn ${item.sendToInvoice ? 'active' : ''}`}
                        onClick={() => changeBreakdownItemField(index, 'sendToInvoice', !item.sendToInvoice)}
                      >
                        {item.sendToInvoice ? <Eye size={14} /> : <EyeOff size={14} />}
                        <span>{item.sendToInvoice ? 'Showing' : 'Hidden'}</span>
                      </button>
                      <button
                        type="button"
                        className="remove-line-btn"
                        onClick={() => removeBreakdownItemRow(index)}
                        disabled={item.isPackageRow}
                        title={item.isPackageRow ? 'Package row cannot be removed' : 'Remove row'}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="line-items-summary">
                <article>
                  <span>Client total</span>
                  <strong>{formatAmount(String(displayTotalClient))}</strong>
                </article>
                <article>
                  <span>Supplier nett</span>
                  <strong>{formatAmount(String(displayTotalNett))}</strong>
                </article>
                <article>
                  <span>Est. profit</span>
                  <strong className={displayTotalProfit >= 0 ? 'profit-total' : 'profit-negative'}>
                    {formatAmount(String(displayTotalProfit))}
                  </strong>
                </article>
              </div>
            </div>
          </section>

          {/* 05b · PAX-TIER BREAKDOWN (Quotation template) */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>05b · Breakdown Template</p>
              <h2>Price per person by group size</h2>
            </div>

            {/* Step 1 — Column setup */}
            {(() => {
              let labels = ['2 PAX', '5 PAX', 'PAX AND ABOVE', 'INFANT']
              try { const p = JSON.parse(bookingForm.breakdownColLabels); if (Array.isArray(p) && p.length === 4) labels = p } catch {}
              let paxCounts = ['', '', '', '']
              try { const p = JSON.parse(bookingForm.breakdownPaxTiers); if (Array.isArray(p) && p.length === 4) paxCounts = p } catch {}
              const setLabel = (i: number, v: string) => { const next = [...labels]; next[i] = v; updateBookingField('breakdownColLabels', JSON.stringify(next)) }
              const setPax = (i: number, v: string) => { const next = [...paxCounts]; next[i] = v; updateBookingField('breakdownPaxTiers', JSON.stringify(next)) }
              // Auto-detect pax count from label if it starts with a number (e.g. "2 PAX" → 2)
              const getEffectivePax = (label: string, storedPax: string) => {
                const match = label.match(/^(\d+)/)
                return match ? match[1] : storedPax
              }
              return (
                <div className="breakdown-tier-config">
                  <div className="breakdown-tier-config-header">
                    <div>
                      <p className="breakdown-tier-config-label">STEP 1 — Set up your group size columns</p>
                      <p className="breakdown-tier-config-hint">Each column = one group size scenario. You can rename the columns if needed. If the column name doesn't start with a number (e.g. "PAX AND ABOVE" or "INFANT"), enter how many people it represents so the total can be calculated.</p>
                    </div>
                  </div>
                  <div className="breakdown-tier-grid">
                    {labels.map((label, i) => {
                      const startsWithNumber = /^\d+/.test(label)
                      const effectivePax = getEffectivePax(label, paxCounts[i])
                      return (
                        <div key={i} className="breakdown-tier-col">
                          <p className="tier-col-num">Column {i + 1}</p>
                          <label className="tier-field-label">Column name</label>
                          <input
                            value={label}
                            onChange={(e) => setLabel(i, e.target.value)}
                            placeholder="e.g. 2 PAX"
                            className="tier-label-input"
                          />
                          {startsWithNumber ? (
                            <p className="tier-autopax">✓ {effectivePax} people — auto detected from name</p>
                          ) : (
                            <>
                              <label className="tier-field-label">How many people? <span style={{color:'var(--error,#dc2626)'}}>*</span></label>
                              <input
                                type="number" min="0"
                                value={paxCounts[i]}
                                onChange={(e) => setPax(i, e.target.value)}
                                placeholder="e.g. 1"
                                className="tier-pax-input"
                              />
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Step 2 — Per-service prices */}
            <div className="breakdown-tier-prices-panel">
              <div className="breakdown-tier-prices-header">
                <div>
                  <p className="breakdown-tier-config-label">STEP 2 — Enter the price per person for each service</p>
                  <p className="breakdown-tier-config-hint">For each service below, type the price per person under the correct group size column. Leave blank if that service doesn't apply to that group size.</p>
                </div>
              </div>

              <div className="line-items-table">
                <div className="line-items-row pax-tier-row header">
                  <span>Service</span>
                  <span>Details (optional)</span>
                  {(() => {
                    let labels = ['2 PAX', '5 PAX', 'PAX AND ABOVE', 'INFANT']
                    try { const p = JSON.parse(bookingForm.breakdownColLabels); if (Array.isArray(p) && p.length === 4) labels = p } catch {}
                    return labels.map((lbl, i) => <span key={i}>Price per person<br/>({lbl})</span>)
                  })()}
                </div>

                {currentBreakdownItems.filter(item => !item.isPackageRow).map((item, index) => {
                  const realIndex = currentBreakdownItems.indexOf(item)
                  return (
                    <div key={index} className="line-item-data-row">
                      <div className="line-items-row pax-tier-row">
                        <div className="pax-tier-service-label">{item.description}</div>
                        <input
                          type="text"
                          value={item.details || ''}
                          onChange={(e) => changeBreakdownItemField(realIndex, 'details', e.target.value)}
                          placeholder="e.g. CRK - MPH"
                        />
                        {(['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant'] as const).map((field) => (
                          <input
                            key={field}
                            type="text"
                            value={(item[field] as string) || ''}
                            onChange={(e) => changeBreakdownItemField(realIndex, field, e.target.value)}
                            placeholder="0.00"
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}

                {currentBreakdownItems.filter(i => !i.isPackageRow).length === 0 && (
                  <div style={{padding:'1.25rem', textAlign:'center', color:'var(--text-secondary)', fontSize:'0.85rem', fontStyle:'italic'}}>
                    No services yet — add rows in Section 05a above first, then come back here to fill in the prices.
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 06 · SUPPLIER */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>06 · Supplier</p>
              <h2>Operator details</h2>
            </div>
            <div className="field-grid two">
              <label>
                Supplier / operator
                <input value={bookingForm.supplier} onChange={(e) => updateBookingField('supplier', e.target.value)} placeholder="Tour operator or hotel name" />
              </label>
              <label>
                Supplier contact
                <input value={bookingForm.supplierContact} onChange={(e) => updateBookingField('supplierContact', e.target.value)} placeholder="09xxxxxxxxx or email" />
              </label>
            </div>
          </section>

          {/* 07 · LOGISTICS */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>07 · Logistics</p>
              <h2>Fulfillment context</h2>
            </div>
            <div className="field-grid two">
              <label className="textarea-field">
                Flight details
                <textarea rows={3} value={bookingForm.flightDetails} onChange={(e) => updateBookingField('flightDetails', e.target.value)} placeholder="MNL-MPH PR2041 0800AM, MPH-MNL PR2042 0500PM" />
              </label>
              <label className="textarea-field">
                Accommodation details
                <textarea rows={3} value={bookingForm.accommodation} onChange={(e) => updateBookingField('accommodation', e.target.value)} placeholder="Henann Regency Beach Resort (Superior Room)" />
              </label>
              <label className="textarea-field">
                Hotel location address
                <textarea rows={2} value={bookingForm.hotelAddress} onChange={(e) => updateBookingField('hotelAddress', e.target.value)} placeholder="Station 2, Balabag, Boracay Island, Malay, Aklan" />
              </label>
              <label className="textarea-field">
                Emergency local contact
                <textarea rows={2} value={bookingForm.emergencyContact} onChange={(e) => updateBookingField('emergencyContact', e.target.value)} placeholder="Hotel Front Desk: (036) 288-6111" />
              </label>
            </div>
          </section>

          {/* 08 · INCLUSIONS — auto-computed from invoice items */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>08 · Inclusions &amp; Exclusions</p>
              <h2>Auto-generated from invoice items</h2>
            </div>
            <div className="field-grid two">
              <div className="textarea-field">
                <span style={{fontWeight:600, fontSize:'0.8rem', color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em'}}>Inclusions (preview)</span>
                <div style={{padding:'0.75rem', background:'var(--surface-raised)', borderRadius:'0.5rem', minHeight:'5rem', fontSize:'0.875rem', lineHeight:'1.6', color:'var(--text-primary)', border:'1px solid var(--border)'}}>
                  {(() => {
                    const { inclusions } = computeInclusionsExclusions(bookingForm.invoiceLineItemsJson)
                    const lines = inclusions.split('\n').filter(Boolean)
                    return lines.length > 0
                      ? lines.map((line, i) => <div key={i}>✓ {line}</div>)
                      : <span style={{color:'var(--text-secondary)', fontStyle:'italic'}}>Add invoice items above to populate inclusions</span>
                  })()}
                </div>
              </div>
              <div className="textarea-field">
                <span style={{fontWeight:600, fontSize:'0.8rem', color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em'}}>Exclusions (preview)</span>
                <div style={{padding:'0.75rem', background:'var(--surface-raised)', borderRadius:'0.5rem', minHeight:'5rem', fontSize:'0.875rem', lineHeight:'1.6', color:'var(--text-primary)', border:'1px solid var(--border)'}}>
                  {(() => {
                    const { exclusions } = computeInclusionsExclusions(bookingForm.invoiceLineItemsJson)
                    const lines = exclusions.split('\n').filter(Boolean)
                    return lines.length > 0
                      ? lines.map((line, i) => <div key={i}>✗ {line}</div>)
                      : <span style={{color:'var(--text-secondary)', fontStyle:'italic'}}>All invoice options are included</span>
                  })()}
                </div>
              </div>
            </div>
          </section>

          {/* 09 · SCHEDULE */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>09 · Schedule</p>
              <h2>Itinerary roadmap</h2>
            </div>
            <label className="textarea-field">
              Daily routing schedule
              <textarea rows={6} value={bookingForm.itinerary} onChange={(e) => updateBookingField('itinerary', e.target.value)} placeholder={'Day 1: Arrival at Caticlan Airport, Transfer to Resort, Free Time\nDay 2: Boracay Island Hopping Tour with Lunch\nDay 3: Breakfast, Free Time until checkout, Departure transfer'} />
            </label>
          </section>

          {/* 10 · REMARKS */}
          <section className="form-section">
            <div className="form-section-heading">
              <p>10 · Remarks</p>
              <h2>Internal operations notes</h2>
            </div>
            <div className="field-grid two">
              <label className="textarea-field">
                Special client requests
                <textarea rows={3} value={bookingForm.specialInstructions} onChange={(e) => updateBookingField('specialInstructions', e.target.value)} placeholder="Requesting high floor rooms if available. Senior friendly pacing." />
              </label>
              <label className="textarea-field">
                Private desk notes
                <textarea rows={3} value={bookingForm.notes} onChange={(e) => updateBookingField('notes', e.target.value)} placeholder="Supplier confirmed rate lock until next Friday only." />
              </label>
            </div>
          </section>

          <footer className="form-actions-bar">
            <button
              type="button"
              className="cancel-form-btn"
              onClick={() => { setEditingBookingId(''); setScreen(isEditingBooking ? 'booking-detail' : 'home') }}
            >
              Cancel changes
            </button>
            <button type="submit" className="save-booking-btn">
              <Save size={18} />
              {isEditingBooking ? 'Save Changes' : 'Save Booking Record'}
            </button>
          </footer>
        </form>
      </main>
    )
  }

  if (screen === 'booking-detail') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Booking not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    return (
      <main className="detail-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Booking Workspace</span>
            </div>
          </div>
          <div className="nav-actions">
            <button type="button" onClick={() => setScreen('home')} title="Back">
              <X size={18} />
            </button>
          </div>
        </nav>

        <div className="detail-layout">
          <section className="detail-main">
            <header className="detail-header">
              <div>
                <p>{selectedBooking.status}</p>
                <h1>{selectedBooking.packageName}</h1>
                <span>{selectedBooking.clientName}</span>
              </div>
              <div className="detail-controls">
                <label>
                  Current stage
                  <select
                    value={selectedBooking.status}
                    onChange={(event) =>
                      updateSelectedBookingStatus(event.target.value as BookingStatus)
                    }
                  >
                    <option>Inquiry</option>
                    <option>Breakdown</option>
                    <option>Quotation</option>
                    <option>Purchase Order</option>
                    <option>Invoice</option>
                    <option>Confirmed</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="delete-project-btn"
                  onClick={handleDeleteBooking}
                >
                  Delete project
                </button>
              </div>
            </header>

            <div className="detail-grid">
              <article>
                <span>Contact</span>
                <strong>{selectedBooking.contactNumber || 'Not provided'}</strong>
              </article>
              <article>
                <span>Email</span>
                <strong>{selectedBooking.clientEmail || 'Not provided'}</strong>
              </article>
              <article>
                <span>Destination</span>
                <strong>{selectedBooking.destination || 'Not provided'}</strong>
              </article>
              <article>
                <span>No. of pax</span>
                <strong>{selectedBooking.pax || 'Not provided'}</strong>
              </article>
              <article>
                <span>Travel dates</span>
                <strong>
                  {selectedBooking.travelStart || 'No start'} to{' '}
                  {selectedBooking.travelEnd || 'No end'}
                </strong>
              </article>
              <article>
                <span>Quotation no.</span>
                <strong>{selectedBooking.quotationNo || 'Not assigned'}</strong>
              </article>
              <article>
                <span>Flight details</span>
                <strong>{selectedBooking.flightDetails || 'Not provided'}</strong>
              </article>
              <article>
                <span>Accommodation</span>
                <strong>{selectedBooking.accommodation || 'Not provided'}</strong>
              </article>
              <article>
                <span>Client price</span>
                <strong>{formatAmount(String(getBookingClientTotal(selectedBooking)))}</strong>
              </article>
              <article className="internal-summary">
                <span>Internal nett</span>
                <strong>{formatAmount(String(getBookingBreakdownNettTotal(selectedBooking)))}</strong>
              </article>
            </div>

            <section className="detail-notes">
              <div>
                <p>Master data</p>
                <h2>Collected notes</h2>
              </div>
              <p>{selectedBooking.notes || 'No notes yet.'}</p>
            </section>
          </section>

          <aside className="document-panel">
            <div className="document-panel-heading">
              <p>Next actions</p>
              <h2>What do you need?</h2>
            </div>

            <div className="workspace-actions">
              <button
                type="button"
                className="primary-workspace-action"
                onClick={openDocumentFolder}
              >
                <FolderKanban size={20} />
                <span>
                  <strong>Open document folder</strong>
                  <small>Breakdown, quotation, invoice, P.O., and voucher.</small>
                </span>
                <ArrowRight size={17} />
              </button>
              <button type="button" onClick={handleEditBooking}>
                <FileText size={19} />
                <span>
                  <strong>Edit booking info</strong>
                  <small>Fix client, travel, price, supplier, or voucher fields.</small>
                </span>
                <ArrowRight size={17} />
              </button>
              <button type="button" onClick={openInvoiceEditor}>
                <FileText size={19} />
                <span>
                  <strong>Update invoice payment</strong>
                  <small>Edit paid amount, balance, date, method, and reference.</small>
                </span>
                <ArrowRight size={17} />
              </button>
            </div>

            <div className="workflow-note">
              <ListChecks size={20} />
              <p>
                Use the document folder for final previews. It keeps client
                documents separate from internal breakdown details.
              </p>
            </div>
          </aside>
        </div>
      </main>
    )
  }

  if (screen === 'document-folder') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Document folder not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    const hasClientAmount = sumLineItems(getBookingLineItems(selectedBooking), 'total') > 0
    const documentFolderItems = [
      {
        title: 'Breakdown',
        label: 'Internal sheet',
        description: 'Supplier nett, client price, and estimated profit.',
        requirement: 'Needs supplier nett and client selling price.',
        ready:
          hasClientAmount &&
          getBookingBreakdownNettTotal(selectedBooking) > 0,
      },
      {
        title: 'Quotation',
        label: 'Client PDF',
        description: 'Client-facing offer with inclusions and exclusions.',
        requirement: 'Needs client, package, travel date, and selling price.',
        ready: Boolean(
          selectedBooking.clientName &&
            selectedBooking.packageName &&
            selectedBooking.travelStart &&
            hasClientAmount,
        ),
      },
      {
        title: 'Invoice',
        label: 'Editable before PDF',
        description: 'Billing document with payment status and balance.',
        requirement: 'Needs client, package, selling price, and payment update.',
        ready: Boolean(selectedBooking.clientName && selectedBooking.packageName && hasClientAmount),
      },
      {
        title: 'Purchase Order',
        label: 'Supplier PDF',
        description: 'Reservation instruction for supplier or operator.',
        requirement: 'Needs supplier/operator, package, pax, and travel date.',
        ready: Boolean(
          selectedBooking.supplier &&
            selectedBooking.packageName &&
            selectedBooking.pax &&
            selectedBooking.travelStart,
        ),
      },
      {
        title: 'Service Voucher',
        label: 'Confirmation PDF',
        description: 'Final confirmed travel details for the client.',
        requirement: 'Needs itinerary, accommodation, contacts, and inclusions.',
        ready: Boolean(
          selectedBooking.itinerary &&
            selectedBooking.accommodation &&
            selectedBooking.contactNumber,
        ),
      },
    ]

    return (
      <main className="detail-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Document Folder</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              className="nav-text-action"
              type="button"
              onClick={() => setScreen('booking-detail')}
              title="Back to booking workspace"
            >
              <X size={18} />
              <span>Booking workspace</span>
            </button>
          </div>
        </nav>

        <section className="folder-layout">
          <header className="folder-header">
            <div>
              <p>Booking folder</p>
              <h1>{selectedBooking.packageName}</h1>
              <span>
                {selectedBooking.clientName || 'No client yet'} /{' '}
                {selectedBooking.quotationNo || selectedBooking.id}
              </span>
            </div>
            <div className="folder-badge">
              <FolderKanban size={22} />
              {documentFolderItems.filter((item) => item.ready).length}/
              {documentFolderItems.length} ready
            </div>
          </header>

          <div className="folder-grid">
            {documentFolderItems.map((item) => (
              <article className="folder-card" key={item.title}>
                <div className="folder-card-top">
                  <FileText size={22} />
                  <span className={item.ready ? 'ready' : 'needs-data'}>
                    {item.ready ? 'Ready' : 'Needs data'}
                  </span>
                </div>
                <h2>{item.title}</h2>
                <strong>{item.label}</strong>
                <p>{item.description}</p>
                <small>{item.requirement}</small>
                <button
                  type="button"
                  className="folder-card-action"
                  onClick={() => openDocumentByTitle(item.title)}
                >
                  {item.title === 'Invoice' ? 'Edit invoice' : 'Open preview'}
                  <ArrowRight size={17} />
                </button>
              </article>
            ))}
          </div>

          <section className="workflow-note folder-note">
            <ListChecks size={20} />
            <p>
              This is the booking document folder. Client-facing previews only
              show their filtered data, while the breakdown keeps internal nett
              and profit details separate.
            </p>
          </section>
        </section>
      </main>
    )
  }

  if (screen === 'quotation-preview') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Quotation not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    const lineItems = getBookingLineItems(selectedBooking)
    const autoIncEx1 = computeInclusionsExclusions(selectedBooking.invoiceLineItemsJson)
    const inclusions = getLines(selectedBooking.inclusions || autoIncEx1.inclusions, [
      'Travel arrangement based on selected package',
    ])
    const exclusions = getLines(selectedBooking.exclusions || autoIncEx1.exclusions, [
      'Meals not stated',
      'Other incidental charges not stated',
    ])

    return (
      <main className="preview-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Quotation Preview</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              className="nav-text-action"
              type="button"
              onClick={handlePrintPreview}
              title={isPdfExporting ? 'Preparing PDF...' : 'Download clean PDF'}
              disabled={isPdfExporting}
            >
              <Printer size={18} />
              <span>{isPdfExporting ? 'Preparing...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('booking-detail')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        <section className="quotation-preview print-document">
          <header className="quote-header">
            <div className="quote-company">
              <strong>LION AND LAMB TRAVEL</strong>
              <span>BLK C 7-17 Olongapo City Public Market</span>
              <span>East Bajac Bajac Olongapo City</span>
              <span>travel_lionlamb@yahoo.com</span>
            </div>
            <img src={logo} alt="Lion and Lamb Travel logo" />
          </header>

          <h1>Quotation</h1>

          <section className="quote-meta-grid">
            <article>
              <span>Date</span>
              <strong>{formatProjectDate(new Date().toISOString())}</strong>
            </article>
            <article>
              <span>Quotation For</span>
              <strong>{selectedBooking.clientName}</strong>
            </article>
            <article>
              <span>Package Name</span>
              <strong>{selectedBooking.packageName}</strong>
            </article>
            <article>
              <span>Quotation No.</span>
              <strong>{selectedBooking.quotationNo || selectedBooking.id}</strong>
            </article>
            <article>
              <span>Date of Travel</span>
              <strong>
                {selectedBooking.travelStart
                  ? `${formatProjectDate(selectedBooking.travelStart)}${
                      selectedBooking.travelEnd
                        ? ` - ${formatProjectDate(selectedBooking.travelEnd)}`
                        : ''
                    }`
                  : 'To be advised'}
              </strong>
            </article>
            <article>
              <span>Condition</span>
              <strong>Rate subject to change and availability</strong>
            </article>
          </section>

          <table className="quote-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="desc-col">Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => (
                <tr key={`${item.description}-${index}`}>
                  <td className="item-col">{item.description}</td>
                  <td className="desc-col">{index === 0 ? (selectedBooking.itemDescription || '') : ''}</td>
                  <td>{item.quantity}</td>
                  <td>{formatAmount(String(item.unitPrice))}</td>
                  <td>{formatAmount(String(item.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="quote-notes">
            <p>Notes: No booking has been made yet.</p>
            <strong>RATE SUBJECT TO CHANGE AND AVAILABILITY</strong>
          </section>

          <section className="preview-list-grid document-checklists">
            <div className="included-list">
              <h2>Inclusions</h2>
              <ul>
                {inclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="excluded-list">
              <h2>Exclusions</h2>
              <ul>
                {exclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="quote-filter-warning">
            <ListChecks size={19} />
            <p>
              Client quotation preview only. Internal supplier nett, markup, and
              breakdown values are intentionally hidden.
            </p>
          </section>

          <footer className="quote-footer-line">
            Prepared By: {selectedBooking.preparedBy || authUser?.displayName || 'LLT Staff'}
          </footer>
        </section>
      </main>
    )
  }

  if (screen === 'invoice-editor') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Invoice not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    const lineItems = getBookingLineItems(selectedBooking)
    const totalPrice = sumLineItems(lineItems, 'total')
    const amountPaid = parseAmount(invoiceForm.invoiceAmountPaid)
    const balance = Math.max(totalPrice - amountPaid, 0)

    return (
      <main className="data-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Editable Invoice</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              type="button"
              onClick={() => setScreen('booking-detail')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        <form className="data-form" onSubmit={handleSaveInvoiceUpdate}>
          <header className="data-form-header">
            <div>
              <p>Invoice update</p>
              <h1>{selectedBooking.packageName}</h1>
              <span>
                Edit payment details first. The invoice PDF preview will use
                this saved payment update.
              </span>
            </div>
            <button type="submit" className="save-booking-btn">
              <Save size={18} />
              Save and preview invoice
            </button>
          </header>

          <section className="invoice-edit-summary">
            <article>
              <span>Total invoice</span>
              <strong>{formatAmount(String(totalPrice))}</strong>
            </article>
            <article>
              <span>Amount paid</span>
              <strong>{formatAmount(invoiceForm.invoiceAmountPaid)}</strong>
            </article>
            <article>
              <span>Balance</span>
              <strong>{formatAmount(String(balance))}</strong>
            </article>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Editable invoice</p>
              <h2>Payment update before PDF</h2>
            </div>
            <div className="field-grid three">
              <label>
                Payment status
                <select
                  value={invoiceForm.invoicePaymentStatus}
                  onChange={(event) =>
                    updateInvoiceField('invoicePaymentStatus', event.target.value)
                  }
                >
                  <option>Unpaid</option>
                  <option>Partially Paid</option>
                  <option>Paid</option>
                </select>
              </label>
              <label>
                Amount paid
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={invoiceForm.invoiceAmountPaid}
                  onChange={(event) =>
                    updateInvoiceField('invoiceAmountPaid', event.target.value)
                  }
                  placeholder="PHP 0.00"
                />
              </label>
              <label>
                Payment date
                <input
                  type="date"
                  value={invoiceForm.invoicePaymentDate}
                  onChange={(event) =>
                    updateInvoiceField('invoicePaymentDate', event.target.value)
                  }
                />
              </label>
            </div>
            <div className="field-grid two">
              <label>
                Payment method
                <input
                  value={invoiceForm.paymentMethod}
                  onChange={(event) =>
                    updateInvoiceField('paymentMethod', event.target.value)
                  }
                  placeholder="Bank transfer, cash, GCash"
                />
              </label>
              <label>
                Payment reference
                <input
                  value={invoiceForm.invoiceReference}
                  onChange={(event) =>
                    updateInvoiceField('invoiceReference', event.target.value)
                  }
                  placeholder="OR / bank ref / GCash ref"
                />
              </label>
            </div>
            <label className="textarea-field">
              Payment records
              <textarea
                value={invoiceForm.paymentRecords}
                onChange={(event) =>
                  updateInvoiceField('paymentRecords', event.target.value)
                }
                placeholder="One payment update per line, e.g. DP MAR 3 PAID - PHP 40,000"
              />
            </label>
          </section>
        </form>
      </main>
    )
  }

  if (screen === 'invoice-preview') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Invoice not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    const lineItems = getBookingLineItems(selectedBooking)
    const totalPrice = sumLineItems(lineItems, 'total')
    const amountPaid = parseAmount(selectedBooking.invoiceAmountPaid)
    const balance = Math.max(totalPrice - amountPaid, 0)
    const paymentRecords = getLines(selectedBooking.paymentRecords, [
      'No payment updates yet.',
    ])
    const autoIncEx2 = computeInclusionsExclusions(selectedBooking.invoiceLineItemsJson)
    const inclusions = getLines(selectedBooking.inclusions || autoIncEx2.inclusions, [
      'Travel arrangement based on confirmed package',
    ])
    const exclusions = getLines(selectedBooking.exclusions || autoIncEx2.exclusions, [
      'Meals not stated',
      'Other services not mentioned above',
    ])

    return (
      <main className="preview-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Invoice Preview</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              className="nav-text-action"
              type="button"
              onClick={handlePrintPreview}
              title={isPdfExporting ? 'Preparing PDF...' : 'Download clean PDF'}
              disabled={isPdfExporting}
            >
              <Printer size={18} />
              <span>{isPdfExporting ? 'Preparing...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              onClick={openInvoiceEditor}
              title="Edit invoice"
            >
              <Save size={18} />
            </button>
            <button
              type="button"
              onClick={() => setScreen('booking-detail')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        <section className="invoice-preview print-document">
          <header className="invoice-header">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <h1>INVOICE</h1>
              <strong>LION AND LAMB TRAVEL</strong>
              <span>BLK C 7-17, Olongapo City Public Market</span>
              <span>Rizal Ave. Olongapo City, Zambales 2200</span>
              <span>travel_lionlamb@yahoo.com</span>
            </div>
            <img src={agencySeal} alt="DOT accreditation seal" />
          </header>

          <section className="invoice-strip">
            <div>
              <span>Invoice #</span>
              <strong>{selectedBooking.id.replace('BK-', 'LLTP')}</strong>
            </div>
            <div>
              <span>Invoice Date</span>
              <strong>{formatProjectDate(new Date().toISOString())}</strong>
            </div>
            <div className="amount-due-box">
              <span>Amount Due</span>
              <strong>{formatAmount(String(balance))}</strong>
            </div>
          </section>

          <section className="bill-to-row">
            <strong>Bill To:</strong>
            <span>{selectedBooking.clientName}</span>
          </section>

          <table className="invoice-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="desc-col">Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => (
                <tr key={`${item.description}-${index}`}>
                  <td className="item-col">{item.description}</td>
                  <td className="desc-col">{index === 0 ? (selectedBooking.itemDescription || '') : ''}</td>
                  <td>{item.quantity}</td>
                  <td>{formatAmount(String(item.unitPrice))}</td>
                  <td>{formatAmount(String(item.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="invoice-total-panel">
            <div>
              <span>Subtotal</span>
              <strong>{formatAmount(String(totalPrice))}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{formatAmount(String(totalPrice))}</strong>
            </div>
            <div>
              <span>Paid</span>
              <strong>{formatAmount(selectedBooking.invoiceAmountPaid)}</strong>
            </div>
            <div>
              <span>Balance</span>
              <strong>{formatAmount(String(balance))}</strong>
            </div>
            <div className="payment-placeholder">
              <span>Payment Updates</span>
              <ul>
                {paymentRecords.map((record) => (
                  <li key={record}>{record}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="invoice-notes">
            <p>
              Status: {selectedBooking.invoicePaymentStatus || 'Unpaid'}.
              Payment method: {selectedBooking.paymentMethod || 'To be advised'}.
              Payment date:{' '}
              {selectedBooking.invoicePaymentDate
                ? formatProjectDate(selectedBooking.invoicePaymentDate)
                : 'To be advised'}.
              Reference: {selectedBooking.invoiceReference || 'N/A'}.
              Flight details: {selectedBooking.flightDetails || 'To be advised'}.
            </p>
            <section className="invoice-policy">
              <h3>Flight Details</h3>
              <p>{selectedBooking.flightDetails || 'To be advised'}</p>
              <h3>Terms and Conditions</h3>
              <p>Booking Policy: Payments are non-refundable once made.</p>
              <p>
                Hotel and tours are re-bookable under certain conditions and
                subject to fees and penalties.
              </p>
              <p>
                Any alteration made without approval from the issuing office
                will be deemed null and void.
              </p>
              <p>
                Any incidental expenses will be on the guest account. The
                issuing office is not liable for problems caused by airline,
                hotel, or local tour operators.
              </p>
              <p>
                Passengers are responsible for checking travel documents and
                immigration requirements before booking.
              </p>
            </section>
            <div className="transaction-box">
              <strong>For faster transactions</strong>
              <span>Send deposit or payment proof with your booking reference.</span>
              <span>BDO - OLONGAPO / SHARON R MORINE</span>
            </div>
          </section>

          <section className="quote-filter-warning">
            <ListChecks size={19} />
            <p>
              Client invoice preview only. Supplier nett and internal breakdown
              values are hidden.
            </p>
          </section>
        </section>
      </main>
    )
  }

  if (screen === 'purchase-order-preview') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Purchase order not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    const lineItems = getBookingLineItems(selectedBooking)
    const amount = sumLineItems(lineItems, 'nettTotal') || sumLineItems(lineItems, 'total')
    const poNumber = selectedBooking.id.replace('BK-', new Date().getFullYear().toString())

    return (
      <main className="preview-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Purchase Order Preview</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              className="nav-text-action"
              type="button"
              onClick={handlePrintPreview}
              title={isPdfExporting ? 'Preparing PDF...' : 'Download clean PDF'}
              disabled={isPdfExporting}
            >
              <Printer size={18} />
              <span>{isPdfExporting ? 'Preparing...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('booking-detail')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        <section className="po-preview print-document">
          <header className="po-header">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>LION AND LAMB TRAVEL</strong>
              <span>BLK #7-17 OLONGAPO CITY PUBLIC MARKET</span>
              <span>Olongapo City, Philippines 2200</span>
              <span>travel_lionlamb@yahoo.com</span>
              <span>DOT No: R03 - TTA 013652023</span>
            </div>
            <img src={agencySeal} alt="DOT accreditation seal" />
          </header>

          <h1>Purchase Order</h1>

          <section className="po-meta-grid">
            <article>
              <span>Date</span>
              <strong>{formatProjectDate(new Date().toISOString())}</strong>
            </article>
            <article>
              <span>Invoice</span>
              <strong>{selectedBooking.quotationNo || selectedBooking.id}</strong>
            </article>
            <article>
              <span>P.O. No.</span>
              <strong>{poNumber}</strong>
            </article>
          </section>

          <section className="po-party-grid">
            <div>
              <span>Vendor:</span>
              <strong>{selectedBooking.supplier || 'To be assigned'}</strong>
              <small>
                Agent:{' '}
                {selectedBooking.preparedBy || authUser?.displayName || 'LLT Staff'}
              </small>
              <small>Contact No.: {selectedBooking.supplierContact || 'N/A'}</small>
            </div>
            <div>
              <span>Client Details:</span>
              <strong>
                {selectedBooking.clientName}
                {selectedBooking.pax ? ` x${selectedBooking.pax}` : ''}
              </strong>
              <small>No. of pax: {selectedBooking.pax || 'N/A'}</small>
              <small>Contact No.: {selectedBooking.contactNumber || 'N/A'}</small>
            </div>
          </section>

          <table className="po-table">
            <thead>
              <tr>
                <th>Payment Method</th>
                <th>Type of Service</th>
                <th>Travel Date</th>
                <th>Option Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{selectedBooking.paymentMethod || 'Bank Transfer'}</td>
                <td>{selectedBooking.destination || 'Tours and Transfers'}</td>
                <td>
                  {selectedBooking.travelStart
                    ? `${formatProjectDate(selectedBooking.travelStart)}${
                        selectedBooking.travelEnd
                          ? ` - ${formatProjectDate(selectedBooking.travelEnd)}`
                          : ''
                      }`
                    : 'TBA'}
                </td>
                <td>
                  {selectedBooking.optionDate
                    ? formatProjectDate(selectedBooking.optionDate)
                    : 'TBA'}
                </td>
              </tr>
            </tbody>
          </table>

          <table className="po-table particulars">
            <thead>
              <tr>
                <th>Qty</th>
                <th># of Pax</th>
                <th>Particular</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => {
                const poUnitPrice = item.nettCost || item.unitPrice
                const poAmount = item.nettTotal || item.total

                return (
                  <tr key={`${item.description}-${index}`}>
                    <td>{item.quantity}</td>
                    <td>{selectedBooking.pax || item.quantity}</td>
                    <td>{item.description}</td>
                    <td>{formatAmount(String(poUnitPrice))}</td>
                    <td>{formatAmount(String(poAmount))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <section className="po-total">
            <span>Total Amount:</span>
            <strong>{formatAmount(String(amount))}</strong>
          </section>

          <section className="po-notes-grid">
            <div>
              <span>Hotel:</span>
              <strong>{selectedBooking.accommodation || selectedBooking.packageName || 'N/A'}</strong>
            </div>
            <div>
              <span>Flight Details:</span>
              <strong>{selectedBooking.flightDetails || 'N/A'}</strong>
            </div>
            <div>
              <span>Special Instructions:</span>
              <strong>
                {selectedBooking.specialInstructions || selectedBooking.notes || 'N/A'}
              </strong>
            </div>
          </section>

          <footer className="po-footer">
            Prepared By: {selectedBooking.preparedBy || authUser?.displayName || 'LLT Staff'}
          </footer>
        </section>
      </main>
    )
  }

  if (screen === 'voucher-preview') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Service voucher not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    const itineraryLines = getLines(selectedBooking.itinerary, [
      selectedBooking.itemDescription ||
        `Arrival and start of ${selectedBooking.packageName}`,
      'Free own leisure. Final reminders and departure arrangements.',
    ])
    const autoIncEx3 = computeInclusionsExclusions(selectedBooking.invoiceLineItemsJson)
    const inclusions = getLines(selectedBooking.inclusions || autoIncEx3.inclusions, [
      'Travel arrangement based on confirmed package',
      'Accommodation / service details as stated above',
      'Assistance from Lion and Lamb Travel',
    ])
    const exclusions = getLines(selectedBooking.exclusions || autoIncEx3.exclusions, [
      'Meals not stated',
      'Optional tours or personal expenses',
      'Other incidental charges not stated',
    ])
    const itineraryRows = itineraryLines.map((line, index) => ({
      date:
        index === 0
          ? selectedBooking.travelStart
            ? formatProjectDate(selectedBooking.travelStart)
            : `Day ${index + 1}`
          : index === itineraryLines.length - 1 && selectedBooking.travelEnd
            ? formatProjectDate(selectedBooking.travelEnd)
            : `Day ${index + 1}`,
      itinerary: line,
      hotel:
        selectedBooking.hotelAddress ||
        selectedBooking.accommodation ||
        selectedBooking.destination ||
        'Accommodation to be advised',
    }))

    return (
      <main className="preview-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Service Voucher Preview</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              className="nav-text-action"
              type="button"
              onClick={handlePrintPreview}
              title={isPdfExporting ? 'Preparing PDF...' : 'Download clean PDF'}
              disabled={isPdfExporting}
            >
              <Printer size={18} />
              <span>{isPdfExporting ? 'Preparing...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('booking-detail')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        <section className="voucher-preview print-document">
          <header className="voucher-header">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>LION AND LAMB TRAVEL</strong>
              <span>BLK C #7-17 OLONGAPO CITY PUBLIC MARKET</span>
              <span>Olongapo City, Philippines 2200</span>
              <span>travel_lionlamb@yahoo.com</span>
              <span>DOT No: R03 - TTA 013652023</span>
            </div>
            <img src={agencySeal} alt="DOT accreditation seal" />
          </header>

          <h1>Service Voucher</h1>

          <section className="voucher-meta">
            <div>
              <span>Date</span>
              <strong>{formatProjectDate(new Date().toISOString())}</strong>
            </div>
            <div>
              <span>Invoice</span>
              <strong>{selectedBooking.quotationNo || selectedBooking.id}</strong>
            </div>
          </section>

          <section className="voucher-party-grid">
            <div>
              <span>Package:</span>
              <strong>{selectedBooking.packageName}</strong>
              <small>
                Tour Date:{' '}
                {selectedBooking.travelStart
                  ? `${formatProjectDate(selectedBooking.travelStart)}${
                      selectedBooking.travelEnd
                        ? ` - ${formatProjectDate(selectedBooking.travelEnd)}`
                        : ''
                    }`
                  : 'TBA'}
              </small>
              <small>Flight Details: {selectedBooking.flightDetails || 'TBA'}</small>
              <small>
                Emergency Contact #: {selectedBooking.emergencyContact || 'TBA'}
              </small>
            </div>
            <div>
              <span>Client Details:</span>
              <strong>Name: {selectedBooking.clientName}</strong>
              <small>Guest Contact Number: {selectedBooking.contactNumber || 'TBA'}</small>
              <small>
                Accommodation:{' '}
                {selectedBooking.accommodation || selectedBooking.packageName || 'TBA'}
              </small>
            </div>
          </section>

          <table className="voucher-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Itinerary</th>
                <th>Hotel</th>
              </tr>
            </thead>
            <tbody>
              {itineraryRows.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{row.itinerary}</td>
                  <td>{row.hotel}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="voucher-lists document-checklists">
            <div className="included-list">
              <h2>Package Inclusions</h2>
              <ul>
                {inclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="excluded-list">
              <h2>Package Exclusions</h2>
              <ul>
                {exclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="voucher-reminders">
            <p>Itinerary may change depending on local weather condition or other unavoidable circumstances.</p>
            <p>For any flight schedule change or flight delays, please inform us immediately.</p>
            <p>Please be informed that whole period quarantine is needed and full charge for any cancellation, amendment, no show, or early check-out may apply.</p>
            <p>Any unused portion for land arrangement is non-refundable.</p>
            <p>All rights reserved by Lion and Lamb Travel if any changes occur without prior notice.</p>
            {selectedBooking.specialInstructions && (
              <p>{selectedBooking.specialInstructions}</p>
            )}
          </section>

          <section className="voucher-disclaimer">
            <strong>Disclaimer and Confidentiality Notice</strong>
            <p>
              Lion and Lamb Travel arranges travel services through independent
              vendors such as airlines, accommodation, transportation, tours, and
              related services. Confirmation vouchers are non-refundable,
              non-transferable, and subject to supplier rules and availability.
            </p>
          </section>

          <footer className="voucher-footer">
            Prepared By: {selectedBooking.preparedBy || authUser?.displayName || 'LLT Staff'}
          </footer>
        </section>
      </main>
    )
  }

  if (screen === 'breakdown-preview') {
    const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)

    if (!selectedBooking) {
      return (
        <main className="detail-screen">
          <section className="missing-detail">
            <FileText size={30} />
            <h1>Breakdown not found</h1>
            <button type="button" onClick={() => setScreen('home')}>
              Back to dashboard
            </button>
          </section>
        </main>
      )
    }

    const brkItems = readBreakdownItems(selectedBooking)

    // Parse pax-tier column labels (default matches the reference image)
    let colLabels = ['2 PAX', '5 PAX', 'PAX AND ABOVE', 'INFANT']
    try {
      const parsed = JSON.parse(selectedBooking.breakdownColLabels)
      if (Array.isArray(parsed) && parsed.length === 4) colLabels = parsed
    } catch {}

    // Parse pax counts per column for the TOTAL row
    // Auto-detect from label if it starts with a number (e.g. "2 PAX" → 2)
    let colPaxStored = ['', '', '', '']
    try {
      const parsed = JSON.parse(selectedBooking.breakdownPaxTiers)
      if (Array.isArray(parsed) && parsed.length === 4) colPaxStored = parsed
    } catch {}
    const colPax = colLabels.map((label, i) => {
      const match = label.match(/^(\d+)/)
      return match ? match[1] : colPaxStored[i]
    })

    const paxPriceFields: (keyof BreakdownLineItem)[] = ['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant']

    // Subtotals per column (sum of all price cells in that column)
    const subtotals = paxPriceFields.map((field) =>
      brkItems
        .filter((item) => !item.isPackageRow)
        .reduce((sum, item) => sum + parseAmount(item[field] as string), 0)
    )

    // Totals per column (subtotal × pax count for that column)
    const totals = subtotals.map((sub, i) => {
      const pax = parseQuantity(colPax[i])
      return sub * pax
    })

    return (
      <main className="preview-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Breakdown Preview</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              className="nav-text-action"
              type="button"
              onClick={handlePrintPreview}
              title={isPdfExporting ? 'Preparing PDF...' : 'Download clean PDF'}
              disabled={isPdfExporting}
            >
              <Printer size={18} />
              <span>{isPdfExporting ? 'Preparing...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('booking-detail')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        <section className="breakdown-preview print-document">
          {/* Header row */}
          <table className="breakdown-quotation-table">
            <thead>
              <tr className="bq-title-row">
                <th colSpan={2}>QUOTATION: {selectedBooking.quotationNo || selectedBooking.id}</th>
                <th colSpan={4} className="bq-amount-header">AMOUNT</th>
              </tr>
              <tr className="bq-info-row">
                <td className="bq-label">NAME:</td>
                <td className="bq-value">{selectedBooking.packageName}</td>
                <td rowSpan={4} colSpan={4} className="bq-amount-cell"></td>
              </tr>
              <tr className="bq-info-row">
                <td className="bq-label">DATE OF TRAVEL:</td>
                <td className="bq-value">
                  {selectedBooking.travelStart
                    ? `${formatProjectDate(selectedBooking.travelStart)}${selectedBooking.travelEnd ? ` - ${formatProjectDate(selectedBooking.travelEnd)}` : ''}`
                    : 'TBA'}
                </td>
              </tr>
              <tr className="bq-info-row">
                <td className="bq-label">NO OF PAX:</td>
                <td className="bq-value">{selectedBooking.pax || '—'}</td>
              </tr>
              <tr className="bq-info-row">
                <td className="bq-label">OPERATOR:</td>
                <td className="bq-value">{selectedBooking.supplier || ''}</td>
              </tr>
              <tr className="bq-col-header">
                <th>SERVICE</th>
                <th>DETAILS</th>
                {colLabels.map((label, i) => (
                  <th key={i} className={i === 3 ? 'bq-infant-col' : ''}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {brkItems.filter(item => !item.isPackageRow).map((item, index) => (
                <tr key={index} className="bq-data-row">
                  <td className="bq-service">{item.description.toUpperCase()}</td>
                  <td className="bq-details">{item.details || ''}</td>
                  {paxPriceFields.map((field, ci) => {
                    const val = parseAmount(item[field] as string)
                    return (
                      <td key={ci} className={`bq-price${val > 0 ? ' bq-has-value' : ''}${ci === 3 ? ' bq-infant-col' : ''}`}>
                        {val > 0 ? `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {/* SUBTOTAL row */}
              <tr className="bq-subtotal-row">
                <td colSpan={2}>SUBTOTAL:</td>
                {subtotals.map((val, i) => (
                  <td key={i} className={`bq-price${val > 0 ? ' bq-has-value' : ''}${i === 3 ? ' bq-infant-col' : ''}`}>
                    {val > 0 ? `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'}
                  </td>
                ))}
              </tr>
              {/* NO. OF PAX row */}
              <tr className="bq-pax-row">
                <td colSpan={2}>NO. OF PAX</td>
                {colPax.map((pax, i) => (
                  <td key={i} className={`bq-price${pax ? ' bq-has-value' : ''}${i === 3 ? ' bq-infant-col' : ''}`}>
                    {pax || ''}
                  </td>
                ))}
              </tr>
              {/* TOTAL row */}
              <tr className="bq-total-row">
                <td colSpan={2}>TOTAL:</td>
                {totals.map((val, i) => (
                  <td key={i} className={`bq-price${val > 0 ? ' bq-has-value' : ''}${i === 3 ? ' bq-infant-col' : ''}`}>
                    {val > 0 ? `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          <section className="internal-warning">
            <ListChecks size={20} />
            <p>
              Internal document only. Supplier nett, profit, and costing details
              must not appear on quotation, invoice, or service voucher PDFs.
            </p>
          </section>
        </section>
      </main>
    )
  }

  // Home / dashboard screen (default fallback)
  const activeProjects = bookings.length
  const inquiryCount = bookings.filter((b) => b.status === 'Inquiry').length
  const confirmedCount = bookings.filter((b) => b.status === 'Confirmed').length
  const invoiceCount = bookings.filter((b) => b.status === 'Invoice').length
  const quotationCount = bookings.filter((b) => b.status === 'Quotation' || b.status === 'Inquiry').length
  const totalBookingValue = bookings.reduce((sum, b) => sum + getBookingClientTotal(b), 0)

  const filteredBookings = (
    activeBookingFilter === 'All'
      ? bookings
      : bookings.filter((b) => b.status === activeBookingFilter)
  ).filter((b) => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return true
    return [b.clientName, b.packageName, b.destination, b.quotationNo, b.status]
      .join(' ').toLowerCase().includes(q)
  })

  const statusCounts = bookingListFilters.reduce(
    (acc, f) => ({
      ...acc,
      [f.value]: f.value === 'All'
        ? bookings.length
        : bookings.filter((b) => b.status === f.value).length,
    }),
    {} as Record<BookingListFilter, number>,
  )

  return (
    <main className="home-screen">
      <nav className="app-nav">
        <div className="nav-brand">
          <img src={logo} alt="Lion and Lamb Travel logo" />
          <div>
            <strong>Lion and Lamb Travel</strong>
            <span>Operations Desk</span>
          </div>
        </div>
        <div className="nav-actions">
          <button type="button" onClick={handleLogout} title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      <div className="home-body">
        {/* LEFT — hero + stats */}
        <section className="home-main">
          <section className="dashboard-banner">
            <img src={travelBanner} alt="" />
            <div className="dashboard-banner-overlay"></div>
            <div className="dashboard-banner-content">
              <div>
                <p>Operations dashboard</p>
                <h1>
                  Good day,{' '}
                  {authUser?.displayName ??
                    (authUser?.email ? getDisplayName(authUser.email) : 'Team Member')}
                </h1>
                <span>{activeProjects} active booking records</span>
              </div>
              <button
                type="button"
                className="create-project-btn"
                onClick={handleNewBooking}
              >
                <Plus size={20} />
                New Inquiry
              </button>
            </div>
          </section>

          <section className="dashboard-grid">
            <article className="summary-card teal" onClick={() => setActiveBookingFilter('Inquiry')} style={{ cursor: 'pointer' }}>
              <div className="summary-card-top">
                <div className="summary-icon blue">
                  <ClipboardList size={20} />
                </div>
                <span>Inquiries</span>
              </div>
              <strong>{inquiryCount}</strong>
              <small>Awaiting preparation</small>
            </article>
            <article className="summary-card gold" onClick={() => setActiveBookingFilter('Quotation')} style={{ cursor: 'pointer' }}>
              <div className="summary-card-top">
                <div className="summary-icon gold">
                  <Clock3 size={20} />
                </div>
                <span>Open Quotes</span>
              </div>
              <strong>{quotationCount}</strong>
              <small>Inquiry and quotation</small>
            </article>
            <article className="summary-card green" onClick={() => setActiveBookingFilter('Confirmed')} style={{ cursor: 'pointer' }}>
              <div className="summary-card-top">
                <div className="summary-icon green">
                  <CheckCircle2 size={20} />
                </div>
                <span>Confirmed</span>
              </div>
              <strong>{confirmedCount}</strong>
              <small>Ready for travel</small>
            </article>
          </section>

          <section className="pipeline-panel">
            <div className="pipeline-heading">
              <div>
                <p>Workflow</p>
                <h2>Booking pipeline</h2>
              </div>
              <span>{activeProjects} total</span>
            </div>
            <div className="pipeline-list">
              {bookingListFilters.slice(1).map((filter, index) => {
                const count = statusCounts[filter.value]
                const progress = activeProjects > 0 ? (count / activeProjects) * 100 : 0

                return (
                  <button
                    type="button"
                    key={filter.value}
                    className={`pipeline-row pipeline-${index + 1}`}
                    onClick={() => setActiveBookingFilter(filter.value)}
                  >
                    <span className="pipeline-dot"></span>
                    <span className="pipeline-name">{filter.label}</span>
                    <span className="pipeline-track">
                      <span style={{ width: `${progress}%` }}></span>
                    </span>
                    <strong>{count}</strong>
                    <ChevronRight size={16} />
                  </button>
                )
              })}
            </div>
          </section>
        </section>

        {/* RIGHT — bookings list */}
        <section className="projects-panel">
          <div className="section-heading">
            <div>
              <p style={{ margin: '0 0 3px', color: 'var(--teal)', fontWeight: 800, fontSize: '.72rem', letterSpacing: '.12em', textTransform: 'uppercase' }}>
                {activeBookingFilter === 'All' ? 'All records' : activeBookingFilter}
              </p>
              <h2>Booking workspace</h2>
            </div>
            <button type="button" className="login-btn create-project-btn" onClick={handleNewBooking} style={{ marginTop: 0 }}>
              <Plus size={16} />
            </button>
          </div>

          {dataError && <p className="data-alert error">{dataError}</p>}
          {dataMessage && <p className="data-alert info">{dataMessage}</p>}

          <label className="booking-search">
            <Search size={16} />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search client, package, destination…"
            />
            {searchTerm.trim() && (
              <button type="button" className="clear-search-btn" onClick={() => setSearchTerm('')} title="Clear">
                <X size={14} />
              </button>
            )}
          </label>

          <div className="booking-tabs" role="tablist">
            {bookingListFilters.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={activeBookingFilter === f.value}
                className={activeBookingFilter === f.value ? 'active' : ''}
                onClick={() => setActiveBookingFilter(f.value)}
              >
                <span>{f.label}</span>
                <strong>{statusCounts[f.value]}</strong>
              </button>
            ))}
          </div>

          <div className="project-list">
            {filteredBookings.length === 0 && (
              <div className="empty-list">
                <FileText size={26} />
                <strong>{searchTerm.trim() ? 'No matching records' : 'No records yet'}</strong>
                <span>
                  {searchTerm.trim()
                    ? 'Try a different client name, package, or quotation number.'
                    : 'New inquiries saved here will appear after data gathering.'}
                </span>
              </div>
            )}
            {filteredBookings.map((booking) => (
              <button
                key={booking.id}
                type="button"
                className={`project-card status-${booking.status.toLowerCase().replaceAll(' ', '-')}`}
                onClick={() => openBookingDetail(booking.id)}
              >
                <div className="project-main">
                  <div className="project-icon"><FileText size={20} /></div>
                  <div>
                    <strong>{booking.packageName}</strong>
                    <span>{booking.clientName}</span>
                  </div>
                </div>
                <div className="project-meta">
                  <span className="status-pill">{booking.status}</span>
                  <span><CalendarDays size={14} />{formatProjectDate(booking.createdAt)}</span>
                  <span><MapPin size={14} />{formatAmount(String(getBookingClientTotal(booking)))}</span>
                  <ChevronRight size={17} />
                </div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)', fontSize: '.78rem', fontWeight: 700 }}>
              {filteredBookings.length} record{filteredBookings.length !== 1 ? 's' : ''}
              {activeBookingFilter !== 'All' ? ` · ${activeBookingFilter}` : ''}
            </span>
            <span style={{ color: 'var(--teal)', fontSize: '.78rem', fontWeight: 800 }}>
              {formatAmount(String(totalBookingValue))} total
            </span>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
