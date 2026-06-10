import { useEffect, useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  FileText,
  FolderKanban,
  LockKeyhole,
  Mail,
  MapPin,
  Plane,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react'
import logo from './assets/brand/logo.png'
import travelHero from './assets/brand/travel-hero.jpg'
import travelBanner from './assets/brand/travel-banner.png'
import './App.css'

type Screen = 'splash' | 'auth' | 'home'

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

function App() {
  const [screen, setScreen] = useState<Screen>('splash')
  const [email, setEmail] = useState('vmloper.dev@gmail.com')
  const [password, setPassword] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setScreen('auth'), 2600)
    return () => window.clearTimeout(timer)
  }, [])

  function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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

  if (screen === 'auth') {
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
              <p>Welcome back</p>
              <h1>Log in to your account</h1>
              <span>Access quotations, invoices, and customer projects.</span>
            </div>

            <div className="quick-login">
              <button type="button">
                <span>G</span>
                Google
              </button>
              <button type="button">
                <ShieldCheck size={17} />
                Admin
              </button>
            </div>

            <div className="auth-divider">
              <span>or continue with email</span>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <label>
                <Mail size={17} />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email"
                />
              </label>
              <label>
                <LockKeyhole size={17} />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                />
              </label>

              <div className="form-meta">
                <label className="remember-row">
                  <input type="checkbox" defaultChecked />
                  Remember me
                </label>
                <button type="button">Forgot Password?</button>
              </div>

              <button className="login-btn" type="submit">
                Log In
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
          <button type="button" onClick={() => setScreen('auth')}>
            <User size={18} />
          </button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="hero-copy">
          <p>Welcome, Floyd Allen B. Bueno</p>
          <h1>Manage travel projects with confidence.</h1>
          <span>
            Create quotations, invoices, customer records, and travel documents
            from one clean dashboard.
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
    </main>
  )
}

export default App
