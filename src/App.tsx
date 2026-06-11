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
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Plane,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { auth } from './firebase'
import logo from './assets/brand/logo.png'
import travelHero from './assets/brand/travel-hero.jpg'
import travelBanner from './assets/brand/travel-banner.png'
import './App.css'

type Screen = 'splash' | 'login' | 'signup' | 'verify-email' | 'home' | 'data-form'
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

function formatAmount(value: string) {
  const amount = Number(value.replace(/[^\d.]/g, ''))

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'PHP 0.00'
  }

  return `PHP ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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
  const [bookings, setBookings] = useState<BookingRecord[]>(getStoredBookings)
  const [bookingForm, setBookingForm] = useState<BookingFormData>(emptyBookingForm)
  const [activeBookingFilter, setActiveBookingFilter] =
    useState<BookingListFilter>('All')
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
              <article className="project-card" key={booking.id}>
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
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
