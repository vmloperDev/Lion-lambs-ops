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
} from 'lucide-react'
import { auth } from './firebase'
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
  itemDescription: string
  quantity: string
  unitPrice: string
  supplier: string
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

const bookingStorageKey = 'lion-lamb-bookings'
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
  itemDescription: '',
  quantity: '1',
  unitPrice: '',
  supplier: '',
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
  itemDescription: project.title,
  quantity: '1',
  unitPrice: '',
  supplier: '',
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

function getStoredBookings() {
  const storedBookings = window.localStorage.getItem(bookingStorageKey)

  if (!storedBookings) {
    return sampleBookings
  }

  try {
    return JSON.parse(storedBookings) as BookingRecord[]
  } catch {
    return sampleBookings
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
  const passwordStrength = getPasswordStrength(password)

  useEffect(() => {
    return onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      setAuthUser(user)
      setIsAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    window.localStorage.setItem(bookingStorageKey, JSON.stringify(bookings))
  }, [bookings])

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
      typeof error === 'object' && error && 'code' in error
        ? (error as AuthError).code
        : ''

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

    if (!email.trim()) {
      setAuthError('Enter your email address to continue.')
      return
    }

    if (!password.trim()) {
      setAuthError('Enter your password to continue.')
      return
    }

    if (isSignUp && !name.trim()) {
      setAuthError('Enter your full name to create an account.')
      return
    }

    if (isSignUp && password !== confirmPassword) {
      setAuthError('Password and confirm password do not match.')
      return
    }

    if (isSignUp && passwordStrength.score === 1) {
      setAuthError('Use a stronger password before creating the account.')
      return
    }

    try {
      setIsAuthLoading(true)

      if (isSignUp) {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        )
        await updateProfile(credential.user, {
          displayName: name.trim() || getDisplayName(email),
        })
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
    if (!email.trim()) {
      setAuthError('Enter your email address first.')
      setAuthMessage('')
      return
    }

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
      setAuthError('Log in again before requesting a new verification email.')
      setAuthMessage('')
      setScreen('login')
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
    if (!auth.currentUser) {
      setScreen('login')
      return
    }

    try {
      setIsAuthLoading(true)
      await auth.currentUser.reload()
      const refreshedUser = auth.currentUser
      setAuthUser(refreshedUser)

      if (refreshedUser?.emailVerified) {
        setAuthError('')
        setAuthMessage('')
        setScreen('home')
      } else {
        setAuthError('Email is not verified yet.')
        setAuthMessage('')
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
    setBookingForm({
      ...emptyBookingForm,
      quotationNo: `QT-${new Date().getFullYear()}-${String(bookings.length + 1).padStart(4, '0')}`,
    })
    setScreen('data-form')
  }

  function updateBookingField<Field extends keyof BookingFormData>(
    field: Field,
    value: BookingFormData[Field],
  ) {
    setBookingForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function handleSaveBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const booking: BookingRecord = {
      ...bookingForm,
      id: `BK-${Date.now()}`,
      createdAt: new Date().toISOString(),
    }

    setBookings((currentBookings) => [booking, ...currentBookings])
    setScreen('home')
  }

  function openBookingDetail(bookingId: string) {
    setSelectedBookingId(bookingId)
    setScreen('booking-detail')
  }

  function updateSelectedBookingStatus(status: BookingStatus) {
    setBookings((currentBookings) =>
      currentBookings.map((booking) =>
        booking.id === selectedBookingId ? { ...booking, status } : booking,
      ),
    )
  }

  function openQuotationPreview() {
    updateSelectedBookingStatus('Quotation')
    setScreen('quotation-preview')
  }

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
    updateSelectedBookingStatus('Invoice')
    setScreen('invoice-editor')
  }

  function updateInvoiceField<Field extends keyof typeof invoiceForm>(
    field: Field,
    value: (typeof invoiceForm)[Field],
  ) {
    setInvoiceForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function handleSaveInvoiceUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBookings((currentBookings) =>
      currentBookings.map((booking) =>
        booking.id === selectedBookingId
          ? {
              ...booking,
              ...invoiceForm,
              status: 'Invoice',
            }
          : booking,
      ),
    )
    setScreen('invoice-preview')
  }

  function openPurchaseOrderPreview() {
    updateSelectedBookingStatus('Purchase Order')
    setScreen('purchase-order-preview')
  }

  function openVoucherPreview() {
    updateSelectedBookingStatus('Confirmed')
    setScreen('voucher-preview')
  }

  function openBreakdownPreview() {
    updateSelectedBookingStatus('Breakdown')
    setScreen('breakdown-preview')
  }

  function handlePrintPreview() {
    window.print()
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
                {isSignUp
                  ? 'Create your operations account for booking management.'
                  : 'Access quotations, invoices, and customer projects.'}
              </span>
            </div>

            <form onSubmit={handleEmailAuth} className="login-form">
              {isSignUp && (
                <label>
                  <UserRound size={17} />
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                      setAuthError('')
                      setAuthMessage('')
                    }}
                    placeholder="Full name"
                    autoComplete="name"
                  />
                </label>
              )}

              <label>
                <Mail size={17} />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setAuthError('')
                    setAuthMessage('')
                  }}
                  placeholder="Email"
                  autoComplete="email"
                />
              </label>
              {!isSignUp && (
                <div className="password-row-meta">
                  <span>Password</span>
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={isAuthLoading}
                  >
                    Forgot password?
                  </button>
                </div>
              )}
              <label>
                <LockKeyhole size={17} />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setAuthError('')
                    setAuthMessage('')
                  }}
                  placeholder="Password"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                />
              </label>

              {isSignUp && (
                <>
                  <label>
                    <LockKeyhole size={17} />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value)
                        setAuthError('')
                        setAuthMessage('')
                      }}
                      placeholder="Confirm password"
                      autoComplete="new-password"
                    />
                  </label>

                  {password && (
                    <div
                      className={`password-strength score-${passwordStrength.score}`}
                    >
                      <div>
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <strong>{passwordStrength.label}</strong>
                    </div>
                  )}
                </>
              )}

              {authError && <p className="auth-error">{authError}</p>}
              {authMessage && <p className="auth-success">{authMessage}</p>}

              <div className="form-meta">
                <span>
                  {isSignUp
                    ? 'Already part of the team?'
                    : 'Firebase keeps trusted sessions signed in.'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setScreen(isSignUp ? 'login' : 'signup')
                    setAuthError('')
                    setAuthMessage('')
                  }}
                >
                  {isSignUp ? 'Log in instead' : 'Create account'}
                </button>
              </div>

              <button className="login-btn" type="submit" disabled={isAuthLoading}>
                {isAuthLoading
                  ? 'Please wait'
                  : isSignUp
                    ? 'Sign Up'
                    : 'Log In'}
                <ArrowRight size={18} />
              </button>
            </form>
          </div>

          <aside className="auth-image-panel">
            <img src={travelHero} alt="Travel destinations collage" />
            <div className="image-overlay">
              <div className="floating-icon">
                <Plane size={26} />
              </div>
              <h2>Organize every client journey.</h2>
              <p>
                Prepare quotations, invoices, and travel records from one
                professional workspace.
              </p>
              <div className="slide-dots">
                <span></span>
                <span className="active"></span>
                <span></span>
              </div>
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
              <div>
                <strong>Lion and Lamb Travel</strong>
                <span>Operations Desk</span>
              </div>
            </div>

            <div className="auth-heading">
              <p>Email verification</p>
              <h1>Check your inbox</h1>
              <span>
                We sent a verification link to {authUser?.email ?? email}. Verify
                that email before opening the dashboard.
              </span>
            </div>

            <div className="verify-actions">
              {authError && <p className="auth-error">{authError}</p>}
              {authMessage && <p className="auth-success">{authMessage}</p>}

              <button
                className="login-btn"
                type="button"
                onClick={handleVerificationRefresh}
                disabled={isAuthLoading}
              >
                {isAuthLoading ? 'Checking' : 'I verified my email'}
                <RefreshCw size={18} />
              </button>

              <button
                className="secondary-auth-btn"
                type="button"
                onClick={handleResendVerification}
                disabled={isAuthLoading}
              >
                Resend verification email
              </button>

              <button
                className="secondary-auth-btn"
                type="button"
                onClick={handleLogout}
                disabled={isAuthLoading}
              >
                Use another account
              </button>
            </div>
          </div>

          <aside className="auth-image-panel">
            <img src={travelHero} alt="Travel destinations collage" />
            <div className="image-overlay">
              <div className="floating-icon">
                <Mail size={26} />
              </div>
              <h2>Secure access for the team.</h2>
              <p>
                Only verified email accounts can open the operations dashboard.
              </p>
            </div>
          </aside>
        </section>
      </main>
    )
  }

  if (screen === 'data-form') {
    return (
      <main className="data-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Data Gathering</span>
            </div>
          </div>
          <div className="nav-actions">
            <button type="button" onClick={() => setScreen('home')} title="Close">
              <X size={18} />
            </button>
          </div>
        </nav>

        <form className="data-form" onSubmit={handleSaveBooking}>
          <header className="data-form-header">
            <div>
              <p>New booking inquiry</p>
              <h1>Data Gathering Form</h1>
              <span>
                Capture the master details once. Later documents will use only
                the fields meant for each output.
              </span>
            </div>
            <button type="submit" className="save-booking-btn">
              <Save size={18} />
              Save Inquiry
            </button>
          </header>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Client</p>
              <h2>Client info</h2>
            </div>
            <div className="field-grid three">
              <label>
                Client name
                <input
                  required
                  value={bookingForm.clientName}
                  onChange={(event) =>
                    updateBookingField('clientName', event.target.value)
                  }
                  placeholder="Ms. Joanna Pico"
                />
              </label>
              <label>
                Contact number
                <input
                  value={bookingForm.contactNumber}
                  onChange={(event) =>
                    updateBookingField('contactNumber', event.target.value)
                  }
                  placeholder="09xxxxxxxxx"
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={bookingForm.clientEmail}
                  onChange={(event) =>
                    updateBookingField('clientEmail', event.target.value)
                  }
                  placeholder="client@email.com"
                />
              </label>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Travel</p>
              <h2>Package details</h2>
            </div>
            <div className="field-grid three">
              <label>
                Package name
                <input
                  required
                  value={bookingForm.packageName}
                  onChange={(event) =>
                    updateBookingField('packageName', event.target.value)
                  }
                  placeholder="3D2N Clark and Olongapo"
                />
              </label>
              <label>
                Destination
                <input
                  value={bookingForm.destination}
                  onChange={(event) =>
                    updateBookingField('destination', event.target.value)
                  }
                  placeholder="Clark, Boracay, Hong Kong"
                />
              </label>
              <label>
                No. of pax
                <input
                  value={bookingForm.pax}
                  onChange={(event) => updateBookingField('pax', event.target.value)}
                  placeholder="2 adults, 1 infant"
                />
              </label>
              <label>
                Travel start
                <input
                  type="date"
                  value={bookingForm.travelStart}
                  onChange={(event) =>
                    updateBookingField('travelStart', event.target.value)
                  }
                />
              </label>
              <label>
                Travel end
                <input
                  type="date"
                  value={bookingForm.travelEnd}
                  onChange={(event) =>
                    updateBookingField('travelEnd', event.target.value)
                  }
                />
              </label>
              <label>
                Status
                <select
                  value={bookingForm.status}
                  onChange={(event) =>
                    updateBookingField('status', event.target.value as BookingStatus)
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
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Quotation</p>
              <h2>Client-facing quote basics</h2>
            </div>
            <div className="field-grid four">
              <label>
                Quotation no.
                <input
                  value={bookingForm.quotationNo}
                  onChange={(event) =>
                    updateBookingField('quotationNo', event.target.value)
                  }
                  placeholder="QTHK26031-04"
                />
              </label>
              <label className="wide-field">
                Item description
                <input
                  required
                  value={bookingForm.itemDescription}
                  onChange={(event) =>
                    updateBookingField('itemDescription', event.target.value)
                  }
                  placeholder="3D2N Hong Kong Free and Easy"
                />
              </label>
              <label>
                Quantity
                <input
                  inputMode="numeric"
                  value={bookingForm.quantity}
                  onChange={(event) =>
                    updateBookingField('quantity', event.target.value)
                  }
                  placeholder="2"
                />
              </label>
              <label>
                Unit price
                <input
                  inputMode="decimal"
                  value={bookingForm.unitPrice}
                  onChange={(event) =>
                    updateBookingField('unitPrice', event.target.value)
                  }
                  placeholder="18888"
                />
              </label>
            </div>
          </section>

          <section className="form-section internal-section">
            <div className="form-section-heading">
              <p>Internal</p>
              <h2>Supplier and costing</h2>
            </div>
            <div className="field-grid three">
              <label>
                Supplier / operator
                <input
                  value={bookingForm.supplier}
                  onChange={(event) =>
                    updateBookingField('supplier', event.target.value)
                  }
                  placeholder="Vendor or tour operator"
                />
              </label>
              <label>
                Nett cost
                <input
                  inputMode="decimal"
                  value={bookingForm.nettCost}
                  onChange={(event) =>
                    updateBookingField('nettCost', event.target.value)
                  }
                  placeholder="Internal only"
                />
              </label>
              <label>
                Selling price
                <input
                  inputMode="decimal"
                  value={bookingForm.sellingPrice}
                  onChange={(event) =>
                    updateBookingField('sellingPrice', event.target.value)
                  }
                  placeholder="Client price"
                />
              </label>
            </div>
            <p className="internal-note">
              Internal costing is for breakdown only and must not appear on
              client-facing quotation or voucher documents.
            </p>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Invoice</p>
              <h2>Payment details</h2>
            </div>
            <div className="field-grid three">
              <label>
                Payment method
                <input
                  value={bookingForm.paymentMethod}
                  onChange={(event) =>
                    updateBookingField('paymentMethod', event.target.value)
                  }
                  placeholder="Bank transfer, cash, GCash"
                />
              </label>
              <label>
                Amount paid
                <input
                  value={bookingForm.invoiceAmountPaid}
                  onChange={(event) =>
                    updateBookingField('invoiceAmountPaid', event.target.value)
                  }
                  placeholder="PHP 0.00"
                />
              </label>
              <label>
                Payment status
                <select
                  value={bookingForm.invoicePaymentStatus}
                  onChange={(event) =>
                    updateBookingField('invoicePaymentStatus', event.target.value)
                  }
                >
                  <option>Unpaid</option>
                  <option>Partially Paid</option>
                  <option>Paid</option>
                </select>
              </label>
            </div>
            <div className="field-grid three">
              <label>
                Payment date
                <input
                  type="date"
                  value={bookingForm.invoicePaymentDate}
                  onChange={(event) =>
                    updateBookingField('invoicePaymentDate', event.target.value)
                  }
                />
              </label>
              <label>
                Payment reference
                <input
                  value={bookingForm.invoiceReference}
                  onChange={(event) =>
                    updateBookingField('invoiceReference', event.target.value)
                  }
                  placeholder="OR / bank ref / GCash ref"
                />
              </label>
              <label>
                Option date
                <input
                  type="date"
                  value={bookingForm.optionDate}
                  onChange={(event) =>
                    updateBookingField('optionDate', event.target.value)
                  }
                />
              </label>
            </div>
            <div className="field-grid three">
              <label>
                Prepared by
                <input
                  value={bookingForm.preparedBy}
                  onChange={(event) =>
                    updateBookingField('preparedBy', event.target.value)
                  }
                  placeholder="Staff name"
                />
              </label>
            </div>
            <label className="textarea-field">
              Payment records
              <textarea
                value={bookingForm.paymentRecords}
                onChange={(event) =>
                  updateBookingField('paymentRecords', event.target.value)
                }
                placeholder="One payment update per line, e.g. DP MAR 3 PAID - PHP 40,000"
              />
            </label>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Voucher</p>
              <h2>Travel confirmation details</h2>
            </div>
            <div className="field-grid three">
              <label>
                Flight details
                <input
                  value={bookingForm.flightDetails}
                  onChange={(event) =>
                    updateBookingField('flightDetails', event.target.value)
                  }
                  placeholder="CRK-HKG 07:00AM"
                />
              </label>
              <label>
                Accommodation
                <input
                  value={bookingForm.accommodation}
                  onChange={(event) =>
                    updateBookingField('accommodation', event.target.value)
                  }
                  placeholder="Hotel / resort name"
                />
              </label>
              <label>
                Emergency contact
                <input
                  value={bookingForm.emergencyContact}
                  onChange={(event) =>
                    updateBookingField('emergencyContact', event.target.value)
                  }
                  placeholder="Emergency contact number"
                />
              </label>
            </div>
            <label className="textarea-field">
              Hotel address
              <textarea
                value={bookingForm.hotelAddress}
                onChange={(event) =>
                  updateBookingField('hotelAddress', event.target.value)
                }
                placeholder="Full hotel address for voucher"
              />
            </label>
            <label className="textarea-field">
              Itinerary
              <textarea
                value={bookingForm.itinerary}
                onChange={(event) => updateBookingField('itinerary', event.target.value)}
                placeholder="One itinerary note per line"
              />
            </label>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Package</p>
              <h2>Inclusions and exclusions</h2>
            </div>
            <div className="field-grid two">
              <label className="textarea-field">
                Inclusions
                <textarea
                  value={bookingForm.inclusions}
                  onChange={(event) =>
                    updateBookingField('inclusions', event.target.value)
                  }
                  placeholder="One inclusion per line"
                />
              </label>
              <label className="textarea-field">
                Exclusions
                <textarea
                  value={bookingForm.exclusions}
                  onChange={(event) =>
                    updateBookingField('exclusions', event.target.value)
                  }
                  placeholder="One exclusion per line"
                />
              </label>
            </div>
            <label className="textarea-field">
              Special instructions
              <textarea
                value={bookingForm.specialInstructions}
                onChange={(event) =>
                  updateBookingField('specialInstructions', event.target.value)
                }
                placeholder="Supplier instructions, voucher reminders, booking notes..."
              />
            </label>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Notes</p>
              <h2>Remarks</h2>
            </div>
            <label className="textarea-field">
              Internal notes / special requests
              <textarea
                value={bookingForm.notes}
                onChange={(event) => updateBookingField('notes', event.target.value)}
                placeholder="Flight notes, hotel preferences, payment remarks, exclusions, reminders..."
              />
            </label>
          </section>
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

    const documentActions = [
      {
        title: 'Breakdown',
        description: 'Internal supplier nett and costing sheet.',
        status: 'Breakdown' as BookingStatus,
      },
      {
        title: 'Quotation',
        description: 'Client-facing price offer and inclusions.',
        status: 'Quotation' as BookingStatus,
      },
      {
        title: 'Invoice',
        description: 'Editable payment and billing document.',
        status: 'Invoice' as BookingStatus,
      },
      {
        title: 'Purchase Order',
        description: 'Supplier/vendor reservation instruction.',
        status: 'Purchase Order' as BookingStatus,
      },
      {
        title: 'Service Voucher',
        description: 'Final confirmed client travel details.',
        status: 'Confirmed' as BookingStatus,
      },
    ]

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
              <label>
                Status
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
                <strong>
                  {formatAmount(
                    selectedBooking.sellingPrice || selectedBooking.unitPrice,
                  )}
                </strong>
              </article>
              <article className="internal-summary">
                <span>Internal nett</span>
                <strong>{formatAmount(selectedBooking.nettCost)}</strong>
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
              <p>Document flow</p>
              <h2>Generate from this record</h2>
            </div>

            <div className="document-actions">
              {documentActions.map((action) => (
                <button
                  key={action.title}
                  type="button"
                  onClick={() =>
                    action.title === 'Quotation'
                      ? openQuotationPreview()
                      : action.title === 'Breakdown'
                      ? openBreakdownPreview()
                      : action.title === 'Invoice'
                        ? openInvoiceEditor()
                        : action.title === 'Purchase Order'
                          ? openPurchaseOrderPreview()
                          : action.title === 'Service Voucher'
                            ? openVoucherPreview()
                          : updateSelectedBookingStatus(action.status)
                  }
                >
                  <FileText size={19} />
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>

            <div className="workflow-note">
              <ListChecks size={20} />
              <p>
                These buttons prepare the workspace for each filtered document.
                PDF previews will be connected in the next phase.
              </p>
            </div>
          </aside>
        </div>
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

    const quantity = Number(selectedBooking.quantity) || 1
    const unitPrice = Number(selectedBooking.unitPrice || selectedBooking.sellingPrice) || 0
    const totalPrice = unitPrice * quantity
    const inclusions = getLines(selectedBooking.inclusions, [
      'Travel arrangement based on selected package',
    ])
    const exclusions = getLines(selectedBooking.exclusions, [
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
              type="button"
              onClick={handlePrintPreview}
              title="Print / Save PDF"
            >
              <Printer size={18} />
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

        <section className="quotation-preview">
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
                <th>Description</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Total price</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{selectedBooking.itemDescription || selectedBooking.packageName}</td>
                <td>{quantity}</td>
                <td>{formatAmount(String(unitPrice))}</td>
                <td>{formatAmount(String(totalPrice))}</td>
              </tr>
            </tbody>
          </table>

          <section className="quote-notes">
            <p>Notes: No booking has been made yet.</p>
            <strong>RATE SUBJECT TO CHANGE AND AVAILABILITY</strong>
          </section>

          <section className="preview-list-grid">
            <div>
              <h2>Inclusions</h2>
              <ul>
                {inclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
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

    const quantity = Number(selectedBooking.quantity) || 1
    const unitPrice = parseAmount(selectedBooking.unitPrice || selectedBooking.sellingPrice)
    const totalPrice = unitPrice * quantity
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

    const quantity = Number(selectedBooking.quantity) || 1
    const unitPrice = parseAmount(selectedBooking.unitPrice || selectedBooking.sellingPrice)
    const totalPrice = unitPrice * quantity
    const amountPaid = parseAmount(selectedBooking.invoiceAmountPaid)
    const balance = Math.max(totalPrice - amountPaid, 0)
    const paymentRecords = getLines(selectedBooking.paymentRecords, [
      'No payment updates yet.',
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
              type="button"
              onClick={handlePrintPreview}
              title="Print / Save PDF"
            >
              <Printer size={18} />
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

        <section className="invoice-preview">
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
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{selectedBooking.itemDescription || selectedBooking.packageName}</td>
                <td>{quantity}</td>
                <td>{formatAmount(String(unitPrice))}</td>
                <td>{formatAmount(String(totalPrice))}</td>
              </tr>
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
            <h2>Note to Customer</h2>
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

    const quantity = Number(selectedBooking.quantity) || 1
    const unitPrice =
      Number(selectedBooking.nettCost || selectedBooking.unitPrice) || 0
    const amount = quantity * unitPrice
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
              type="button"
              onClick={handlePrintPreview}
              title="Print / Save PDF"
            >
              <Printer size={18} />
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

        <section className="po-preview">
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
              <small>Contact No.: {selectedBooking.contactNumber || 'N/A'}</small>
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
              <tr>
                <td>{quantity}</td>
                <td>{selectedBooking.pax || quantity}</td>
                <td>{selectedBooking.itemDescription || selectedBooking.packageName}</td>
                <td>{formatAmount(String(unitPrice))}</td>
                <td>{formatAmount(String(amount))}</td>
              </tr>
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
    const inclusions = getLines(selectedBooking.inclusions, [
      'Travel arrangement based on confirmed package',
      'Accommodation / service details as stated above',
      'Assistance from Lion and Lamb Travel',
    ])
    const exclusions = getLines(selectedBooking.exclusions, [
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
              type="button"
              onClick={handlePrintPreview}
              title="Print / Save PDF"
            >
              <Printer size={18} />
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

        <section className="voucher-preview">
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

          <section className="voucher-lists">
            <div>
              <h2>Package Inclusions</h2>
              <ul>
                {inclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
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
            <p>Any unused portion for land arrangement is non-refundable.</p>
            <p>All rights reserved by Lion and Lamb Travel if any changes occur without prior notice.</p>
            {selectedBooking.specialInstructions && (
              <p>{selectedBooking.specialInstructions}</p>
            )}
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

    const quantity = Number(selectedBooking.quantity) || 1
    const nettCost = Number(selectedBooking.nettCost) || 0
    const sellingPrice =
      Number(selectedBooking.sellingPrice || selectedBooking.unitPrice) || 0
    const internalTotal = nettCost * quantity
    const clientTotal = sellingPrice * quantity
    const estimatedProfit = clientTotal - internalTotal
    const breakdownRows = [
      {
        service: 'PACKAGE / SERVICE',
        details: selectedBooking.itemDescription || selectedBooking.packageName,
        amount: internalTotal,
      },
      {
        service: 'SUPPLIER / OPERATOR',
        details: selectedBooking.supplier || 'To be assigned',
        amount: 0,
      },
      {
        service: 'SELLING PRICE',
        details: 'Client-facing amount',
        amount: clientTotal,
      },
      {
        service: 'EST. PROFIT',
        details: 'Selling price minus supplier nett',
        amount: estimatedProfit,
      },
    ]

    return (
      <main className="preview-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>Internal Breakdown Preview</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              type="button"
              onClick={handlePrintPreview}
              title="Print / Save PDF"
            >
              <Printer size={18} />
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

        <section className="breakdown-preview">
          <header className="breakdown-header">
            <h1>QUOTATION: {selectedBooking.quotationNo || selectedBooking.id}</h1>
            <strong>INTERNAL BREAKDOWN</strong>
          </header>

          <section className="breakdown-info">
            <div>
              <span>Name</span>
              <strong>{selectedBooking.packageName}</strong>
            </div>
            <div>
              <span>Date of Travel</span>
              <strong>
                {selectedBooking.travelStart
                  ? `${formatProjectDate(selectedBooking.travelStart)}${
                      selectedBooking.travelEnd
                        ? ` - ${formatProjectDate(selectedBooking.travelEnd)}`
                        : ''
                    }`
                  : 'TBA'}
              </strong>
            </div>
            <div>
              <span>No. of Pax</span>
              <strong>{selectedBooking.pax || quantity}</strong>
            </div>
            <div>
              <span>Operator</span>
              <strong>{selectedBooking.supplier || 'To be assigned'}</strong>
            </div>
          </section>

          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Details</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {breakdownRows.map((row) => (
                <tr key={row.service}>
                  <td>{row.service}</td>
                  <td>{row.details}</td>
                  <td>{formatAmount(String(row.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="breakdown-total-grid">
            <div>
              <span>Supplier Nett Total</span>
              <strong>{formatAmount(String(internalTotal))}</strong>
            </div>
            <div>
              <span>Client Total</span>
              <strong>{formatAmount(String(clientTotal))}</strong>
            </div>
            <div>
              <span>Estimated Profit</span>
              <strong>{formatAmount(String(estimatedProfit))}</strong>
            </div>
          </section>

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

  const activeProjects = bookings.length
  const invoiceCount = bookings.filter((booking) => booking.status === 'Invoice').length
  const quotationCount = bookings.filter(
    (booking) => booking.status === 'Quotation' || booking.status === 'Inquiry',
  ).length
  const filteredBookings =
    activeBookingFilter === 'All'
      ? bookings
      : bookings.filter((booking) => booking.status === activeBookingFilter)
  const statusCounts = bookingListFilters.reduce(
    (counts, filter) => ({
      ...counts,
      [filter.value]:
        filter.value === 'All'
          ? bookings.length
          : bookings.filter((booking) => booking.status === filter.value).length,
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
          <button type="button">
            <Search size={18} />
          </button>
          <button type="button" onClick={handleLogout} title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      <div className="home-body">
        <section className="home-main">
          <section className="home-hero">
            <div className="hero-copy">
              <p>
                Welcome,{' '}
                {authUser?.displayName ??
                  (authUser?.email ? getDisplayName(authUser.email) : 'Team Member')}
              </p>
              <h1>Manage travel projects with confidence.</h1>
              <span>
                Create quotations, invoices, customer records, and travel
                documents from one clean dashboard.
              </span>
              <button
                type="button"
                className="create-project-btn"
                onClick={handleNewBooking}
              >
                <Plus size={20} />
                Create New Project
              </button>
            </div>
            <div className="hero-image">
              <img src={travelBanner} alt="Lion and Lamb travel banner" />
            </div>
          </section>

          <section className="dashboard-grid">
            <article className="summary-card">
              <div className="summary-icon blue">
                <FolderKanban size={22} />
              </div>
              <span>Active Projects</span>
              <strong>{activeProjects}</strong>
            </article>
            <article className="summary-card">
              <div className="summary-icon green">
                <FileText size={22} />
              </div>
              <span>Invoices</span>
              <strong>{invoiceCount}</strong>
            </article>
            <article className="summary-card">
              <div className="summary-icon gold">
                <Sparkles size={22} />
              </div>
              <span>Pending Quotations</span>
              <strong>{quotationCount}</strong>
            </article>
          </section>
        </section>

        <section className="projects-panel">
          <div className="section-heading">
            <div>
              <p>Filtered summaries</p>
              <h2>{activeBookingFilter === 'All' ? 'All records' : activeBookingFilter}</h2>
            </div>
            <button type="button">
              View All
              <ArrowRight size={17} />
            </button>
          </div>

          <div className="booking-tabs" role="tablist" aria-label="Booking lists">
            {bookingListFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={activeBookingFilter === filter.value}
                className={activeBookingFilter === filter.value ? 'active' : ''}
                onClick={() => setActiveBookingFilter(filter.value)}
              >
                <span>{filter.label}</span>
                <strong>{statusCounts[filter.value]}</strong>
              </button>
            ))}
          </div>

          <div className="project-list">
            {filteredBookings.length === 0 && (
              <div className="empty-list">
                <FileText size={26} />
                <strong>No records yet</strong>
                <span>
                  Saved bookings with this status will appear here after data
                  gathering.
                </span>
              </div>
            )}

            {filteredBookings.map((booking) => (
              <button
                className="project-card"
                key={booking.id}
                type="button"
                onClick={() => openBookingDetail(booking.id)}
              >
                <div className="project-main">
                  <div className="project-icon">
                    <FileText size={20} />
                  </div>
                  <div>
                    <strong>{booking.packageName}</strong>
                    <span>{booking.clientName}</span>
                  </div>
                </div>
                <div className="project-meta">
                  <span className="status-pill">{booking.status}</span>
                  <span>
                    <CalendarDays size={15} />
                    {formatProjectDate(booking.createdAt)}
                  </span>
                  <span>
                    <MapPin size={15} />
                    {formatAmount(booking.sellingPrice || booking.unitPrice)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
