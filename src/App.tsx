import { useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  type AuthError,
  onAuthStateChanged,
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
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { auth } from './firebase'
import logo from './assets/brand/logo.png'
import travelHero from './assets/brand/travel-hero.jpg'
import travelBanner from './assets/brand/travel-banner.png'
import './App.css'

type Screen = 'splash' | 'login' | 'signup' | 'home'
type PasswordStrength = {
  label: 'Weak' | 'Fair' | 'Strong'
  score: 1 | 2 | 3
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
  const passwordStrength = getPasswordStrength(password)

  useEffect(() => {
    return onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      setAuthUser(user)
      setIsAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    if (isAuthLoading) {
      return
    }

    const timer = window.setTimeout(() => {
      setScreen(authUser ? 'home' : 'login')
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
        setAuthUser(auth.currentUser)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }

      setAuthError('')
      setAuthMessage('')
      setScreen('home')
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

  async function handleLogout() {
    await signOut(auth)
    setPassword('')
    setConfirmPassword('')
    setScreen('login')
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
              <button type="button" className="create-project-btn">
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
              <strong>12</strong>
            </article>
            <article className="summary-card">
              <div className="summary-icon green">
                <FileText size={22} />
              </div>
              <span>Invoices</span>
              <strong>8</strong>
            </article>
            <article className="summary-card">
              <div className="summary-icon gold">
                <Sparkles size={22} />
              </div>
              <span>Pending Quotations</span>
              <strong>4</strong>
            </article>
          </section>
        </section>

        <section className="projects-panel">
          <div className="section-heading">
            <div>
              <p>Previous Project</p>
              <h2>Recent work</h2>
            </div>
            <button type="button">
              View All
              <ArrowRight size={17} />
            </button>
          </div>

          <div className="project-list">
            {previousProjects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-main">
                  <div className="project-icon">
                    <FileText size={20} />
                  </div>
                  <div>
                    <strong>{project.title}</strong>
                    <span>{project.client}</span>
                  </div>
                </div>
                <div className="project-meta">
                  <span className="status-pill">{project.status}</span>
                  <span>
                    <CalendarDays size={15} />
                    {project.date}
                  </span>
                  <span>
                    <MapPin size={15} />
                    {project.amount}
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
