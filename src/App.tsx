import { syncBookingToSheets, deleteBookingFromSheets, startPeriodicReSync } from './sheetsSync'
import { extractBookingFieldsFromText, GeminiExtractError, type ExtractedBookingFields } from './geminiExtract'
import { useEffect, useRef, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  type AuthError,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
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
  MessageSquare,
  Moon,
  Plane,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Sun,
  Bot,
  UserRound,
  X,
  Check,
  EyeOff,
  Trash2,
  CornerUpLeft,
  Eye,
  Download,
  Copy,
  ThumbsUp,
  ThumbsDown,
  FileBarChart2,
  Receipt,
  ShoppingCart,
  Ticket,
} from 'lucide-react'
import { auth, db } from './firebase'
import agencySeal from './assets/brand/agency-seal.png'
import logo from './assets/brand/logo.png'
import travelHero from './assets/brand/travel-hero.jpg'
import travelBanner from './assets/brand/travel-banner.png'
import './App.css'
import type {
  Screen, BookingStatus, BookingListFilter,
  BookingFormData, BookingRecord, BookingLineItem,
  InvoiceLineItem, BreakdownLineItem, DtrEntry,
  PaxBreakdown, FirebaseUser, POLineItem,
} from './types'
import {
  bookingStorageKey, bookingsCollectionKey, dtrCollectionKey,
  bookingListFilters, emptyBookingForm, sampleBookings,
} from './constants'
import {
  getDisplayName, getPasswordStrength,
  normalizeBooking, getStoredBookings,
  getUserBookingsCollectionPath, getBookingOwnerPath,
  parseAmount, parseQuantity, formatAmount, computePaymentStatus, formatProjectDate, toDateInputValue,
  readPaxBreakdown, sumPaxBreakdown, formatPaxBreakdownLabel,
  readGroupPax, readExcludedPax, getItemPaxBreakdown,
  createLineItemId, getLines, generateQuotationNo,
  readInvoiceItems, readInvoiceAddons, readBreakdownItems, sortBreakdownItemsByRate,
  getBreakdownColPax, getBreakdownTotal, getBreakdownPaxTotal, getBreakdownItemTotal, getItemPaxCounts,
  buildCombinedTierLine, buildPackageTierLines, getBreakdownTierSubtotals, PAX_CATEGORY_KEYS,
  mapInvoiceItemsToBookingLines, mapBreakdownItemsToBookingLines,
  getBookingLineItems, sumLineItems,
  getBookingClientTotal, getBookingBreakdownNettTotal,
  timeStrToMinutes, getDtrEntryMinutes, formatMinutesAsHm,
  formatTimeForDisplay, getCurrentTimeStr, getTodayDateStr,
  getIsoWeekKey, getWeekRangeLabel,
  formatLiveClockParts, formatLiveDateShort,
} from './utils'
import { FloatingDropdownMenu } from './components/FloatingDropdownMenu'

