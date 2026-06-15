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
  quantity: string
  unitPrice: string
  nettCost: string
  sendToInvoice: boolean
  isPackageRow?: boolean
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
    
    const booking: BookingRecord = {
      ...bookingForm,
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
    
    // Internal dynamically updated dashboard totals indicators
    const displayTotalClient = getBookingClientTotal(bookingForm)
    const displayTotalNett = getBookingBreakdownNettTotal(bookingForm)
    const displayTotalProfit = displayTotalClient - displayTotalNett

    return (
      <main className="data-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div><strong>Lion and Lamb Travel</strong><span>{isEditingBooking ? 'Edit Booking' : 'Data Gathering'}</span></div>
          </div>
          <div className="nav-actions">
            <button type="button" onClick={() => { setEditingBookingId(''); setScreen(isEditingBooking ? 'booking-detail' : 'home') }} title="Close">
              <X size={18} />
            </button>
          </div>
        </nav>

        <form className="data-form" onSubmit={handleSaveBooking}>
          <header className="data-form-header">
            <div>
              <p>{isEditingBooking ? 'Update master record' : 'New inquiry'}</p>
              <h1>{isEditingBooking ? 'Edit Booking Info' : 'Data Gathering Form'}</h1>
              <span>Configure individual settings for separate workflow views seamlessly from a single terminal interface.</span>
            </div>
            <button type="submit" className="save-booking-btn">
              <Save size={18} /> {isEditingBooking ? 'Save Changes' : 'Save Inquiry'}
            </button>
          </header>

          {dataError && <p className="data-alert error">{dataError}</p>}
          {dataMessage && <p className="data-alert info">{dataMessage}</p>}

          <section className="form-section">
            <div className="form-section-heading"><p>01 · Client</p><h2>Client info</h2></div>
            <div className="field-grid three">
              <label>Client name <input required value={bookingForm.clientName} onChange={(event) => updateBookingField('clientName', event.target.value)} placeholder="Ms. Joanna Pico" /></label>
              <label>Contact number <input value={bookingForm.contactNumber} onChange={(event) => updateBookingField('contactNumber', event.target.value)} placeholder="09xxxxxxxxx" /></label>
              <label>Email <input type="email" value={bookingForm.clientEmail} onChange={(event) => updateBookingField('clientEmail', event.target.value)} placeholder="client@email.com" /></label>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading"><p>02 · Travel</p><h2>Package details</h2></div>
            <div className="field-grid three">
              <label>Package name <input required value={bookingForm.packageName} onChange={(event) => updateBookingField('packageName', event.target.value)} placeholder="3D2N Clark and Olongapo" /></label>
              <label>Destination <input value={bookingForm.destination} onChange={(event) => updateBookingField('destination', event.target.value)} placeholder="Clark, Boracay, Hong Kong" /></label>
              <label>No. of pax <input value={bookingForm.pax} onChange={(event) => updateBookingField('pax', event.target.value)} placeholder="2 adults, 1 infant" /></label>
              <label>Travel start <input type="date" value={bookingForm.travelStart} onChange={(event) => updateBookingField('travelStart', event.target.value)} /></label>
              <label>Travel end <input type="date" value={bookingForm.travelEnd} onChange={(event) => updateBookingField('travelEnd', event.target.value)} /></label>
              <label>Status 
                <select value={bookingForm.status} onChange={(event) => updateBookingField('status', event.target.value as BookingStatus)}>
                  <option>Inquiry</option><option>Breakdown</option><option>Quotation</option><option>Purchase Order</option><option>Invoice</option><option>Confirmed</option>
                </select>
              </label>
            </div>
          </section>

          {/* NEW DYNAMIC QUOTATION SECTION */}
          <section className="form-section">
            <div className="form-section-heading"><p>03 · Quotation</p><h2>Basic</h2></div>
            <div className="field-grid three">
              <label>Quotation no. <input value={bookingForm.quotationNo} onChange={(event) => updateBookingField('quotationNo', event.target.value)} placeholder="QT-2026-0001" /></label>
              <label>Option date <input type="date" value={bookingForm.optionDate} onChange={(event) => updateBookingField('optionDate', event.target.value)} /></label>
              <label>Prepared by <input value={bookingForm.preparedBy} onChange={(event) => updateBookingField('preparedBy', event.target.value)} placeholder="Agent Name" /></label>
            </div>
            
            <div className="itemized-container" style={{ marginTop: '1.5rem' }}>
              <div className="itemized-header" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', fontWeight: 'bold', paddingBottom: '0.5rem', borderBottom: '1px solid #ddd' }}>
                <span>Package Name</span>
                <span>QTY</span>
                <span>Client Price</span>
              </div>
              <div className="itemized-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginTop: '0.5rem', alignItems: 'center' }}>
                <input style={{ background: '#f5f5f5', cursor: 'not-allowed' }} disabled value={bookingForm.packageName || '(Set Package Name above)'} />
                <input type="number" min="1" value={bookingForm.quantity || '1'} onChange={(e) => updateBookingField('quantity', e.target.value)} placeholder="1" />
                <input type="text" value={bookingForm.unitPrice} onChange={(e) => updateBookingField('unitPrice', e.target.value)} placeholder="0.00" />
              </div>
              <p className="field-help" style={{ marginTop: '0.5rem', color: '#666' }}>
                This is the simple client quotation price. Nett/supplier costs are handled in the invoice add-ons and internal breakdown.
              </p>
            </div>
          </section>

          {/* NEW INVOICE SECTION */}
          <section className="form-section">
            <div className="form-section-heading"><p>04 · Invoice</p><h2>Basic / Optional</h2></div>
            <p className="field-help" style={{ marginBottom: '1rem' }}>Service / Item rows shown here are client-visible. The package is already included; add optional items only when needed.</p>
            
            <div className="itemized-container">
              <div className="itemized-header" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '0.5rem', fontWeight: 'bold', paddingBottom: '0.5rem', borderBottom: '1px solid #ddd' }}>
                <span>Service / Item</span>
                <span>QTY</span>
                <span>Client Price</span>
                <span>Supplier Nett</span>
                <span></span>
              </div>
              
              {currentInvoiceItems.map((item, index) => (
                <div key={index} className="itemized-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                  {item.isPackageRow ? (
                    <input style={{ background: '#f5f5f5', cursor: 'not-allowed' }} disabled value={bookingForm.packageName ? `${bookingForm.packageName} (Package Name)` : 'Basic Package'} />
                  ) : (
                    <select value={item.description} onChange={(e) => changeInvoiceItemField(index, 'description', e.target.value)}>
                      {invoiceOptions.map((opt, oIdx) => <option key={oIdx} value={opt}>{opt}</option>)}
                    </select>
                  )}
                  
                  <input type="number" min="1" value={item.quantity} onChange={(e) => changeInvoiceItemField(index, 'quantity', e.target.value)} />
                  <input type="text" value={item.unitPrice} onChange={(e) => changeInvoiceItemField(index, 'unitPrice', e.target.value)} placeholder="0.00" />
                  
                  {item.isPackageRow ? (
                    <input style={{ background: '#f5f5f5', cursor: 'not-allowed', color: '#999' }} disabled value="N/A" />
                  ) : (
                    <input type="text" value={item.nettCost} onChange={(e) => changeInvoiceItemField(index, 'nettCost', e.target.value)} placeholder="0.00" />
                  )}

                  {!item.isPackageRow ? (
                    <button type="button" className="remove-item-btn" onClick={() => removeInvoiceItemRow(index)} style={{ padding: '4px', background: '#ff4d4d', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>×</button>
                  ) : <span />}
                </div>
              ))}

              <button type="button" className="add-item-btn" onClick={addInvoiceItemRow} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '1rem', padding: '0.5rem 1rem', background: '#008080', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                <Plus size={16} /> Add New Item
              </button>
            </div>
          </section>

          {/* NEW BREAKDOWN SECTION */}
          <section className="form-section">
            <div className="form-section-heading"><p>05 · Breakdown</p><h2>Charges / Optional</h2></div>
            <p className="field-help" style={{ marginBottom: '1rem' }}>Service / Item rows here are for internal costing. Turn on "Show" only when a breakdown row should also appear in the invoice.</p>
            
            <div className="itemized-container">
              <div className="itemized-header" style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 1fr 1fr 1.2fr 40px', gap: '0.5rem', fontWeight: 'bold', paddingBottom: '0.5rem', borderBottom: '1px solid #ddd' }}>
                <span>Service / Item</span>
                <span>QTY</span>
                <span>Client Price</span>
                <span>Supplier Nett</span>
                <span style={{ textAlign: 'center' }}>Send To Invoice?</span>
                <span></span>
              </div>

              {currentBreakdownItems.map((item, index) => (
                <div key={index} className="itemized-row" style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 1fr 1fr 1.2fr 40px', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                  {item.isPackageRow ? (
                    <input style={{ background: '#f5f5f5', cursor: 'not-allowed' }} disabled value={`Calculated from Invoice: ${bookingForm.packageName || 'Basic Package'}`} />
                  ) : (
                    <select value={item.description} onChange={(e) => changeBreakdownItemField(index, 'description', e.target.value)}>
                      {breakdownOptions.map((opt, oIdx) => <option key={oIdx} value={opt}>{opt}</option>)}
                    </select>
                  )}

                  <input type="number" min="1" disabled={item.isPackageRow} style={item.isPackageRow ? { background: '#f5f5f5' } : {}} value={item.quantity} onChange={(e) => changeBreakdownItemField(index, 'quantity', e.target.value)} />
                  <input type="text" disabled={item.isPackageRow} style={item.isPackageRow ? { background: '#f5f5f5' } : {}} value={item.unitPrice} onChange={(e) => changeBreakdownItemField(index, 'unitPrice', e.target.value)} placeholder="0.00" />
                  <input type="text" value={item.nettCost} onChange={(e) => changeBreakdownItemField(index, 'nettCost', e.target.value)} placeholder="0.00" />

                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      onClick={() => changeBreakdownItemField(index, 'sendToInvoice', !item.sendToInvoice)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #ccc',
                        background: item.sendToInvoice ? '#e6f7ff' : '#fff',
                        color: item.sendToInvoice ? '#1890ff' : '#666',
                        cursor: 'pointer'
                      }}
                    >
                      {item.sendToInvoice ? <Eye size={14} /> : <EyeOff size={14} />}
                      <span style={{ fontSize: '11px' }}>{item.sendToInvoice ? 'Showing' : 'Hidden'}</span>
                    </button>
                  </div>

                  {!item.isPackageRow ? (
                    <button type="button" className="remove-item-btn" onClick={() => removeBreakdownItemRow(index)} style={{ padding: '4px', background: '#ff4d4d', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>×</button>
                  ) : <span />}
                </div>
              ))}

              <button type="button" className="add-item-btn" onClick={addBreakdownItemRow} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '1rem', padding: '0.5rem 1rem', background: '#2575fc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                <Plus size={16} /> Add Item
              </button>
            </div>

            <div className="form-summary-card" style={{ marginTop: '1.5rem', padding: '1rem', background: '#f9f9f9', borderRadius: '6px', border: '1px solid #eee' }}>
              <h3>Live Cost and Profit Summary</h3>
              <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
                <div><strong>Invoice Client Total:</strong> <span style={{ color: '#2e7d32' }}>{formatAmount(String(displayTotalClient))}</span></div>
                <div><strong>Internal Nett Total:</strong> <span style={{ color: '#c62828' }}>{formatAmount(String(displayTotalNett))}</span></div>
                <div><strong>Estimated Profit:</strong> <span style={{ color: '#1565c0', fontWeight: 'bold' }}>{formatAmount(String(displayTotalProfit))}</span></div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading"><p>06 · Logistics</p><h2>Fulfillment context</h2></div>
            <div className="field-grid two">
              <label>Flight details <textarea rows={3} value={bookingForm.flightDetails} onChange={(event) => updateBookingField('flightDetails', event.target.value)} placeholder="MNL-MPH PR2041 0800AM, MPH-MNL PR2042 0500PM" /></label>
              <label>Accommodation details <textarea rows={3} value={bookingForm.accommodation} onChange={(event) => updateBookingField('accommodation', event.target.value)} placeholder="Henann Regency Beach Resort (Superior Room)" /></label>
              <label>Hotel location address <textarea rows={2} value={bookingForm.hotelAddress} onChange={(event) => updateBookingField('hotelAddress', event.target.value)} placeholder="Station 2, Balabag, Boracay Island, Malay, Aklan" /></label>
              <label>Emergency local contact <textarea rows={2} value={bookingForm.emergencyContact} onChange={(event) => updateBookingField('emergencyContact', event.target.value)} placeholder="Hotel Front Desk: (036) 288-6111" /></label>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading"><p>07 · Inclusions</p><h2>Document line specifications</h2></div>
            <div className="field-grid two">
              <label>Inclusions <textarea rows={4} value={bookingForm.inclusions} onChange={(event) => updateBookingField('inclusions', event.target.value)} placeholder="Daily Breakfast&#10;Roundtrip Airport Transfers&#10;Free Wi-Fi access" /></label>
              <label>Exclusions <textarea rows={4} value={bookingForm.exclusions} onChange={(event) => updateBookingField('exclusions', event.target.value)} placeholder="Tipping for Tour Guide&#10;Personal spending money&#10;Travel insurance" /></label>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading"><p>08 · Schedule</p><h2>Itinerary roadmap</h2></div>
            <label>Daily routing schedule <textarea rows={6} value={bookingForm.itinerary} onChange={(event) => updateBookingField('itinerary', event.target.value)} placeholder="Day 1: Arrival at Caticlan Airport, Transfer to Resort, Free Time&#10;Day 2: Boracay Island Hopping Tour with Lunch&#10;Day 3: Breakfast, Free Time until checkout, Departure transfer" /></label>
          </section>

          <section className="form-section">
            <div className="form-section-heading"><p>09 · Remarks</p><h2>Internal operations index</h2></div>
            <div className="field-grid two">
              <label>Special client requests <textarea rows={3} value={bookingForm.specialInstructions} onChange={(event) => updateBookingField('specialInstructions', event.target.value)} placeholder="Requesting high floor rooms if available. Senior friendly pacing." /></label>
              <label>Private desk notes <textarea rows={3} value={bookingForm.notes} onChange={(event) => updateBookingField('notes', event.target.value)} placeholder="Supplier confirmed rate lock until next Friday only." /></label>
            </div>
          </section>

          <footer className="form-actions-bar">
            <button type="button" className="cancel-form-btn" onClick={() => { setEditingBookingId(''); setScreen(isEditingBooking ? 'booking-detail' : 'home') }}>Cancel changes</button>
            <button type="submit" className="save-booking-btn"><Save size={18} /> {isEditingBooking ? 'Save Changes' : 'Save Booking Record'}</button>
          </footer>
        </form>
      </main>
    )
  }

  // Fallback rendering structure for other screens remains unchanged
  return (
    <main className="dashboard-layout" style={{ padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1>Lion and Lamb Travel Dashboard</h1>
          <p>Logged in as: {authUser?.email}</p>
        </div>
        <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: '#333', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}><LogOut size={16} /> Log Out</button>
      </header>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <input type="text" placeholder="Search client name or packages..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: '0.5rem', width: '300px', borderRadius: '4px', border: '1px solid #ccc' }} />
        <button onClick={handleNewBooking} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem 1rem', background: '#2575fc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}><Plus size={16} /> Create New Record</button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {bookingListFilters.map((f, idx) => (
          <button key={idx} onClick={() => setActiveBookingFilter(f.value)} style={{ padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid #ccc', background: activeBookingFilter === f.value ? '#2575fc' : '#fff', color: activeBookingFilter === f.value ? '#fff' : '#333', cursor: 'pointer' }}>{f.label}</button>
        ))}
      </div>

      <section style={{ display: 'grid', gap: '1rem' }}>
        {bookings
          .filter(b => activeBookingFilter === 'All' || b.status === activeBookingFilter)
          .filter(b => b.clientName.toLowerCase().includes(searchTerm.toLowerCase()) || b.packageName.toLowerCase().includes(searchTerm.toLowerCase()))
          .map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#fff', borderRadius: '6px', border: '1px solid #eee', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <div>
                <h3 style={{ margin: 0 }}>{b.packageName}</h3>
                <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '14px' }}>Client: {b.clientName} | Status: <strong style={{ color: '#008080' }}>{b.status}</strong></p>
              </div>
              <button onClick={() => { setSelectedBookingId(b.id); handleEditBooking(); }} style={{ padding: '0.4rem 0.8rem', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>Edit Form</button>
            </div>
        ))}
      </section>
    </main>
  )
}

export default App
