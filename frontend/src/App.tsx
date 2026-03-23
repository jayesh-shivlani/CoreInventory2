/**
 * Main frontend application shell.
 * Hosts routing, layout, page composition, and shared state orchestration.
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { AUTH_INVALID_EVENT, LIVE_SYNC_INTERVAL_MS, TOKEN_KEY } from './config/constants'
import ReportsPage from './ReportsPage'
import DashboardPage from './pages/DashboardPage'
import MoveHistoryPage from './pages/MoveHistoryPage'
import OperationsPage from './pages/OperationsPage'
import ProductsPage from './pages/ProductsPage'
import ProfilePage from './pages/ProfilePage'
import WarehousesPage from './pages/WarehousesPage'
import { apiRequest } from './utils/helpers'
import type {
  NotificationItem,
  Toast,
  UserProfile,
} from './types/models'

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    if (!token) {
      return
    }

    let active = true

    const loadCurrentUser = async () => {
      try {
        const profile = await apiRequest<UserProfile>('/users/me', 'GET', token)
        if (active) {
          setCurrentUser(profile)
        }
      } catch {
        if (active) {
          setCurrentUser(null)
        }
      }
    }

    loadCurrentUser()
  // Keep profile/role state fresh so role-gated UI updates without requiring a full reload.
    const timer = setInterval(loadCurrentUser, LIVE_SYNC_INTERVAL_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [token])

  const pushToast = (kind: Toast['kind'], text: string) => {
    const next = { id: Date.now() + Math.floor(Math.random() * 1000), kind, text }
    setToasts((prev) => [...prev, next])
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== next.id))
    }, 3500)
  }

  const login = (nextToken: string) => {
    localStorage.setItem(TOKEN_KEY, nextToken)
    setToken(nextToken)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setCurrentUser(null)
    pushToast('info', 'Logged out')
  }

  useEffect(() => {
    const handleAuthInvalid = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      // Centralized forced logout path used by API helper when token becomes invalid.
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setCurrentUser(null)
      pushToast('error', detail?.message || 'Session expired. Please sign in again.')
    }

    window.addEventListener(AUTH_INVALID_EVENT, handleAuthInvalid)
    return () => window.removeEventListener(AUTH_INVALID_EVENT, handleAuthInvalid)
  }, [])

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to={token ? '/dashboard' : '/auth'} replace />} />
        <Route
          path="/auth"
          element={<AuthPage token={token} onLogin={login} pushToast={pushToast} />}
        />
        <Route element={<ProtectedLayout token={token} onLogout={logout} currentUser={currentUser} />}>
          <Route
            path="/dashboard"
            element={<DashboardPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/products"
            element={<ProductsPage token={token} pushToast={pushToast} currentUser={currentUser} />}
          />
          <Route
            path="/operations/receipts"
            element={<OperationsPage token={token} pushToast={pushToast} currentUser={currentUser} />}
          />
          <Route
            path="/operations/deliveries"
            element={<OperationsPage token={token} pushToast={pushToast} currentUser={currentUser} />}
          />
          <Route
            path="/operations/transfers"
            element={<OperationsPage token={token} pushToast={pushToast} currentUser={currentUser} />}
          />
          <Route
            path="/operations/adjustments"
            element={<OperationsPage token={token} pushToast={pushToast} currentUser={currentUser} />}
          />
          <Route
            path="/move-history"
            element={<MoveHistoryPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/reports"
            element={<ReportsPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/settings/warehouses"
            element={<WarehousesPage token={token} pushToast={pushToast} currentUser={currentUser} />}
          />
          <Route
            path="/profile"
            element={<ProfilePage token={token} pushToast={pushToast} />}
          />
        </Route>
        <Route path="*" element={<Navigate to={token ? '/dashboard' : '/auth'} replace />} />
      </Routes>
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            {toast.text}
          </div>
        ))}
      </div>
    </>
  )
}

function ProtectedLayout({
  token,
  onLogout,
  currentUser,
}: {
  token: string | null
  onLogout: () => void
  currentUser: UserProfile | null
}) {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const notifRef = useRef<HTMLDivElement>(null)
  const knownNotificationIdsRef = useRef<Set<string>>(new Set())
  const notificationInitRef = useRef(false)

  useEffect(() => {
    if (!token) return
    const load = async () => {
      try {
        const data = await apiRequest<NotificationItem[]>('/notifications', 'GET', token)
        setNotifications(Array.isArray(data) ? data : [])
      } catch {
        // non-fatal
      }
    }
    void load()
    const timer = setInterval(load, LIVE_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [token])

  useEffect(() => {
    const nextIds = new Set(notifications.map((n) => n.id))

    if (!notificationInitRef.current) {
      knownNotificationIdsRef.current = nextIds
      notificationInitRef.current = true
      return
    }

    const hasNew = notifications.some((n) => !knownNotificationIdsRef.current.has(n.id))
    knownNotificationIdsRef.current = nextIds

    // Play sound only for new arrivals, not for initial list hydration.
    if (hasNew) {
      playNotificationTing()
    }
  }, [notifications])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const visibleNotifs = notifications.filter((n) => !dismissed.has(n.id))
  const unreadCount = visibleNotifs.length
  const location = useLocation()
  if (!token) {
    return <Navigate to="/auth" replace />
  }

  const segments = location.pathname
    .split('/')
    .filter(Boolean)
    // Build human-readable breadcrumbs from route segments (e.g. move-history -> Move History).
    .map((chunk) =>
      chunk.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-title">Core Inventory</div>
          <div className="sidebar-brand-sub">Inventory Management System</div>
        </div>
        <nav className="sidebar-nav" aria-label="Primary">
          <div className="sidebar-nav-section">
            <div className="sidebar-section-label">Overview</div>
            <NavLink to="/dashboard">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
              Dashboard
            </NavLink>
          </div>
          <div className="sidebar-nav-section">
            <div className="sidebar-section-label">Catalog</div>
            <NavLink to="/products">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
              Products
            </NavLink>
          </div>
          <div className="sidebar-nav-section">
            <div className="sidebar-section-label">Operations</div>
            <NavLink to="/operations/receipts">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
              Receipts
            </NavLink>
            <NavLink to="/operations/deliveries">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
              Delivery Orders
            </NavLink>
            <NavLink to="/operations/transfers">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
              Internal Transfers
            </NavLink>
            <NavLink to="/operations/adjustments">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
              Inventory Adjustment
            </NavLink>
            <NavLink to="/move-history">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="14 2 14 8 20 8" /><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9.34" /><polygon points="18 2 22 6 12 16 8 16 8 12 18 2" /></svg>
              Move History
            </NavLink>
            <NavLink to="/reports">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
              Reports
            </NavLink>
          </div>
          <div className="sidebar-nav-section">
            <div className="sidebar-section-label">Settings &amp; Account</div>
            <NavLink to="/settings/warehouses">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              Warehouses
            </NavLink>
            <NavLink to="/profile">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              My Profile
            </NavLink>
          </div>
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="logout-btn" onClick={onLogout}>
            <svg style={{ width: '18px', height: '18px', flexShrink: 0, opacity: 0.7 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            Logout
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <span>Inventory</span>
            {segments.map((seg, i) => (
              <span key={i}>
                <span className="sep">{'>'}</span>
                <span className={i === segments.length - 1 ? 'current' : ''}>{seg}</span>
              </span>
            ))}
          </div>
          <div className="topbar-right">
            <div className="notif-wrapper" ref={notifRef}>
              <button
                type="button"
                className="notif-bell"
                aria-label="Notifications"
                onClick={() => setNotifOpen((o) => !o)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                {unreadCount > 0 && (
                  <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>
              {notifOpen && (
                <div className="notif-dropdown">
                  <div className="notif-dropdown-head">
                    <span>Notifications</span>
                    {visibleNotifs.length > 0 && (
                      <button type="button" className="notif-clear-all" onClick={() => { setDismissed(new Set(notifications.map((n) => n.id))); setNotifOpen(false) }}>
                        Clear all
                      </button>
                    )}
                  </div>
                  {visibleNotifs.length === 0 ? (
                    <div className="notif-empty">You're all caught up!</div>
                  ) : (
                    <ul className="notif-list">
                      {visibleNotifs.map((n) => (
                        <li key={n.id} className={`notif-item notif-${n.kind}`}>
                          <div className="notif-item-body">
                            <div className="notif-item-title">{n.title}</div>
                            <div className="notif-item-msg">{n.message}</div>
                          </div>
                          <div className="notif-item-actions">
                            <button
                              type="button"
                              className="notif-view-link notif-view-btn"
                              onClick={() => {
                                setNotifOpen(false)
                                navigate(n.link)
                              }}
                            >
                              View
                            </button>
                            <button type="button" className="notif-dismiss" aria-label="Dismiss" onClick={() => setDismissed((prev) => new Set([...prev, n.id]))}>x</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="topbar-role-chip">{currentUser?.role ?? 'Loading role...'}</div>
          </div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function playNotificationTing() {
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    const ctx = new AudioCtx()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(1450, ctx.currentTime + 0.08)

    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.2)
    oscillator.onended = () => {
      void ctx.close().catch(() => undefined)
    }
  } catch {
    // Ignore audio restrictions/errors to keep notifications non-blocking.
  }
}

function isStrongPassword(password: string): boolean {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(password || ''))
}

function AuthPage({
  token,
  onLogin,
  pushToast,
}: {
  token: string | null
  onLogin: (token: string) => void
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [requestedRole, setRequestedRole] = useState<'Warehouse Staff' | 'Manager'>('Warehouse Staff')
  const [signupStep, setSignupStep] = useState<'request' | 'verify'>('request')
  const [signupOtp, setSignupOtp] = useState('')
  const [signupOtpSentTo, setSignupOtpSentTo] = useState('')
  const [signupResendCooldown, setSignupResendCooldown] = useState(0)
  const [showReset, setShowReset] = useState(false)
  const [resetStep, setResetStep] = useState<'request' | 'verify'>('request')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetOtp, setResetOtp] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [otpSentTo, setOtpSentTo] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (token) {
      navigate('/dashboard', { replace: true })
    }
  }, [token, navigate])

  useEffect(() => {
    if (resendCooldown <= 0) return

    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(timer)
  }, [resendCooldown])

  useEffect(() => {
    if (signupResendCooldown <= 0) return

    const timer = setInterval(() => {
      setSignupResendCooldown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(timer)
  }, [signupResendCooldown])

  const requestResetOtp = async () => {
    if (!resetEmail.trim()) {
      pushToast('error', 'Email is required')
      return
    }

    setResetBusy(true)
    try {
      await apiRequest<{ message?: string }>('/auth/reset-password', 'POST', undefined, {
        email: resetEmail,
      })
      setResetStep('verify')
      setOtpSentTo(resetEmail.trim())
      setResendCooldown(30)
      pushToast('info', 'OTP sent to your email')
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  const submitPasswordReset = async () => {
    if (!resetEmail.trim()) {
      pushToast('error', 'Email is required')
      return
    }
    if (!resetOtp.trim()) {
      pushToast('error', 'OTP is required')
      return
    }
    if (!isStrongPassword(resetNewPassword)) {
      pushToast('error', 'Use a stronger password: at least 8 characters with letters and numbers')
      return
    }
    if (resetNewPassword !== resetConfirmPassword) {
      pushToast('error', 'New password and confirm password do not match')
      return
    }

    setResetBusy(true)
    try {
      await apiRequest('/auth/reset-password', 'POST', undefined, {
        email: resetEmail,
        otp: resetOtp,
        newPassword: resetNewPassword,
      })

      pushToast('success', 'Password reset completed. Please sign in.')
      setShowReset(false)
      setResetStep('request')
      setResetOtp('')
      setResetNewPassword('')
      setResetConfirmPassword('')
      setOtpSentTo('')
      setResendCooldown(0)
      setMode('login')
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      pushToast('error', 'Email is required')
      return
    }
    if (mode === 'login' && password.length < 6) {
      pushToast('error', 'Password must be at least 6 characters')
      return
    }
    if (mode === 'signup' && !name.trim()) {
      pushToast('error', 'Name is required for sign up')
      return
    }
    if (mode === 'signup' && !isStrongPassword(password)) {
      pushToast('error', 'Use a stronger password: at least 8 characters with letters and numbers')
      return
    }
    if (mode === 'signup' && password !== confirmPassword) {
      pushToast('error', 'Password and confirm password do not match')
      return
    }

    setBusy(true)
    try {
      if (mode === 'login') {
        const data = await apiRequest<{ token: string }>('/auth/login', 'POST', undefined, {
          email,
          password,
        })
        onLogin(data.token)
        pushToast('success', 'Login successful')
        navigate('/dashboard', { replace: true })
      }

      if (mode === 'signup') {
        if (signupStep === 'request') {
          await apiRequest<{ message?: string }>('/auth/register', 'POST', undefined, {
            name,
            email,
            password,
            role: requestedRole,
          })

          setSignupStep('verify')
          setSignupOtpSentTo(email.trim())
          setSignupResendCooldown(30)
          pushToast('info', 'OTP sent to your email')
        } else {
          if (!signupOtp.trim()) {
            pushToast('error', 'OTP is required to verify your email')
            return
          }

          await apiRequest('/auth/register', 'POST', undefined, {
            name,
            email,
            password,
            role: requestedRole,
            otp: signupOtp,
          })

          pushToast('success', 'Account created with default access. You can sign in now. Admin approval is needed only for your requested role.')
          setSignupStep('request')
          setSignupOtp('')
          setSignupOtpSentTo('')
          setSignupResendCooldown(0)
          setRequestedRole('Warehouse Staff')
          setConfirmPassword('')
          setMode('login')
        }
      }

    } catch (error) {
      const msg = (error as Error).message
      setAuthError(msg)
      pushToast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <aside className="auth-hero-panel">
          <div className="auth-logo">
            <img className="auth-logo-image" src="/odoo.png" alt="Odoo logo" />
            <div className="auth-logo-text">
              <h2>Core Inventory</h2>
              <p>Inventory Management System</p>
            </div>
          </div>
          <h3 className="auth-hero-title">Run warehouse operations without spreadsheet chaos.</h3>
          <p className="auth-hero-copy">Track stock, manage transfers, validate deliveries, and monitor inventory in one consistent workspace.</p>
          <div className="auth-hero-points">
            <span>Live stock visibility</span>
            <span>Operational traceability</span>
            <span>Centralized product control</span>
          </div>
        </aside>

        <div className="auth-card">
          <div className="auth-card-head">
            <h3>{mode === 'login' ? 'Welcome Back' : 'Create Your Account'}</h3>
            <p>
              {mode === 'login'
                ? 'Sign in to continue managing inventory operations.'
                : signupStep === 'request'
                  ? 'Request an OTP to verify your email and submit your role request.'
                  : 'Enter the OTP to verify your email and finish account setup.'}
            </p>
          </div>

          <div className="auth-tabs">
            <button type="button" className={`auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => { setMode('login'); setAuthError(null) }}>Sign In</button>
            <button
              type="button"
              className={`auth-tab${mode === 'signup' ? ' active' : ''}`}
              onClick={() => {
                setMode('signup')
                setAuthError(null)
                setSignupStep('request')
                setSignupOtp('')
                setSignupOtpSentTo('')
                setSignupResendCooldown(0)
                setRequestedRole('Warehouse Staff')
                setConfirmPassword('')
              }}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={submit}>
            {mode === 'signup' && (
              <div className="form-field">
                <label className="form-field-label">Full Name</label>
                <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required />
              </div>
            )}
            {mode === 'signup' && (
              <div className="form-field">
                <label className="form-field-label">Requested Role</label>
                <select className="form-select" value={requestedRole} onChange={(e) => setRequestedRole(e.target.value as 'Warehouse Staff' | 'Manager')}>
                  <option value="Warehouse Staff">Warehouse Staff</option>
                  <option value="Manager">Manager</option>
                </select>
              </div>
            )}
            <div className="form-field">
              <label className="form-field-label">Email Address</label>
              <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
            </div>
            <div className="form-field">
              <label className="form-field-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" required minLength={mode === 'signup' ? 8 : 6} />
            </div>

            {mode === 'signup' && (
              <div className="form-field">
                <label className="form-field-label">Confirm Password</label>
                <input className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" required minLength={8} />
                {confirmPassword && (
                  <p className={password === confirmPassword ? 'password-match' : 'password-mismatch'}>
                    {password === confirmPassword ? '[OK] Passwords match' : '[X] Passwords do not match'}
                  </p>
                )}
                <p className="password-help">Use at least 8 characters and include both letters and numbers.</p>
              </div>
            )}

            {mode === 'signup' && signupStep === 'verify' && (
              <>
                {signupOtpSentTo && (
                  <p className="muted auth-reset-note">OTP sent to {signupOtpSentTo}</p>
                )}
                <div className="form-field">
                  <label className="form-field-label">Signup OTP</label>
                  <input className="form-input" value={signupOtp} onChange={(e) => setSignupOtp(e.target.value)} placeholder="Enter 6-digit OTP" required />
                </div>
                <div className="auth-reset-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || signupResendCooldown > 0}
                    onClick={async () => {
                      if (!name.trim() || !email.trim() || !isStrongPassword(password) || password !== confirmPassword) {
                        pushToast('error', 'Enter valid details, use a strong password, and confirm password correctly')
                        return
                      }

                      try {
                        await apiRequest<{ message?: string }>('/auth/register', 'POST', undefined, {
                          name,
                          email,
                          password,
                          role: requestedRole,
                        })
                        setSignupResendCooldown(30)
                        pushToast('info', 'OTP resent to your email')
                      } catch (error) {
                        pushToast('error', (error as Error).message)
                      }
                    }}
                  >
                    {signupResendCooldown > 0 ? `Resend in ${signupResendCooldown}s` : 'Resend OTP'}
                  </button>
                </div>
              </>
            )}

            <button type="submit" className="btn btn-primary auth-submit-btn" disabled={busy}>
              {busy
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign In'
                  : signupStep === 'request'
                    ? 'Send Verification OTP'
                    : 'Verify & Create Account'}
            </button>
            {authError && (
              <div className="auth-error">{authError}</div>
            )}

            {mode === 'login' && (
              <button type="button" className="link-btn auth-reset-toggle" onClick={() => {
                setShowReset((prev) => !prev)
                setResetStep('request')
                setResetOtp('')
                setResetNewPassword('')
                setResetConfirmPassword('')
                setResetEmail(email)
                setOtpSentTo('')
                setResendCooldown(0)
              }}>{showReset ? 'Cancel password reset' : 'Forgot password?'}</button>
            )}

            {mode === 'login' && showReset && (
              <div className="reset-box">
                <div className="form-field">
                  <label className="form-field-label">Email for reset</label>
                  <input className="form-input" type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required />
                </div>
                {resetStep === 'verify' && otpSentTo && (
                  <p className="muted auth-reset-note">OTP sent to {otpSentTo}</p>
                )}
                {resetStep === 'verify' && (
                  <>
                    <div className="form-field">
                      <label className="form-field-label">OTP Code</label>
                      <input className="form-input" value={resetOtp} onChange={(e) => setResetOtp(e.target.value)} required />
                    </div>
                    <div className="form-field">
                      <label className="form-field-label">New Password</label>
                      <input className="form-input" type="password" value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} minLength={8} required />
                      <p className="password-help">Use at least 8 characters and include both letters and numbers.</p>
                    </div>
                    <div className="form-field">
                      <label className="form-field-label">Confirm New Password</label>
                      <input className="form-input" type="password" value={resetConfirmPassword} onChange={(e) => setResetConfirmPassword(e.target.value)} minLength={8} required />
                      {resetConfirmPassword && (
                        <p className={resetNewPassword === resetConfirmPassword ? 'password-match' : 'password-mismatch'}>
                          {resetNewPassword === resetConfirmPassword ? '[OK] Passwords match' : '[X] Passwords do not match'}
                        </p>
                      )}
                    </div>
                  </>
                )}
                <div className="auth-reset-actions">
                  <button type="button" className="btn btn-secondary" onClick={requestResetOtp} disabled={resetBusy || resendCooldown > 0}>
                    {resetBusy ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : resetStep === 'request' ? 'Send OTP' : 'Resend OTP'}
                  </button>
                  {resetStep === 'verify' && (
                    <button type="button" className="btn btn-primary" onClick={submitPasswordReset} disabled={resetBusy}>
                      {resetBusy ? 'Resetting...' : 'Reset Password'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}

export default App