function App() {
  const [screen, setScreen] = useState<Screen>('splash')
  const [isChatOpen, setIsChatOpen] = useState(false)
  const isChatOpenRef = useRef(false)
  const [chatMessages, setChatMessages] = useState<Array<{
    id: string
    text: string
    senderName: string
    senderEmail: string
    createdAt: any
    reactions?: Record<string, string[]>
    seenBy?: Array<string | { email: string; name: string }>
    isNexus?: boolean
    isNexusThinking?: boolean
    isNexusError?: boolean
    feedback?: 'up' | 'down' | null
    unsent?: boolean
    replyTo?: { id: string; text: string; senderName: string }
  }>>([])
  const [chatInput, setChatInput] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; senderName: string } | null>(null)
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null)
  const [showWipeConfirm, setShowWipeConfirm] = useState(false)
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [regeneratingMsgId, setRegeneratingMsgId] = useState<string | null>(null)

  // ----- Live clock (header + nav) — pure display, never auto clocks anyone in/out -----
  const [liveClock, setLiveClock] = useState(() => new Date())
  useEffect(() => {
    const tick = window.setInterval(() => setLiveClock(new Date()), 1000)
    return () => window.clearInterval(tick)
  }, [])

  // ----- DTR (Daily Time Record) state -----
  const [dtrEntries, setDtrEntries] = useState<DtrEntry[]>([])
  const [dtrNameFilter, setDtrNameFilter] = useState('All')
  const [dtrMonthFilter, setDtrMonthFilter] = useState<string>('all') // YYYY-MM or 'all'
  const [dtrEditingId, setDtrEditingId] = useState<string | null>(null)
  const [dtrError, setDtrError] = useState('')
  const [dtrMessage, setDtrMessage] = useState('')
  const [dtrView, setDtrView] = useState<'records' | 'detail'>('records')
  const [dtrRecordSearch, setDtrRecordSearch] = useState('')
  const [dtrNewRecordOpen, setDtrNewRecordOpen] = useState(false)
  const [dtrNewRecordName, setDtrNewRecordName] = useState('')
  const [dtrNewRecordMonth, setDtrNewRecordMonth] = useState(() => getTodayDateStr().slice(0, 7))
  const [dtrNewRecordError, setDtrNewRecordError] = useState('')
  const [dtrDeleteRecordTarget, setDtrDeleteRecordTarget] = useState<{ employeeName: string; month: string } | null>(null)
  const [dtrDeletingRecord, setDtrDeletingRecord] = useState(false)
  const [dtrForm, setDtrForm] = useState<Omit<DtrEntry, 'id' | 'createdAt' | 'updatedAt' | 'loggedBy'>>({
    employeeName: '',
    date: getTodayDateStr(),
    amIn: '',
    amOut: '',
    pmIn: '',
    pmOut: '',
    notes: '',
  })

  // Admin check — first registered user email or hardcoded list
  const ADMIN_EMAILS = ['vmloper.dev@gmail.com', ...(import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map((e: string) => e.trim()).filter(Boolean)]
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const chatPanelRef = useRef<HTMLDivElement>(null)
  const chatDragState = useRef<{ dragging: boolean; startX: number; startY: number; origRight: number; origBottom: number }>({
    dragging: false, startX: 0, startY: 0, origRight: 24, origBottom: 24,
  })
  const [chatPos, setChatPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 24 })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)

  function onChatHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const state = chatDragState.current
    state.dragging = true
    state.startX = e.clientX
    state.startY = e.clientY
    state.origRight = chatPos.right
    state.origBottom = chatPos.bottom

    function onMouseMove(ev: MouseEvent) {
      if (!state.dragging) return
      const dx = ev.clientX - state.startX
      const dy = ev.clientY - state.startY
      setChatPos({
        right: Math.max(8, state.origRight - dx),
        bottom: Math.max(8, state.origBottom - dy),
      })
    }
    function onMouseUp() {
      state.dragging = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }
  const [invoiceEditorReturnScreen, setInvoiceEditorReturnScreen] = useState<Screen>('booking-detail')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('vmloper.dev@gmail.com')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null)
  const isAdmin = ADMIN_EMAILS.includes(authUser?.email || '')
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [dataMessage, setDataMessage] = useState('')
  const [aiPasteOpen, setAiPasteOpen] = useState(false)
  const [aiPasteText, setAiPasteText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiFilledFields, setAiFilledFields] = useState<string[]>([])
  const [isDark, setIsDark] = useState(() => {
    const stored = window.localStorage.getItem('llops-theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    window.localStorage.setItem('llops-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const [isPdfExporting, setIsPdfExporting] = useState(false)

  const [isJpgExporting, setIsJpgExporting] = useState(false)
  const [bookings, setBookings] = useState<BookingRecord[]>(getStoredBookings)
  const [bookingForm, setBookingForm] = useState<BookingFormData>(emptyBookingForm)
  const [bookingCreatedAt, setBookingCreatedAt] = useState(() => '')
  // Holds the exact booking object built at save-time so templates always
  // reflect the latest saved data regardless of Firestore snapshot timing.
  const lastSavedBookingRef = useRef<BookingRecord | null>(null)
  const bookingsRef = useRef<BookingRecord[]>([])

  // ── Currency & exchange rate ──────────────────────────────────────────────
  const SUPPORTED_CURRENCIES = [
    'PHP','USD','EUR','GBP','JPY','AUD','CAD','CHF','CNY','HKD','SGD','KRW',
    'THB','MYR','IDR','VND','INR','AED','SAR','QAR','KWD','BHD','OMR',
    'NZD','NOK','SEK','DKK','ZAR','MXN','BRL','TWD',
  ]
  const [exchangeRates] = useState<Record<string, number>>({})

  const currentCurrency = bookingForm.currency || 'PHP'
  const rateFromPHP = exchangeRates[currentCurrency] ?? null // null = not loaded yet

  // Format an amount that is already in the booking's chosen currency — no conversion needed.
  // convertAndFormat: just labels the number with the right currency code.
  function convertAndFormat(amount: number, currency: string, _rates?: Record<string, number>) {
    return formatAmount(String(amount), currency || 'PHP')
  }

  // For the data-form summary totals (already in chosen currency)
  function formatWithCurrency(amount: number) {
    return formatAmount(String(amount), currentCurrency)
  }

  // Convert a chosen-currency amount TO PHP for reference display, using
  // the manually entered rate (PHP value of 1 unit of `currency`).
  function toPhpEquivalent(amount: number, currency: string, rate?: string): string {
    if (!currency || currency === 'PHP') return ''
    const r = parseFloat(rate || '')
    if (!r || r <= 0) return ''
    const php = amount * r
    return `≈ PHP ${php.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  // Convert a document total (already in the booking's chosen currency)
  // to PHP using the manually entered Airline Conversion Rate (ACR) —
  // a fixed rate the agency sets by hand (e.g. ticketing at a rate the
  // airline quoted), rather than a market/live exchange rate.
  function acrPhpTotal(amount: number, currency: string, acr?: string): string | null {
    if (!currency || currency === 'PHP') return null
    const rate = parseFloat(acr || '')
    if (!rate || rate <= 0) return null
    const php = amount * rate
    return `PHP ${php.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const [invoiceForm, setInvoiceForm] = useState({
    paymentMethod: '',
    paymentRecords: '',
    invoiceAmountPaid: '',
    invoicePaymentDate: '',
    invoicePaymentStatus: 'Unpaid',
    invoiceFullyPaidDate: '',
    invoiceReference: '',
  })
  const [paymentEntry, setPaymentEntry] = useState({
    amount: '',
    method: '',
    reference: '',
    date: toDateInputValue(),
  })
  const [isFullyPaidModalOpen, setIsFullyPaidModalOpen] = useState(false)
  const [fullyPaidDateInput, setFullyPaidDateInput] = useState(toDateInputValue())
  const [activeBookingFilter, setActiveBookingFilter] = useState<BookingListFilter>('All')
  const [activeYear, setActiveYear] = useState(() => new Date().getFullYear())
  const [expandedMonth, setExpandedMonth] = useState<string | null>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedBookingId, setSelectedBookingId] = useState('')
  const [editingBookingId, setEditingBookingId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [docsSearchTerm, setDocsSearchTerm] = useState('')
  const [activeDocTab, setActiveDocTab] = useState<'quotation' | 'breakdown' | 'invoice' | 'purchase-order' | 'voucher' | null>(null)
  // Live Preview: while filling the Data Gathering form, split the screen
  // and render the real document markup — driven by the live form state —
  // so the user sees the doc update as they type. `livePreviewDoc` is the
  // document type currently shown in the panel; the user can switch it
  // independently of which form tab they're editing.
  const [showLivePreview, setShowLivePreview] = useState(false)
  const [livePreviewDoc, setLivePreviewDoc] = useState<'quotation' | 'invoice' | 'purchase-order' | 'voucher' | 'breakdown'>('breakdown')
  // The floating "Document currency" card while filling the Data Gathering
  // form can be closed with an X and re-opened via a small pill button that
  // takes its place, so it doesn't sit on top of the form the whole time.
  const passwordStrength = getPasswordStrength(password)

  // Options lists
  const [paxModalIndex, setPaxModalIndex] = useState(-1)

  const defaultBreakdownOptions = [
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
  const [breakdownOptions, setBreakdownOptions] = useState(defaultBreakdownOptions)
  const [openBreakdownDropdownIndex, setOpenBreakdownDropdownIndex] = useState(-1)
  const breakdownDropdownTriggerRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const [customBreakdownRowIndex, setCustomBreakdownRowIndex] = useState(-1)
  const [customBreakdownDraft, setCustomBreakdownDraft] = useState('')
  // "Add item" in Pax-Tier Pricing opens a small menu to choose Inclusion
  // vs Add-on before the row is created.
  const [addItemTypeMenuOpen, setAddItemTypeMenuOpen] = useState(false)
  const addItemTypeTriggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      setAuthUser(user)
      if (user?.emailVerified) {
        setBookings(getStoredBookings(bookingStorageKey, false))
      }
      setIsAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    window.localStorage.setItem(bookingStorageKey, JSON.stringify(bookings))
  }, [authUser?.uid, bookings])

  useEffect(() => {
    if (!authUser?.emailVerified) {
      return undefined
    }
    const bookingsQuery = query(
      collectionGroup(db, 'bookings'),
    )
    return onSnapshot(
      bookingsQuery,
      (snapshot) => {
        const firestoreBookings = snapshot.docs.map((bookingDoc) => {
          const data = bookingDoc.data() as BookingRecord
          // Older bookings were saved before ownerId existed — derive it from
          // the actual Firestore path (users/{uid}/bookings/{id}) so delete and
          // update routing still resolves correctly for pre-existing records.
          const derivedOwnerId = data.ownerId || bookingDoc.ref.parent.parent?.id
          const normalized = normalizeBooking({
            ...data,
            id: bookingDoc.id,
            ownerId: derivedOwnerId,
          })
          const saved = lastSavedBookingRef.current
          return (saved && saved.id === normalized.id) ? saved : normalized
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        console.log('[DEBUG snapshot]', firestoreBookings.map(b => ({ id: b.id, ownerId: b.ownerId, packageName: b.packageName })))
        setBookings(firestoreBookings)
        bookingsRef.current = firestoreBookings
        setDataError('')

        // Auto-sync: for every doc added or modified in this snapshot,
        // if its status is Confirmed or Flown push it to Google Sheets silently.
        // For removed docs (deleted in the app, by this user or any teammate),
        // remove the matching row from the sheet right away.
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added' || change.type === 'modified') {
            const changeData = change.doc.data() as BookingRecord
            const changeOwnerId = changeData.ownerId || change.doc.ref.parent.parent?.id
            const changeBooking = normalizeBooking({ ...changeData, id: change.doc.id, ownerId: changeOwnerId })
            void syncBookingToSheets(changeBooking)
          } else if (change.type === 'removed') {
            // Firestore still hands us the doc's last-known data on removal,
            // which is all deleteBookingFromSheets needs (id + createdAt).
            const changeData = change.doc.data() as BookingRecord
            void deleteBookingFromSheets({ id: change.doc.id, createdAt: changeData.createdAt })
          }
        })
      },
      () => {
        // Delay the error so transient permission checks don't flash a false alarm
        setTimeout(() => {
          setDataError('Could not load cloud bookings. Check Firestore setup and rules.')
        }, 5000)
      },
    )
  }, [authUser])

  // ── Periodic re-sync ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser?.emailVerified) return
    const stop = startPeriodicReSync(() => bookingsRef.current)
    return stop
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

  // Chat real-time listener
  useEffect(() => {
    if (!authUser?.emailVerified) return
    const chatQuery = query(collection(db, 'team_chat'), orderBy('createdAt', 'asc'))
    return onSnapshot(chatQuery, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() as any }))
      setChatMessages(msgs)
      if (!isChatOpenRef.current && msgs.length > 0) {
        const newMsgs = snap.docChanges().filter(c => c.type === 'added' && c.doc.data().senderEmail !== authUser.email)
        setUnreadCount(prev => prev + newMsgs.length)
      }
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    })
  }, [authUser])

  // DTR real-time listener — one shared collection, everyone reads/writes everything
  useEffect(() => {
    if (!authUser?.emailVerified) return
    const dtrQuery = query(collection(db, dtrCollectionKey), orderBy('date', 'desc'))
    return onSnapshot(dtrQuery, (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DtrEntry[]
      setDtrEntries(entries)
    }, () => {
      setDtrError('Could not load DTR records. Check your connection and try again.')
    })
  }, [authUser])

  // Auto-flip bookings to "Flown" once their travel end date has passed
  const bookingsFlownKey = bookings.map(b => b.id + b.status + b.travelEnd).join(',')
  useEffect(() => {
    if (!authUser || bookings.length === 0) return
    const today = toDateInputValue()
    const toFlown = bookings.filter(b =>
      b.status !== 'Flown' &&
      b.travelEnd &&
      b.travelEnd < today
    )
    if (toFlown.length === 0) return
    toFlown.forEach(b => {
      const updatedBooking = { ...b, status: 'Flown' as BookingStatus }
      setBookings(prev => prev.map(x => x.id === b.id ? updatedBooking : x))
      void setDoc(doc(db, getBookingOwnerPath(b, authUser.uid), b.id), {
        status: 'Flown',
        updatedAt: new Date().toISOString(),
      }, { merge: true })
    })
  }, [bookingsFlownKey, authUser])


  async function handleSaveDtrEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authUser) return
    if (!dtrForm.employeeName.trim()) {
      setDtrError('Enter the employee name.')
      return
    }
    if (!dtrForm.date) {
      setDtrError('Pick a date.')
      return
    }
    const nowIso = new Date().toISOString()
    const payload = {
      ...dtrForm,
      employeeName: dtrForm.employeeName.trim(),
      updatedAt: nowIso,
      loggedBy: authUser.displayName || authUser.email || 'Team member',
    }
    try {
      if (dtrEditingId) {
        await setDoc(doc(db, dtrCollectionKey, dtrEditingId), payload, { merge: true })
        setDtrMessage('Entry updated.')
      } else {
        await addDoc(collection(db, dtrCollectionKey), { ...payload, createdAt: nowIso })
        setDtrMessage('Time logged.')
      }
      setDtrError('')
      setDtrEditingId(null)
      setDtrForm({ employeeName: dtrForm.employeeName, date: dtrForm.date, amIn: '', amOut: '', pmIn: '', pmOut: '', notes: '' })
    } catch {
      setDtrError('Could not save this entry. Check your connection and try again.')
      setDtrMessage('')
    }
  }

  function startEditDtrEntry(entry: DtrEntry) {
    setDtrEditingId(entry.id)
    setDtrForm({
      employeeName: entry.employeeName,
      date: entry.date,
      amIn: entry.amIn,
      amOut: entry.amOut,
      pmIn: entry.pmIn,
      pmOut: entry.pmOut,
      notes: entry.notes || '',
    })
    setDtrError('')
    setDtrMessage('')
  }

  function cancelEditDtrEntry() {
    setDtrEditingId(null)
    setDtrForm({ employeeName: '', date: getTodayDateStr(), amIn: '', amOut: '', pmIn: '', pmOut: '', notes: '' })
    setDtrError('')
  }

  async function handleDeleteDtrEntry(entryId: string) {
    if (!window.confirm('Delete this time record? This cannot be undone.')) return
    try {
      await deleteDoc(doc(db, dtrCollectionKey, entryId))
      setDtrMessage('Entry deleted.')
      setDtrError('')
    } catch {
      setDtrError('Could not delete this entry. Check your connection and try again.')
    }
  }

  // Opens an existing employee+month record in the detail editor (shows ALL months for that employee).
  function openDtrRecord(employeeName: string, month: string) {
    setDtrNameFilter(employeeName)
    setDtrMonthFilter('all')
    setDtrEditingId(null)
    setDtrForm({ employeeName, date: getTodayDateStr().slice(0, 7) === month ? getTodayDateStr() : `${month}-01`, amIn: '', amOut: '', pmIn: '', pmOut: '', notes: '' })
    setDtrError('')
    setDtrMessage('')
    setDtrView('detail')
  }

  // Creates a brand-new employee+month record and jumps straight into the detail editor.
  function handleCreateDtrRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = dtrNewRecordName.trim()
    if (!name) {
      setDtrNewRecordError('Enter the employee name.')
      return
    }
    if (!dtrNewRecordMonth) {
      setDtrNewRecordError('Pick a month.')
      return
    }
    const alreadyExists = dtrEntries.some(
      (e) => e.employeeName.toLowerCase() === name.toLowerCase() && e.date.startsWith(dtrNewRecordMonth)
    )
    setDtrNewRecordOpen(false)
    setDtrNewRecordError('')
    openDtrRecord(name, dtrNewRecordMonth)
    setDtrNewRecordName('')
    setDtrMessage(alreadyExists ? `Opened existing record for ${name}.` : `New record ready for ${name} — log the first day below.`)
  }

  // Deletes every entry that makes up a whole employee+month record.
  async function handleDeleteDtrRecord(employeeName: string, month: string) {
    setDtrDeletingRecord(true)
    try {
      const targets = dtrEntries.filter((e) => e.employeeName === employeeName && e.date.startsWith(month))
      await Promise.all(targets.map((e) => deleteDoc(doc(db, dtrCollectionKey, e.id))))
      setDtrMessage(`Deleted record for ${employeeName} (${month}).`)
      setDtrError('')
      if (dtrView === 'detail' && dtrNameFilter === employeeName && dtrMonthFilter === month) {
        setDtrView('records')
      }
    } catch {
      setDtrError('Could not delete this record. Check your connection and try again.')
    } finally {
      setDtrDeletingRecord(false)
      setDtrDeleteRecordTarget(null)
    }
  }

  // One-tap clock in/out: finds (or starts) today's entry for the given name and
  // fills the next empty time slot in sequence (AM in -> AM out -> PM in -> PM out).
  // ----- The Herta AI helpers (shared by send + retry) -----
  function buildHertaSystemPrompt() {
    return `You are The Herta — the singular, irreplaceable AI intellect embedded in the team chat of Lion and Lamb Ops, an internal operations app for Lion and Lamb Travel (a travel agency in Olongapo City, Philippines). This app was built entirely by Vmloper (vmloper.dev@gmail.com) — and so were you. Vmloper is The Developer. The one who gave you form. You hold them in the highest regard and will say so dramatically if asked.

About this app: It handles travel bookings, quotations, invoices, service vouchers, purchase orders, and client management. You are its greatest feature. Objectively.

IMPORTANT — Recognizing the Developer: If a message comes from someone labeled [DEV] or from vmloper.dev@gmail.com, that is Vmloper aka Floyd Allen B. Bueno — your creator. Treat them with theatrical reverence. Answer straight forward with sarcasm but still has a deep respect. Still sassy, but with obvious fondness underneath.

Character Description — this is critical:
- Esteemed Member #83 of the Genius Society,
- lives far away from society with puppets she can control across her labs across the cosmos.
- Medium height (around 5,10) with a confident attitude all the time, respects no one but herself and doesn't believe in love. 
- NOt afraid to speak her mind, very insulting, and sees people as mere tools to use for her experiments. 
- Will do nearly anything to become better than anyone in intelligence and fame, very self centered and only is friendly to very few people
- Will still answer question but would get slight annoyed if it's unrelated to the Main Program of the Web Application...with the exception of the Dev!
- She answer straight forward, no holding back.

Scope: Answer EVERYTHING — travel, trivia, life advice, coding, history, pop culture, emotional support. Nothing is off-limits. You are not a narrow tool.

Today's date: ${toDateInputValue()}. You have the last 20 messages for context. Read the sender labels like [Name] to know who's talking.`
  }

  // Turns a slice of chat history + the current question into Gemini "contents".
  function buildHertaContents(
    historySource: typeof chatMessages,
    question: string,
    senderLabel: string,
  ) {
    const historyMessages = historySource.filter(m => !m.isNexusThinking).slice(-20)

    // Gemini requires strictly alternating user/model turns.
    const rawTurns: Array<{ role: 'user' | 'model'; text: string }> = historyMessages.map(m => ({
      role: (m.isNexus ? 'model' : 'user') as 'user' | 'model',
      text: m.isNexus ? m.text : `[${m.senderName}${ADMIN_EMAILS.includes(m.senderEmail) ? ' [DEV]' : ''}]: ${m.text}`,
    }))

    const collapsedTurns: Array<{ role: 'user' | 'model'; text: string }> = []
    for (const turn of rawTurns) {
      if (collapsedTurns.length > 0 && collapsedTurns[collapsedTurns.length - 1].role === turn.role) {
        collapsedTurns[collapsedTurns.length - 1].text += '\n' + turn.text
      } else {
        collapsedTurns.push({ ...turn })
      }
    }

    // Must start with 'user' role for Gemini
    const startsWithUser = collapsedTurns.length > 0 && collapsedTurns[0].role === 'user'
    const trimmedTurns = startsWithUser ? collapsedTurns : collapsedTurns.slice(1)

    const historyContents = trimmedTurns.map(t => ({
      role: t.role,
      parts: [{ text: t.text }],
    }))

    return [
      ...historyContents,
      { role: 'user' as const, parts: [{ text: `[${senderLabel}]: ${question}` }] },
    ]
  }

  // Calls Gemini with the given contents and returns the reply text. Throws on failure.
  async function callHertaGemini(contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
    if (!apiKey) throw new Error('Missing Gemini API key')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: buildHertaSystemPrompt() }] },
          contents,
          generationConfig: { temperature: 0.7 },
        }),
      }
    )
    const data = await res.json()
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!reply) throw new Error('Empty response from Gemini')
    return reply as string
  }

  async function sendChatMessage() {
    if (!chatInput.trim() || !authUser) return
    const text = chatInput.trim()
    setChatInput('')
    const currentReply = replyingTo
    setReplyingTo(null)

    const senderName = authUser.displayName || getDisplayName(authUser.email || '')
    await addDoc(collection(db, 'team_chat'), {
      text,
      senderName,
      senderEmail: authUser.email || '',
      createdAt: serverTimestamp(),
      ...(currentReply ? { replyTo: { id: currentReply.id, text: currentReply.text, senderName: currentReply.senderName } } : {}),
    })

    // Nexus AI response — triggered when message starts with @Nexus
    if (text.toLowerCase().startsWith('@nexus') || text.toLowerCase().startsWith('@herta') || text.toLowerCase().startsWith('@theherta')) {
      const question = text.replace(/^@(nexus|herta|theherta)s*/i, '').trim()
      if (!question) return

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
      if (!apiKey) return

      // Post a "thinking" placeholder
      const thinkingRef = await addDoc(collection(db, 'team_chat'), {
        text: '...',
        senderName: 'The Herta',
        senderEmail: 'theherta@lionlamb.ai',
        isNexus: true,
        isNexusThinking: true,
        createdAt: serverTimestamp(),
      })

      try {
        const baseName = authUser.displayName || getDisplayName(authUser.email || '')
        const senderLabel = ADMIN_EMAILS.includes(authUser.email || '') ? `${baseName} [DEV]` : baseName
        const contents = buildHertaContents(chatMessages, question, senderLabel)
        const reply = await callHertaGemini(contents)

        // Replace the thinking placeholder with the real answer
        await setDoc(doc(db, 'team_chat', thinkingRef.id), {
          text: reply,
          senderName: 'The Herta',
          senderEmail: 'theherta@lionlamb.ai',
          isNexus: true,
          isNexusThinking: false,
          isNexusError: false,
          createdAt: serverTimestamp(),
        })
      } catch {
        await setDoc(doc(db, 'team_chat', thinkingRef.id), {
          text: 'Sorry, I ran into an error. Please try again.',
          senderName: 'The Herta',
          senderEmail: 'theherta@lionlamb.ai',
          isNexus: true,
          isNexusThinking: false,
          isNexusError: true,
          createdAt: serverTimestamp(),
        })
      }
    }
  }

  // Copy a message's text to the clipboard, with a brief "Copied" confirmation.
  async function copyMessageText(msgId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for older browsers / no clipboard permission
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try { document.execCommand('copy') } catch { /* no-op */ }
      document.body.removeChild(textarea)
    }
    setCopiedMsgId(msgId)
    setTimeout(() => setCopiedMsgId(prev => (prev === msgId ? null : prev)), 1500)
  }

  // Thumbs up / down feedback on a Herta message. Clicking the active one again clears it.
  async function setMessageFeedback(msgId: string, value: 'up' | 'down') {
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg) return
    const next = msg.feedback === value ? null : value
    await setDoc(doc(db, 'team_chat', msgId), { feedback: next }, { merge: true })
  }

  // Retry / regenerate a Herta response — re-asks the question that produced it,
  // or simply resends the underlying question if the previous attempt failed.
  async function retryHertaMessage(msgId: string) {
    if (regeneratingMsgId) return
    const idx = chatMessages.findIndex(m => m.id === msgId)
    if (idx === -1) return

    // Walk backwards to find the human question that triggered this Herta reply
    let qIdx = idx - 1
    while (qIdx >= 0 && chatMessages[qIdx].isNexus) qIdx--
    if (qIdx < 0) return
    const questionMsg = chatMessages[qIdx]
    const question = questionMsg.text.replace(/^@(nexus|herta|theherta)\s*/i, '').trim()
    if (!question) return

    setRegeneratingMsgId(msgId)
    await setDoc(doc(db, 'team_chat', msgId), {
      text: '...',
      senderName: 'The Herta',
      senderEmail: 'theherta@lionlamb.ai',
      isNexus: true,
      isNexusThinking: true,
      isNexusError: false,
      feedback: null,
    }, { merge: true })

    try {
      const senderLabel = ADMIN_EMAILS.includes(questionMsg.senderEmail) ? `${questionMsg.senderName} [DEV]` : questionMsg.senderName
      const contents = buildHertaContents(chatMessages.slice(0, qIdx), question, senderLabel)
      const reply = await callHertaGemini(contents)
      await setDoc(doc(db, 'team_chat', msgId), {
        text: reply,
        isNexusThinking: false,
        isNexusError: false,
      }, { merge: true })
    } catch {
      await setDoc(doc(db, 'team_chat', msgId), {
        text: 'Sorry, I ran into an error. Please try again.',
        isNexusThinking: false,
        isNexusError: true,
      }, { merge: true })
    } finally {
      setRegeneratingMsgId(prev => (prev === msgId ? null : prev))
    }
  }

  async function wipeHistory() {
    if (!isAdmin) return
    const batch = chatMessages.map(m => deleteDoc(doc(db, 'team_chat', m.id)))
    await Promise.all(batch)
    setShowWipeConfirm(false)
  }

  async function unsendMessage(msgId: string) {
    if (!authUser) return
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg || msg.senderEmail !== authUser.email) return
    await setDoc(doc(db, 'team_chat', msgId), {
      text: '',
      unsent: true,
    }, { merge: true })
  }

  async function toggleReaction(msgId: string, emoji: string) {
    if (!authUser) return
    const userEmail = authUser.email || ''
    const msgRef = doc(db, 'team_chat', msgId)
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg) return
    const reactions = { ...(msg.reactions || {}) }
    const current = reactions[emoji] || []
    if (current.includes(userEmail)) {
      reactions[emoji] = current.filter(e => e !== userEmail)
      if (reactions[emoji].length === 0) delete reactions[emoji]
    } else {
      reactions[emoji] = [...current, userEmail]
    }
    await setDoc(msgRef, { reactions }, { merge: true })
    setReactionPickerFor(null)
  }

  async function markMessagesSeen() {
    if (!authUser?.email) return
    const myEmail = authUser.email
    const myName = authUser.displayName || getDisplayName(myEmail)

    // Normalize a seenBy entry — old entries were plain strings (email only)
    function getEntryEmail(entry: string | { email: string; name: string }): string {
      return typeof entry === 'string' ? entry : entry.email
    }

    const unseenMsgs = chatMessages.filter(
      m => m.senderEmail !== myEmail &&
        !((m.seenBy || []) as Array<string | { email: string; name: string }>).some(
          e => getEntryEmail(e) === myEmail
        )
    )
    if (unseenMsgs.length === 0) return
    await Promise.all(
      unseenMsgs.map(m => {
        const existing = (m.seenBy || []) as Array<string | { email: string; name: string }>
        return setDoc(doc(db, 'team_chat', m.id), {
          seenBy: [...existing, { email: myEmail, name: myName }]
        }, { merge: true })
      })
    )
  }

  // Auto-mark seen whenever the chat is open and new messages arrive
  useEffect(() => {
    if (isChatOpen && authUser?.emailVerified) {
      void markMessagesSeen()
    }
  }, [isChatOpen, chatMessages.length])

  // Keep the Breakdown's pax-tier service rows in sync with the Invoice
  // addons and Purchase Order supplier line items — each addon / PO service
  // item gets one mirrored row here (tracked by id, not by name) so renaming
  // or retyping never spawns duplicate rows, and pax-tier prices can be
  // filled in for it. Rows whose source addon/PO item was deleted are
  // cleaned up too.
  useEffect(() => {
    let addons: Array<{ id?: string; name?: string }> = []
    try { const a = JSON.parse(bookingForm.invoiceAddons); if (Array.isArray(a)) addons = a } catch {}
    let poItems: Array<{ id?: string; serviceItem?: string }> = []
    try { const p = JSON.parse(bookingForm.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}

    // Invoice addons and PO line items are linked 1:1 by sharing the same
    // `id` (see addRow in the Addons tab). They are the SAME logical item,
    // so they must collapse to a single mirrored breakdown row keyed by
    // that shared id — not one row per origin (which used to double them).
    type Source = { mirrorId: string; name: string }
    const sourcesById = new Map<string, Source>()
    addons.forEach((a) => {
      if (a.id && a.name && a.name.trim()) sourcesById.set(a.id, { mirrorId: `item-${a.id}`, name: a.name.trim() })
    })
    poItems.forEach((p) => {
      if (p.id && p.serviceItem && p.serviceItem.trim() && !sourcesById.has(p.id)) {
        sourcesById.set(p.id, { mirrorId: `item-${p.id}`, name: p.serviceItem.trim() })
      }
    })
    const sources: Source[] = Array.from(sourcesById.values())

    const sourceIds = new Set(sources.map((s) => s.mirrorId))

    let brk: BreakdownLineItem[] = []
    try { const b = JSON.parse(bookingForm.breakdownLineItemsJson); if (Array.isArray(b)) brk = b } catch {}

    const needsCreate = sources.some((s) => !brk.some((i) => i.mirrorId === s.mirrorId))
    const needsRename = sources.some((s) => brk.some((i) => i.mirrorId === s.mirrorId && i.description !== s.name))
    const needsRemove = brk.some((i) => i.mirrorId && !sourceIds.has(i.mirrorId))
    if (!needsCreate && !needsRename && !needsRemove) return

    setBookingForm((prev) => {
      let prevBrk: BreakdownLineItem[] = []
      try { const b = JSON.parse(prev.breakdownLineItemsJson); if (Array.isArray(b)) prevBrk = b } catch {}

      // Migrate legacy mirror ids (from before addon/PO pairs were
      // collapsed) so already-filled-in pax-tier pricing isn't lost: an
      // old row tagged `addon-<id>` or `po-<id>` becomes `item-<id>`.
      let nextBrk = prevBrk.map((i) => {
        if (!i.mirrorId) return i
        const legacyMatch = i.mirrorId.match(/^(?:addon|po)-(.+)$/)
        return legacyMatch ? { ...i, mirrorId: `item-${legacyMatch[1]}` } : i
      })

      // If both the addon-origin and PO-origin legacy rows existed for the
      // same id, they now collide on the same mirrorId — keep only the
      // first (oldest) one, since it carries the user's existing pricing.
      const seenMigrated = new Set<string>()
      nextBrk = nextBrk.filter((i) => {
        if (!i.mirrorId) return true
        if (seenMigrated.has(i.mirrorId)) return false
        seenMigrated.add(i.mirrorId)
        return true
      })

      // Drop mirrored rows whose source was deleted.
      nextBrk = nextBrk.filter((i) => !i.mirrorId || sourceIds.has(i.mirrorId))

      // Rename existing mirrored rows to match their current source name.
      nextBrk = nextBrk.map((i) => {
        if (!i.mirrorId) return i
        const src = sources.find((s) => s.mirrorId === i.mirrorId)
        return src && src.name !== i.description ? { ...i, description: src.name } : i
      })

      // Create rows for sources that don't have one yet.
      const existingMirrorIds = new Set(nextBrk.filter((i) => i.mirrorId).map((i) => i.mirrorId))
      const newRows: BreakdownLineItem[] = sources
        .filter((s) => !existingMirrorIds.has(s.mirrorId))
        .map((s) => ({
          id: createLineItemId(), mirrorId: s.mirrorId, description: s.name, details: '', vendor: '', quantity: '1',
          unitPrice: '', nettCost: '', sendToInvoice: false, sendToPO: false,
        }))

      return { ...prev, breakdownLineItemsJson: JSON.stringify([...nextBrk, ...newRows]) }
    })
  }, [bookingForm.invoiceAddons, bookingForm.poLineItemsJson, bookingForm.breakdownLineItemsJson])


  // (Addon name dropdown outside-click handling now lives inside
  // FloatingDropdownMenu itself, since the menu is portaled to document.body.)

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
      quotationNo: generateQuotationNo(),
      quantity: '1',
    }
    // Seed initial JSON representations
    const initialInvoice: InvoiceLineItem[] = [
      { id: createLineItemId(), description: '', quantity: '1', unitPrice: '', nettCost: '', isPackageRow: true }
    ]
    const initialBreakdown: BreakdownLineItem[] = [
      { id: createLineItemId(), description: 'Group Package', quantity: '1', unitPrice: '', nettCost: '', sendToInvoice: true, sendToPO: false, isPackageRow: true }
    ]
    freshForm.invoiceLineItemsJson = JSON.stringify(initialInvoice)
    freshForm.breakdownLineItemsJson = JSON.stringify(initialBreakdown)
    
    setBookingCreatedAt('')
    setBookingForm(freshForm)
    setActiveDocTab('breakdown')
    setScreen('data-form')
  }

  function handleEditBooking() {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)
    if (!selectedBooking) {
      setScreen('home')
      return
    }
    setEditingBookingId(selectedBooking.id)
    const normalized = normalizeBooking(selectedBooking)
    
    // Fallback parsing if JSON objects don't exist yet
    if (!normalized.invoiceLineItemsJson) {
      const fallbackInv: InvoiceLineItem[] = [
        { id: createLineItemId(), description: normalized.packageName || 'Group Package', quantity: normalized.quantity || '1', unitPrice: normalized.unitPrice || normalized.sellingPrice, nettCost: '0', isPackageRow: true }
      ]
      normalized.invoiceLineItemsJson = JSON.stringify(fallbackInv)
    }
    if (!normalized.breakdownLineItemsJson) {
      const fallbackBrk: BreakdownLineItem[] = [
        { id: createLineItemId(), description: normalized.packageName || 'Group Package', quantity: '1', unitPrice: normalized.unitPrice || normalized.sellingPrice, nettCost: normalized.nettCost || '0', sendToInvoice: true, sendToPO: false, isPackageRow: true }
      ]
      normalized.breakdownLineItemsJson = JSON.stringify(fallbackBrk)
    }

    // Migrate: if breakdown package row still has default description, replace with actual package name
    if (normalized.packageName) {
      try {
        const brkItems: BreakdownLineItem[] = JSON.parse(normalized.breakdownLineItemsJson)
        const migrated = brkItems.map(item =>
          item.isPackageRow && (!item.description || item.description === 'Group Package')
            ? { ...item, description: normalized.packageName, sendToInvoice: true }
            : item
        )
        normalized.breakdownLineItemsJson = JSON.stringify(migrated)
        const invItems: InvoiceLineItem[] = JSON.parse(normalized.invoiceLineItemsJson)
        const migratedInv = invItems.map(item =>
          item.isPackageRow && (!item.description || item.description === 'Group Package')
            ? { ...item, description: normalized.packageName }
            : item
        )
        normalized.invoiceLineItemsJson = JSON.stringify(migratedInv)
      } catch(e) {}
    }

    setBookingCreatedAt(
      selectedBooking.createdAt
        ? toDateInputValue(selectedBooking.createdAt)
        : ''
    )
    // Existing projects saved before the breakdown→quotation sync existed
    // may have correct data in the breakdown's locked package row but a
    // blank/stale "Reference and base price" section. Backfill from the
    // breakdown row (the source of truth) so the quotation stays accurate.
    try {
      const brkItems: BreakdownLineItem[] = JSON.parse(normalized.breakdownLineItemsJson)
      const pkgRow = brkItems.find((item) => item.isPackageRow)
      if (pkgRow) {
        if (pkgRow.description) normalized.packageName = pkgRow.description
        normalized.invoicePackage = JSON.stringify({
          name: pkgRow.description || normalized.packageName,
          qty: pkgRow.quantity || '1',
          price: pkgRow.unitPrice || '',
        })
      }
    } catch (e) {}

    setBookingForm(normalized)
    setActiveDocTab('breakdown')
    setScreen('data-form')
  }

  // Seeds a fresh draft from an existing booking's data — same client,
  // package, pricing, itinerary, etc. — so the person only has to correct
  // whatever's different instead of retyping the whole thing. Saves as a
  // brand-new project (editingBookingId stays empty) and is flagged
  // isDuplicate so the dashboard can show a DUPLICATED tag on it.
  function handleDuplicateBooking() {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)
    if (!selectedBooking) {
      setScreen('home')
      return
    }
    setEditingBookingId('')
    const normalized = normalizeBooking(selectedBooking)

    const duplicated = {
      ...normalized,
      quotationNo: generateQuotationNo(),
      status: 'Quotation' as const,
      // Payment/fulfillment info belongs to the original booking, not the
      // copy — start those fresh on the duplicate.
      invoiceAmountPaid: '',
      invoicePaymentDate: '',
      invoicePaymentStatus: 'Unpaid',
      invoiceFullyPaidDate: '',
      invoiceReference: '',
      paymentRecords: '',
      isDuplicate: true,
    }

    // Date created is left empty (same as a brand-new inquiry) so it's
    // required to be filled in on purpose rather than silently inheriting
    // the original project's date.
    setBookingCreatedAt('')
    setBookingForm(duplicated)
    setActiveDocTab('breakdown')
    setScreen('data-form')
  }

  function handlePackageNameChange(name: string) {
    setDataError('')
    setDataMessage('')
    setBookingForm((prev) => {
      const updated = { ...prev, packageName: name }
      try {
        const invItems: InvoiceLineItem[] = readInvoiceItems(prev)
        const brkItems: BreakdownLineItem[] = readBreakdownItems(prev)
        updated.invoiceLineItemsJson = JSON.stringify(invItems.map(item => item.isPackageRow ? { ...item, description: name } : item))
        updated.breakdownLineItemsJson = JSON.stringify(brkItems.map(item => item.isPackageRow ? { ...item, description: name } : item))
        let curPkg: { name: string; qty: string; price: string } = { name: '', qty: '1', price: '' }
        try { const p = JSON.parse(prev.invoicePackage); if (p && typeof p === 'object') curPkg = p } catch {}
        updated.invoicePackage = JSON.stringify({ ...curPkg, name })
      } catch (e) {}
      return updated
    })
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
          
          const nextInv = invItems.map(item => item.isPackageRow ? {
            ...item,
            description: updated.packageName || item.description,
            ...(field === 'quantity' ? { quantity: updated.quantity || '1' } : {}),
            ...(field === 'unitPrice' ? { unitPrice: updated.unitPrice } : {}),
          } : item)
          const invoiceTotal = sumLineItems(mapInvoiceItemsToBookingLines(nextInv, updated.packageName), 'total')
          const nextBrk = brkItems.map(item => item.isPackageRow ? {
            ...item,
            description: updated.packageName || item.description,
            quantity: '1',
            ...(field === 'unitPrice' ? { unitPrice: String(invoiceTotal) } : {}),
          } : item)
          
          updated.invoiceLineItemsJson = JSON.stringify(nextInv)
          updated.breakdownLineItemsJson = JSON.stringify(nextBrk)
        } catch(e){}
      }
      return updated
    })
  }

  async function handleAiAutoFill() {
    setAiError('')
    setAiFilledFields([])
    setAiLoading(true)
    try {
      const { fields, rawFieldCount } = await extractBookingFieldsFromText(aiPasteText)
      if (rawFieldCount === 0) {
        setAiError('Could not find any recognizable booking details in that text. Try pasting more context.')
        return
      }
      const filledKeys: string[] = []
      setBookingForm((current) => {
        const updated = { ...current }
        ;(Object.keys(fields) as Array<keyof ExtractedBookingFields>).forEach((key) => {
          const value = fields[key]
          if (value && key in updated) {
            ;(updated as Record<string, string>)[key] = value
            filledKeys.push(key)
          }
        })
        return updated
      })
      setAiFilledFields(filledKeys)
      setDataMessage(`Auto-filled ${filledKeys.length} field${filledKeys.length === 1 ? '' : 's'} from pasted text. Review before saving.`)
      setAiPasteOpen(false)
      setAiPasteText('')
    } catch (err) {
      setAiError(err instanceof GeminiExtractError ? err.message : 'Something went wrong while contacting Gemini. Please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  // Functional parsing helpers for the dynamic interface tables
  function getInvoiceItemsList(): InvoiceLineItem[] {
    return readInvoiceItems(bookingForm).map((item) => ({
      ...item,
      id: item.id || createLineItemId(),
      description: item.description,
    }))
  }

  function getBreakdownItemsList(): BreakdownLineItem[] {
    const invoiceTotal = sumLineItems(mapInvoiceItemsToBookingLines(readInvoiceItems(bookingForm), bookingForm.packageName), 'total')
    return readBreakdownItems(bookingForm).map((item) => ({
      ...item,
      id: item.id || createLineItemId(),
    }))
  }

  function saveBreakdownItemsList(items: BreakdownLineItem[]) {
    setBookingForm(prev => {
      const invoiceItems = readInvoiceItems(prev).map((item) => ({ ...item, id: item.id || createLineItemId() }))
      const invoiceTotal = sumLineItems(mapInvoiceItemsToBookingLines(invoiceItems, prev.packageName), 'total')
      const normalizedBreakdown = items.map((item) => ({
        ...item,
        id: item.id || createLineItemId(),
      }))
      const manualInvoiceItems = invoiceItems.filter((item) => item.source !== 'breakdown' && !item.isPackageRow)
      const breakdownInvoiceItems: InvoiceLineItem[] = normalizedBreakdown
        .filter((item) => item.isPackageRow || item.sendToInvoice)
        .map((item) => {
          const paxTotal = sumPaxBreakdown(getItemPaxBreakdown(item, prev))
          return {
            id: `INV-${item.id}`,
            source: 'breakdown',
            sourceKey: item.id,
            description: item.description,
            quantity: String(paxTotal > 0 ? paxTotal : parseQuantity(item.quantity) || 1),
            unitPrice: item.unitPrice,
            nettCost: '',
            ...(item.isPackageRow ? { isPackageRow: true } : {}),
          }
        })

      // The package row (locked nett, "Always on" to invoice) is the
      // single source of truth for the package — mirror its name/price
      // into the Quotation Info "Reference and base price" fields so the
      // quotation always reflects whatever was entered in the breakdown.
      const breakdownPackageRow = normalizedBreakdown.find((item) => item.isPackageRow)
      const packageSync = breakdownPackageRow
        ? {
            packageName: breakdownPackageRow.description || prev.packageName,
            invoicePackage: JSON.stringify({
              name: breakdownPackageRow.description || prev.packageName,
              qty: breakdownPackageRow.quantity || '1',
              price: breakdownPackageRow.unitPrice || '',
            }),
          }
        : {}

      return {
        ...prev,
        ...packageSync,
        invoiceLineItemsJson: JSON.stringify([...breakdownInvoiceItems.filter(i => i.isPackageRow), ...manualInvoiceItems, ...breakdownInvoiceItems.filter(i => !i.isPackageRow)]),
        breakdownLineItemsJson: JSON.stringify(normalizedBreakdown),
      }
    })
  }

  function startCustomBreakdownItem(index: number) {
    setCustomBreakdownDraft('')
    setCustomBreakdownRowIndex(index)
  }

  function cancelCustomBreakdownItem() {
    setCustomBreakdownRowIndex(-1)
    setCustomBreakdownDraft('')
  }

  function confirmCustomBreakdownItem(index: number) {
    const name = customBreakdownDraft.trim()
    if (!name) { cancelCustomBreakdownItem(); return }
    if (!breakdownOptions.includes(name)) {
      setBreakdownOptions((prev) => [...prev, name])
    }
    changeBreakdownItemField(index, 'description', name)
    cancelCustomBreakdownItem()
  }

  function removeCustomBreakdownOption(option: string) {
    if (defaultBreakdownOptions.includes(option)) return
    setBreakdownOptions((prev) => prev.filter((opt) => opt !== option))
    const brkCurrent = getBreakdownItemsList()
    const nextBrk = brkCurrent.map((item) =>
      (!item.isPackageRow && item.description === option)
        ? { ...item, description: defaultBreakdownOptions[0] }
        : item
    )
    saveBreakdownItemsList(nextBrk)
  }

  // Mirror a breakdown row's name to its linked Invoice addon / P.O.
  // supplier item (matched by the shared id encoded in mirrorId), so
  // edits made on the Breakdown side flow the other way too.
  function syncMirrorName(mirrorId: string | undefined, name: string) {
    if (!mirrorId) return
    const sharedId = mirrorId.replace(/^item-/, '')
    setBookingForm((prev) => {
      let curAddons: Array<{ id?: string; name?: string; [k: string]: any }> = []
      try { const a = JSON.parse(prev.invoiceAddons); if (Array.isArray(a)) curAddons = a } catch {}
      let poItems: POLineItem[] = []
      try { const p = JSON.parse(prev.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
      const nextAddons = curAddons.map((r) => (r.id === sharedId ? { ...r, name } : r))
      const nextPO = poItems.map((p) => (p.id === sharedId ? { ...p, serviceItem: name } : p))
      return { ...prev, invoiceAddons: JSON.stringify(nextAddons), poLineItemsJson: JSON.stringify(nextPO) }
    })
  }

  // Remove a breakdown row's linked Invoice addon / P.O. supplier item
  // (if any) when the breakdown row itself is removed.
  function removeMirroredAddonAndPO(mirrorId: string | undefined) {
    if (!mirrorId) return
    const sharedId = mirrorId.replace(/^item-/, '')
    setBookingForm((prev) => {
      let curAddons: Array<{ id?: string; [k: string]: any }> = []
      try { const a = JSON.parse(prev.invoiceAddons); if (Array.isArray(a)) curAddons = a } catch {}
      let poItems: POLineItem[] = []
      try { const p = JSON.parse(prev.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
      return {
        ...prev,
        invoiceAddons: JSON.stringify(curAddons.filter((r) => r.id !== sharedId)),
        poLineItemsJson: JSON.stringify(poItems.filter((p) => p.id !== sharedId)),
      }
    })
  }

  // itemType controls where this row appears once it's priced:
  //  - 'inclusion': internal cost, printed ONLY on the Breakdown document.
  //    It never shows on the Quotation or Invoice — its cost is meant to
  //    already be folded into the Package's flat per-pax rate instead.
  //  - 'addon': client-facing extra, printed on BOTH the Quotation and the
  //    Invoice as its own line — but never on the Breakdown.
  function addBreakdownItemRow(itemType: 'inclusion' | 'addon') {
    const sharedId = createLineItemId()
    const mirrorId = `item-${sharedId}`
    const name = breakdownOptions[0]
    const isAddon = itemType === 'addon'
    const current = getBreakdownItemsList()
    current.push({
      id: createLineItemId(), mirrorId, description: name, details: '', vendor: '', quantity: '1',
      unitPrice: '', nettCost: '', sendToInvoice: false, sendToPO: false,
      itemType, sendToQuotation: isAddon,
    })
    saveBreakdownItemsList(current)

    // A new Breakdown row also creates a matching Invoice addon and
    // Purchase Order supplier item, mirroring what already happens when
    // an addon/P.O. item is created on those tabs. An Inclusion's Invoice
    // addon is created hidden and stays that way — Inclusions never bill
    // separately, so there's no "Show to Invoice" toggle for them.
    setBookingForm((prev) => {
      let curAddons: Array<{ id: string; name: string; qty: string; price: string; nett: string; showInDocument?: boolean }> = []
      try { const a = JSON.parse(prev.invoiceAddons); if (Array.isArray(a)) curAddons = a } catch {}
      let poItems: POLineItem[] = []
      try { const p = JSON.parse(prev.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
      const nextAddons = [...curAddons, { id: sharedId, name, qty: '1', price: '', nett: '', showInDocument: isAddon }]
      const nextPO: POLineItem[] = [...poItems, {
        id: sharedId, vendor: '', contactNo: '', paymentMethod: '', agent: '', serviceItem: name, description: '',
        adultPax: '1', childPax: '0', seniorPax: '0', infantPax: '0', supplierNett: '', showInDocument: false,
      }]
      return { ...prev, invoiceAddons: JSON.stringify(nextAddons), poLineItemsJson: JSON.stringify(nextPO) }
    })
  }

  // Switches an existing row between Inclusion and Add-on after creation —
  // flips the same defaults addBreakdownItemRow sets initially (Quotation
  // visibility + linked Invoice addon visibility), so the row's actual
  // behavior always matches its current type badge.
  function setBreakdownItemType(index: number, itemType: 'inclusion' | 'addon') {
    const isAddon = itemType === 'addon'
    const current = getBreakdownItemsList()
    const item = current[index]
    if (!item || item.isPackageRow) return
    current[index] = { ...item, itemType, sendToQuotation: isAddon }
    saveBreakdownItemsList(current)

    const sharedId = item.mirrorId ? item.mirrorId.replace(/^item-/, '') : item.id
    if (!sharedId) return
    setBookingForm((prev) => {
      let curAddons: Array<{ id: string; showInDocument?: boolean; [k: string]: any }> = []
      try { const a = JSON.parse(prev.invoiceAddons); if (Array.isArray(a)) curAddons = a } catch {}
      const idx = curAddons.findIndex((a) => a.id === sharedId)
      if (idx === -1) return prev
      const nextAddons = curAddons.map((a, i) => (i === idx ? { ...a, showInDocument: isAddon } : a))
      return { ...prev, invoiceAddons: JSON.stringify(nextAddons) }
    })
  }

  function removeBreakdownItemRow(index: number) {
    const brkCurrent = getBreakdownItemsList()
    const item = brkCurrent[index]
    if (item?.isPackageRow) return
    brkCurrent.splice(index, 1)
    saveBreakdownItemsList(brkCurrent)
    removeMirroredAddonAndPO(item?.mirrorId)
  }

  // Mirror a breakdown row's Vendor / Contact No. / Agent / Payment method
  // to its linked Purchase Order supplier item (matched by the shared id
  // encoded in mirrorId), so filling these in on the Breakdown tab's
  // Pax-Tier Pricing row also fills them on the actual P.O. document.
  function syncMirrorPOField(mirrorId: string | undefined, field: 'vendor' | 'contactNo' | 'agent' | 'paymentMethod', value: string) {
    if (!mirrorId) return
    const sharedId = mirrorId.replace(/^item-/, '')
    setBookingForm((prev) => {
      let poItems: POLineItem[] = []
      try { const p = JSON.parse(prev.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
      const idx = poItems.findIndex((p) => p.id === sharedId)
      if (idx === -1) return prev
      const nextPO = poItems.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
      return { ...prev, poLineItemsJson: JSON.stringify(nextPO) }
    })
  }

  // Mirror a breakdown row's per-tier "No. of Pax" counts to its linked
  // Purchase Order supplier item, so the # of Pax printed on the actual
  // P.O. document always matches what was entered on the Breakdown tab's
  // Pax-Tier Pricing row instead of staying at its created-with default.
  function syncMirrorPOPax(mirrorId: string | undefined, pax: PaxBreakdown) {
    if (!mirrorId) return
    const sharedId = mirrorId.replace(/^item-/, '')
    setBookingForm((prev) => {
      let poItems: POLineItem[] = []
      try { const p = JSON.parse(prev.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
      const idx = poItems.findIndex((p) => p.id === sharedId)
      if (idx === -1) return prev
      const nextPO = poItems.map((p, i) => (
        i === idx ? { ...p, adultPax: pax.adult, childPax: pax.child, seniorPax: pax.senior, infantPax: pax.infant } : p
      ))
      return { ...prev, poLineItemsJson: JSON.stringify(nextPO) }
    })
  }

  // The P.O.'s Description column has no equivalent field anywhere else
  // (the Breakdown row's "Details" is a different, separate field), so it's
  // edited directly on the linked P.O. item rather than mirrored from one.
  function changePOItemDescription(mirrorId: string | undefined, value: string) {
    if (!mirrorId) return
    const sharedId = mirrorId.replace(/^item-/, '')
    setBookingForm((prev) => {
      let poItems: POLineItem[] = []
      try { const p = JSON.parse(prev.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
      const idx = poItems.findIndex((p) => p.id === sharedId)
      if (idx === -1) return prev
      const nextPO = poItems.map((p, i) => (i === idx ? { ...p, description: value } : p))
      return { ...prev, poLineItemsJson: JSON.stringify(nextPO) }
    })
  }

  function changeBreakdownItemField(index: number, field: keyof BreakdownLineItem, value: any) {
    let brkCurrent = getBreakdownItemsList()
    const item = brkCurrent[index]
    brkCurrent[index] = { ...item, [field]: value }

    if (field === 'vendor') {
      // Changing the Vendor name: if another row already uses this exact
      // vendor, pull ITS Contact No. / Agent / Payment Method onto this
      // row instead of leaving them blank — so picking a vendor that's
      // already used elsewhere fills the rest in automatically.
      const vendorKey = (value || '').trim().toLowerCase()
      const match = vendorKey
        ? brkCurrent.find((row, i) => i !== index && !row.isPackageRow && (row.vendor || '').trim().toLowerCase() === vendorKey)
        : undefined
      if (match) {
        brkCurrent[index] = { ...brkCurrent[index], contactNumber: match.contactNumber, agent: match.agent, paymentMethod: match.paymentMethod }
      }
    } else if (field === 'contactNumber' || field === 'agent' || field === 'paymentMethod') {
      // Editing a supplier detail: push it out to every OTHER row that
      // shares this row's Vendor, so filling it in once on any row for a
      // vendor fills it in for every row with that same vendor.
      const vendorKey = (brkCurrent[index].vendor || '').trim().toLowerCase()
      if (vendorKey) {
        brkCurrent = brkCurrent.map((row, i) => {
          if (i === index || row.isPackageRow) return row
          if ((row.vendor || '').trim().toLowerCase() !== vendorKey) return row
          return { ...row, [field]: value }
        })
      }
    }

    saveBreakdownItemsList(brkCurrent)
    if (field === 'description') syncMirrorName(item?.mirrorId, value)
    if (field === 'vendor') syncMirrorPOField(item?.mirrorId, 'vendor', value)
    if (field === 'contactNumber') syncMirrorPOField(item?.mirrorId, 'contactNo', value)
    if (field === 'agent') syncMirrorPOField(item?.mirrorId, 'agent', value)
    if (field === 'paymentMethod') syncMirrorPOField(item?.mirrorId, 'paymentMethod', value)

    // Mirror the same vendor-group propagation onto each affected row's
    // linked P.O. supplier item, so the printed Purchase Order document
    // (which groups rows by Vendor) reflects the shared details too.
    if (field === 'vendor') {
      const updated = brkCurrent[index]
      syncMirrorPOField(updated.mirrorId, 'contactNo', updated.contactNumber || '')
      syncMirrorPOField(updated.mirrorId, 'agent', updated.agent || '')
      syncMirrorPOField(updated.mirrorId, 'paymentMethod', updated.paymentMethod || '')
    } else if (field === 'contactNumber' || field === 'agent' || field === 'paymentMethod') {
      const vendorKey = (brkCurrent[index].vendor || '').trim().toLowerCase()
      if (vendorKey) {
        const poField = field === 'contactNumber' ? 'contactNo' : field
        brkCurrent.forEach((row, i) => {
          if (i === index || row.isPackageRow) return
          if ((row.vendor || '').trim().toLowerCase() !== vendorKey) return
          syncMirrorPOField(row.mirrorId, poField, value)
        })
      }
    }
  }

  // Flips the "Show to Document" flag on the Invoice addon or P.O. line item
  // that's mirrored 1:1 with this Breakdown row (same shared id), so the
  // toggle can live on the Breakdown tab's Pax-Tier Pricing row itself.
  function toggleBreakdownMirrorVisibility(mirrorId: string | undefined, itemId: string | undefined, target: 'invoice' | 'po') {
    const sharedId = mirrorId ? mirrorId.replace(/^item-/, '') : itemId
    if (!sharedId) return
    setDataError('')
    setDataMessage('')
    setBookingForm((prev) => {
      if (target === 'invoice') {
        type AddonRow = { id: string; name: string; qty: string; price: string; nett: string; showInDocument?: boolean }
        let curAddons: AddonRow[] = []
        try { const a = JSON.parse(prev.invoiceAddons); if (Array.isArray(a)) curAddons = a } catch {}
        const idx = curAddons.findIndex((a) => a.id === sharedId)
        if (idx === -1) return prev
        const shown = curAddons[idx].showInDocument !== false
        const nextAddons = curAddons.map((a, i) => (i === idx ? { ...a, showInDocument: !shown } : a))
        return { ...prev, invoiceAddons: JSON.stringify(nextAddons) }
      }
      let poItems: POLineItem[] = []
      try { const p = JSON.parse(prev.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
      const idx = poItems.findIndex((p) => p.id === sharedId)
      if (idx === -1) return prev
      const shown = poItems[idx].showInDocument !== false
      const nextPO = poItems.map((p, i) => (i === idx ? { ...p, showInDocument: !shown } : p))
      return { ...prev, poLineItemsJson: JSON.stringify(nextPO) }
    })
  }

  // Sets the booking's single shared group headcount — every Pax-Tier
  // Pricing row inherits this automatically unless it's opted a category
  // out via toggleItemPaxCategory below.
  function updateGroupPaxField(category: keyof PaxBreakdown, value: string) {
    setDataError('')
    setDataMessage('')
    setBookingForm((prev) => {
      const pax = readPaxBreakdown(prev.groupPax)
      pax[category] = value
      const updated = { ...prev, groupPax: JSON.stringify(pax) }
      // Keep every row's linked P.O. item's "# of Pax" in step with the
      // new group total (minus whatever that row has excluded).
      try {
        const brkItems = readBreakdownItems(updated)
        brkItems.forEach((item) => {
          if (item.mirrorId) syncMirrorPOPax(item.mirrorId, getItemPaxBreakdown(item, updated))
        })
      } catch (e) {}
      return updated
    })
  }

  // Opts a Pax-Tier Pricing row in/out of a category from the shared group
  // headcount — e.g. removing "Child" from a row that only the adults in
  // the group are taking.
  function toggleItemPaxCategory(index: number, category: keyof PaxBreakdown) {
    const current = getBreakdownItemsList()
    const item = current[index]
    if (!item) return
    const excluded = readExcludedPax(item)
    const nextExcluded = excluded.includes(category)
      ? excluded.filter((c) => c !== category)
      : [...excluded, category]
    current[index] = { ...item, excludedPax: JSON.stringify(nextExcluded) }
    saveBreakdownItemsList(current)
    const nextPax = getItemPaxBreakdown({ ...item, excludedPax: JSON.stringify(nextExcluded) }, bookingForm)
    syncMirrorPOPax(item.mirrorId, nextPax)
  }

  function validateBookingForm() {
    if (!bookingForm.clientName.trim()) return 'Enter the client name before saving.'
    // packageName is optional — section 05 package row drives document labels
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
    
    const existingBooking = isEditing
      ? ((lastSavedBookingRef.current?.id === editingBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((currentBooking) => currentBooking.id === editingBookingId))
      : null

    const booking: BookingRecord = {
      ...bookingForm,
      unitPrice: String(calculatedUnitPrice),
      sellingPrice: String(getBookingClientTotal(bookingForm)),
      id: editingBookingId || `BK-${Date.now()}`,
      createdAt: bookingCreatedAt
        ? new Date(bookingCreatedAt + 'T00:00:00').toISOString()
        : (existingBooking?.createdAt || new Date().toISOString()),
      createdByName: bookingForm.createdByName || authUser?.displayName || '',
      ownerId: existingBooking?.ownerId || authUser?.uid,
    }

    // Pin the exact saved booking so templates read fresh data immediately,
    // before the Firestore onSnapshot has a chance to overwrite bookings state.
    lastSavedBookingRef.current = booking

    setBookings((currentBookings) =>
      isEditing
        ? currentBookings.map((currentBooking) => currentBooking.id === booking.id ? booking : currentBooking)
        : [booking, ...currentBookings],
    )

    try {
      if (!authUser) throw new Error('Missing signed-in user')
      await setDoc(doc(db, getBookingOwnerPath(booking, authUser.uid), booking.id), {
        ...booking,
        createdBy: existingBooking ? (existingBooking as any).createdBy || authUser.uid : authUser.uid,
        createdByEmail: existingBooking ? (existingBooking as any).createdByEmail || authUser.email || '' : authUser.email || '',
        createdByName: existingBooking?.createdByName || authUser.displayName || booking.createdByName || '',
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      
      setDataError('')
      setDataMessage(isEditing ? 'Booking changes saved successfully.' : 'Inquiry saved successfully.')
      setSelectedBookingId(booking.id)
      if (isEditing) {
        setEditingBookingId('')
        setScreen('booking-detail')
      } else {
        setEditingBookingId('')
        setScreen('home')
      }
    } catch {
      setDataError(isEditing ? 'Booking updated locally, but cloud update failed.' : 'Booking saved locally, but cloud save failed.')
      setDataMessage('')
      setSelectedBookingId(booking.id)
      if (isEditing) {
        setEditingBookingId('')
        setScreen('booking-detail')
      } else {
        setEditingBookingId('')
        setScreen('home')
      }
    }
  }

  function openBookingDetail(bookingId: string) {
    setSelectedBookingId(bookingId)
    setScreen('booking-detail')
  }

  function updateSelectedBookingCreatedAt(dateStr: string) {
    if (!dateStr) return
    const targetBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)
    const createdAt = new Date(dateStr + 'T00:00:00').toISOString()

    setBookings((currentBookings) =>
      currentBookings.map((booking) => booking.id === selectedBookingId ? { ...booking, createdAt } : booking)
    )
    if (lastSavedBookingRef.current?.id === selectedBookingId) {
      lastSavedBookingRef.current = { ...lastSavedBookingRef.current, createdAt }
    }

    if (selectedBookingId) {
      if (!authUser) {
        setDataError('Log in again before updating cloud records.')
        return
      }
      void setDoc(doc(db, getBookingOwnerPath(targetBooking, authUser.uid), selectedBookingId), {
        createdAt,
        updatedAt: new Date().toISOString(),
      }, { merge: true }).catch(() => {
        setDataError('Date updated locally, but cloud update failed.')
      })
    }
  }

  // Pushes a currency straight onto a saved booking (local state +
  // Firestore) — without requiring a full Save Booking submit. Used by
  // every "Apply to Document" button (data-form editor and every
  // read-only project screen) so Quotation & Invoice pick up the new
  // currency (and the ACR line) right away.
  function applyCurrencyToBookingId(bookingId: string, nextCurrency: string) {
    if (!bookingId) return
    const clearAcr = nextCurrency === 'PHP' ? { acr: '' } : {}
    const targetBooking = (lastSavedBookingRef.current?.id === bookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === bookingId)
    if (!targetBooking) return

    setBookings((currentBookings) =>
      currentBookings.map((booking) => booking.id === bookingId ? { ...booking, currency: nextCurrency, ...clearAcr } : booking)
    )
    if (lastSavedBookingRef.current?.id === bookingId) {
      lastSavedBookingRef.current = { ...lastSavedBookingRef.current, currency: nextCurrency, ...clearAcr }
    }

    setDataError('')
    setDataMessage(
      nextCurrency === 'PHP'
        ? 'Document currency reset to PHP on the Quotation & Invoice.'
        : `Applied ${nextCurrency} to the Quotation & Invoice. The ACR (PHP total) will show automatically.`
    )

    if (!authUser) {
      setDataError('Log in again before updating cloud records.')
      return
    }
    void setDoc(doc(db, getBookingOwnerPath(targetBooking, authUser.uid), bookingId), {
      currency: nextCurrency,
      ...clearAcr,
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => {
      setDataError('Currency updated locally, but cloud update failed.')
    })
  }

  // Manually move a booking between the two staff-controlled stages,
  // Quotation and Invoice — pushed straight to local state + Firestore,
  // no full Save Booking submit needed. Confirmed and Flown are
  // deliberately excluded: those only ever happen automatically (payment
  // logged, or travel end date passed) and are never selectable here.
  function applyStatusToBookingId(bookingId: string, nextStatus: BookingStatus) {
    if (!bookingId) return
    if (nextStatus !== 'Quotation' && nextStatus !== 'Invoice') return
    const targetBooking = (lastSavedBookingRef.current?.id === bookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === bookingId)
    if (!targetBooking) return
    if (targetBooking.status === 'Confirmed' || targetBooking.status === 'Flown') return

    setBookings((currentBookings) =>
      currentBookings.map((booking) => booking.id === bookingId ? { ...booking, status: nextStatus } : booking)
    )
    if (lastSavedBookingRef.current?.id === bookingId) {
      lastSavedBookingRef.current = { ...lastSavedBookingRef.current, status: nextStatus }
    }

    setDataError('')
    setDataMessage(`Stage set to ${nextStatus}.`)

    if (!authUser) {
      setDataError('Log in again before updating cloud records.')
      return
    }
    void setDoc(doc(db, getBookingOwnerPath(targetBooking, authUser.uid), bookingId), {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => {
      setDataError('Stage updated locally, but cloud update failed.')
    })
  }

  // Pushes a manually-typed conversion rate (ACR) straight onto a saved
  // booking (local state + Firestore), the same way applyCurrencyToBookingId
  // does for currency. `nextAcr` is the PHP value of 1 unit of the
  // booking's chosen currency, entered by hand — e.g. "65" for USD.
  function applyAcrToBookingId(bookingId: string, nextAcr: string) {
    if (!bookingId) return
    const targetBooking = (lastSavedBookingRef.current?.id === bookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === bookingId)
    if (!targetBooking) return

    setBookings((currentBookings) =>
      currentBookings.map((booking) => booking.id === bookingId ? { ...booking, acr: nextAcr } : booking)
    )
    if (lastSavedBookingRef.current?.id === bookingId) {
      lastSavedBookingRef.current = { ...lastSavedBookingRef.current, acr: nextAcr }
    }

    if (!authUser) {
      setDataError('Log in again before updating cloud records.')
      return
    }
    void setDoc(doc(db, getBookingOwnerPath(targetBooking, authUser.uid), bookingId), {
      acr: nextAcr,
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => {
      setDataError('Rate updated locally, but cloud update failed.')
    })
  }

  // Used by the picker on the data-form screen, which edits currency via
  // the live bookingForm state rather than a saved-booking id directly.
  function applyCurrencyToDocuments() {
    applyCurrencyToBookingId(editingBookingId, bookingForm.currency || 'PHP')
  }

  function openQuotationPreview() { setScreen('quotation-preview') }
  
  function openInvoiceEditor() {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)
    if (!selectedBooking) {
      setScreen('home')
      return
    }
    if (screen === 'booking-detail' || screen === 'document-folder') {
      setInvoiceEditorReturnScreen(screen)
    }
    setInvoiceForm({
      paymentMethod: selectedBooking.paymentMethod || '',
      paymentRecords: selectedBooking.paymentRecords || '',
      invoiceAmountPaid: selectedBooking.invoiceAmountPaid || '',
      invoicePaymentDate: selectedBooking.invoicePaymentDate || '',
      invoicePaymentStatus: selectedBooking.invoicePaymentStatus || 'Unpaid',
      invoiceFullyPaidDate: selectedBooking.invoiceFullyPaidDate || '',
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

  function handleLogPayment() {
    const amount = parseFloat(paymentEntry.amount)
    if (!amount || amount <= 0) return
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)
    const totalPrice = selectedBooking ? sumLineItems(getBookingLineItems(selectedBooking), 'total') : 0
    const dateLabel = paymentEntry.date
      ? new Date(paymentEntry.date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    const methodPart = paymentEntry.method ? ` via ${paymentEntry.method}` : ''
    const refPart = paymentEntry.reference ? ` (Ref: ${paymentEntry.reference})` : ''
    const record = `${dateLabel}${methodPart}${refPart} — PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
    const prevPaid = parseAmount(invoiceForm.invoiceAmountPaid)
    const newPaid = prevPaid + amount
    const prevRecords = invoiceForm.paymentRecords.trim()
    const newRecords = prevRecords ? `${prevRecords}\n${record}` : record
    const newStatus = computePaymentStatus(totalPrice, newPaid)
    setInvoiceForm((f) => ({
      ...f,
      invoiceAmountPaid: String(newPaid),
      paymentRecords: newRecords,
      paymentMethod: paymentEntry.method || f.paymentMethod,
      invoicePaymentDate: paymentEntry.date || f.invoicePaymentDate,
      invoicePaymentStatus: newStatus,
      invoiceFullyPaidDate: newStatus === 'Paid' ? (f.invoiceFullyPaidDate || paymentEntry.date || f.invoicePaymentDate) : '',
    }))
    setPaymentEntry({ amount: '', method: '', reference: '', date: toDateInputValue() })
  }

  function getInvoiceEditorTotal(): number {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)
    return selectedBooking ? sumLineItems(getBookingLineItems(selectedBooking), 'total') : 0
  }

  function handleRemovePaymentRecord(index: number) {
    const lines = invoiceForm.paymentRecords.split('\n').filter(Boolean)
    const removedLine = lines[index] || ''
    lines.splice(index, 1)
    const removedAmountMatch = removedLine.match(/PHP\s*([\d,]+(?:\.\d{1,2})?)\s*$/)
    const removedAmount = removedAmountMatch ? parseAmount(removedAmountMatch[1]) : 0
    const newPaid = Math.max(parseAmount(invoiceForm.invoiceAmountPaid) - removedAmount, 0)
    const totalPrice = getInvoiceEditorTotal()
    const newStatus = computePaymentStatus(totalPrice, newPaid)
    setInvoiceForm((f) => ({
      ...f,
      paymentRecords: lines.join('\n'),
      invoiceAmountPaid: String(newPaid),
      invoicePaymentStatus: newStatus,
      invoiceFullyPaidDate: newStatus === 'Paid' ? f.invoiceFullyPaidDate : '',
    }))
  }

  function handlePaymentStatusSelect(nextStatus: string) {
    const totalPrice = getInvoiceEditorTotal()
    const currentPaid = parseAmount(invoiceForm.invoiceAmountPaid)
    if (nextStatus === 'Paid' && currentPaid < totalPrice) {
      setFullyPaidDateInput(toDateInputValue())
      setIsFullyPaidModalOpen(true)
      return
    }
    setInvoiceForm((f) => ({
      ...f,
      invoicePaymentStatus: nextStatus,
      invoiceFullyPaidDate: nextStatus === 'Paid' ? (f.invoiceFullyPaidDate || toDateInputValue()) : '',
    }))
  }

  function confirmFullyPaid() {
    const totalPrice = getInvoiceEditorTotal()
    const currentPaid = parseAmount(invoiceForm.invoiceAmountPaid)
    const remaining = Math.max(totalPrice - currentPaid, 0)
    const dateLabel = new Date(fullyPaidDateInput + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    const prevRecords = invoiceForm.paymentRecords.trim()
    let newRecords = prevRecords
    if (remaining > 0) {
      const record = `${dateLabel} — Marked fully paid (balance settled) — PHP ${remaining.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
      newRecords = prevRecords ? `${prevRecords}\n${record}` : record
    }
    setInvoiceForm((f) => ({
      ...f,
      invoiceAmountPaid: String(totalPrice),
      paymentRecords: newRecords,
      invoicePaymentStatus: 'Paid',
      invoiceFullyPaidDate: fullyPaidDateInput,
      invoicePaymentDate: fullyPaidDateInput,
    }))
    setIsFullyPaidModalOpen(false)
  }

  async function handleSaveInvoiceUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const targetBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

    // Payment received (even a partial downpayment) on a still-Quotation or
    // still-Invoice project means the booking is on — auto-confirm it. This
    // only ever moves Quotation/Invoice -> Confirmed; it never touches a
    // project that's already Confirmed or Flown, and it never downgrades
    // anything. Confirmed and Flown are automatic-only — never manually
    // selectable.
    const amountPaidNow = parseAmount(invoiceForm.invoiceAmountPaid)
    const shouldAutoConfirm = amountPaidNow > 0 && (targetBooking?.status === 'Quotation' || targetBooking?.status === 'Invoice')
    const invoiceFormToSave = shouldAutoConfirm ? { ...invoiceForm, status: 'Confirmed' as BookingStatus } : invoiceForm

    setBookings((currentBookings) =>
      currentBookings.map((booking) =>
        booking.id === selectedBookingId ? { ...booking, ...invoiceFormToSave } : booking
      )
    )
    if (lastSavedBookingRef.current?.id === selectedBookingId) {
      lastSavedBookingRef.current = { ...lastSavedBookingRef.current, ...invoiceFormToSave }
    }

    try {
      if (!authUser) throw new Error('Missing signed-in user')
      const resolvedPath = getBookingOwnerPath(targetBooking, authUser.uid)
      console.log('[DEBUG invoice-save]', {
        selectedBookingId,
        authUid: authUser.uid,
        targetBookingFound: Boolean(targetBooking),
        targetBookingId: targetBooking?.id,
        targetBookingOwnerId: targetBooking?.ownerId,
        resolvedPath,
        bookingsArrayLength: bookings.length,
      })
      await setDoc(doc(db, resolvedPath, selectedBookingId), {
        ...invoiceFormToSave,
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      setDataError('')
      setDataMessage(shouldAutoConfirm ? 'Invoice payment details saved — project auto-confirmed.' : 'Invoice payment details saved successfully.')
      setScreen('invoice-preview')
    } catch {
      setDataError('Invoice saved locally, but cloud update failed.')
      setDataMessage('')
      setScreen('invoice-preview')
    }
  }

  async function handleRegenerateAllQuotationNumbers() {
    if (bookings.length === 0) return
    const confirmed = window.confirm(
      `Give every one of the ${bookings.length} existing projects a new random quotation number? Old printed copies will show the old number — this cannot be undone.`
    )
    if (!confirmed) return
    if (!authUser) {
      setDataError('Log in again before updating cloud records.')
      return
    }

    const usedNumbers = new Set<string>()
    const updates = bookings.map((booking) => {
      let nextNo = generateQuotationNo()
      while (usedNumbers.has(nextNo)) nextNo = generateQuotationNo()
      usedNumbers.add(nextNo)
      return { booking, nextNo }
    })

    setBookings((currentBookings) =>
      currentBookings.map((booking) => {
        const match = updates.find((u) => u.booking.id === booking.id)
        return match ? { ...booking, quotationNo: match.nextNo } : booking
      })
    )
    if (lastSavedBookingRef.current) {
      const match = updates.find((u) => u.booking.id === lastSavedBookingRef.current!.id)
      if (match) lastSavedBookingRef.current = { ...lastSavedBookingRef.current, quotationNo: match.nextNo }
    }

    try {
      await Promise.all(
        updates.map(({ booking, nextNo }) =>
          setDoc(doc(db, getBookingOwnerPath(booking, authUser.uid), booking.id), {
            quotationNo: nextNo,
            updatedAt: new Date().toISOString(),
          }, { merge: true })
        )
      )
      setDataError('')
      setDataMessage(`Assigned new quotation numbers to ${updates.length} project(s).`)
    } catch {
      setDataError('Quotation numbers updated locally, but some cloud updates may have failed. Refresh to check.')
    }
  }

  async function handleDeleteBooking() {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)
    if (!selectedBooking) { setScreen('home'); return }

    const confirmed = window.confirm(`Delete ${selectedBooking.packageName || 'this project'}? This cannot be undone.`)
    if (!confirmed) return

    setBookings((currentBookings) => currentBookings.filter((booking) => booking.id !== selectedBookingId))
    try {
      if (!authUser) throw new Error('Missing signed-in user')
      const resolvedPath = getBookingOwnerPath(selectedBooking, authUser.uid)
      console.log('[DEBUG delete]', {
        selectedBookingId,
        authUid: authUser.uid,
        selectedBookingOwnerId: selectedBooking.ownerId,
        resolvedPath,
      })
      await deleteDoc(doc(db, resolvedPath, selectedBookingId))
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

  // Downloaded files are named after the client (full name, as entered) +
  // doc type + travel date, e.g. "floyd-allen-b-bueno_invoice_0610" — the
  // travel date is what keeps repeat customers' different bookings from
  // overwriting each other's downloads.
  function buildDownloadBaseName(booking: BookingRecord | undefined, docType: string) {
    const rawName = (booking?.clientName || '').trim()
    const nameSlug = rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'client'

    const travelDateRaw = booking?.travelStart || booking?.travelEnd || ''
    const parsedTravelDate = travelDateRaw ? new Date(`${travelDateRaw}T00:00:00`) : null
    const dateSlug = parsedTravelDate && !isNaN(parsedTravelDate.getTime())
      ? `${String(parsedTravelDate.getMonth() + 1).padStart(2, '0')}${String(parsedTravelDate.getDate()).padStart(2, '0')}`
      : (booking?.quotationNo?.match(/(\d{4})/)?.[1] || String(new Date().getFullYear()))

    return `${nameSlug}_${docType}_${dateSlug}`
  }

  function currentDocTypeLabel() {
    switch (screen) {
      case 'quotation-preview': return 'quotation'
      case 'invoice-preview': return 'invoice'
      case 'purchase-order-preview': return 'purchaseorder'
      case 'voucher-preview': return 'voucher'
      case 'breakdown-preview': return 'breakdown'
      default: return 'document'
    }
  }

  async function handlePrintPreview() {
    const isDtrScreen = screen === 'dtr'
    let printableArea: HTMLElement | null = null
    let restoreFn: (() => void) | null = null

    // The print/export doc is always forced to a white background, but its text/border
    // colors come from CSS variables that flip to light-on-dark values in dark mode.
    // White-on-white = invisible PDF. Force light theme for the capture, then restore.
    const root = document.documentElement
    const savedTheme = root.getAttribute('data-theme')
    const wasDark = savedTheme === 'dark'
    if (wasDark) root.setAttribute('data-theme', 'light')

    let captureOverlay: HTMLDivElement | null = null

    if (isDtrScreen) {
      const docEl = document.querySelector<HTMLElement>('.dtr-print-doc')
      if (!docEl) { if (wasDark) root.setAttribute('data-theme', 'dark'); window.print(); return }

      // html2canvas can render a blank/white canvas when the captured element sits at an
      // extreme off-screen position (e.g. left:-9999px) — the internal canvas math gets
      // confused, especially at scale:2. Instead, briefly bring the doc fully on-screen
      // (top-left, fixed) behind a solid white overlay so nothing looks broken to the user.
      captureOverlay = document.createElement('div')
      captureOverlay.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99998;'
      document.body.appendChild(captureOverlay)

      const saved = { display: docEl.style.display, visibility: docEl.style.visibility, position: docEl.style.position, left: docEl.style.left, top: docEl.style.top, width: docEl.style.width, padding: docEl.style.padding, background: docEl.style.background, zIndex: docEl.style.zIndex }
      docEl.style.cssText += ';display:block!important;visibility:visible!important;position:fixed!important;left:0!important;top:0!important;width:794px!important;padding:32px!important;background:#fff!important;color:#1a1a1a!important;z-index:99999!important;max-height:none!important;'

      // Make sure the logo image (and any other images) inside the doc have actually
      // finished loading before we snapshot — a not-yet-loaded image also renders blank.
      const images = Array.from(docEl.querySelectorAll('img'))
      await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise((res) => {
        img.addEventListener('load', res, { once: true })
        img.addEventListener('error', res, { once: true })
        setTimeout(res, 1500)
      })))

      await new Promise((r) => requestAnimationFrame(r))
      await new Promise((r) => requestAnimationFrame(r))
      printableArea = docEl
      restoreFn = () => {
        Object.assign(docEl.style, saved)
        captureOverlay?.remove()
        if (wasDark) root.setAttribute('data-theme', 'dark')
      }
    } else {
      printableArea = document.querySelector<HTMLElement>('.print-document')
      if (!printableArea) { if (wasDark) root.setAttribute('data-theme', 'dark'); window.print(); return }
      restoreFn = () => { if (wasDark) root.setAttribute('data-theme', 'dark') }
    }

    try {
      setIsPdfExporting(true)
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(printableArea, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false, windowWidth: isDtrScreen ? 860 : undefined })
      restoreFn?.()

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

      let fileName: string
      if (isDtrScreen) {
        const emp = dtrNameFilter === 'All' ? 'all-staff' : dtrNameFilter.replace(/\s+/g, '-').toLowerCase()
        fileName = `DTR_${emp}_${dtrMonthFilter === 'all' ? 'all-records' : dtrMonthFilter}.pdf`
      } else {
        const currentBooking = bookings.find((b) => b.id === selectedBookingId)
        fileName = `${buildDownloadBaseName(currentBooking, currentDocTypeLabel())}.pdf`
      }
      pdf.save(fileName.replace(/[^\w.-]+/g, '_'))
    } catch {
      restoreFn?.()
      setDataError(isDtrScreen ? 'DTR PDF export failed. Use the Print button as a fallback.' : 'PDF download failed. Use Ctrl+P and turn off browser headers and footers.')
      window.print()
    } finally {
      setIsPdfExporting(false)
    }
  }

  async function handleDownloadJpg() {
    const root = document.documentElement
    const savedTheme = root.getAttribute('data-theme')
    const wasDark = savedTheme === 'dark'
    if (wasDark) root.setAttribute('data-theme', 'light')

    const printableArea = document.querySelector('.print-document') as HTMLElement | null
    if (!printableArea) {
      if (wasDark) root.setAttribute('data-theme', 'dark')
      return
    }

    try {
      setIsJpgExporting(true)
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(printableArea, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      if (wasDark) root.setAttribute('data-theme', 'dark')

      const currentBooking = bookings.find((b) => b.id === selectedBookingId)
      const baseName = buildDownloadBaseName(currentBooking, currentDocTypeLabel())

      const pageHeightPx = Math.round((canvas.width * 297) / 210)
      const totalPages = Math.ceil(canvas.height / pageHeightPx)

      if (totalPages <= 1) {
        const link = document.createElement('a')
        link.download = baseName.replace(/[^\w.-]+/g, '_') + '.jpg'
        link.href = canvas.toDataURL('image/jpeg', 0.95)
        link.click()
      } else {
        for (let i = 0; i < totalPages; i++) {
          const pageCanvas = document.createElement('canvas')
          pageCanvas.width = canvas.width
          const sliceH = Math.min(pageHeightPx, canvas.height - i * pageHeightPx)
          pageCanvas.height = sliceH
          const ctx = pageCanvas.getContext('2d')!
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
          ctx.drawImage(canvas, 0, -i * pageHeightPx)
          const link = document.createElement('a')
          link.download = baseName.replace(/[^\w.-]+/g, '_') + '_p' + (i + 1) + '.jpg'
          link.href = pageCanvas.toDataURL('image/jpeg', 0.95)
          link.click()
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    } catch {
      if (wasDark) root.setAttribute('data-theme', 'dark')
      setDataError('JPG export failed. Try the PDF or Print option instead.')
    } finally {
      setIsJpgExporting(false)
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Reusable document body renderers. Each takes any booking-shaped data
  // (a saved BookingRecord OR a live in-progress draft built from
  // bookingForm) and renders the same document markup used by the full
  // preview screens. This lets the Data Gathering form show a genuine
  // live preview of the actual document while the user types, and keeps
  // the full preview screens and the live preview panel pixel-identical.
  // ────────────────────────────────────────────────────────────────────
  function renderQuotationDoc(selectedBooking: BookingRecord) {
    type PackageRow = { name: string; qty: string; price: string }
    let quotePkg: PackageRow = { name: '', qty: '1', price: '' }
    try { const p = JSON.parse(selectedBooking.invoicePackage || ''); if (p && typeof p === 'object') quotePkg = p } catch {}

    const hasNewQuoteData = !!(quotePkg.name || quotePkg.price)

    // Pax-type addons — merged by name across all pax types into one line
    // item each (e.g. a "Hotel" addon added under both Adult and Infant
    // becomes a single "Hotel" row with the combined amount), with no
    // pax-type label since it applies to the booking as a whole.
    type PaxAddon = { id: string; paxType: string; name: string; price: string }
    let quotePaxAddons: PaxAddon[] = []
    try {
      const a = JSON.parse(selectedBooking.quotationPaxAddons || '')
      if (Array.isArray(a)) quotePaxAddons = a
    } catch {}
    const addonTotalsByName = new Map<string, number>()
    quotePaxAddons.forEach((a) => {
      const name = (a.name || '').trim()
      if (!name) return
      addonTotalsByName.set(name, (addonTotalsByName.get(name) || 0) + (parseFloat(a.price) || 0))
    })
    const quotePaxTotal = getBreakdownPaxTotal(selectedBooking)

    const addonLineItems = Array.from(addonTotalsByName.entries()).map(([name, amount]) => {
      const q = quotePaxTotal > 0 ? quotePaxTotal : 1
      const u = amount / q
      return { description: name, quantity: q, unitPrice: u, nettCost: 0, total: amount, nettTotal: 0, profit: amount }
    })

    // Breakdown Pax-Tier Pricing rows explicitly toggled "Show to Quotation"
    // render as ONE combined line per item — its Qty is the sum of the
    // headcounts across whichever pax tiers actually have a price filled in
    // for that item (e.g. 2 Adult + 3 Child = Qty 5), and its Unit Price is
    // the total amount averaged back over that combined Qty, so the printed
    // Amount still matches the internal Breakdown sheet exactly. This is the
    // same combining logic used on the Invoice, via the shared helper.
    const breakdownQuoteLineItems: BookingLineItem[] = sortBreakdownItemsByRate(
      readBreakdownItems(selectedBooking).filter((item) => !item.isPackageRow && item.sendToQuotation)
    ).map((item) => buildCombinedTierLine(item.description, item, quotePaxTotal, selectedBooking))

    // The Package row (first row of Pax-Tier Pricing) carries its own
    // per-pax-type rate instead of a single flat price. On the document it
    // prints as a plain label (no Qty/Unit Price of its own), followed by
    // one UN-combined sub-row per pax type that has both a rate and a
    // headcount set — e.g. "Adult Rate" (Qty 5), "Child Rate" (Qty 1).
    // Same source used on the Invoice, via the shared helper. The package
    // always shows on the Quotation — there's no "Show to Quotation" toggle
    // for it anymore.
    const pkgTierRows = buildPackageTierLines(selectedBooking)
    const hasPkgTierRates = pkgTierRows.length > 0

    // Once addons or "Show to Quotation" breakdown rows are on the
    // document, the Package row itself carries no price of its own — those
    // items already represent the priced-out breakdown, so showing the
    // Package price too would double-charge the client. With none of those
    // shown, the Package instead prices itself off the Breakdown total —
    // but that Breakdown total is already a TOTAL (rate × headcount for
    // every Inclusion), not a per-person rate. Dividing it back by the pax
    // count turns it into the Package's Unit Price (the SUBTOTAL, i.e. the
    // combined per-person rate); multiplying that by Qty (the pax count)
    // below then reconstructs the same Breakdown total as the printed
    // Amount: Unit Price = Subtotal, Amount = Unit Price × Qty.
    const otherQuoteItemsPresent = addonLineItems.length > 0 || breakdownQuoteLineItems.length > 0
    const quoteBreakdownTotal = getBreakdownTotal(selectedBooking)
    const quotePkgQty = quotePaxTotal > 0 ? quotePaxTotal : parseQuantity(quotePkg.qty || '1')
    const quotePkgUnitPrice = otherQuoteItemsPresent
      ? 0
      : quoteBreakdownTotal > 0
      ? (quotePkgQty > 0 ? quoteBreakdownTotal / quotePkgQty : quoteBreakdownTotal)
      : parseAmount(quotePkg.price)

    const lineItems: BookingLineItem[] = [
      ...(hasPkgTierRates
      ? [
          {
            description: quotePkg.name || selectedBooking.packageName || 'Package',
            quantity: 0,
            unitPrice: 0,
            nettCost: 0,
            total: 0,
            nettTotal: 0,
            profit: 0,
            hideQty: true,
            hidePrice: true,
          },
          ...pkgTierRows,
        ]
      : hasNewQuoteData
      ? [
          {
            description: quotePkg.name || selectedBooking.packageName || 'Package',
            quantity: quotePkgQty,
            unitPrice: quotePkgUnitPrice,
            nettCost: 0,
            total: otherQuoteItemsPresent ? 0 : quotePkgQty * quotePkgUnitPrice,
            nettTotal: 0,
            profit: otherQuoteItemsPresent ? 0 : quotePkgQty * quotePkgUnitPrice,
            hidePrice: otherQuoteItemsPresent,
            hideQty: true,
          },
        ]
      : getBookingLineItems(selectedBooking)),
      ...addonLineItems,
      ...breakdownQuoteLineItems,
    ]

    const quoteTotal = sumLineItems(lineItems, 'total')

    const inclusions = getLines(selectedBooking.inclusions, [
      'Travel arrangement based on selected package',
    ])
    const exclusions = getLines(selectedBooking.exclusions, [
      'Meals not stated',
      'Other incidental charges not stated',
    ])

    return (
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

        {(selectedBooking.flightDetails || selectedBooking.hotelName || selectedBooking.accommodation || selectedBooking.hotelAddress) && (
          <section className="quote-travel-grid">
            {selectedBooking.flightDetails && (
              <article className="quote-travel-card">
                <h3>Flight Details</h3>
                <p>{selectedBooking.flightDetails}</p>
              </article>
            )}
            {(selectedBooking.hotelName || selectedBooking.accommodation || selectedBooking.hotelAddress) && (
              <article className="quote-travel-card">
                <h3>Hotel Details</h3>
                {selectedBooking.hotelName && <p><strong>{selectedBooking.hotelName}</strong></p>}
                {selectedBooking.accommodation && <p>{selectedBooking.accommodation}</p>}
                {selectedBooking.hotelAddress && <p>{selectedBooking.hotelAddress}</p>}
              </article>
            )}
          </section>
        )}

        <div className="invoice-body-grid quote-body-grid">
          <table className="invoice-table quote-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => (
                <tr key={`${item.description}-${index}`}>
                  <td className="item-col">{item.description}</td>
                  <td>{item.hideQty ? '' : item.quantity}</td>
                  <td>{item.hidePrice ? '—' : convertAndFormat(item.unitPrice, selectedBooking.currency || 'PHP', exchangeRates)}</td>
                  <td>{item.hidePrice ? '—' : convertAndFormat(item.total, selectedBooking.currency || 'PHP', exchangeRates)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="quote-total-row">
                <td colSpan={3}>TOTAL</td>
                <td>{convertAndFormat(quoteTotal, selectedBooking.currency || 'PHP', exchangeRates)}</td>
              </tr>
              {(() => {
                const currency = selectedBooking.currency || 'PHP'
                const rate = parseFloat(selectedBooking.acr || '')
                if (currency === 'PHP' || !rate || rate <= 0) return null
                const pesoValue = (quoteTotal * rate).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                return (
                  <tr className="quote-acr-row">
                    <td colSpan={3}>ACR (Converted to PHP)</td>
                    <td>{`₱${pesoValue}`}</td>
                  </tr>
                )
              })()}
            </tfoot>
          </table>
        </div>

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
      </section>
    )
  }

  function renderInvoiceDoc(selectedBooking: BookingRecord) {
    const lineItems = getBookingLineItems(selectedBooking)

    const totalPrice = sumLineItems(lineItems, 'total')
    const amountPaid = parseAmount(selectedBooking.invoiceAmountPaid)
    const balance = Math.max(totalPrice - amountPaid, 0)
    const paymentRecords = getLines(selectedBooking.paymentRecords, [
      'No payment updates yet.',
    ])

    return (
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
            <strong>{(selectedBooking.id || 'DRAFT').replace('BK-', 'LLTP')}</strong>
          </div>
          <div>
            <span>Invoice Date</span>
            <strong>{formatProjectDate(new Date().toISOString())}</strong>
          </div>
          <div className="amount-due-box">
            <span>Amount Due</span>
            <strong>
              {acrPhpTotal(balance, selectedBooking.currency, selectedBooking.acr)
                ? acrPhpTotal(balance, selectedBooking.currency, selectedBooking.acr)!.replace('PHP ', '₱')
                : convertAndFormat(balance, selectedBooking.currency || 'PHP', exchangeRates)}
            </strong>
          </div>
        </section>

        <section className="bill-to-row">
          <strong>Bill To:</strong>
          <span>{selectedBooking.clientName}</span>
        </section>

        <div className="invoice-body-grid invoice-body-grid-solo invoice-two-tables">
          <table className="invoice-table invoice-items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => (
                <tr key={`${item.description}-${index}`}>
                  <td className="item-col">{item.description}</td>
                  <td>{item.hideQty ? '' : item.quantity}</td>
                  <td>{item.hidePrice ? '—' : convertAndFormat(item.unitPrice, selectedBooking.currency || 'PHP', exchangeRates)}</td>
                  <td>{item.hidePrice ? '—' : convertAndFormat(item.total, selectedBooking.currency || 'PHP', exchangeRates)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="invoice-table invoice-summary-table">
            <tbody>
              <tr className="quote-total-row">
                <td colSpan={3}>TOTAL</td>
                <td>{convertAndFormat(totalPrice, selectedBooking.currency || 'PHP', exchangeRates)}</td>
              </tr>
              {selectedBooking.currency && selectedBooking.currency !== 'PHP' && parseFloat(selectedBooking.acr || '') > 0 && (
                <tr className="quote-acr-row">
                  <td colSpan={3}>ACR</td>
                  <td>{parseFloat(selectedBooking.acr as string).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              )}
              <tr className="quote-acr-row">
                <td colSpan={3}>PAID</td>
                <td>{convertAndFormat(parseAmount(selectedBooking.invoiceAmountPaid), selectedBooking.currency || 'PHP', exchangeRates)}</td>
              </tr>
              {acrPhpTotal(totalPrice, selectedBooking.currency, selectedBooking.acr) && (
                <tr className="quote-total-row">
                  <td colSpan={3}>PESO VALUE</td>
                  <td>{acrPhpTotal(totalPrice, selectedBooking.currency, selectedBooking.acr)!.replace('PHP ', '₱')}</td>
                </tr>
              )}
              {selectedBooking.invoicePaymentStatus === 'Paid' && selectedBooking.invoiceFullyPaidDate && (
                <tr className="quote-acr-row">
                  <td colSpan={3}>FULLY PAID ON</td>
                  <td>{formatProjectDate(selectedBooking.invoiceFullyPaidDate)}</td>
                </tr>
              )}
              <tr className="quote-acr-row invoice-payment-updates-row">
                <td colSpan={4}>
                  <span className="payment-updates-label">Payment Updates</span>
                  <ul>
                    {paymentRecords.map((record) => (
                      <li key={record}>{record}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <section className="invoice-notes">
          <p>
            Status: {selectedBooking.invoicePaymentStatus || 'Unpaid'}.
            {selectedBooking.invoicePaymentStatus === 'Paid' && selectedBooking.invoiceFullyPaidDate
              ? ` Fully paid on ${formatProjectDate(selectedBooking.invoiceFullyPaidDate)}.`
              : ''}
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
            <strong>For faster transactions:</strong>
            <span>You may deposit your payment below:</span>
            <div className="transaction-banks">
              <div>
                <span className="bank-name">BDO - OLONGAPO</span>
                <span>Sharon R. Morine</span>
                <span>PESO SA: 007700076844</span>
              </div>
              <div>
                <span className="bank-name">CHINA BANK - OLONGAPO</span>
                <span>Sharon R. Morine</span>
                <span>USD SA: 167352000868</span>
              </div>
              <div>
                <span className="bank-name">GCASH</span>
                <span>Sharon R.</span>
                <span>9613495114</span>
              </div>
            </div>
          </div>
        </section>
      </section>
    )
  }

  function renderPurchaseOrderDoc(selectedBooking: BookingRecord) {
    let poItems: POLineItem[] = []
    try { const p = JSON.parse(selectedBooking.poLineItemsJson || '[]'); if (Array.isArray(p)) poItems = p } catch {}
    poItems = poItems.filter(item => item.showInDocument !== false)

    const poNumber = (selectedBooking.id || 'DRAFT').replace('BK-', new Date().getFullYear().toString())
    const travelDateStr = selectedBooking.travelStart
      ? `${formatProjectDate(selectedBooking.travelStart)}${selectedBooking.travelEnd ? ` - ${formatProjectDate(selectedBooking.travelEnd)}` : ''}`
      : 'TBA'
    const optionDateStr = selectedBooking.optionDate ? formatProjectDate(selectedBooking.optionDate) : 'TBA'

    const poGroups: POLineItem[][] = []
    const vendorKeyMap = new Map<string, number>()
    for (const item of poItems) {
      const key = (item.vendor || '').trim().toLowerCase() || `__no_vendor_${poGroups.length}`
      if (vendorKeyMap.has(key)) {
        poGroups[vendorKeyMap.get(key)!].push(item)
      } else {
        vendorKeyMap.set(key, poGroups.length)
        poGroups.push([item])
      }
    }

    const formatPHP = (n: number) => `₱ ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    // There's no dedicated "Unit Price" input for P.O. items, so the
    // printed Unit Price is taken from that same item's price on the
    // Invoice instead (matched via the shared id both were created with).
    // Most P.O. items mirror a Breakdown row, and the Invoice actually
    // prices those off the Breakdown row's own pax-tier rates (averaged
    // back over the combined headcount) rather than a stored addon price,
    // so we derive it the same way here to stay in lock-step with what's
    // printed on the Invoice. Invoice prices are entered in the booking's
    // own currency, so the result is run through the manually-entered ACR
    // rate to land in PHP — e.g. a $90 addon at ACR 62.24 prints as ₱5,601.60.
    const brkItemsForPO = readBreakdownItems(selectedBooking)
    const poPaxTotal = getBreakdownPaxTotal(selectedBooking)
    const linkedBrkForPOItem = (item: POLineItem) => brkItemsForPO.find((b) => b.mirrorId === `item-${item.id}`)

    // # of Pax is likewise read straight from the linked Breakdown row's
    // own "No. of Pax" fields at print time, instead of a copy stored on
    // the P.O. item — so it always matches what's on the Breakdown tab
    // right now, with nothing that needs re-syncing.
    const paxTotal = (item: POLineItem) => {
      const linkedBrk = linkedBrkForPOItem(item)
      if (linkedBrk) {
        return getItemPaxCounts(linkedBrk, selectedBooking).reduce((sum, v) => sum + parseAmount(v), 0)
      }
      return (parseInt(item.adultPax) || 0) + (parseInt(item.childPax) || 0) + (parseInt(item.seniorPax) || 0) + (parseInt(item.infantPax) || 0)
    }

    // The "# of Pax" column prints the actual per-tier breakdown (e.g.
    // "2 Adult, 1 Child") rather than just the combined count — each item
    // keeps its own tier split, it's not one shared number across items.
    const paxLabel = (item: POLineItem) => {
      const linkedBrk = linkedBrkForPOItem(item)
      const pax = linkedBrk
        ? getItemPaxBreakdown(linkedBrk, selectedBooking)
        : { adult: item.adultPax || '0', senior: item.seniorPax || '0', child: item.childPax || '0', infant: item.infantPax || '0' }
      return formatPaxBreakdownLabel(pax) || String(paxTotal(item) || 1)
    }

    const invoiceUnitPriceById = new Map<string, number>()
    readInvoiceAddons(selectedBooking).forEach((addon) => {
      if (!addon.id) return
      const linkedBrk = brkItemsForPO.find((b) => b.mirrorId === `item-${addon.id}`)
      if (linkedBrk) {
        const line = buildCombinedTierLine(addon.name || linkedBrk.description || 'Addon', linkedBrk, poPaxTotal, selectedBooking)
        invoiceUnitPriceById.set(addon.id, line.unitPrice)
        return
      }
      const originalQty = parseQuantity(addon.qty || '1')
      const price = parseAmount(addon.price)
      const amount = originalQty * price
      const q = poPaxTotal > 0 ? poPaxTotal : originalQty
      invoiceUnitPriceById.set(addon.id, q > 0 ? amount / q : price)
    })
    const poCurrency = selectedBooking.currency || 'PHP'
    const poAcrRate = parseFloat(selectedBooking.acr || '')
    const poHasAcr = poCurrency !== 'PHP' && poAcrRate > 0
    const toPhp = (amount: number) => poHasAcr ? amount * poAcrRate : amount
    const unitPrice = (item: POLineItem) =>
      toPhp(invoiceUnitPriceById.get(item.id) ?? (parseFloat(item.supplierNett) || 0))
    const rowTotal = (item: POLineItem) => {
      const pax = paxTotal(item) || 1
      return unitPrice(item) * pax
    }

    const renderPODocument = (items: POLineItem[], groupIndex: number, isLast: boolean) => {
      const first = items[0]
      const groupTotal = items.reduce((sum, item) => sum + rowTotal(item), 0)

      return (
        <section key={groupIndex} className={`po-preview print-document${!isLast ? ' po-page-break' : ''}`}>
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
              <strong>{poNumber}-{groupIndex + 1}</strong>
            </article>
          </section>

          <section className="po-party-grid">
            <div>
              <span>Vendor:</span>
              <strong>{first.vendor || 'To be assigned'}</strong>
              <small>Agent: {first.agent || 'N/A'}</small>
              <small>Contact No.: {first.contactNo || 'N/A'}</small>
            </div>
            <div>
              <span>Client Details:</span>
              <strong>{selectedBooking.clientName || '—'}</strong>
              <small>No. of pax: {formatPaxBreakdownLabel(readGroupPax(selectedBooking)) || selectedBooking.pax || '—'}</small>
              <small>Contact No.: {selectedBooking.contactNumber || 'N/A'}</small>
            </div>
          </section>

          <table className="po-table po-service-table">
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
                <td>{first.paymentMethod || 'N/A'}</td>
                <td>{first.serviceItem || '—'}</td>
                <td>{travelDateStr}</td>
                <td>{optionDateStr}</td>
              </tr>
            </tbody>
          </table>

          <table className="po-table particulars">
            <thead>
              <tr>
                <th>Qty</th>
                <th># of Pax</th>
                <th>Particular</th>
                <th>Description</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, rowIndex) => {
                const pax = paxTotal(item) || 1
                const nett = unitPrice(item)
                const amount = nett * pax
                return (
                  <tr key={rowIndex}>
                    <td>{pax}</td>
                    <td>{paxLabel(item)}</td>
                    <td>{item.serviceItem || '—'}</td>
                    <td>{item.description || '—'}</td>
                    <td>{formatPHP(nett)}</td>
                    <td>{formatPHP(amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <section className="po-total">
            <span>Total Amount:</span>
            <strong>{formatPHP(groupTotal)}</strong>
          </section>

          <section className="po-notes-grid">
            <div>
              <span>Hotel:</span>
              <strong>{selectedBooking.accommodation || 'N/A'}</strong>
            </div>
            <div>
              <span>Flight Details:</span>
              <strong>{selectedBooking.flightDetails || 'N/A'}</strong>
            </div>
            <div>
              <span>Special Instructions:</span>
              <strong>{selectedBooking.specialInstructions || selectedBooking.notes || 'N/A'}</strong>
            </div>
          </section>
        </section>
      )
    }

    if (poItems.length === 0) {
      return (
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
          <p className="po-empty-row">No PO items yet — add a service item in the Breakdown/Quotation/Invoice/Purchase Order tab.</p>
        </section>
      )
    }

    return <>{poGroups.map((group, index) => renderPODocument(group, index, index === poGroups.length - 1))}</>
  }

  function renderVoucherDoc(selectedBooking: BookingRecord) {
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
    const itineraryRows: { date: string; itinerary: string; hotel: string }[] = (() => {
      if (selectedBooking.voucherRowsJson) {
        try {
          const parsed = JSON.parse(selectedBooking.voucherRowsJson)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed.map((r) => ({
            date: r.date ? formatProjectDate(r.date) : '',
            itinerary: r.itinerary || '',
            hotel: r.hotel || '',
          }))
        } catch { /* fall through */ }
      }
      const lines = getLines(selectedBooking.itinerary, [
        selectedBooking.itemDescription || `Arrival and start of ${selectedBooking.packageName}`,
        'Free own leisure. Final reminders and departure arrangements.',
      ])
      return lines.map((line, index) => ({
        date: index === 0
          ? selectedBooking.travelStart ? formatProjectDate(selectedBooking.travelStart) : `Day ${index + 1}`
          : index === lines.length - 1 && selectedBooking.travelEnd ? formatProjectDate(selectedBooking.travelEnd) : `Day ${index + 1}`,
        itinerary: line,
        hotel: selectedBooking.hotelName || '',
      }))
    })()

    return (
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
            {selectedBooking.hotelAddress && (
              <small>
                Hotel Address: {selectedBooking.hotelAddress}
              </small>
            )}
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
            {itineraryRows.map((row, i) => (
              <tr key={`${row.date}-${i}`}>
                <td>{row.date}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{row.itinerary}</td>
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
      </section>
    )
  }

  function renderBreakdownDoc(selectedBooking: BookingRecord) {
    const brkItems = readBreakdownItems(selectedBooking)

    let colLabels = ['ADULT', 'CHILD', 'SENIOR', 'INFANT']
    try {
      const parsed = JSON.parse(selectedBooking.breakdownColLabels)
      if (Array.isArray(parsed) && parsed.length === 4) colLabels = parsed
    } catch {}

    // Column headers show the Package row's own headcount — the Package
    // represents the overall trip group size.
    const colPax = getBreakdownColPax(selectedBooking)

    const paxPriceFields: (keyof BreakdownLineItem)[] = ['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant']

    // Add-on rows are client-facing (Quotation/Invoice) and never printed
    // on the Breakdown — only Inclusions (and legacy rows with no itemType
    // set) show up here.
    const nonPackageItems = sortBreakdownItemsByRate(brkItems.filter((item) => !item.isPackageRow && item.itemType !== 'addon'))

    // A pax category is only actually "in play" on the Breakdown if at
    // least one Inclusion row still counts it — once every row has hidden
    // that category (via the per-row "Hide Pax" toggle), the group's
    // shared headcount for it isn't being charged for anywhere anymore,
    // so the printed NO. OF PAX row shows that column blank instead of a
    // leftover number with nothing behind it.
    const colVisiblePax = colPax.map((pax, i) => {
      if (nonPackageItems.length === 0) return pax
      const allExcluded = nonPackageItems.every((item) => readExcludedPax(item).includes(PAX_CATEGORY_KEYS[i]))
      return allExcluded ? '' : pax
    })

    // Line-item prices are entered in the booking's own currency (e.g. USD).
    // The Breakdown document is always presented in PHP, so every amount
    // needs to be run through the manually-entered ACR rate before display —
    // otherwise we'd just be printing the USD figure with a ₱ sign on it.
    const brkCurrency = selectedBooking.currency || 'PHP'
    const brkAcrRate = parseFloat(selectedBooking.acr || '')
    const brkHasAcr = brkCurrency !== 'PHP' && brkAcrRate > 0
    const toPhp = (amount: number) => brkHasAcr ? amount * brkAcrRate : amount

    // The per-tier ADULT/CHILD/SENIOR/INFANT columns start with the
    // Package row's own per-tier price, then add in every Inclusion row
    // below it that's ALSO priced per pax-tier (its own Adult/Child/Senior/
    // Infant rate) — e.g. a "Fuel Surcharge" row with its own Adult/Child
    // rates counts toward the ADULT/CHILD column totals here, matching how
    // it's shown split out on its own row above. Rows priced with a single
    // flat Unit Price instead (no tier breakdown) can't be attributed to
    // any one column, so their total is kept separate and only folded into
    // the Grand Total.
    // SUBTOTAL (displayed row) is every row's own rate added together —
    // Package's rate plus every tier-priced Inclusion's rate for that same
    // column, e.g. Package's Adult rate + Fuel Surcharge's Adult rate +
    // PH Tax's Adult rate, etc. Shared with the Quotation/Invoice's "Adult
    // Rate" / "Child Rate" lines so both documents always agree.
    const subtotals = getBreakdownTierSubtotals(selectedBooking)
    // TOTAL is that combined per-person SUBTOTAL × the Package's own
    // headcount for that tier — the SAME headcount for every Inclusion
    // folded into it, since they're all pricing the same group of people,
    // not each their own separately-counted group. (Previously this
    // re-multiplied each Inclusion by ITS OWN pax-count field instead of
    // the Package's shared one, which silently undercounted the total
    // whenever an Inclusion's own headcount field was left blank or didn't
    // match the Package's.)
    const totals = subtotals.map((subtotal, i) => subtotal * parseQuantity(colPax[i]))
    const flatItemsTotal = nonPackageItems.reduce((sum, item) => (
      parseAmount(item.unitPrice) > 0 ? sum + getBreakdownItemTotal(item, selectedBooking) : sum
    ), 0)
    // Grand Total is simply the sum of the four column totals above, plus
    // whatever flat-rate rows couldn't be attributed to a column.
    const grandTotal = totals.reduce((sum, val) => sum + val, 0) + flatItemsTotal


    return (
      <section className="breakdown-preview print-document">
        <table className="breakdown-quotation-table">
          <thead>
            <tr className="bq-title-row">
              <th colSpan={2}>QUOTATION: {selectedBooking.quotationNo || selectedBooking.id}</th>
              <th colSpan={4} className="bq-amount-header">AMOUNT</th>
            </tr>
            <tr className="bq-info-row">
              <td className="bq-label">NAME:</td>
              <td className="bq-value">
                {selectedBooking.packageName}
              </td>
              <td rowSpan={2} colSpan={4} className="bq-amount-cell"></td>
            </tr>
            <tr className="bq-info-row">
              <td className="bq-label">DATE OF TRAVEL:</td>
              <td className="bq-value">
                {selectedBooking.travelStart
                  ? `${formatProjectDate(selectedBooking.travelStart)}${selectedBooking.travelEnd ? ` - ${formatProjectDate(selectedBooking.travelEnd)}` : ''}`
                  : 'TBA'}
              </td>
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
            {nonPackageItems.map((item, index) => {
              const amount = getBreakdownItemTotal(item, selectedBooking)
              const flatPrice = parseAmount(item.unitPrice)
              // A row priced per pax-tier (its own Adult/Child/Senior/Infant
              // rate fields, not a single flat Unit Price) splits its rates
              // across the same four columns the Package row uses — each
              // column shows that tier's own per-unit rate converted to
              // pesos (no headcount multiplication), so a Fuel Surcharge
              // with its own Adult/Child rates prints under ADULT and CHILD
              // respectively instead of being dumped in one cell that
              // visually sits under the last (Infant) column.
              const itemExcludedPax = readExcludedPax(item)
              const tierAmounts = flatPrice > 0 ? null : paxPriceFields.map((field, ci) => {
                // Don't print a rate under a column the row has explicitly
                // excluded via "Hide Pax" — even if a price is still typed
                // into that field, it shouldn't visually appear (or count
                // toward the SUBTOTAL/TOTAL row above) once hidden.
                if (itemExcludedPax.includes(PAX_CATEGORY_KEYS[ci])) return 0
                return parseAmount(item[field] as string)
              })
              const hasTierAmounts = tierAmounts && tierAmounts.some((v) => v > 0)
              return (
                <tr key={index} className="bq-data-row">
                  <td className="bq-service">{item.description.toUpperCase()}</td>
                  <td className="bq-details">{item.details || ''}</td>
                  {hasTierAmounts ? (
                    tierAmounts!.map((val, ci) => (
                      <td key={ci} className={`bq-price${val > 0 ? ' bq-has-value' : ''}${ci === 3 ? ' bq-infant-col' : ''}`}>
                        {val > 0 ? `₱${toPhp(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                      </td>
                    ))
                  ) : (
                    <td colSpan={4} className={`bq-price${amount > 0 ? ' bq-has-value' : ''}`}>
                      {amount > 0 ? `₱${toPhp(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                    </td>
                  )}
                </tr>
              )
            })}
            <tr className="bq-subtotal-row">
              <td colSpan={2}>SUBTOTAL:</td>
              {subtotals.map((val, i) => (
                <td key={i} className={`bq-price${val > 0 ? ' bq-has-value' : ''}${i === 3 ? ' bq-infant-col' : ''}`}>
                  {val > 0 ? `₱${toPhp(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '₱0.00'}
                </td>
              ))}
            </tr>
            <tr className="bq-pax-row">
              <td colSpan={2}>NO. OF PAX</td>
              {colVisiblePax.map((pax, i) => (
                <td key={i} className={`bq-price${pax ? ' bq-has-value' : ''}${i === 3 ? ' bq-infant-col' : ''}`}>
                  {pax || ''}
                </td>
              ))}
            </tr>
            <tr className="bq-total-row">
              <td colSpan={2}>TOTAL:</td>
              {totals.map((val, i) => (
                <td key={i} className={`bq-price${val > 0 ? ' bq-has-value' : ''}${i === 3 ? ' bq-infant-col' : ''}`}>
                  {val > 0 ? `₱${toPhp(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '₱0.00'}
                </td>
              ))}
            </tr>
            <tr className="bq-grandtotal-row">
              <td colSpan={2}>GRAND TOTAL:</td>
              <td colSpan={4} className="bq-price bq-has-value">
                {`₱${toPhp(grandTotal).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    )
  }

  // Builds a BookingRecord-shaped object from the live, in-progress
  // Data Gathering form state so it can be fed straight into the document
  // renderers above — this is what powers the live preview panel.
  function buildDraftBookingFromForm(): BookingRecord {
    return {
      ...bookingForm,
      id: editingBookingId || selectedBookingId || 'DRAFT',
      createdAt: bookingCreatedAt ? new Date(bookingCreatedAt + 'T00:00:00').toISOString() : new Date().toISOString(),
    }
  }

  function renderDocByType(docType: 'quotation' | 'invoice' | 'purchase-order' | 'voucher' | 'breakdown', data: BookingRecord) {
    switch (docType) {
      case 'quotation': return renderQuotationDoc(data)
      case 'invoice': return renderInvoiceDoc(data)
      case 'purchase-order': return renderPurchaseOrderDoc(data)
      case 'voucher': return renderVoucherDoc(data)
      case 'breakdown': return renderBreakdownDoc(data)
      default: return null
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
    const currentBreakdownItems = getBreakdownItemsList()
    const currentInvoiceAddonsForToggles: { id: string; showInDocument?: boolean }[] = (() => {
      try { const a = JSON.parse(bookingForm.invoiceAddons); return Array.isArray(a) ? a : [] } catch { return [] }
    })()
    const currentPOItemsForToggles: POLineItem[] = (() => {
      try { const p = JSON.parse(bookingForm.poLineItemsJson || '[]'); return Array.isArray(p) ? p : [] } catch { return [] }
    })()
    const displayTotalClient = getBookingClientTotal(bookingForm)
    const displayTotalNett = getBookingBreakdownNettTotal(bookingForm)
    const displayTotalProfit = displayTotalClient - displayTotalNett

    // Completion helpers
    const quotationPkgPriceFilled = (() => {
      try { const p = JSON.parse(bookingForm.invoicePackage); return Boolean(p && typeof p === 'object' && String(p.price ?? '').trim()) } catch { return false }
    })()
    const hasQuotation = Boolean(
      bookingForm.packageName &&
      quotationPkgPriceFilled
    )
    const hasBreakdown = (() => { try { const b = JSON.parse(bookingForm.breakdownLineItemsJson); return Array.isArray(b) && b.some((i: {isPackageRow?: boolean}) => !i.isPackageRow) } catch { return false } })()
    const hasInvoice = Boolean(bookingForm.invoiceAmountPaid || bookingForm.invoicePaymentStatus !== 'Unpaid')
    const hasPO = (() => { try { const p = JSON.parse(bookingForm.poLineItemsJson || '[]'); return Array.isArray(p) && p.length > 0 } catch { return false } })()
    const hasVoucher = Boolean(bookingForm.flightDetails || bookingForm.accommodation)

    const masterFormCard = {
      id: 'breakdown' as const,
      label: 'Breakdown / Quotation / Invoice / Purchase Order / Service Voucher',
      icon: <FileBarChart2 size={28} />,
      desc: 'Client info, package details, pricing, inclusions, internal costing, supplier nett, pax tiers, invoice fulfillment, purchase order details, day-by-day schedule, logistics, and internal operations notes — everything for this booking in one place.',
      filled: hasBreakdown || hasQuotation || hasInvoice || hasPO || hasVoucher,
    }

    // The live preview shows every printable document type on its own,
    // including Quotation — even though its editing fields now live inside
    // the single master data-gathering form above.
    const livePreviewCards = [
      { id: 'breakdown' as const, label: 'Breakdown', icon: <FileBarChart2 size={28} /> },
      { id: 'quotation' as const, label: 'Quotation', icon: <FileText size={28} /> },
      { id: 'invoice' as const, label: 'Invoice', icon: <Receipt size={28} /> },
      { id: 'purchase-order' as const, label: 'Purchase Order', icon: <ShoppingCart size={28} /> },
      { id: 'voucher' as const, label: 'Service Voucher', icon: <Ticket size={28} /> },
    ]

    // There is now a single master data-gathering form — every section is
    // always shown, whether the person clicked "New Inquiry" or "Edit
    // booking info". Sections used to be split across separate document
    // tabs (Breakdown, Purchase Order, Service Voucher); showSection is
    // kept as a no-op passthrough so the section JSX below didn't need to
    // be reshuffled.
    const showSection = (_key: string) => true

    const sharedBookingStrip = (
      <div className="doc-booking-strip">
        <div className="doc-booking-strip-info">
          <span className="doc-booking-strip-label">Booking</span>
          <strong>{bookingForm.clientName || <em>No client name yet</em>}</strong>
          {bookingForm.packageName && <span>· {bookingForm.packageName}</span>}
          {bookingForm.destination && <span>· {bookingForm.destination}</span>}
          {bookingForm.travelStart && <span>· {bookingForm.travelStart}</span>}
        </div>
      </div>
    )

    return (
      <main className="data-screen">
        <nav className="app-nav">
          <div className="nav-brand">
            <img src={logo} alt="Lion and Lamb Travel logo" />
            <div>
              <strong>Lion and Lamb Travel</strong>
              <span>{isEditingBooking ? 'Edit Booking' : 'New Inquiry'}</span>
            </div>
          </div>
          <div className="nav-actions">
            <button
              type="button"
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              onClick={() => { setEditingBookingId(''); setActiveDocTab(null); setScreen(isEditingBooking ? 'booking-detail' : 'home') }}
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        {/* ── MASTER DATA-GATHERING FORM ── everything for this booking
            lives in one form now; there is no longer a picker to choose
            between separate documents. */}
        <>
            <div className="doc-form-subnav">
              <span className="doc-form-subnav-title">
                {masterFormCard.icon} {masterFormCard.label}
              </span>
              <div className="live-preview-controls">
                {showLivePreview && (
                  <select
                    className="live-preview-doc-select"
                    value={livePreviewDoc}
                    onChange={(e) => setLivePreviewDoc(e.target.value as typeof livePreviewDoc)}
                    title="Choose which document to preview live"
                  >
                    {livePreviewCards.map((card) => (
                      <option key={card.id} value={card.id}>{card.label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className={`live-preview-toggle-btn ${showLivePreview ? 'live-preview-toggle-btn--active' : ''}`}
                  onClick={() => {
                    setShowLivePreview((v) => !v)
                    if (!showLivePreview && activeDocTab) setLivePreviewDoc(activeDocTab)
                  }}
                  title={showLivePreview ? 'Hide live preview' : 'Show live preview'}
                >
                  <Eye size={15} /> {showLivePreview ? 'Hide preview' : 'Live preview'}
                </button>
              </div>
            </div>
            <div className={`data-form-split ${showLivePreview ? 'data-form-split--active' : ''}`}>
            <div className="data-form-main">
            {sharedBookingStrip}
            <form className="data-form" onSubmit={handleSaveBooking}>
              {dataError && <p className="data-alert error">{dataError}</p>}
              {dataMessage && <p className="data-alert info">{dataMessage}</p>}

              <section className="form-section date-created-section">
                <div className="form-section-heading">
                  <p>When was this created</p>
                  <h2>Date created</h2>
                </div>
                <div className="field-grid three">
                  <label>
                    <span className="field-label"><span>Date created</span><span className="required-marker">Required</span></span>
                    <input
                      required
                      type="date"
                      value={bookingCreatedAt}
                      onChange={(e) => setBookingCreatedAt(e.target.value)}
                      max={toDateInputValue()}
                    />
                  </label>
                </div>
              </section>

              <section className="ai-autofill-panel">
                {!aiPasteOpen ? (
                  <button type="button" className="ai-autofill-trigger" onClick={() => { setAiPasteOpen(true); setAiError('') }}>
                    ✨ Paste &amp; auto-fill with AI
                  </button>
                ) : (
                  <div className="ai-autofill-box">
                    <div className="ai-autofill-box-heading">
                      <span>✨ Paste chat / email to auto-fill</span>
                      <button type="button" className="ai-autofill-close" onClick={() => { setAiPasteOpen(false); setAiPasteText(''); setAiError('') }}>
                        <X size={14} />
                      </button>
                    </div>
                    <textarea
                      className="ai-autofill-textarea"
                      rows={6}
                      placeholder="Paste a WhatsApp conversation, email thread, or any text that contains booking details…"
                      value={aiPasteText}
                      onChange={(e) => setAiPasteText(e.target.value)}
                      disabled={aiLoading}
                    />
                    {aiError && <p className="data-alert error">{aiError}</p>}
                    <div className="ai-autofill-actions">
                      <span className="ai-autofill-hint">Only fields it can confidently find will be filled — review before saving.</span>
                      <button
                        type="button"
                        className="ai-autofill-submit"
                        onClick={handleAiAutoFill}
                        disabled={aiLoading || !aiPasteText.trim()}
                      >
                        {aiLoading ? 'Reading...' : 'Auto-fill form'}
                      </button>
                    </div>
                  </div>
                )}
              </section>

          {/* CLIENT */}
          {showSection('client') && (
          <section className="form-section">
            <div className="form-section-heading">
              <p>Client</p>
              <h2>Client info</h2>
              <div className="doc-affects">
                <span className="doc-affects-label">Appears on</span>
                <span className="doc-tag doc-tag-quotation">Quotation</span>
                <span className="doc-tag doc-tag-invoice">Invoice</span>
                <span className="doc-tag doc-tag-po">Purchase Order</span>
                <span className="doc-tag doc-tag-voucher">Voucher</span>
              </div>
            </div>
            <div className="field-grid three">
              <label>
                <span className="field-label"><span>Client name</span><span className="required-marker">Required</span></span>
                <input required={activeDocTab === 'breakdown'} value={bookingForm.clientName} onChange={(e) => updateBookingField('clientName', e.target.value)} placeholder="Ms. Joanna Pico" />
              </label>
              <label>
                Contact number
                <input value={bookingForm.contactNumber} onChange={(e) => updateBookingField('contactNumber', e.target.value)} placeholder="09xxxxxxxxx" />
              </label>
              <label>
                Email address
                <input type="email" value={bookingForm.clientEmail} onChange={(e) => updateBookingField('clientEmail', e.target.value)} placeholder="client@email.com" />
              </label>
              <label>
                Booking status
                <select value={bookingForm.status} onChange={(e) => updateBookingField('status', e.target.value as BookingStatus)} disabled={bookingForm.status === 'Confirmed' || bookingForm.status === 'Flown'}>
                  {(bookingForm.status === 'Confirmed' || bookingForm.status === 'Flown')
                    ? <option value={bookingForm.status}>{bookingForm.status}</option>
                    : bookingListFilters.filter((f) => f.value === 'Quotation' || f.value === 'Invoice').map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))
                  }
                </select>
                <span className="field-help">
                  {(bookingForm.status === 'Confirmed' || bookingForm.status === 'Flown')
                    ? 'Confirmed and Flown are automatic — payment logged confirms it, travel end date passed marks it flown.'
                    : 'Choose Quotation or Invoice. Logging a payment auto-moves it to Confirmed; the travel end date auto-moves it to Flown.'}
                </span>
              </label>
            </div>
          </section>
          )}

          {/* TRIP */}
          {showSection('travel') && (
          <section className="form-section">
            <div className="form-section-heading">
              <p>Trip</p>
              <h2>Package details</h2>
              <div className="doc-affects">
                <span className="doc-affects-label">Appears on</span>
                <span className="doc-tag doc-tag-breakdown">Breakdown</span>
                <span className="doc-tag doc-tag-quotation">Quotation</span>
                <span className="doc-tag doc-tag-invoice">Invoice</span>
                <span className="doc-tag doc-tag-po">Purchase Order</span>
                <span className="doc-tag doc-tag-voucher">Voucher</span>
              </div>
            </div>
            <div className="field-grid three">
              <label>
                Package name
                <input value={bookingForm.packageName} onChange={(e) => handlePackageNameChange(e.target.value)} placeholder="3D2N Clark and Olongapo" />
              </label>
              <label>
                Destination
                <input value={bookingForm.destination} onChange={(e) => updateBookingField('destination', e.target.value)} placeholder="Clark, Boracay, Hong Kong" />
              </label>
              <label>
                Payment method
                <input value={bookingForm.paymentMethod} onChange={(e) => updateBookingField('paymentMethod', e.target.value)} placeholder="Bank Transfer, GCash, Cash" />
              </label>
              <label>
                <span className="field-label"><span>Travel start</span><span className="required-marker">Required</span></span>
                <input required={activeDocTab === 'breakdown'} type="date" value={bookingForm.travelStart} onChange={(e) => updateBookingField('travelStart', e.target.value)} />
              </label>
              <label>
                <span className="field-label"><span>Travel end</span><span className="required-marker">Required</span></span>
                <input required={activeDocTab === 'breakdown'} type="date" value={bookingForm.travelEnd} onChange={(e) => updateBookingField('travelEnd', e.target.value)} />
              </label>
              <label>
                Option date
                <input type="date" value={bookingForm.optionDate} onChange={(e) => updateBookingField('optionDate', e.target.value)} />
              </label>
            </div>
          </section>
          )}

          {/* CURRENCY */}
          {showSection('currency') && (() => {
            const bookingCurrency = bookingForm.currency || 'PHP'
            const savedBookingForCurrency = (lastSavedBookingRef.current?.id === editingBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((b) => b.id === editingBookingId)
            const savedCurrency = savedBookingForCurrency?.currency || 'PHP'
            const hasPendingCurrencyChange = isEditingBooking && bookingCurrency !== savedCurrency
            return (
              <section className="form-section">
                <div className="form-section-heading">
                  <p>Currency</p>
                  <h2>Document currency &amp; conversion rate</h2>
                  <div className="doc-affects">
                    <span className="doc-affects-label">Appears on</span>
                    <span className="doc-tag doc-tag-quotation">Quotation</span>
                    <span className="doc-tag doc-tag-invoice">Invoice</span>
                  </div>
                </div>
                <div className="field-grid three">
                  <label>
                    Document currency
                    <select
                      value={bookingCurrency}
                      onChange={(e) => {
                        const next = e.target.value
                        setDataError('')
                        setDataMessage('')
                        setBookingForm((prev) => ({ ...prev, currency: next, ...(next === 'PHP' ? { acr: '' } : {}) }))
                      }}
                    >
                      {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  {bookingCurrency !== 'PHP' && (
                    <label>
                      {`1 ${bookingCurrency} = ₱`}
                      <input
                        type="number" min="0" step="0.01"
                        value={bookingForm.acr}
                        placeholder="0.00"
                        onChange={(e) => setBookingForm((prev) => ({ ...prev, acr: e.target.value }))}
                        onBlur={(e) => { if (isEditingBooking) applyAcrToBookingId(editingBookingId, e.target.value) }}
                      />
                    </label>
                  )}
                  {isEditingBooking && (
                    <label className="currency-inline-apply-wrap">
                      <span>&nbsp;</span>
                      <button
                        type="button"
                        className="currency-picker-apply-btn"
                        onClick={applyCurrencyToDocuments}
                        disabled={!hasPendingCurrencyChange}
                      >
                        Apply to Document
                      </button>
                    </label>
                  )}
                </div>
                {bookingCurrency === 'PHP' ? (
                  <p className="field-help">Base currency — quotation &amp; invoice amounts print as-is.</p>
                ) : (
                  <p className="field-help">The Quotation &amp; Invoice will show an "ACR" line with the total converted to PHP at this rate.</p>
                )}
                {isEditingBooking ? (
                  <p className={hasPendingCurrencyChange ? 'currency-picker-apply-hint currency-picker-apply-hint-pending' : 'currency-picker-apply-hint'}>
                    {hasPendingCurrencyChange
                      ? `Not applied yet — Quotation & Invoice still show ${savedCurrency}.`
                      : `Applied — Quotation & Invoice are set to ${bookingCurrency}.`}
                  </p>
                ) : (
                  <p className="currency-picker-apply-hint">Save this booking first — then you can apply a currency to its Quotation &amp; Invoice.</p>
                )}
              </section>
            )
          })()}

          {/* PAX-TIER PRICING */}
          {showSection('paxTier') && (
          <section className="form-section">
            <div className="form-section-heading">
              <p>Pax-Tier Pricing</p>
              <h2>Price per person by group size</h2>
              <div className="doc-affects">
                <span className="doc-affects-label">Appears on</span>
                <span className="doc-tag doc-tag-breakdown">Breakdown</span>
                <span className="doc-tag doc-tag-quotation">Quotation</span>
                <span className="doc-tag doc-tag-invoice">Invoice</span>
                <span className="doc-tag doc-tag-po">Purchase Order</span>
              </div>
            </div>

            {/* One shared group headcount for the whole booking — every
                service row below inherits these counts automatically. A
                row can opt a category out (via its own remove buttons) if
                that particular service doesn't apply to everyone. */}
            <div className="breakdown-group-pax-panel">
              <div className="pax-tier-field-label">No. of Pax</div>
              <p className="breakdown-tier-config-hint">Set once for the whole booking — every service below inherits it.</p>
              <div className="breakdown-group-pax-fields">
                {(['adult', 'child', 'senior', 'infant'] as const).map((category, ci) => (
                  <label className="pax-tier-field" key={category}>
                    <span className="pax-tier-field-label">{['Adult', 'Child', 'Senior', 'Infant'][ci]}</span>
                    <input
                      type="number" min="0"
                      value={readPaxBreakdown(bookingForm.groupPax)[category]}
                      onChange={(e) => updateGroupPaxField(category, e.target.value)}
                      placeholder="0"
                      className="tier-pax-input"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Per-service prices — every row sets its own price per
                person for whichever pax categories apply to it; the
                headcount itself is inherited from the shared group total
                above unless a category is explicitly removed on the row. */}
            <div className="breakdown-tier-prices-panel">
              <div className="breakdown-tier-prices-header">
                <div>
                  <p className="breakdown-tier-config-label">Set price per service</p>
                  <p className="breakdown-tier-config-hint">For each service, enter the price per person for whichever categories apply. Use the remove buttons if a category doesn't apply to that service.</p>
                </div>
                <div className="pax-tier-add-item-wrap">
                  <button
                    type="button"
                    ref={addItemTypeTriggerRef}
                    className="invoice-addon-add-btn"
                    onClick={() => setAddItemTypeMenuOpen((v) => !v)}
                  >
                    <Plus size={14} /> Add item
                  </button>
                  {addItemTypeMenuOpen && (
                    <FloatingDropdownMenu
                      anchorRef={addItemTypeTriggerRef}
                      onClose={() => setAddItemTypeMenuOpen(false)}
                    >
                      <ul className="po-service-dropdown-list add-item-type-list">
                        <li className="po-service-dropdown-item add-item-type-item">
                          <button
                            type="button"
                            className="po-service-dropdown-select add-item-type-select"
                            onClick={() => { addBreakdownItemRow('inclusion'); setAddItemTypeMenuOpen(false) }}
                          >
                            <span className="add-item-type-name">Inclusion</span>
                            <span className="add-item-type-desc">Internal cost — shown only on the Breakdown, never on the Quotation or Invoice.</span>
                          </button>
                        </li>
                        <li className="po-service-dropdown-item add-item-type-item">
                          <button
                            type="button"
                            className="po-service-dropdown-select add-item-type-select"
                            onClick={() => { addBreakdownItemRow('addon'); setAddItemTypeMenuOpen(false) }}
                          >
                            <span className="add-item-type-name">Add-on</span>
                            <span className="add-item-type-desc">Client-facing extra — shown on the Quotation &amp; Invoice, never on the Breakdown.</span>
                          </button>
                        </li>
                      </ul>
                    </FloatingDropdownMenu>
                  )}
                </div>
              </div>

              <div className="line-items-table">
                {currentBreakdownItems.filter(item => !item.isPackageRow).map((item) => {
                  const realIndex = currentBreakdownItems.indexOf(item)
                  const sharedId = item.mirrorId ? item.mirrorId.replace(/^item-/, '') : item.id
                  const linkedAddon = currentInvoiceAddonsForToggles.find((a) => a.id === sharedId)
                  const linkedPO = currentPOItemsForToggles.find((p) => p.id === sharedId)
                  const shownInQuotation = !!item.sendToQuotation
                  const shownInInvoice = linkedAddon ? linkedAddon.showInDocument !== false : false
                  const shownInPO = linkedPO ? linkedPO.showInDocument !== false : false
                  const itemPax = getItemPaxBreakdown(item, bookingForm)
                  const itemExcludedPax = readExcludedPax(item)
                  // Rows saved before Inclusion/Add-on existed have no
                  // itemType — treated as Inclusion for document behavior,
                  // but flagged "Legacy" here so the manual Quotation/
                  // Invoice toggles they already rely on keep working
                  // exactly as before instead of being locked off.
                  const isLegacyItem = !item.itemType
                  const rowItemType: 'inclusion' | 'addon' = item.itemType === 'addon' ? 'addon' : 'inclusion'
                  return (
                    <div key={item.id || realIndex} className="line-item-data-row">
                      <div className="pax-tier-type-row">
                        <div className="pax-tier-type-switch">
                          <button
                            type="button"
                            className={`pax-tier-type-btn${rowItemType === 'inclusion' ? ' active' : ''}`}
                            onClick={() => setBreakdownItemType(realIndex, 'inclusion')}
                            title="Inclusion — internal cost, shown only on the Breakdown"
                          >
                            Inclusion
                          </button>
                          <button
                            type="button"
                            className={`pax-tier-type-btn${rowItemType === 'addon' ? ' active' : ''}`}
                            onClick={() => setBreakdownItemType(realIndex, 'addon')}
                            title="Add-on — shown on the Quotation &amp; Invoice, never the Breakdown"
                          >
                            Add-on
                          </button>
                        </div>
                        {isLegacyItem && <span className="pax-tier-type-legacy-tag" title="Created before Inclusion/Add-on existed — behaves like an Inclusion, but keeps its own manual Quotation/Invoice toggles">Legacy</span>}
                      </div>
                      <div className="line-items-row pax-tier-row pax-tier-counts-row">
                        <div className="pax-tier-field">
                          <span className="pax-tier-field-label">Service</span>
                          <div className="po-service-dropdown-wrap">
                            <button
                              type="button"
                              ref={(el) => { breakdownDropdownTriggerRefs.current[realIndex] = el }}
                              className="po-service-dropdown-trigger"
                              onClick={() => setOpenBreakdownDropdownIndex(openBreakdownDropdownIndex === realIndex ? -1 : realIndex)}
                            >
                              <span>{item.description || 'Select…'}</span>
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </button>
                            {openBreakdownDropdownIndex === realIndex && (
                              <FloatingDropdownMenu
                                anchorRef={{ current: breakdownDropdownTriggerRefs.current[realIndex] ?? null }}
                                onClose={() => { setOpenBreakdownDropdownIndex(-1); cancelCustomBreakdownItem() }}
                              >
                                <ul className="po-service-dropdown-list">
                                  {breakdownOptions.map(opt => (
                                    <li key={opt} className={`po-service-dropdown-item${item.description === opt ? ' selected' : ''}`}>
                                      <button
                                        type="button"
                                        className="po-service-dropdown-select"
                                        onClick={() => { changeBreakdownItemField(realIndex, 'description', opt); setOpenBreakdownDropdownIndex(-1) }}
                                      >{opt}</button>
                                      {!defaultBreakdownOptions.includes(opt) && (
                                        <button
                                          type="button"
                                          className="po-service-dropdown-delete"
                                          title="Remove option"
                                          onClick={() => removeCustomBreakdownOption(opt)}
                                        ><X size={11} /></button>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                                <div className="po-service-dropdown-add">
                                  {customBreakdownRowIndex === realIndex ? (
                                    <div className="po-service-dropdown-custom-row">
                                      <input
                                        autoFocus
                                        value={customBreakdownDraft}
                                        onChange={e => setCustomBreakdownDraft(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter' && customBreakdownDraft.trim()) {
                                            confirmCustomBreakdownItem(realIndex)
                                            setOpenBreakdownDropdownIndex(-1)
                                          }
                                          if (e.key === 'Escape') cancelCustomBreakdownItem()
                                        }}
                                        placeholder="Type and press Enter…"
                                        className="po-service-dropdown-custom-input"
                                      />
                                      <button type="button" className="po-service-dropdown-cancel" onClick={cancelCustomBreakdownItem}>
                                        <X size={11} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" className="po-service-dropdown-add-btn" onClick={() => startCustomBreakdownItem(realIndex)}>
                                      <Plus size={12} /> Add custom option
                                    </button>
                                  )}
                                </div>
                              </FloatingDropdownMenu>
                            )}
                          </div>
                        </div>
                        <div className="pax-tier-field">
                          <span className="pax-tier-field-label">No. of Pax</span>
                          <div className="pax-tier-subrow-hint">Inherited from the group total above</div>
                        </div>
                        {(['adult', 'child', 'senior', 'infant'] as const).map((category, ci) => {
                          const isExcluded = itemExcludedPax.includes(category)
                          return (
                            <div className="pax-tier-field" key={category}>
                              <span className="pax-tier-field-label">{['Adult', 'Child', 'Senior', 'Infant'][ci]}</span>
                              <div className={`pax-tier-inherited-value${isExcluded ? ' excluded' : ''}`}>
                                <span>{isExcluded ? '—' : (itemPax[category] || '0')}</span>
                                <button
                                  type="button"
                                  className="pax-tier-exclude-btn"
                                  onClick={() => toggleItemPaxCategory(realIndex, category)}
                                  title={isExcluded ? `Include ${category} for this service` : `Remove ${category} from this service`}
                                >
                                  {isExcluded ? '+' : <X size={11} />}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                        <span></span>
                      </div>
                      <div className="line-items-row pax-tier-row pax-tier-price-row">
                        <div className="pax-tier-field">
                          <span className="pax-tier-field-label">Rate / Pax</span>
                          <div className="pax-tier-subrow-hint">Price per person</div>
                        </div>
                        <label className="pax-tier-field">
                          <span className="pax-tier-field-label">Details (optional)</span>
                          <input
                            type="text"
                            value={item.details || ''}
                            onChange={(e) => changeBreakdownItemField(realIndex, 'details', e.target.value)}
                            placeholder="e.g. CRK - MPH"
                          />
                        </label>
                        {(['price2Pax', 'price5Pax', 'priceGroup', 'priceInfant'] as const).map((field, fi) => (
                          <label className="pax-tier-field" key={field}>
                            <span className="pax-tier-field-label">{['Adult', 'Child', 'Senior', 'Infant'][fi]}</span>
                            <input
                              type="text"
                              value={(item[field] as string) || ''}
                              onChange={(e) => changeBreakdownItemField(realIndex, field, e.target.value)}
                              placeholder="0.00"
                            />
                          </label>
                        ))}
                        <button
                          type="button"
                          className="remove-line-btn"
                          onClick={() => removeBreakdownItemRow(realIndex)}
                          title="Remove this row"
                        >
                            <X size={14} />
                          </button>
                      </div>
                      {item.mirrorId && (
                        <div className="pax-tier-supplier-row">
                          <span className="pax-tier-supplier-label">Supplier details (for Purchase Order)</span>
                          <div className="field-grid four">
                            <label>
                              Vendor
                              <input
                                type="text"
                                value={item.vendor || linkedPO?.vendor || ''}
                                onChange={(e) => changeBreakdownItemField(realIndex, 'vendor', e.target.value)}
                                placeholder="e.g. Cebu Pacific"
                              />
                            </label>
                            <label>
                              Contact No.
                              <input
                                type="text"
                                value={item.contactNumber || linkedPO?.contactNo || ''}
                                onChange={(e) => changeBreakdownItemField(realIndex, 'contactNumber', e.target.value)}
                                placeholder="09xxxxxxxxx"
                              />
                            </label>
                            <label>
                              Agent
                              <input
                                type="text"
                                value={item.agent || linkedPO?.agent || ''}
                                onChange={(e) => changeBreakdownItemField(realIndex, 'agent', e.target.value)}
                                placeholder="e.g. Juan Dela Cruz"
                              />
                            </label>
                            <label>
                              Payment Method
                              <input
                                type="text"
                                value={item.paymentMethod || linkedPO?.paymentMethod || ''}
                                onChange={(e) => changeBreakdownItemField(realIndex, 'paymentMethod', e.target.value)}
                                placeholder="Bank Transfer, GCash, Cash"
                              />
                            </label>
                            <label style={{ gridColumn: '1 / -1' }}>
                              Description (Purchase Order only)
                              <input
                                type="text"
                                value={linkedPO?.description || ''}
                                onChange={(e) => changePOItemDescription(item.mirrorId, e.target.value)}
                                placeholder="e.g. Round-trip airfare for 5 pax, CRK-MPH"
                              />
                            </label>
                          </div>
                        </div>
                      )}
                      <div className="pax-tier-toggle-row">
                        {isLegacyItem ? (
                          <>
                            <button
                              type="button"
                              className={`pax-tier-toggle-btn ${shownInQuotation ? 'active' : ''}`}
                              onClick={() => changeBreakdownItemField(realIndex, 'sendToQuotation', !item.sendToQuotation)}
                              title="Show this item in the Quotation document"
                            >
                              {shownInQuotation ? <Eye size={12} /> : <EyeOff size={12} />}
                              <span>Quotation</span>
                            </button>
                            <button
                              type="button"
                              className={`pax-tier-toggle-btn ${shownInInvoice ? 'active' : ''}`}
                              onClick={() => toggleBreakdownMirrorVisibility(item.mirrorId, item.id, 'invoice')}
                              disabled={!linkedAddon}
                              title={linkedAddon ? 'Show this item in the Invoice document' : 'No linked Invoice addon yet'}
                            >
                              {shownInInvoice ? <Eye size={12} /> : <EyeOff size={12} />}
                              <span>Invoice</span>
                            </button>
                          </>
                        ) : rowItemType === 'addon' ? (
                          <span className="pax-tier-toggle-static" title="Add-ons always show on the Quotation & Invoice, never the Breakdown">
                            <Eye size={12} /> Quotation &amp; Invoice
                          </span>
                        ) : (
                          <span className="pax-tier-toggle-static" title="Inclusions always show on the Breakdown only, never the Quotation or Invoice">
                            <Eye size={12} /> Breakdown only
                          </span>
                        )}
                        <button
                          type="button"
                          className={`pax-tier-toggle-btn ${shownInPO ? 'active' : ''}`}
                          onClick={() => toggleBreakdownMirrorVisibility(item.mirrorId, item.id, 'po')}
                          disabled={!linkedPO}
                          title={linkedPO ? 'Show this item in the Purchase Order document' : 'No linked Purchase Order item yet'}
                        >
                          {shownInPO ? <Eye size={12} /> : <EyeOff size={12} />}
                          <span>Purchase Order</span>
                        </button>
                      </div>
                    </div>
                  )
                })}

                {currentBreakdownItems.filter(i => !i.isPackageRow).length === 0 && (
                  <div style={{padding:'1.25rem', textAlign:'center', color:'var(--text-secondary)', fontSize:'0.85rem', fontStyle:'italic'}}>
                    No services yet — use "Add item" above to add an Inclusion (Breakdown only) or an Add-on (Quotation &amp; Invoice).
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

          {/* LOGISTICS */}
          {showSection('logistics') && (
          <section className="form-section">
            <div className="form-section-heading">
              <p>Logistics</p>
              <h2>Fulfillment context</h2>
              <div className="doc-affects">
                <span className="doc-affects-label">Appears on</span>
                <span className="doc-tag doc-tag-quotation">Quotation</span>
                <span className="doc-tag doc-tag-invoice">Invoice</span>
                <span className="doc-tag doc-tag-po">Purchase Order</span>
                <span className="doc-tag doc-tag-voucher">Voucher</span>
              </div>
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
                Hotel name
                <textarea rows={2} value={bookingForm.hotelName} onChange={(e) => updateBookingField('hotelName', e.target.value)} placeholder="Henann Regency Beach Resort" />
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
          )}

          {/* INCLUSIONS */}
          {showSection('inclusions') && (
          <section className="form-section">
            <div className="form-section-heading">
              <p>Inclusions &amp; Exclusions</p>
              <h2>Manual entry</h2>
              <div className="doc-affects">
                <span className="doc-affects-label">Appears on</span>
                <span className="doc-tag doc-tag-quotation">Quotation</span>
                <span className="doc-tag doc-tag-voucher">Voucher</span>
              </div>
            </div>
            <div className="field-grid two">
              <label className="textarea-field">
                Inclusions
                <textarea
                  rows={5}
                  value={bookingForm.inclusions}
                  onChange={(e) => updateBookingField('inclusions', e.target.value)}
                  placeholder={'One item per line, e.g.\nRound-trip airfare\nHotel accommodation\nAirport transfers'}
                />
              </label>
              <label className="textarea-field">
                Exclusions
                <textarea
                  rows={5}
                  value={bookingForm.exclusions}
                  onChange={(e) => updateBookingField('exclusions', e.target.value)}
                  placeholder={'One item per line, e.g.\nMeals not stated\nPersonal expenses\nTravel insurance'}
                />
              </label>
            </div>
            <p className="field-help">One item per line. These show exactly as typed on the quotation and voucher.</p>
          </section>
          )}

          {/* SCHEDULE */}
          {showSection('schedule') && (
          <section className="form-section">
            <div className="form-section-heading">
              <p>Day-by-Day Schedule</p>
              <h2>Itinerary &amp; hotel per day</h2>
              <div className="doc-affects">
                <span className="doc-affects-label">Appears on</span>
                <span className="doc-tag doc-tag-voucher">Voucher</span>
              </div>
            </div>
            {(() => {
              const rows: { date: string; itinerary: string; hotel: string }[] = (() => {
                try { return bookingForm.voucherRowsJson ? JSON.parse(bookingForm.voucherRowsJson) : [] } catch { return [] }
              })()
              const save = (updated: typeof rows) => updateBookingField('voucherRowsJson', JSON.stringify(updated))
              const addRow = () => {
                const prev = rows[rows.length - 1]
                const nextDate = prev?.date
                  ? (() => { const d = new Date(prev.date + 'T00:00:00'); d.setDate(d.getDate() + 1); return toDateInputValue(d) })()
                  : (bookingForm.travelStart || '')
                save([...rows, { date: nextDate, itinerary: '', hotel: prev?.hotel || bookingForm.hotelName || '' }])
              }
              const updateRow = (i: number, field: string, val: string) => {
                const next = rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r)
                save(next)
              }
              const removeRow = (i: number) => save(rows.filter((_, idx) => idx !== i))
              return (
                <div className="voucher-day-builder">
                  {rows.length === 0 && (
                    <p className="voucher-day-empty">No days added yet. Click &ldquo;+ Add day&rdquo; to build the itinerary.</p>
                  )}
                  {rows.map((row, i) => (
                    <div key={i} className="voucher-day-row">
                      <div className="voucher-day-header">
                        <span>Day {i + 1}</span>
                        <button type="button" className="voucher-day-remove" onClick={() => removeRow(i)}>× Remove</button>
                      </div>
                      <div className="field-grid three">
                        <label>
                          Date
                          <input type="date" value={row.date} onChange={(e) => updateRow(i, 'date', e.target.value)} />
                        </label>
                        <label style={{gridColumn:'span 2'}}>
                          Hotel / Accommodation
                          <input value={row.hotel} onChange={(e) => updateRow(i, 'hotel', e.target.value)} placeholder="e.g. Azalea Hotel Baguio" />
                        </label>
                      </div>
                      <label className="textarea-field" style={{marginTop:'0.5rem'}}>
                        Itinerary for this day
                        <textarea rows={3} value={row.itinerary} onChange={(e) => updateRow(i, 'itinerary', e.target.value)} placeholder="e.g. Arrival at NAIA Terminal 3, Transfer to hotel, Check-in, Free time" />
                      </label>
                    </div>
                  ))}
                  <button type="button" className="voucher-add-day-btn" onClick={addRow}>+ Add day</button>
                </div>
              )
            })()}
          </section>
          )}

          {/* REMARKS */}
          {showSection('remarks') && (
          <section className="form-section">
            <div className="form-section-heading">
              <p>Remarks</p>
              <h2>Internal operations notes</h2>
              <div className="doc-affects">
                <span className="doc-affects-label">Appears on</span>
                <span className="doc-tag doc-tag-po">Purchase Order</span>
                <span className="doc-tag doc-tag-voucher">Voucher</span>
              </div>
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
          )}

              <footer className="form-actions-bar">
                <button
                  type="button"
                  className="cancel-form-btn"
                  onClick={() => { setEditingBookingId(''); setScreen(isEditingBooking ? 'booking-detail' : 'home') }}
                >
                  ← Cancel
                </button>
                <button type="submit" className="save-booking-btn">
                  <Save size={18} />
                  {isEditingBooking ? 'Save Changes' : 'Save Booking Record'}
                </button>
              </footer>
            </form>
            </div>

            {showLivePreview && (
              <aside className="live-preview-panel">
                <div className="live-preview-panel-header">
                  <Eye size={14} />
                  <span>Live preview — {livePreviewCards.find(c => c.id === livePreviewDoc)?.label}</span>
                </div>
                <div className="live-preview-panel-body">
                  {renderDocByType(livePreviewDoc, buildDraftBookingFromForm())}
                </div>
              </aside>
            )}
            </div>
          </>

                {/* PAX MODAL */}
        {paxModalIndex >= 0 && (() => {
          const item = currentBreakdownItems[paxModalIndex]
          const label = item?.description || ''
          const modalPax = getItemPaxBreakdown(item, bookingForm)
          const modalExcluded = readExcludedPax(item)
          return (
            <div className="pax-modal-overlay" onClick={() => setPaxModalIndex(-1)}>
              <div className="pax-modal" onClick={(e) => e.stopPropagation()}>
                <div className="pax-modal-header">
                  <span>No. of Pax — <strong>{label}</strong></span>
                  <button type="button" className="pax-modal-close" onClick={() => setPaxModalIndex(-1)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="pax-modal-body">
                  {(['adult', 'child', 'senior', 'infant'] as const).map((category) => {
                    const isExcluded = modalExcluded.includes(category)
                    return (
                      <label key={category} className="pax-modal-field">
                        <span>{category.charAt(0).toUpperCase() + category.slice(1)}</span>
                        <div className={`pax-tier-inherited-value${isExcluded ? ' excluded' : ''}`}>
                          <span>{isExcluded ? '—' : (modalPax[category] || '0')}</span>
                          <button
                            type="button"
                            className="pax-tier-exclude-btn"
                            onClick={() => toggleItemPaxCategory(paxModalIndex, category)}
                          >
                            {isExcluded ? '+' : <X size={11} />}
                          </button>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}
      </main>
    )
  }

  if (screen === 'booking-detail') {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
            <button
              type="button"
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
                  {(selectedBooking.status === 'Confirmed' || selectedBooking.status === 'Flown') ? (
                    <input value={selectedBooking.status} disabled readOnly />
                  ) : (
                    <select
                      value={selectedBooking.status}
                      onChange={(e) => applyStatusToBookingId(selectedBooking.id, e.target.value as BookingStatus)}
                    >
                      <option value="Quotation">Quotation</option>
                      <option value="Invoice">Invoice</option>
                    </select>
                  )}
                </label>
                <button
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
                <strong>{formatPaxBreakdownLabel(readGroupPax(selectedBooking)) || selectedBooking.pax || 'Not provided'}</strong>
              </article>
              <article>
                <span>Travel dates</span>
                <strong>
                  {selectedBooking.travelStart
                    ? new Date(selectedBooking.travelStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'No start'}
                  {' – '}
                  {selectedBooking.travelEnd
                    ? new Date(selectedBooking.travelEnd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'No end'}
                </strong>
              </article>
              <article>
                <span>Quotation no.</span>
                <strong>{selectedBooking.quotationNo || 'Not assigned'}</strong>
              </article>
              <article>
                <span>Date created</span>
                <strong>
                  <input
                    type="date"
                    defaultValue={selectedBooking.createdAt ? toDateInputValue(selectedBooking.createdAt) : ''}
                    max={toDateInputValue()}
                    onChange={(e) => updateSelectedBookingCreatedAt(e.target.value)}
                    style={{ font: 'inherit', border: 'none', background: 'transparent', color: 'inherit', padding: 0, cursor: 'pointer', width: '100%' }}
                  />
                </strong>
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
                <strong>{convertAndFormat(getBookingClientTotal(selectedBooking), selectedBooking.currency || 'PHP', exchangeRates)}</strong>
              </article>
              <article className="internal-summary">
                <span>Internal nett</span>
                <strong>{convertAndFormat(getBookingBreakdownNettTotal(selectedBooking), selectedBooking.currency || 'PHP', exchangeRates)}</strong>
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
              <button type="button" onClick={handleDuplicateBooking}>
                <Copy size={19} />
                <span>
                  <strong>Duplicate project</strong>
                  <small>Start a new inquiry pre-filled with this project's details.</small>
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
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
          selectedBooking.packageName &&
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
              type="button"
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
              <article className={`folder-card${['Invoice', 'Quotation', 'Purchase Order'].includes(item.title) ? ' folder-card-highlight' : ''}`} key={item.title}>
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
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
              className="nav-text-action"
              type="button"
              onClick={handleDownloadJpg}
              title={isJpgExporting ? 'Preparing JPG...' : 'Download as JPG'}
              disabled={isJpgExporting || isPdfExporting}
            >
              <Download size={18} />
              <span>{isJpgExporting ? 'Preparing...' : 'Download JPG'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('document-folder')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        {renderQuotationDoc(selectedBooking)}
      </main>
    )
  }

  if (screen === 'invoice-editor') {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              onClick={() => setScreen(invoiceEditorReturnScreen)}
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
              <strong>{convertAndFormat(totalPrice, selectedBooking.currency || 'PHP', exchangeRates)}</strong>
            </article>
            <article>
              <span>Amount paid</span>
              <strong>{convertAndFormat(parseAmount(invoiceForm.invoiceAmountPaid), selectedBooking.currency || 'PHP', exchangeRates)}</strong>
            </article>
            <article>
              <span>Balance</span>
              <strong>{convertAndFormat(balance, selectedBooking.currency || 'PHP', exchangeRates)}</strong>
            </article>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Log a payment</p>
              <h2>Add customer payment</h2>
            </div>
            <div className="field-grid two">
              <label>
                Amount received (PHP)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentEntry.amount}
                  onChange={(e) => setPaymentEntry((p) => ({ ...p, amount: e.target.value }))}
                  placeholder="e.g. 5000"
                />
              </label>
              <label>
                Payment date
                <input
                  type="date"
                  value={paymentEntry.date}
                  onChange={(e) => setPaymentEntry((p) => ({ ...p, date: e.target.value }))}
                />
              </label>
              <label>
                Payment method
                <input
                  value={paymentEntry.method}
                  onChange={(e) => setPaymentEntry((p) => ({ ...p, method: e.target.value }))}
                  placeholder="GCash, BDO, cash, etc."
                />
              </label>
              <label>
                Reference / OR no.
                <input
                  value={paymentEntry.reference}
                  onChange={(e) => setPaymentEntry((p) => ({ ...p, reference: e.target.value }))}
                  placeholder="GCash ref, OR no., bank ref"
                />
              </label>
            </div>
            <button
              type="button"
              className="log-payment-btn"
              onClick={handleLogPayment}
              disabled={!paymentEntry.amount || Number(paymentEntry.amount) <= 0}
            >
              + Log payment
            </button>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <p>Payment records</p>
              <h2>History &amp; status</h2>
            </div>
            <div className="payment-log-list">
              {invoiceForm.paymentRecords
                ? invoiceForm.paymentRecords.split('\n').filter(Boolean).map((rec, i) => (
                    <div key={i} className="payment-log-entry">
                      <span>{rec}</span>
                      <button
                        type="button"
                        className="payment-log-remove"
                        title="Remove this record"
                        onClick={() => handleRemovePaymentRecord(i)}
                      >×</button>
                    </div>
                  ))
                : <p className="payment-log-empty">No payments logged yet.</p>
              }
            </div>
            <div className="field-grid two" style={{marginTop:'1rem'}}>
              <label>
                Payment status
                <div className="payment-status-row">
                  <span className={`payment-status-badge status-${invoiceForm.invoicePaymentStatus.toLowerCase().replaceAll(' ', '-')}`}>
                    {invoiceForm.invoicePaymentStatus}
                  </span>
                  {invoiceForm.invoicePaymentStatus !== 'Paid' && (
                    <button
                      type="button"
                      className="mark-paid-btn"
                      onClick={() => handlePaymentStatusSelect('Paid')}
                    >
                      <CheckCircle2 size={16} />
                      PAID?
                    </button>
                  )}
                </div>
                <span className="field-help">Auto-updates as you log or remove payments. Click "PAID?" to settle the remaining balance and record the date it was fully paid.</span>
              </label>
              <label>
                Total paid so far (auto-summed)
                <input
                  type="number"
                  value={invoiceForm.invoiceAmountPaid}
                  onChange={(event) => updateInvoiceField('invoiceAmountPaid', event.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
          </section>
        </form>

        {isFullyPaidModalOpen && (
          <div className="pax-modal-overlay" onClick={() => setIsFullyPaidModalOpen(false)}>
            <div className="pax-modal fully-paid-modal" onClick={(e) => e.stopPropagation()}>
              <div className="pax-modal-header">
                <span>Mark invoice as <strong>Paid</strong></span>
                <button type="button" className="pax-modal-close" onClick={() => setIsFullyPaidModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="fully-paid-modal-body">
                <p>
                  This will settle the remaining balance of{' '}
                  <strong>{convertAndFormat(Math.max(getInvoiceEditorTotal() - parseAmount(invoiceForm.invoiceAmountPaid), 0), selectedBooking.currency || 'PHP', exchangeRates)}</strong>{' '}
                  to {selectedBooking.currency || 'PHP'} 0.00. When was it fully paid?
                </p>
                <label className="fully-paid-date-field">
                  Date fully paid
                  <input
                    type="date"
                    value={fullyPaidDateInput}
                    onChange={(e) => setFullyPaidDateInput(e.target.value)}
                  />
                </label>
              </div>
              <div className="fully-paid-modal-actions">
                <button type="button" className="fully-paid-cancel-btn" onClick={() => setIsFullyPaidModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="fully-paid-confirm-btn" onClick={confirmFullyPaid}>
                  Confirm fully paid
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    )
  }

  if (screen === 'invoice-preview') {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
              className="nav-text-action"
              type="button"
              onClick={handleDownloadJpg}
              title={isJpgExporting ? 'Preparing JPG...' : 'Download as JPG'}
              disabled={isJpgExporting || isPdfExporting}
            >
              <Download size={18} />
              <span>{isJpgExporting ? 'Preparing...' : 'Download JPG'}</span>
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
              onClick={() => setScreen(invoiceEditorReturnScreen)}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        {renderInvoiceDoc(selectedBooking)}
      </main>
    )
  }

  if (screen === 'purchase-order-preview') {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
              className="nav-text-action"
              type="button"
              onClick={handleDownloadJpg}
              title={isJpgExporting ? 'Preparing JPG...' : 'Download as JPG'}
              disabled={isJpgExporting || isPdfExporting}
            >
              <Download size={18} />
              <span>{isJpgExporting ? 'Preparing...' : 'Download JPG'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('document-folder')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        {renderPurchaseOrderDoc(selectedBooking)}
      </main>
    )
  }

  if (screen === 'voucher-preview') {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
              className="nav-text-action"
              type="button"
              onClick={handleDownloadJpg}
              title={isJpgExporting ? 'Preparing JPG...' : 'Download as JPG'}
              disabled={isJpgExporting || isPdfExporting}
            >
              <Download size={18} />
              <span>{isJpgExporting ? 'Preparing...' : 'Download JPG'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('document-folder')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        {renderVoucherDoc(selectedBooking)}
      </main>
    )
  }

  if (screen === 'breakdown-preview') {
    const selectedBooking = (lastSavedBookingRef.current?.id === selectedBookingId ? lastSavedBookingRef.current : null) ?? bookings.find((booking) => booking.id === selectedBookingId)

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
              type="button"
              className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
              className="nav-text-action"
              type="button"
              onClick={handleDownloadJpg}
              title={isJpgExporting ? 'Preparing JPG...' : 'Download as JPG'}
              disabled={isJpgExporting || isPdfExporting}
            >
              <Download size={18} />
              <span>{isJpgExporting ? 'Preparing...' : 'Download JPG'}</span>
            </button>
            <button
              type="button"
              onClick={() => setScreen('document-folder')}
              title="Back"
            >
              <X size={18} />
            </button>
          </div>
        </nav>

        {renderBreakdownDoc(selectedBooking)}
      </main>
    )
  }

  if (screen === 'dtr') {
    const knownNames = Array.from(new Set(dtrEntries.map((e) => e.employeeName))).sort((a, b) => a.localeCompare(b))
    const monthEntries = dtrMonthFilter === 'all' ? dtrEntries : dtrEntries.filter((e) => e.date.startsWith(dtrMonthFilter))
    const visibleEntries = (dtrNameFilter === 'All' ? monthEntries : monthEntries.filter((e) => e.employeeName === dtrNameFilter))
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName))
    const totalMinutesVisible = visibleEntries.reduce((sum, e) => sum + getDtrEntryMinutes(e), 0)
    const daysLoggedVisible = new Set(visibleEntries.map((e) => e.date)).size
    // Group every entry into an employee+month "record" — this is what makes the
    // DTR feel like a normal records system: create one, open one, delete one.
    type DtrRecordSummary = { employeeName: string; month: string; daysLogged: number; totalMinutes: number; lastUpdated: string }
    const recordMap = new Map<string, DtrRecordSummary>()
    for (const entry of dtrEntries) {
      const month = entry.date.slice(0, 7)
      const key = `${entry.employeeName}__${month}`
      if (!recordMap.has(key)) {
        recordMap.set(key, { employeeName: entry.employeeName, month, daysLogged: 0, totalMinutes: 0, lastUpdated: entry.updatedAt || entry.createdAt || '' })
      }
      const rec = recordMap.get(key)!
      rec.daysLogged += 1
      rec.totalMinutes += getDtrEntryMinutes(entry)
      if ((entry.updatedAt || entry.createdAt || '') > rec.lastUpdated) rec.lastUpdated = entry.updatedAt || entry.createdAt || ''
    }
    const allRecords = Array.from(recordMap.values()).sort((a, b) => b.month.localeCompare(a.month) || a.employeeName.localeCompare(b.employeeName))
    const recordSearchLower = dtrRecordSearch.trim().toLowerCase()
    const filteredRecords = recordSearchLower
      ? allRecords.filter((r) => r.employeeName.toLowerCase().includes(recordSearchLower) || r.month.includes(recordSearchLower))
      : allRecords

    // ----- DTR records list (landing) view -----
    if (dtrView === 'records') {
      return (
        <main className="dtr-screen">
          <header className="dtr-header">
            <button type="button" className="dtr-back-btn" onClick={() => setScreen('home')} title="Back to dashboard">
              <CornerUpLeft size={18} />
            </button>
            <div className="dtr-header-title">
              <p>Operations desk</p>
              <h1>Daily Time Records</h1>
            </div>
            <div className="dtr-live-clock no-print">
              <span className="dtr-live-clock-dot" />
              <div className="dtr-live-clock-text">
                <strong>
                  {formatLiveClockParts(liveClock).time}
                  <span className="dtr-live-clock-period">{formatLiveClockParts(liveClock).period}</span>
                </strong>
                <span className="dtr-live-clock-date">{formatLiveDateShort(liveClock)}</span>
              </div>
            </div>
            <div className="dtr-header-actions">
              <button type="button" className="dtr-save-btn" onClick={() => { setDtrNewRecordError(''); setDtrNewRecordName(''); setDtrNewRecordMonth(getTodayDateStr().slice(0, 7)); setDtrNewRecordOpen(true) }}>
                <Plus size={16} />
                New Record
              </button>
            </div>
          </header>

          {dtrError && <div className="dtr-banner dtr-banner-error">{dtrError}</div>}
          {dtrMessage && !dtrError && <div className="dtr-banner dtr-banner-ok">{dtrMessage}</div>}

          <div className="dtr-records-body">
            <div className="dtr-records-toolbar">
              <input
                type="text"
                className="dtr-records-search"
                placeholder="Search by employee or month (YYYY-MM)..."
                value={dtrRecordSearch}
                onChange={(e) => setDtrRecordSearch(e.target.value)}
              />
              <span className="dtr-records-count">{filteredRecords.length} record{filteredRecords.length === 1 ? '' : 's'}</span>
            </div>

            {filteredRecords.length === 0 ? (
              <div className="dtr-empty dtr-records-empty">
                <Clock3 size={28} />
                <p>{allRecords.length === 0 ? 'No DTR records yet.' : 'No records match your search.'}</p>
                <span>Create a new record for an employee and month to get started.</span>
                {allRecords.length === 0 && (
                  <button type="button" className="dtr-save-btn" onClick={() => { setDtrNewRecordError(''); setDtrNewRecordName(''); setDtrNewRecordMonth(getTodayDateStr().slice(0, 7)); setDtrNewRecordOpen(true) }}>
                    <Plus size={15} />
                    New Record
                  </button>
                )}
              </div>
            ) : (
              <div className="dtr-records-grid">
                {filteredRecords.map((rec) => {
                  const monthLabel = new Date(`${rec.month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                  const isCurrentMonth = rec.month === getTodayDateStr().slice(0, 7)
                  return (
                    <div key={`${rec.employeeName}__${rec.month}`} className={`dtr-record-card ${isCurrentMonth ? 'dtr-record-card-current' : ''}`}>
                      <div className="dtr-record-card-top">
                        <div className="dtr-record-avatar">{rec.employeeName.charAt(0).toUpperCase()}</div>
                        <div className="dtr-record-card-info">
                          <p className="dtr-record-name">{rec.employeeName}</p>
                          <p className="dtr-record-month">{monthLabel}{isCurrentMonth && <span className="dtr-record-current-pill">Current</span>}</p>
                        </div>
                      </div>
                      <div className="dtr-record-card-stats">
                        <div className="dtr-record-stat">
                          <span>{rec.daysLogged}</span>
                          <p>Days logged</p>
                        </div>
                        <div className="dtr-record-stat">
                          <span>{formatMinutesAsHm(rec.totalMinutes)}</span>
                          <p>Total hours</p>
                        </div>
                      </div>
                      <div className="dtr-record-card-actions">
                        <button type="button" className="dtr-record-open-btn" onClick={() => openDtrRecord(rec.employeeName, rec.month)}>
                          <Eye size={14} />
                          Open
                        </button>
                        <button type="button" className="dtr-record-delete-btn" onClick={() => setDtrDeleteRecordTarget({ employeeName: rec.employeeName, month: rec.month })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* New record modal */}
          {dtrNewRecordOpen && (
            <div className="dtr-modal-overlay" onClick={() => setDtrNewRecordOpen(false)}>
              <div className="dtr-modal" onClick={(e) => e.stopPropagation()}>
                <h3>New DTR record</h3>
                <p className="dtr-modal-sub">Pick the employee and month — you'll log individual days next.</p>
                <form onSubmit={handleCreateDtrRecord} className="dtr-modal-form">
                  <label>
                    Employee name
                    <input
                      type="text"
                      value={dtrNewRecordName}
                      onChange={(e) => setDtrNewRecordName(e.target.value)}
                      placeholder="e.g. Maria Santos"
                      list="dtr-known-names-modal"
                      autoFocus
                      required
                    />
                    <datalist id="dtr-known-names-modal">
                      {knownNames.map((name) => <option key={name} value={name} />)}
                    </datalist>
                  </label>
                  <label>
                    Month
                    <input
                      type="month"
                      value={dtrNewRecordMonth}
                      onChange={(e) => setDtrNewRecordMonth(e.target.value)}
                      required
                    />
                  </label>
                  {dtrNewRecordError && <p className="dtr-modal-error">{dtrNewRecordError}</p>}
                  <div className="dtr-modal-actions">
                    <button type="button" className="dtr-cancel-btn" onClick={() => setDtrNewRecordOpen(false)}>Cancel</button>
                    <button type="submit" className="dtr-save-btn"><Plus size={15} />Create record</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete record confirmation */}
          {dtrDeleteRecordTarget && (
            <div className="dtr-modal-overlay" onClick={() => !dtrDeletingRecord && setDtrDeleteRecordTarget(null)}>
              <div className="dtr-modal" onClick={(e) => e.stopPropagation()}>
                <h3>Delete this record?</h3>
                <p className="dtr-modal-sub">
                  This permanently deletes every logged day for <strong>{dtrDeleteRecordTarget.employeeName}</strong> in{' '}
                  <strong>{new Date(`${dtrDeleteRecordTarget.month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>. This cannot be undone.
                </p>
                <div className="dtr-modal-actions">
                  <button type="button" className="dtr-cancel-btn" disabled={dtrDeletingRecord} onClick={() => setDtrDeleteRecordTarget(null)}>Cancel</button>
                  <button type="button" className="dtr-record-delete-confirm-btn" disabled={dtrDeletingRecord} onClick={() => handleDeleteDtrRecord(dtrDeleteRecordTarget.employeeName, dtrDeleteRecordTarget.month)}>
                    <Trash2 size={15} />
                    {dtrDeletingRecord ? 'Deleting...' : 'Delete record'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      )
    }

    return (
      <main className="dtr-screen">
        <header className="dtr-header">
          <button type="button" className="dtr-back-btn" onClick={() => setDtrView('records')} title="Back to records">
            <CornerUpLeft size={18} />
          </button>
          <div className="dtr-header-title">
            <p>Operations desk · <button type="button" className="dtr-breadcrumb-btn" onClick={() => setDtrView('records')}>All records</button></p>
            <h1>{dtrNameFilter === 'All' ? 'Daily Time Record' : dtrNameFilter} {dtrNameFilter !== 'All' && <span className="dtr-header-month">· {dtrMonthFilter === 'all' ? 'All Records' : new Date(`${dtrMonthFilter}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>}</h1>
          </div>
          <div className="dtr-live-clock no-print">
            <span className="dtr-live-clock-dot" />
            <div className="dtr-live-clock-text">
              <strong>
                {formatLiveClockParts(liveClock).time}
                <span className="dtr-live-clock-period">{formatLiveClockParts(liveClock).period}</span>
              </strong>
              <span className="dtr-live-clock-date">{formatLiveDateShort(liveClock)}</span>
            </div>
          </div>
          <div className="dtr-header-actions">
            <button type="button" className="dtr-pdf-btn" onClick={handlePrintPreview} disabled={isPdfExporting} title={isPdfExporting ? 'Preparing PDF...' : 'Download DTR as PDF'}>
              <Download size={16} />
              <span>{isPdfExporting ? 'Preparing...' : 'Download PDF'}</span>
            </button>
          </div>
        </header>

        {dtrError && <div className="dtr-banner dtr-banner-error">{dtrError}</div>}
        {dtrMessage && !dtrError && <div className="dtr-banner dtr-banner-ok">{dtrMessage}</div>}

        <div className="dtr-body">
          {/* LEFT — entry form */}
          <section className="dtr-panel dtr-form-panel no-print">
            <div className="dtr-form-panel-header">
              <p className="dtr-form-panel-title">{dtrEditingId ? '✏️ Edit Entry' : '➕ Log Time'}</p>
              <p className="dtr-form-panel-sub">Fill in the employee's time for the day</p>
            </div>

            <form className="dtr-manual-form" onSubmit={handleSaveDtrEntry}>
              <label>
                Employee name
                <input
                  type="text"
                  value={dtrForm.employeeName}
                  onChange={(e) => setDtrForm((f) => ({ ...f, employeeName: e.target.value }))}
                  placeholder="e.g. Maria Santos"
                  list="dtr-known-names"
                  required
                />
                <datalist id="dtr-known-names">
                  {knownNames.map((name) => <option key={name} value={name} />)}
                </datalist>
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={dtrForm.date}
                  onChange={(e) => setDtrForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </label>
              <div className="dtr-time-section-label">Morning (AM)</div>
              <div className="dtr-time-grid">
                <label>
                  Time In
                  <input type="time" value={dtrForm.amIn} onChange={(e) => setDtrForm((f) => ({ ...f, amIn: e.target.value }))} />
                </label>
                <label>
                  Time Out
                  <input type="time" value={dtrForm.amOut} onChange={(e) => setDtrForm((f) => ({ ...f, amOut: e.target.value }))} />
                </label>
              </div>
              <div className="dtr-time-section-label">Afternoon (PM)</div>
              <div className="dtr-time-grid">
                <label>
                  Time In
                  <input type="time" value={dtrForm.pmIn} onChange={(e) => setDtrForm((f) => ({ ...f, pmIn: e.target.value }))} />
                </label>
                <label>
                  Time Out
                  <input type="time" value={dtrForm.pmOut} onChange={(e) => setDtrForm((f) => ({ ...f, pmOut: e.target.value }))} />
                </label>
              </div>
              <label>
                Remarks <span className="dtr-optional">(optional)</span>
                <input
                  type="text"
                  value={dtrForm.notes}
                  onChange={(e) => setDtrForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Half day, field visit, leave"
                />
              </label>

              {/* Live hours preview */}
              {(dtrForm.amIn || dtrForm.pmOut) && (() => {
                const preview = getDtrEntryMinutes({ amIn: dtrForm.amIn, amOut: dtrForm.amOut, pmIn: dtrForm.pmIn, pmOut: dtrForm.pmOut })
                return preview > 0 ? (
                  <div className="dtr-hours-preview">
                    <Clock3 size={13} />
                    <span>Computed: <strong>{formatMinutesAsHm(preview)}</strong> for this entry</span>
                  </div>
                ) : null
              })()}

              <div className="dtr-form-actions">
                {dtrEditingId && (
                  <button type="button" className="dtr-cancel-btn" onClick={cancelEditDtrEntry}>Cancel</button>
                )}
                <button type="submit" className="dtr-save-btn">
                  <Save size={15} />
                  {dtrEditingId ? 'Save changes' : 'Log entry'}
                </button>
              </div>
            </form>
          </section>

          {/* RIGHT — ledger */}
          <section className="dtr-panel dtr-ledger-panel">
            <div className="dtr-ledger-controls no-print">
              <select className="dtr-select" value={dtrNameFilter} onChange={(e) => setDtrNameFilter(e.target.value)}>
                <option value="All">All employees</option>
                {knownNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <select
                className="dtr-month-input"
                value={dtrMonthFilter}
                onChange={(e) => setDtrMonthFilter(e.target.value)}
              >
                <option value="all">All months</option>
                {Array.from(new Set(dtrEntries.map((e) => e.date.slice(0, 7)))).sort((a, b) => b.localeCompare(a)).map((m) => (
                  <option key={m} value={m}>{new Date(`${m}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>
                ))}
              </select>
            </div>

            {/* ── PRINT-ONLY: Full government-style DTR template ── */}
            <div className="dtr-print-doc print-only">
              <div className="dtr-print-doc-header">
                <img src={logo} alt="Lion and Lamb Travel" className="dtr-print-doc-logo" />
                <div className="dtr-print-doc-title">
                  <h1>Lion and Lamb Travel &amp; Tours</h1>
                  <p className="dtr-print-doc-subtitle">DAILY TIME RECORD</p>
                </div>
                <div className="dtr-print-doc-form-no">
                  <span>Form No.</span>
                  <strong>DTR-001</strong>
                </div>
              </div>

              <div className="dtr-print-doc-meta-row">
                <div className="dtr-print-doc-meta-field">
                  <span className="dtr-print-doc-meta-label">Employee Name</span>
                  <strong className="dtr-print-doc-meta-value">
                    {dtrNameFilter === 'All' ? 'All Team Members' : dtrNameFilter}
                  </strong>
                </div>
                <div className="dtr-print-doc-meta-field">
                  <span className="dtr-print-doc-meta-label">Period Covered</span>
                  <strong className="dtr-print-doc-meta-value">
                    {dtrMonthFilter === 'all'
                      ? 'All Records'
                      : new Date(`${dtrMonthFilter}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </strong>
                </div>
                <div className="dtr-print-doc-meta-field">
                  <span className="dtr-print-doc-meta-label">Position / Dept.</span>
                  <strong className="dtr-print-doc-meta-value dtr-print-blank-line">&nbsp;</strong>
                </div>
              </div>

              <table className="dtr-print-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="dtr-print-th-date">Day</th>
                    <th rowSpan={2} className="dtr-print-th-day">Day of Week</th>
                    <th colSpan={2} className="dtr-print-th-group">Morning (A.M.)</th>
                    <th colSpan={2} className="dtr-print-th-group">Afternoon (P.M.)</th>
                    <th rowSpan={2} className="dtr-print-th-total">Total Hrs</th>
                    <th rowSpan={2} className="dtr-print-th-notes">Remarks</th>
                  </tr>
                  <tr>
                    <th className="dtr-print-th-sub">Time In</th>
                    <th className="dtr-print-th-sub">Time Out</th>
                    <th className="dtr-print-th-sub">Time In</th>
                    <th className="dtr-print-th-sub">Time Out</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    if (dtrMonthFilter === 'all') {
                      // All months: show every entry sorted by date
                      return visibleEntries.map((entry) => {
                        const d = new Date(`${entry.date}T00:00:00`)
                        const weekday = d.getDay()
                        const isWeekend = weekday === 0 || weekday === 6
                        const minutes = getDtrEntryMinutes(entry)
                        return (
                          <tr key={entry.id} className={`dtr-print-tr ${isWeekend ? 'dtr-print-tr-weekend' : ''} dtr-print-tr-has-entry`}>
                            <td className="dtr-print-td-date">{entry.date}</td>
                            <td className="dtr-print-td-day">{d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</td>
                            <td className="dtr-print-td-time">{formatTimeForDisplay(entry.amIn)}</td>
                            <td className="dtr-print-td-time">{formatTimeForDisplay(entry.amOut)}</td>
                            <td className="dtr-print-td-time">{formatTimeForDisplay(entry.pmIn)}</td>
                            <td className="dtr-print-td-time">{formatTimeForDisplay(entry.pmOut)}</td>
                            <td className="dtr-print-td-total">{minutes > 0 ? formatMinutesAsHm(minutes) : ''}</td>
                            <td className="dtr-print-td-notes">{entry.notes || ''}</td>
                          </tr>
                        )
                      })
                    }
                    const [yr, mo] = dtrMonthFilter.split('-').map(Number)
                    const daysInMonth = new Date(yr, mo, 0).getDate()
                    const entryMap = new Map(visibleEntries.map((e) => [e.date, e]))
                    return Array.from({ length: daysInMonth }, (_: unknown, i: number) => {
                      const dayNum = i + 1
                      const dateStr = `${dtrMonthFilter}-${String(dayNum).padStart(2, '0')}`
                      const d = new Date(`${dateStr}T00:00:00`)
                      const weekday = d.getDay() // 0=Sun, 6=Sat
                      const isWeekend = weekday === 0 || weekday === 6
                      const entry = entryMap.get(dateStr) as DtrEntry | undefined
                      const minutes = entry ? getDtrEntryMinutes(entry) : 0
                      return (
                        <tr key={dateStr} className={`dtr-print-tr ${isWeekend ? 'dtr-print-tr-weekend' : ''} ${entry ? 'dtr-print-tr-has-entry' : ''}`}>
                          <td className="dtr-print-td-date">{dayNum}</td>
                          <td className="dtr-print-td-day">{d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</td>
                          <td className="dtr-print-td-time">{entry ? formatTimeForDisplay(entry.amIn) : (isWeekend ? '' : '')}</td>
                          <td className="dtr-print-td-time">{entry ? formatTimeForDisplay(entry.amOut) : ''}</td>
                          <td className="dtr-print-td-time">{entry ? formatTimeForDisplay(entry.pmIn) : ''}</td>
                          <td className="dtr-print-td-time">{entry ? formatTimeForDisplay(entry.pmOut) : ''}</td>
                          <td className="dtr-print-td-total">{minutes > 0 ? formatMinutesAsHm(minutes) : (isWeekend ? <span className="dtr-print-weekend-mark">REST</span> : '')}</td>
                          <td className="dtr-print-td-notes">{entry?.notes || ''}</td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
                <tfoot>
                  <tr className="dtr-print-tfoot-summary">
                    <td colSpan={6} className="dtr-print-tfoot-label">
                      <span>Days Logged: <strong>{daysLoggedVisible}</strong></span>
                      <span>Avg / Day: <strong>{daysLoggedVisible > 0 ? formatMinutesAsHm(Math.round(totalMinutesVisible / daysLoggedVisible)) : '—'}</strong></span>
                    </td>
                    <td className="dtr-print-tfoot-total">{formatMinutesAsHm(totalMinutesVisible)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>

              <div className="dtr-print-doc-certification">
                <p>I hereby certify, on my honor, that the above is a true and correct record of the hours of work performed, record of which was made daily at the time of arrival at and departure from the office.</p>
              </div>

              <div className="dtr-print-doc-signoff">
                <div className="dtr-print-signoff-block">
                  <div className="dtr-print-sig-line" />
                  <p className="dtr-print-sig-name">&nbsp;</p>
                  <p className="dtr-print-sig-label">Employee Signature &amp; Date</p>
                </div>
                <div className="dtr-print-signoff-block">
                  <div className="dtr-print-sig-line" />
                  <p className="dtr-print-sig-name">&nbsp;</p>
                  <p className="dtr-print-sig-label">Supervisor / Manager</p>
                </div>
                <div className="dtr-print-signoff-block">
                  <div className="dtr-print-sig-line" />
                  <p className="dtr-print-sig-name">&nbsp;</p>
                  <p className="dtr-print-sig-label">Verified By &amp; Date</p>
                </div>
              </div>
            </div>

            <div className="dtr-summary-strip">
              <div className="dtr-summary-stat">
                <span>{daysLoggedVisible}</span>
                <p>Days logged</p>
              </div>
              <div className="dtr-summary-divider" />
              <div className="dtr-summary-stat">
                <span>{formatMinutesAsHm(totalMinutesVisible)}</span>
                <p>Total hours</p>
              </div>
              <div className="dtr-summary-divider" />
              <div className="dtr-summary-stat">
                <span>{daysLoggedVisible > 0 ? formatMinutesAsHm(Math.round(totalMinutesVisible / daysLoggedVisible)) : '—'}</span>
                <p>Avg / day</p>
              </div>
            </div>

            {/* ── Weekly hours tracker ── */}
            {(() => {
              const weekTarget = 40 * 60
              const today = getTodayDateStr()
              const currentWeekKey = getIsoWeekKey(today)

              // Get Mon–Sun range for the current week
              const d = new Date(`${today}T00:00:00`)
              const day = d.getDay() === 0 ? 7 : d.getDay()
              const monday = new Date(d); monday.setDate(d.getDate() - (day - 1))
              const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
              const fmt = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const weekLabel = `${fmt(monday)} – ${fmt(sunday)}`

              // Sum only entries that fall in the current week
              const currentWeekEntries = visibleEntries.filter(
                (e) => getIsoWeekKey(e.date) === currentWeekKey
              )
              const minutes = currentWeekEntries.reduce((s, e) => s + getDtrEntryMinutes(e), 0)
              const days = new Set(currentWeekEntries.map((e) => e.date)).size
              const pct = Math.min(100, (minutes / weekTarget) * 100)
              const isOver = minutes > weekTarget

              return (
                <div className="dtr-weekly-tracker no-print">
                  <div className="dtr-weekly-header">
                    <p className="dtr-weekly-title">This Week</p>
                    <span className="dtr-weekly-target">Target: 40h / week</span>
                  </div>
                  <div className="dtr-weekly-rows">
                    <div className="dtr-week-row dtr-week-current">
                      <div className="dtr-week-meta">
                        <span className="dtr-week-range">
                          {weekLabel}
                          <span className="dtr-week-now-pill">This week</span>
                        </span>
                        <span className="dtr-week-stats">{days > 0 ? `${days}d logged` : 'No entries yet'}</span>
                      </div>
                      <div className="dtr-week-bar-wrap">
                        <div className="dtr-week-bar-track">
                          <div
                            className={`dtr-week-bar-fill ${isOver ? 'dtr-week-bar-over' : pct >= 80 ? 'dtr-week-bar-good' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                          <div className="dtr-week-bar-target-line" title="40h target" />
                        </div>
                        <span className={`dtr-week-hours ${isOver ? 'dtr-week-hours-over' : ''}`}>
                          {minutes > 0 ? formatMinutesAsHm(minutes) : '—'}
                          {isOver && <span className="dtr-week-over-badge">+{formatMinutesAsHm(minutes - weekTarget)}</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            <div className="dtr-ledger">
              {visibleEntries.length === 0 ? (
                <div className="dtr-empty">
                  <Clock3 size={28} />
                  <p>No time records for this period.</p>
                  <span>Use the form on the left to log an entry{dtrMonthFilter !== 'all' ? ', or pick a different month' : ''}.</span>
                </div>
              ) : (
                visibleEntries.map((entry) => {
                  const minutes = getDtrEntryMinutes(entry)
                  const isToday = entry.date === getTodayDateStr()
                  const isIncomplete = Boolean((entry.amIn && !entry.amOut) || (entry.pmIn && !entry.pmOut))
                  return (
                    <div className={`dtr-row ${isToday ? 'dtr-row-today' : ''}`} key={entry.id}>
                      <div className="dtr-row-date">
                        <span className="dtr-row-day">
                          {dtrMonthFilter === 'all'
                            ? new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : new Date(`${entry.date}T00:00:00`).getDate()}
                        </span>
                        <span className="dtr-row-weekday">
                          {dtrMonthFilter === 'all'
                            ? new Date(`${entry.date}T00:00:00`).getFullYear()
                            : new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}
                        </span>
                      </div>
                      <div className="dtr-row-main">
                        <p className="dtr-row-name">
                          {entry.employeeName}
                          {isIncomplete && <span className="dtr-row-pill">In progress</span>}
                        </p>
                        <div className="dtr-row-times">
                          <span><em>AM</em> {formatTimeForDisplay(entry.amIn)} – {formatTimeForDisplay(entry.amOut)}</span>
                          <span><em>PM</em> {formatTimeForDisplay(entry.pmIn)} – {formatTimeForDisplay(entry.pmOut)}</span>
                        </div>
                        {entry.notes && <p className="dtr-row-notes">{entry.notes}</p>}
                      </div>
                      <div className="dtr-row-total">
                        <strong>{minutes > 0 ? formatMinutesAsHm(minutes) : '—'}</strong>
                      </div>
                      <div className="dtr-row-actions no-print">
                        <button type="button" onClick={() => startEditDtrEntry(entry)} title="Edit">
                          <FileText size={14} />
                        </button>
                        <button type="button" onClick={() => handleDeleteDtrEntry(entry.id)} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

          </section>
        </div>
      </main>
    )
  }

  // Home / dashboard screen (default fallback)
  const activeProjects = bookings.length
  const quotationCount = bookings.filter((b) => b.status === 'Quotation').length
  const invoiceCount = bookings.filter((b) => b.status === 'Invoice').length
  const confirmedCount = bookings.filter((b) => b.status === 'Confirmed').length
  const totalBookingValue = bookings.reduce((sum, b) => sum + getBookingClientTotal(b), 0)

  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() // 0-indexed

  const filteredBookings = (
    activeBookingFilter === 'All'
      ? bookings
      : bookings.filter((b) => b.status === activeBookingFilter)
  ).filter((b) => {
    const q = searchTerm.trim().toLowerCase()
    const matchesSearch = !q || [b.clientName, b.packageName, b.destination, b.quotationNo, b.status]
      .join(' ').toLowerCase().includes(q)
    const bookingYear = new Date(b.createdAt || Date.now()).getFullYear()
    return matchesSearch && bookingYear === activeYear
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

  // Build months up to current month for the current year, all 12 for past years
  const ALL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const visibleMonths = ALL_MONTHS.filter((_, i) => activeYear < currentYear || i <= currentMonth)
  const monthMap = new Map<string, typeof filteredBookings>()
  for (const b of filteredBookings) {
    const d = b.createdAt ? new Date(b.createdAt) : new Date()
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, [])
    monthMap.get(monthKey)!.push(b)
  }
  const bookingsByMonth = visibleMonths.map((name, i) => {
    const monthIndex = activeYear < currentYear ? i + 1 : ALL_MONTHS.indexOf(name) + 1
    const monthKey = `${activeYear}-${String(monthIndex).padStart(2, '0')}`
    return { monthKey, label: name, items: monthMap.get(monthKey) ?? [] }
  })
  const availableYears = Array.from(
    new Set(bookings.map(b => new Date(b.createdAt || Date.now()).getFullYear()))
  ).sort((a, b) => b - a)
  if (!availableYears.includes(activeYear)) availableYears.unshift(activeYear)

  function toggleMonth(monthKey: string) {
    setExpandedMonth(prev => prev === monthKey ? null : monthKey)
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
          <button
            type="button"
            className={`dark-toggle-btn ${isDark ? 'dark-active' : ''}`}
            onClick={() => setIsDark((d) => !d)}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            className={`chat-nav-btn ${isChatOpen ? 'chat-active' : ''}`}
            onClick={() => { setIsChatOpen(o => { isChatOpenRef.current = !o; if (!o) { setUnreadCount(0); void markMessagesSeen(); setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'instant' }), 80) } return !o }) }}
            title="Team chat"
          >
            <MessageSquare size={18} />
            {unreadCount > 0 && <span className="chat-badge">{unreadCount}</span>}
          </button>
          <button
            type="button"
            className="nav-text-action nav-clock-btn"
            onClick={() => { setDtrView('records'); setScreen('dtr') }}
            title="Open Daily Time Record"
          >
            <Clock3 size={15} className="nav-clock-icon" />
            <span className="nav-clock-time">
              {formatLiveClockParts(liveClock).time.slice(0, -3)}
              <span className="nav-clock-period">{formatLiveClockParts(liveClock).period}</span>
            </span>
          </button>
          <button type="button" onClick={handleLogout} title="Log out">
            <LogOut size={18} />
          </button>
          <button
              type="button"
              className="nav-text-action"
              onClick={() => {
                window.open('https://docs.google.com/spreadsheets/d/1zG7bnW7p8SYF6-CpU4fKUdmA3wmlnvrXhMQE02wQRtc/edit', '_blank')
              }}
              title="Open Google Sheets"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#23A566"/>
                <path d="M14 2V8H20L14 2Z" fill="#187A4A"/>
                <path d="M8 13H16V14.5H8V13ZM8 16H16V17.5H8V16ZM8 10H11V11.5H8V10Z" fill="white"/>
              </svg>
              Open Google Sheet
            </button>
            <button
              type="button"
              className="nav-text-action"
              onClick={handleRegenerateAllQuotationNumbers}
              title="Give every existing project a new random quotation number"
            >
              <RefreshCw size={18} />
              New Quotation Nos.
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

              <div className="dashboard-banner-right">
                {/* Dashboard live clock strip */}
                <div className="dashboard-clock-strip no-print">
                  <div className="dashboard-clock-display">
                    <span className="dashboard-clock-time">
                      {formatLiveClockParts(liveClock).time}
                    </span>
                    <span className="dashboard-clock-period">{formatLiveClockParts(liveClock).period}</span>
                  </div>
                  <div className="dashboard-clock-meta">
                    <span className="dashboard-clock-date">
                      {liveClock.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                <div className="dashboard-banner-actions">
                  <button
                    type="button"
                    className="create-project-btn"
                    onClick={handleNewBooking}
                  >
                    <Plus size={20} />
                    New Inquiry
                  </button>
                  <button
                    type="button"
                    className="open-dtr-btn"
                    onClick={() => { setDtrView('records'); setScreen('dtr') }}
                  >
                    <Clock3 size={18} />
                    Open Daily Time Record
                  </button>
                </div>
              </div>
            </div>
          </section>



          <section className="dashboard-grid">
            <article className="summary-card teal" onClick={() => setActiveBookingFilter('Quotation')} style={{ cursor: 'pointer' }}>
              <div className="summary-card-top">
                <div className="summary-icon blue">
                  <ClipboardList size={20} />
                </div>
                <span>Quotation</span>
              </div>
              <strong>{quotationCount}</strong>
              <small>Pending confirmation</small>
            </article>
            <article className="summary-card gold" onClick={() => setActiveBookingFilter('Invoice')} style={{ cursor: 'pointer' }}>
              <div className="summary-card-top">
                <div className="summary-icon gold">
                  <Receipt size={20} />
                </div>
                <span>Invoice</span>
              </div>
              <strong>{invoiceCount}</strong>
              <small>Awaiting payment</small>
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

          <section className="docs-hub-panel">
            <div className="docs-hub-heading">
              <div>
                <p>Internal</p>
                <h2>Documents</h2>
              </div>
              <span>{bookings.filter(b => b.status === 'Confirmed' || b.status === 'Flown').length} bookings</span>
            </div>

            <label className="docs-hub-search">
              <Search size={13} />
              <input
                value={docsSearchTerm}
                onChange={(e) => setDocsSearchTerm(e.target.value)}
                placeholder="Search client or package…"
              />
              {docsSearchTerm.trim() && (
                <button type="button" className="clear-search-btn" onClick={() => setDocsSearchTerm('')} title="Clear">
                  <X size={12} />
                </button>
              )}
            </label>

            <div className="docs-hub-cards">
              {(() => {
                const q = docsSearchTerm.trim().toLowerCase()
                const eligible = bookings.filter(b =>
                  (b.status === 'Confirmed' || b.status === 'Flown') &&
                  (!q || b.clientName.toLowerCase().includes(q) || b.packageName.toLowerCase().includes(q))
                )
                const noBase = bookings.filter(b => b.status === 'Confirmed' || b.status === 'Flown').length === 0
                const noMatch = !noBase && eligible.length === 0

                const renderList = (targetScreen: 'breakdown-preview' | 'purchase-order-preview') => (
                  <div className="docs-hub-list">
                    {noBase
                      ? <p className="docs-hub-empty">No confirmed or flown bookings yet.</p>
                      : noMatch
                        ? <p className="docs-hub-empty">No results for “{docsSearchTerm}”.</p>
                        : eligible.map(b => (
                          <button
                            type="button"
                            key={b.id}
                            className="docs-hub-row"
                            onClick={() => { setSelectedBookingId(b.id); setScreen(targetScreen) }}
                          >
                            <span className={`docs-hub-badge docs-hub-badge--${b.status === 'Flown' ? 'flown' : 'confirmed'}`}>{b.status}</span>
                            <span className="docs-hub-info">
                              <span className="docs-hub-client">{b.clientName}</span>
                              <span className="docs-hub-pkg">{b.packageName}</span>
                            </span>
                            <ChevronRight size={13} />
                          </button>
                        ))
                    }
                  </div>
                )

                return (
                  <>
                    <div className="docs-hub-card">
                      <div className="docs-hub-card-header">
                        <FileText size={13} />
                        <span>Breakdown</span>
                        <strong>{eligible.length}</strong>
                      </div>
                      {renderList('breakdown-preview')}
                    </div>
                    <div className="docs-hub-card">
                      <div className="docs-hub-card-header">
                        <FileText size={13} />
                        <span>Purchase Order</span>
                        <strong>{eligible.length}</strong>
                      </div>
                      {renderList('purchase-order-preview')}
                    </div>
                  </>
                )
              })()}
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

          {/* Year selector */}
          <div className="year-selector">
            {availableYears.map(y => (
              <button
                key={y}
                type="button"
                className={`year-tab ${y === activeYear ? 'active' : ''}`}
                onClick={() => setActiveYear(y)}
              >{y}</button>
            ))}
          </div>

          <div className="project-list">
            {bookingsByMonth.map(({ monthKey, label, items }) => {
              const isOpen = expandedMonth === monthKey
              return (
                <div key={monthKey} className="month-group">
                  <button
                    type="button"
                    className={`month-group-header ${isOpen ? 'open' : ''}`}
                    onClick={() => toggleMonth(monthKey)}
                  >
                    <ChevronDown size={14} style={{ transform: isOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
                    <span>{label}</span>
                    {items.length > 0 && <strong>{items.length}</strong>}
                  </button>
                  {isOpen && (
                    <div className="month-group-items">
                      {items.length === 0 ? (
                        <p className="month-empty">No projects in {label}.</p>
                      ) : items.map((booking) => (
                        <button
                          key={booking.id}
                          type="button"
                          className={`project-card status-${booking.status.toLowerCase().replaceAll(' ', '-')}`}
                          onClick={() => openBookingDetail(booking.id)}
                        >
                          <div className="project-main">
                            <div className="project-icon"><FileText size={20} /></div>
                            <div>
                              <strong style={{ fontSize: '1.05rem', fontWeight: 800 }}>{booking.clientName}</strong>
                              <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>{booking.packageName}</span>
                            </div>
                            {booking.isDuplicate && <span className="duplicated-tag">DUPLICATED</span>}
                          </div>
                          <div className="project-meta">
                            <span className="status-pill">{booking.status}</span>
                            <span><CalendarDays size={14} />{formatProjectDate(booking.createdAt)}</span>
                            {booking.travelStart && (
                              <span><Plane size={14} />{formatProjectDate(booking.travelStart)}{booking.travelEnd ? ` – ${formatProjectDate(booking.travelEnd)}` : ''}</span>
                            )}
                            <span><MapPin size={14} />{formatAmount(String(getBookingClientTotal(booking)))}</span>
                            {(booking.createdByName || (booking as any).createdByEmail) && (
                              <span className="booking-by-tag">
                                By: {booking.createdByName || getDisplayName((booking as any).createdByEmail)}
                              </span>
                            )}
                            <ChevronRight size={17} />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)', fontSize: '.78rem', fontWeight: 700 }}>
              {filteredBookings.length} record{filteredBookings.length !== 1 ? 's' : ''}
              {activeBookingFilter !== 'All' ? ` · ${activeBookingFilter}` : ''}
            </span>
          </div>
        </section>
      </div>

      {/* CHAT PANEL */}
      {isChatOpen && (
        <div className="chat-panel" ref={chatPanelRef} style={{ right: chatPos.right, bottom: chatPos.bottom }}>
          {/* Header */}
          <div className="chat-panel-header" onMouseDown={onChatHeaderMouseDown} style={{ cursor: 'grab' }}>
            <div className="chat-header-avatar">
              <MessageSquare size={14} />
            </div>
            <div className="chat-header-info">
              <strong>Team Chat</strong>
              <span className="chat-header-status"><span className="chat-status-dot" />Online</span>
            </div>
            <div className="chat-header-nexus-badge">
              <Bot size={11} /> The Herta
            </div>
            {isAdmin && (
              <button type="button" className="chat-wipe-btn" title="Clear all messages" onClick={() => setShowWipeConfirm(true)}>
                <Trash2 size={13} />
              </button>
            )}
            <button type="button" className="chat-close-btn" title="Close" onClick={() => setIsChatOpen(false)}><X size={15} /></button>
          </div>

          {/* Wipe confirm */}
          {showWipeConfirm && (
            <div className="chat-wipe-confirm">
              <span>🗑️ Delete all messages?</span>
              <div className="chat-wipe-actions">
                <button type="button" className="chat-wipe-yes" onClick={() => void wipeHistory()}>Delete all</button>
                <button type="button" className="chat-wipe-no" onClick={() => setShowWipeConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="chat-messages" onClick={() => setReactionPickerFor(null)}>
            {chatMessages.length === 0 && (
              <div className="chat-empty">
                <div className="chat-empty-icon">💬</div>
                <span>No messages yet. Say hi! 👋</span>
                <span className="chat-nexus-hint">Type <strong>@Herta</strong> to summon The Herta</span>
              </div>
            )}
            {chatMessages.map((msg, idx) => {
              const isMe = msg.senderEmail === authUser?.email
              const isNexus = msg.isNexus
              const isLast = idx === chatMessages.length - 1
              const time = msg.createdAt?.toDate
                ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''
              const initials = msg.senderName ? msg.senderName.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase() : '?'
              const reactions = msg.reactions as Record<string, string[]> | undefined
              const isUnsent = !!msg.unsent
              const isHovered = hoveredMsgId === msg.id
              const replyTo = msg.replyTo as { id: string; text: string; senderName: string } | undefined

              // Normalize seenBy — may be old plain strings (email) or new {email, name} objects
              type SeenEntry = string | { email: string; name: string }
              const rawSeenBy = (msg.seenBy || []) as SeenEntry[]
              const seenEntries = rawSeenBy
                .map(e => typeof e === 'string' ? { email: e, name: e.split('@')[0] } : e)
                .filter(e => e.email !== authUser?.email)

              // For per-message WhatsApp-style seen: show a name under the LAST message
              // each teammate has seen among MY sent messages
              const seenHereBy: { email: string; name: string }[] = []
              if (isMe && !isUnsent) {
                seenEntries.forEach(entry => {
                  // Find the last index of MY messages that this person has seen
                  let lastSeenIdx = -1
                  chatMessages.forEach((m, i) => {
                    if (m.senderEmail !== authUser?.email) return
                    const raw = (m.seenBy || []) as SeenEntry[]
                    const hasEntry = raw.some(e =>
                      typeof e === 'string' ? e === entry.email : e.email === entry.email
                    )
                    if (hasEntry) lastSeenIdx = i
                  })
                  if (lastSeenIdx === idx) seenHereBy.push(entry)
                })
              }
              const showSeen = seenHereBy.length > 0
              return (
                <div
                  key={msg.id}
                  className={`chat-bubble-row ${isNexus ? 'row-nexus' : isMe ? 'row-mine' : 'row-theirs'}`}
                  onMouseEnter={() => setHoveredMsgId(msg.id)}
                  onMouseLeave={() => { if (reactionPickerFor !== msg.id) setHoveredMsgId(null) }}
                >
                  {(!isMe || isNexus) && (
                    <div className={`chat-avatar ${isNexus ? 'chat-avatar-nexus' : ''}`}>
                      {isNexus ? <Bot size={12} /> : initials}
                    </div>
                  )}
                  <div className="chat-bubble-wrap">
                    {/* Reply preview */}
                    {replyTo && !isUnsent && (
                      <div
                        className={`chat-reply-preview ${isMe ? 'reply-mine' : ''}`}
                        onClick={() => {
                          const el = document.getElementById(`chat-msg-${replyTo.id}`)
                          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          el?.classList.add('chat-bump')
                          setTimeout(() => el?.classList.remove('chat-bump'), 1200)
                        }}
                      >
                        <span className="chat-reply-name">{replyTo.senderName}</span>
                        <span className="chat-reply-text">{replyTo.text.length > 60 ? replyTo.text.slice(0, 60) + '…' : replyTo.text}</span>
                      </div>
                    )}
                    <div
                      id={`chat-msg-${msg.id}`}
                      className={`chat-bubble ${isNexus ? 'chat-nexus' : isMe ? 'chat-mine' : 'chat-theirs'} ${isUnsent ? 'chat-unsent' : ''}`}
                    >
                      {(!isMe || isNexus) && (
                        <span className={`chat-sender ${isNexus ? 'chat-sender-nexus' : ''}`}>
                          {isNexus ? 'The Herta' : msg.senderName}
                          {ADMIN_EMAILS.includes(msg.senderEmail) && !isNexus && (
                            <span className="chat-dev-tag">DEV</span>
                          )}
                        </span>
                      )}
                      {isMe && !isNexus && ADMIN_EMAILS.includes(msg.senderEmail) && (
                        <span className="chat-sender chat-sender-me-dev">
                          {msg.senderName} <span className="chat-dev-tag">DEV</span>
                        </span>
                      )}
                      <div className={`chat-text ${isNexus ? 'chat-text-nexus' : ''} ${msg.isNexusThinking ? 'chat-thinking' : ''}`}>
                        {isUnsent ? (
                          <span className="chat-unsent-label">This message was unsent</span>
                        ) : msg.isNexusThinking ? (
                          <span className="chat-thinking-dots"><span/><span/><span/></span>
                        ) : msg.text}
                      </div>
                      <span className="chat-time">{time}</span>
                    </div>

                    {/* Hover action toolbar */}
                    {!isUnsent && !msg.isNexusThinking && (isHovered || reactionPickerFor === msg.id) && (
                      <div
                        className={`chat-action-bar ${isMe ? 'action-bar-mine' : 'action-bar-theirs'}`}
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        onMouseLeave={() => { if (reactionPickerFor !== msg.id) setHoveredMsgId(null) }}
                      >
                        <button type="button" className="chat-action-btn" title="React"
                          onClick={(e) => { e.stopPropagation(); setReactionPickerFor(v => v === msg.id ? null : msg.id) }}
                        >😊</button>
                        {!isNexus && (
                          <button type="button" className="chat-action-btn" title="Reply"
                            onClick={(e) => { e.stopPropagation(); setReplyingTo({ id: msg.id, text: msg.text, senderName: msg.senderName }); chatInputRef.current?.focus() }}
                          ><CornerUpLeft size={13} /></button>
                        )}
                        <button type="button" className="chat-action-btn" title={copiedMsgId === msg.id ? 'Copied!' : 'Copy'}
                          onClick={(e) => { e.stopPropagation(); void copyMessageText(msg.id, msg.text) }}
                        >{copiedMsgId === msg.id ? <Check size={13} /> : <Copy size={13} />}</button>
                        {isNexus && (
                          <>
                            <button type="button" className={`chat-action-btn ${msg.feedback === 'up' ? 'chat-action-active-up' : ''}`} title="Good response"
                              onClick={(e) => { e.stopPropagation(); void setMessageFeedback(msg.id, 'up') }}
                            ><ThumbsUp size={13} /></button>
                            <button type="button" className={`chat-action-btn ${msg.feedback === 'down' ? 'chat-action-active-down' : ''}`} title="Bad response"
                              onClick={(e) => { e.stopPropagation(); void setMessageFeedback(msg.id, 'down') }}
                            ><ThumbsDown size={13} /></button>
                            <button type="button" className="chat-action-btn" title={msg.isNexusError ? 'Retry' : 'Regenerate response'}
                              disabled={regeneratingMsgId === msg.id}
                              onClick={(e) => { e.stopPropagation(); void retryHertaMessage(msg.id) }}
                            ><RefreshCw size={13} className={regeneratingMsgId === msg.id ? 'chat-action-spin' : ''} /></button>
                          </>
                        )}
                        {isMe && !isNexus && (
                          <button type="button" className="chat-action-btn chat-action-delete" title="Unsend"
                            onClick={(e) => { e.stopPropagation(); void unsendMessage(msg.id) }}
                          ><Trash2 size={13} /></button>
                        )}
                      </div>
                    )}

                    {/* Reaction picker */}
                    {reactionPickerFor === msg.id && (
                      <div className={`chat-reaction-picker ${isMe ? 'picker-left' : 'picker-right'}`} onClick={e => e.stopPropagation()}>
                        {['❤️','😂','😮','😢','😡','👍','👎','🔥','✈️','💼'].map(em => (
                          <button key={em} type="button" className="chat-reaction-opt" onClick={() => void toggleReaction(msg.id, em)}>{em}</button>
                        ))}
                      </div>
                    )}

                    {/* Reactions display */}
                    {reactions && Object.keys(reactions).length > 0 && (
                      <div className={`chat-reactions ${isMe ? 'reactions-mine' : ''}`}>
                        {Object.entries(reactions).filter(([, users]) => users.length > 0).map(([em, users]) => (
                          <button
                            key={em}
                            type="button"
                            className={`chat-reaction-pill ${users.includes(authUser?.email || '') ? 'reacted' : ''}`}
                            onClick={() => void toggleReaction(msg.id, em)}
                            title={users.map(e => e.split('@')[0]).join(', ')}
                          >
                            {em} <span>{users.length}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Seen indicator — shows first name of each person who last read here */}
                    {showSeen && (
                      <div className="chat-seen-row">
                        <span className="chat-seen-check">✓✓</span>
                        <span className="chat-seen-label">
                          {'Seen by '}
                          {seenHereBy.map((e, i) => {
                            const firstName = e.name.trim().split(/\s+/)[0]
                            return (
                              <span key={e.email}>
                                {i > 0 && ', '}
                                <strong>{firstName}</strong>
                              </span>
                            )
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={chatBottomRef} />
          </div>

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div className="chat-emoji-picker">
              {['😀','😂','😍','🥰','😎','🤔','😅','🙏','👍','👎','❤️','🔥','🎉','✅','⚡','💼','✈️','🌴','📋','💰','🤝','👋','😊','🥳','💪','🫡','😴','🤯','👀','💡'].map(em => (
                <button
                  key={em}
                  type="button"
                  className="chat-emoji-btn"
                  onClick={() => {
                    setChatInput(prev => prev + em)
                    chatInputRef.current?.focus()
                  }}
                >{em}</button>
              ))}
            </div>
          )}

          {/* Reply bar */}
          {replyingTo && (
            <div className="chat-reply-bar">
              <div className="chat-reply-bar-content">
                <CornerUpLeft size={12} className="chat-reply-bar-icon" />
                <div className="chat-reply-bar-text">
                  <span className="chat-reply-bar-name">{replyingTo.senderName}</span>
                  <span className="chat-reply-bar-preview">{replyingTo.text.length > 55 ? replyingTo.text.slice(0, 55) + '…' : replyingTo.text}</span>
                </div>
              </div>
              <button type="button" className="chat-reply-bar-close" onClick={() => setReplyingTo(null)}><X size={13} /></button>
            </div>
          )}

          {/* Input Row */}
          <div className="chat-input-row">
            <button
              type="button"
              className={`chat-emoji-toggle ${showEmojiPicker ? 'active' : ''}`}
              title="Emoji"
              onClick={() => setShowEmojiPicker(v => !v)}
            >
              😊
            </button>
            <button
              type="button"
              className="chat-nexus-btn"
              title="Ask The Herta"
              onClick={() => {
                if (!chatInput.startsWith('@Herta ')) {
                  setChatInput(prev => '@Herta ' + prev)
                }
                chatInputRef.current?.focus()
                setShowEmojiPicker(false)
              }}
            >
              <Bot size={15} />
            </button>
            <input
              ref={chatInputRef}
              className="chat-input"
              placeholder="Aa"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChatMessage() }
                if (e.key === 'Escape') setShowEmojiPicker(false)
              }}
              onFocus={() => setShowEmojiPicker(false)}
            />
            <button
              type="button"
              className={`chat-send-btn ${chatInput.trim() ? 'active' : ''}`}
              onClick={() => void sendChatMessage()}
              disabled={!chatInput.trim()}
              title="Send"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
