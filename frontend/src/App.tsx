import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type KPIResponse = {
  totalProductsInStock: number
  lowOrOutOfStockItems: number
  pendingReceipts: number
  pendingDeliveries: number
  scheduledInternalTransfers: number
}

type DashboardFilterResponse = {
  documentTypes: string[]
  statuses: string[]
  warehouses: string[]
  categories: string[]
}

type ProductFilterOptions = {
  categories: string[]
  locations: string[]
  uoms: string[]
}

type Product = {
  id: number
  name: string
  sku: string
  category: string
  unit_of_measure: string
  reorder_minimum?: number
  availableStock?: number
  locationName?: string
}

type OperationKind = 'Receipt' | 'Delivery' | 'Internal' | 'Adjustment'

type Operation = {
  id: number
  reference_number: string
  type: OperationKind
  status: 'Draft' | 'Waiting' | 'Ready' | 'Done' | 'Canceled'
  source_location_name?: string
  destination_location_name?: string
  created_at: string
}

type LedgerEntry = {
  id: number
  timestamp: string
  product_name: string
  from_location_name?: string
  to_location_name?: string
  quantity: number
  reference_number?: string
  note?: string
}

type Warehouse = {
  id: number
  name: string
  type: string
}

type UserProfile = {
  id: number
  name: string
  email: string
  role: string
}

type AdminRoleRequest = {
  id: number
  name: string
  email: string
  requested_role: string
  status: string
  created_at: string
  reviewed_at?: string
  review_note?: string
  reviewed_by_name?: string
}

type UserRoleRequestStatus = {
  status: 'not_requested' | 'pending' | 'rejected' | 'completed'
  requested_role: string | null
  requested_at: string | null
  reviewed_at: string | null
  review_note: string | null
}

type Toast = {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

type OperationDraftLine = {
  product_id: string
  requested_quantity: string
  picked_quantity?: string
  packed_quantity?: string
}

type ProductStockRow = {
  location_id: number
  location_name: string
  quantity: number
}

const TOKEN_KEY = 'ims-auth-token'
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api').replace(/\/$/, '')
const LIVE_SYNC_INTERVAL_MS = 8000
const DEFAULT_UOMS = ['Units', 'Kg', 'L', 'Box', 'Pack', 'Piece']
const DEFAULT_CATEGORIES = ['Raw Materials', 'Finished Goods', 'Consumables', 'Electronics', 'Hardware']
const AUTH_INVALID_EVENT = 'ims-auth-invalid'

const toOperationKind = (path: string): OperationKind => {
  if (path.includes('receipts')) return 'Receipt'
  if (path.includes('deliveries')) return 'Delivery'
  if (path.includes('transfers')) return 'Internal'
  return 'Adjustment'
}

const safeNumber = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const formatDate = (value: string): string => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

async function apiRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  token?: string,
  payload?: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      `Request failed (${response.status})`

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { message } }))
    }

    throw new Error(message)
  }

  return body as T
}

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    if (!token) {
      setCurrentUser(null)
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
        <Route path="/" element={<Navigate to="/auth" replace />} />
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
  const location = useLocation()
  if (!token) {
    return <Navigate to="/auth" replace />
  }

  const segments = location.pathname
    .split('/')
    .filter(Boolean)
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
                <span className="sep">›</span>
                <span className={i === segments.length - 1 ? 'current' : ''}>{seg}</span>
              </span>
            ))}
          </div>
          <div className="topbar-role-chip">{currentUser?.role ?? 'Loading role...'}</div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function hasElevatedAccess(user: UserProfile | null): boolean {
  const role = String(user?.role || '').trim().toLowerCase()
  return role === 'admin' || role === 'manager'
}

function isAdminRole(role: string | undefined | null): boolean {
  return String(role || '').trim().toLowerCase() === 'admin'
}

function isPendingRoleRequestStatus(status: string | undefined | null): boolean {
  const normalized = String(status || '').trim().toUpperCase()
  return normalized === 'AWAITING_ADMIN_APPROVAL' || normalized === 'PENDING' || normalized === 'PENDING_ADMIN_APPROVAL'
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
      const response = await apiRequest<{ message?: string; dev_otp?: string }>('/auth/reset-password', 'POST', undefined, {
        email: resetEmail,
      })
      setResetStep('verify')
      setOtpSentTo(resetEmail.trim())
      setResendCooldown(30)
      if (response?.dev_otp) {
        setResetOtp(response.dev_otp)
        pushToast('info', `Email provider test mode: use OTP ${response.dev_otp}`)
      } else {
        pushToast('info', 'OTP sent to your email')
      }
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
          const response = await apiRequest<{ message?: string; dev_otp?: string }>('/auth/register', 'POST', undefined, {
            name,
            email,
            password,
            role: requestedRole,
          })

          setSignupStep('verify')
          setSignupOtpSentTo(email.trim())
          setSignupResendCooldown(30)
          if (response?.dev_otp) {
            setSignupOtp(response.dev_otp)
            pushToast('info', `Email provider test mode: use OTP ${response.dev_otp}`)
          } else {
            pushToast('info', 'OTP sent to your email')
          }
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

          {mode === 'signup' && (
            <div className="auth-step-chip">{signupStep === 'request' ? 'Step 1 of 2: Request OTP' : 'Step 2 of 2: Verify OTP'}</div>
          )}

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
              <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={mode === 'signup' ? 8 : 6} />
            </div>

            {mode === 'signup' && (
              <div className="form-field">
                <label className="form-field-label">Confirm Password</label>
                <input className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" required minLength={8} />
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
                        const response = await apiRequest<{ message?: string; dev_otp?: string }>('/auth/register', 'POST', undefined, {
                          name,
                          email,
                          password,
                          role: requestedRole,
                        })
                        setSignupResendCooldown(30)
                        if (response?.dev_otp) {
                          setSignupOtp(response.dev_otp)
                          pushToast('info', `Email provider test mode: use OTP ${response.dev_otp}`)
                        } else {
                          pushToast('info', 'OTP resent to your email')
                        }
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
                ? 'Please wait…'
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
                  </>
                )}
                <div className="auth-reset-actions">
                  <button type="button" className="btn btn-secondary" onClick={requestResetOtp} disabled={resetBusy || resendCooldown > 0}>
                    {resetBusy ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : resetStep === 'request' ? 'Send OTP' : 'Resend OTP'}
                  </button>
                  {resetStep === 'verify' && (
                    <button type="button" className="btn btn-primary" onClick={submitPasswordReset} disabled={resetBusy}>
                      {resetBusy ? 'Resetting…' : 'Reset Password'}
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

function DashboardPage({
  token,
  pushToast,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<KPIResponse>({
    totalProductsInStock: 0,
    lowOrOutOfStockItems: 0,
    pendingReceipts: 0,
    pendingDeliveries: 0,
    scheduledInternalTransfers: 0,
  })
  const [docType, setDocType] = useState('')
  const [status, setStatus] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [category, setCategory] = useState('')
  const [filterOptions, setFilterOptions] = useState<DashboardFilterResponse>({
    documentTypes: [],
    statuses: [],
    warehouses: [],
    categories: [],
  })
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([])
  const previousLowStockCount = useRef(0)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (docType) params.set('documentType', docType)
    if (status) params.set('status', status)
    if (warehouse) params.set('warehouse', warehouse)
    if (category) params.set('category', category)
    const serial = params.toString()
    return serial ? `?${serial}` : ''
  }, [docType, status, warehouse, category])

  useEffect(() => {
    let active = true
    const loadFilters = async () => {
      try {
        const options = await apiRequest<DashboardFilterResponse>('/dashboard/filters', 'GET', token ?? undefined)
        if (active) {
          setFilterOptions({
            documentTypes: Array.isArray(options?.documentTypes) ? options.documentTypes : [],
            statuses: Array.isArray(options?.statuses) ? options.statuses : [],
            warehouses: Array.isArray(options?.warehouses) ? options.warehouses : [],
            categories: Array.isArray(options?.categories) ? options.categories : [],
          })
        }
      } catch {
        // Keep defaults if options cannot be loaded.
      }
    }

    const load = async () => {
      setLoading(true)
      try {
        const [raw, lowStockRows] = await Promise.all([
          apiRequest<Partial<KPIResponse> | null>(
            `/dashboard/kpis${query}`,
            'GET',
            token ?? undefined,
          ),
          apiRequest<Product[]>('/products?lowStockOnly=true', 'GET', token ?? undefined),
        ])
        setLowStockProducts(Array.isArray(lowStockRows) ? lowStockRows : [])
        const latestCount = Array.isArray(lowStockRows) ? lowStockRows.length : 0
        if (previousLowStockCount.current !== 0 && latestCount > previousLowStockCount.current) {
          pushToast('info', `Low stock alerts increased to ${latestCount}`)
        }
        previousLowStockCount.current = latestCount

        const data = (raw ?? {}) as Partial<KPIResponse>
        if (!active) return
        setKpis({
          totalProductsInStock: safeNumber(data.totalProductsInStock),
          lowOrOutOfStockItems: safeNumber(data.lowOrOutOfStockItems),
          pendingReceipts: safeNumber(data.pendingReceipts),
          pendingDeliveries: safeNumber(data.pendingDeliveries),
          scheduledInternalTransfers: safeNumber(data.scheduledInternalTransfers),
        })
      } catch (error) {
        pushToast('error', `Dashboard load failed: ${(error as Error).message}`)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadFilters()
    load()
    const timer = setInterval(() => {
      load()
      loadFilters()
    }, LIVE_SYNC_INTERVAL_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [query, token, pushToast])

  const activeDashboardFilters = [docType, status, warehouse, category].filter(Boolean).length

  return (
    <section className="dashboard-page">
      <div className="dashboard-hero-card">
        <div className="dashboard-title">Inventory Dashboard</div>
        <p className="dashboard-subtitle">Realtime status of inventory, operations, and transfer workload.</p>
        <div className="dashboard-meta-grid">
          <div className="dashboard-meta-item">
            <span>Filters Applied</span>
            <strong>{activeDashboardFilters}</strong>
          </div>
          <div className="dashboard-meta-item">
            <span>Pending Work</span>
            <strong>{kpis.pendingReceipts + kpis.pendingDeliveries + kpis.scheduledInternalTransfers}</strong>
          </div>
          <div className="dashboard-meta-item">
            <span>Stock Risk</span>
            <strong>{kpis.lowOrOutOfStockItems}</strong>
          </div>
        </div>
      </div>

      {lowStockProducts.length > 0 && (
        <div className="dashboard-header-card low-stock-alert-card">
          <div className="list-header dashboard-section-header">
            <h2>Low Stock Alerts</h2>
            <span className="alert-count-pill">{lowStockProducts.length} product(s)</span>
          </div>
          <div className="low-stock-alert-list">
            {lowStockProducts.slice(0, 6).map((product) => (
              <div key={product.id} className="low-stock-alert-item">
                <strong>{product.name}</strong>
                <span>{product.sku}</span>
                <span>
                  On hand {safeNumber(product.availableStock)} / Reorder min {safeNumber(product.reorder_minimum)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-header-card">
        <div className="list-header dashboard-section-header">
          <h2>Operational Metrics</h2>
        </div>
        <div className="kpi-grid">
          <KpiCard label="Total Products in Stock" value={kpis.totalProductsInStock} />
          <KpiCard label="Low / Out of Stock" value={kpis.lowOrOutOfStockItems} variant="warning" />
          <KpiCard label="Pending Receipts" value={kpis.pendingReceipts} />
          <KpiCard label="Pending Deliveries" value={kpis.pendingDeliveries} />
          <KpiCard label="Transfers Scheduled" value={kpis.scheduledInternalTransfers} variant="success" />
        </div>
      </div>

      <div className="dashboard-header-card">
        <div className="list-header dashboard-section-header">
          <h2>Dashboard Filters</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setDocType('')
              setStatus('')
              setWarehouse('')
              setCategory('')
            }}
            disabled={activeDashboardFilters === 0}
          >
            Reset
          </button>
        </div>
        <div className="filters-row">
          <div className="filter-group">
            <label className="filter-label">Document Type</label>
            <select className="form-select" value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="">All</option>
              {filterOptions.documentTypes.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {filterOptions.statuses.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Warehouse</label>
            <select className="form-select" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              <option value="">All</option>
              {filterOptions.warehouses.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Category</label>
            <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              {filterOptions.categories.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>
      {loading && <p className="muted" style={{ textAlign: 'center', padding: '20px' }}>Loading KPI data…</p>}
    </section>
  )
}

function KpiCard({ label, value, variant }: { label: string; value: number; variant?: 'warning' | 'success' }) {
  return (
    <article className={`kpi-card${variant === 'warning' ? ' kpi-warning' : variant === 'success' ? ' kpi-success' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </article>
  )
}

function ProductsPage({
  token,
  pushToast,
  currentUser,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
  currentUser: UserProfile | null
}) {
  const [viewMode, setViewMode] = useState<'list' | 'form'>('list')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [filterOptions, setFilterOptions] = useState<ProductFilterOptions>({
    categories: [],
    locations: [],
    uoms: [],
  })
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null)
  const [stockByProductId, setStockByProductId] = useState<Record<number, ProductStockRow[]>>({})
  const [stockLoadingForProductId, setStockLoadingForProductId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [category, setCategory] = useState('')
  const [uom, setUom] = useState('Units')
  const [initialStock, setInitialStock] = useState('0')
  const [reorderMinimum, setReorderMinimum] = useState('0')
  const canManageProducts = hasElevatedAccess(currentUser)

  const resetForm = () => {
    setEditingProductId(null)
    setName('')
    setSku('')
    setCategory('')
    setUom('Units')
    setInitialStock('0')
    setReorderMinimum('0')
  }

  const startNew = () => {
    if (!canManageProducts) {
      pushToast('info', 'Only admin-approved roles can change products. Please contact admin.')
      return
    }
    resetForm()
    setViewMode('form')
  }

  const startEdit = (product: Product) => {
    if (!canManageProducts) {
      pushToast('info', 'Only admin-approved roles can change products. Please contact admin.')
      return
    }
    setEditingProductId(product.id)
    setName(product.name)
    setSku(product.sku)
    setCategory(product.category)
    setUom(product.unit_of_measure)
    setReorderMinimum(String(safeNumber(product.reorder_minimum)))
    setInitialStock('0')
    setViewMode('form')
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (filterCategory.trim()) params.set('category', filterCategory.trim())
      if (filterLocation.trim()) params.set('location', filterLocation.trim())
      if (lowStockOnly) params.set('lowStockOnly', 'true')
      const query = params.toString() ? `?${params.toString()}` : ''
      const data = await apiRequest<Product[]>(`/products${query}`, 'GET', token ?? undefined)
      setProducts(Array.isArray(data) ? data : [])
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filterCategory, filterLocation, lowStockOnly, pushToast, search, token])

  const loadFilterOptions = useCallback(async () => {
    try {
      const data = await apiRequest<ProductFilterOptions>('/products/filter-options', 'GET', token ?? undefined)
      setFilterOptions({
        categories: Array.isArray(data?.categories) ? data.categories : [],
        locations: Array.isArray(data?.locations) ? data.locations : [],
        uoms: Array.isArray(data?.uoms) ? data.uoms : [],
      })
    } catch {
      // Keep the page usable even if filter options cannot be loaded.
    }
  }, [token])

  useEffect(() => {
    loadFilterOptions()
  }, [loadFilterOptions])

  useEffect(() => {
    const timer = setInterval(() => {
      load()
      loadFilterOptions()
    }, LIVE_SYNC_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [load, loadFilterOptions])

  useEffect(() => {
    load()
  }, [load])

  const categoryOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_CATEGORIES, ...filterOptions.categories, category].filter(Boolean))),
    [filterOptions.categories, category],
  )

  const uomOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_UOMS, ...filterOptions.uoms, uom].filter(Boolean))),
    [filterOptions.uoms, uom],
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canManageProducts) {
      pushToast('error', 'Only admin-approved roles can change products. Please contact admin.')
      return
    }
    if (!name.trim() || !sku.trim() || !category.trim() || !uom.trim()) {
      pushToast('error', 'Name, SKU, category, and unit of measure are required')
      return
    }

    const parsedInitial = Number(initialStock)
    const parsedReorder = Number(reorderMinimum)
    if (Number.isNaN(parsedInitial) || Number.isNaN(parsedReorder)) {
      pushToast('error', 'Stock and reorder values must be numeric')
      return
    }
    if (parsedInitial < 0 || parsedReorder < 0) {
      pushToast('error', 'Negative values are not allowed in this form')
      return
    }

    setSaving(true)
    try {
      if (editingProductId) {
        await apiRequest(`/products/${editingProductId}`, 'PUT', token ?? undefined, {
          name: name.trim(),
          sku: sku.trim(),
          category: category.trim(),
          unit_of_measure: uom.trim(),
          reorder_minimum: parsedReorder,
        })
        pushToast('success', 'Product updated')
      } else {
        await apiRequest('/products', 'POST', token ?? undefined, {
          name: name.trim(),
          sku: sku.trim(),
          category: category.trim(),
          unit_of_measure: uom.trim(),
          initial_stock: parsedInitial,
          reorder_minimum: parsedReorder,
        })
        pushToast('success', 'Product saved')
      }

      resetForm()
      await loadFilterOptions()
      load()
      setViewMode('list')
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const deleteProduct = async () => {
    if (!editingProductId) return
    if (!canManageProducts) {
      pushToast('error', 'Only admin-approved roles can change products. Please contact admin.')
      return
    }
    if (!window.confirm('Are you sure you want to delete this product?')) return

    setSaving(true)
    try {
      await apiRequest(`/products/${editingProductId}`, 'DELETE', token ?? undefined)
      pushToast('success', 'Product deleted')
      resetForm()
      await loadFilterOptions()
      load()
      setViewMode('list')
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setFilterCategory('')
    setFilterLocation('')
    setLowStockOnly(false)
  }

  const toggleStockDetails = async (productId: number) => {
    if (expandedProductId === productId) {
      setExpandedProductId(null)
      return
    }

    setExpandedProductId(productId)
    if (stockByProductId[productId]) {
      return
    }

    setStockLoadingForProductId(productId)
    try {
      const rows = await apiRequest<ProductStockRow[]>(`/products/${productId}/stock`, 'GET', token ?? undefined)
      setStockByProductId((prev) => ({
        ...prev,
        [productId]: Array.isArray(rows) ? rows : [],
      }))
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setStockLoadingForProductId((prev) => (prev === productId ? null : prev))
    }
  }

  const totalProducts = products.length
  const totalStock = useMemo(
    () => products.reduce((sum, product) => sum + safeNumber(product.availableStock), 0),
    [products],
  )
  const lowStockCount = useMemo(
    () => products.filter((product) => safeNumber(product.availableStock) <= safeNumber(product.reorder_minimum)).length,
    [products],
  )
  const activeFiltersCount = [search.trim(), filterCategory.trim(), filterLocation.trim(), lowStockOnly ? '1' : '']
    .filter(Boolean)
    .length

  return (
    <section className="product-page">
      {viewMode === 'list' && (
        <>
          <div className="product-overview">
            <div className="product-overview-top">
              <div className="product-title-block">
                <h2>Products</h2>
                <p>Manage catalog items, monitor stock, and keep reorder levels in control.</p>
              </div>
              {canManageProducts ? (
                <button type="button" className="btn btn-primary" onClick={startNew}>+ New Product</button>
              ) : (
                <div className="muted">Read-only access. Contact admin to manage products.</div>
              )}
            </div>
            <div className="product-stats-grid">
              <article className="product-stat-card">
                <div className="product-stat-label">Total Products</div>
                <div className="product-stat-value">{totalProducts}</div>
              </article>
              <article className="product-stat-card">
                <div className="product-stat-label">Total Units on Hand</div>
                <div className="product-stat-value">{totalStock}</div>
              </article>
              <article className="product-stat-card">
                <div className="product-stat-label">Low or Out of Stock</div>
                <div className="product-stat-value product-stat-warning">{lowStockCount}</div>
              </article>
              <article className="product-stat-card">
                <div className="product-stat-label">Active Filters</div>
                <div className="product-stat-value">{activeFiltersCount}</div>
              </article>
            </div>
          </div>

          <div className="list-card product-filter-card">
            <div className="list-header">
              <h2>Filter Products</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={clearFilters}
                disabled={activeFiltersCount === 0}
              >
                Reset
              </button>
            </div>
            <div className="product-filter-grid">
              <div className="filter-group">
                <label className="filter-label">Search</label>
                <input
                  className="search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, SKU, or category"
                />
              </div>
              <div className="filter-group">
                <label className="filter-label">Category</label>
                <select className="form-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {filterOptions.categories.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label className="filter-label">Location</label>
                <select className="form-select" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
                  <option value="">All locations</option>
                  {filterOptions.locations.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div className="product-filter-actions">
                <label className="checkbox-label">
                  <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
                  Low stock only
                </label>
                <button type="button" className="btn btn-primary" onClick={load}>Apply Filters</button>
              </div>
            </div>
          </div>

          <div className="list-card product-table-card">
            <div className="list-header">
              <h2>Product List</h2>
              <p className="muted">{canManageProducts ? 'Click Edit to open a product.' : 'Read-only list. Only admin-approved roles can change products.'}</p>
            </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>SKU / Code</th>
                  <th>Category</th>
                  <th>Unit of Measure</th>
                  <th>On Hand</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr className="empty-row"><td colSpan={8}>Loading products…</td></tr>}
                {!loading && products.length === 0 && <tr className="empty-row"><td colSpan={8}>No products found. Click "+ New Product" to create one.</td></tr>}
                {!loading && products.map((product) => (
                  <Fragment key={product.id}>
                  <tr>
                    <td>
                      <div className="product-name-cell">
                        <strong>{product.name}</strong>
                        <span className="muted">Min reorder: {safeNumber(product.reorder_minimum)}</span>
                      </div>
                    </td>
                    <td>{product.sku}</td>
                    <td>{product.category}</td>
                    <td>{product.unit_of_measure}</td>
                    <td>{safeNumber(product.availableStock)}</td>
                    <td>{product.locationName ?? '—'}</td>
                    <td>
                      <span className={`badge ${safeNumber(product.availableStock) <= safeNumber(product.reorder_minimum) ? 'badge-waiting' : 'badge-done'}`}>
                        {safeNumber(product.availableStock) <= safeNumber(product.reorder_minimum) ? 'Low Stock' : 'In Stock'}
                      </span>
                    </td>
                    <td className="product-actions-cell">
                      {canManageProducts && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(product)}>
                          Edit
                        </button>
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void toggleStockDetails(product.id) }}>
                        {expandedProductId === product.id ? 'Hide Stock' : 'View Stock'}
                      </button>
                    </td>
                  </tr>
                {expandedProductId === product.id && (
                  <tr>
                    <td colSpan={8}>
                      <div className="inline-stock-card">
                        {stockLoadingForProductId === product.id && <p className="muted">Loading location-wise stock…</p>}
                        {stockLoadingForProductId !== product.id && (stockByProductId[product.id] || []).length === 0 && (
                          <p className="muted">No location-wise stock found for this product.</p>
                        )}
                        {stockLoadingForProductId !== product.id && (stockByProductId[product.id] || []).length > 0 && (
                          <table className="data-table nested-table">
                            <thead>
                              <tr>
                                <th>Location</th>
                                <th>Quantity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(stockByProductId[product.id] || []).map((row) => (
                                <tr key={`${product.id}-${row.location_id}`}>
                                  <td>{row.location_name}</td>
                                  <td>{safeNumber(row.quantity)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {viewMode === 'form' && (
        <form onSubmit={submit}>
          <div className="control-bar">
            <div className="control-bar-left">
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setViewMode('list') }}>Discard</button>
            </div>
            {editingProductId && (
              <div className="control-bar-right">
                <button type="button" className="btn btn-danger-outline" onClick={deleteProduct} disabled={saving}>
                  Delete
                </button>
              </div>
            )}
          </div>
          <div className="product-form-grid">
            <div className="form-sheet">
              <div className="form-title-area">
                <div className="form-doc-subtitle">{editingProductId ? 'Edit Product' : 'New Product'}</div>
                <input
                  className="form-doc-title"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Steel Rods"
                />
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label className="field-label">Internal Reference (SKU)</label>
                  <input className="form-input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. SKU-001" required />
                </div>
                <div className="field-group">
                  <label className="field-label">Category</label>
                  <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)} required>
                    <option value="">Select category…</option>
                    {categoryOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Unit of Measure</label>
                  <select className="form-select" value={uom} onChange={(e) => setUom(e.target.value)} required>
                    {uomOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Reorder Minimum</label>
                  <input className="form-input" type="number" min={0} value={reorderMinimum} onChange={(e) => setReorderMinimum(e.target.value)} />
                </div>
                {!editingProductId && (
                  <div className="field-group">
                    <label className="field-label">Initial Stock</label>
                    <input className="form-input" type="number" min={0} value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
            <div className="panel-card product-form-meta">
              <div className="panel-card-header">Guidelines</div>
              <div className="panel-card-body">
                <div className="info-grid">
                  <div className="info-item">
                    <dt>SKU</dt>
                    <dd>Use a unique and searchable code.</dd>
                  </div>
                  <div className="info-item">
                    <dt>Reorder</dt>
                    <dd>Triggers low stock visibility in lists.</dd>
                  </div>
                  <div className="info-item">
                    <dt>Category</dt>
                    <dd>Used in dashboard and filtering.</dd>
                  </div>
                  <div className="info-item">
                    <dt>Initial Stock</dt>
                    <dd>Available only for new products.</dd>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}

function OperationsPage({
  token,
  pushToast,
  currentUser,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
  currentUser: UserProfile | null
}) {
  const location = useLocation()
  const operationType = toOperationKind(location.pathname)

  const [viewMode, setViewMode] = useState<'list' | 'form'>('list')
  const [operations, setOperations] = useState<Operation[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [locations, setLocations] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sortBy, setSortBy] = useState<'date' | 'status'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [sourceLocation, setSourceLocation] = useState('')
  const [destinationLocation, setDestinationLocation] = useState('')
  const [supplier, setSupplier] = useState('')
  const [lines, setLines] = useState<OperationDraftLine[]>([
    { product_id: '', requested_quantity: '0', picked_quantity: '0', packed_quantity: '0' },
  ])
  const canDeleteOperations = hasElevatedAccess(currentUser)

  const resetDraftForm = () => {
    setLines([{ product_id: '', requested_quantity: '0', picked_quantity: '0', packed_quantity: '0' }])
    setSupplier('')
    setSourceLocation('')
    setDestinationLocation('')
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [docs, productList, locationList] = await Promise.all([
        apiRequest<Operation[]>(`/operations?type=${operationType}`, 'GET', token ?? undefined),
        apiRequest<Product[]>('/products', 'GET', token ?? undefined),
        apiRequest<Warehouse[]>('/locations', 'GET', token ?? undefined),
      ])
      setOperations(Array.isArray(docs) ? docs : [])
      setProducts(Array.isArray(productList) ? productList : [])
      setLocations(Array.isArray(locationList) ? locationList : [])
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [operationType, pushToast, token])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    const timer = setInterval(() => {
      fetchData()
    }, LIVE_SYNC_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [fetchData])

  const requiresSource = operationType === 'Delivery' || operationType === 'Internal'
  const requiresDestination = operationType === 'Internal'
  const requiresAdjustmentLocation = operationType === 'Adjustment'
  const isDelivery = operationType === 'Delivery'

  const sortedOperations = useMemo(() => {
    const statusRank: Record<Operation['status'], number> = {
      Draft: 1,
      Waiting: 2,
      Ready: 3,
      Done: 4,
      Canceled: 5,
    }

    const copy = [...operations]
    copy.sort((a, b) => {
      if (sortBy === 'status') {
        const statusDiff = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99)
        if (statusDiff !== 0) return sortDir === 'asc' ? statusDiff : -statusDiff
      }

      const dateDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sortDir === 'asc' ? dateDiff : -dateDiff
    })
    return copy
  }, [operations, sortBy, sortDir])
  const overRequested =
    operationType === 'Delivery' &&
    lines.some((line) => {
      const product = products.find((p) => String(p.id) === line.product_id)
      const requested = Number(line.requested_quantity)
      return (
        product?.availableStock !== undefined &&
        Number.isFinite(requested) &&
        requested > safeNumber(product.availableStock)
      )
    })

  const submit = async (mode: 'draft' | 'validate') => {

    if (!lines.length) {
      pushToast('error', 'Add at least one line')
      return
    }

    for (const line of lines) {
      if (!line.product_id) {
        pushToast('error', 'Select a product for every line')
        return
      }

      const requested = Number(line.requested_quantity)
      if (Number.isNaN(requested) || requested < 0) {
        pushToast('error', 'Quantity must be a non-negative number')
        return
      }
      if (operationType !== 'Adjustment' && requested <= 0) {
        pushToast('error', 'Quantity must be greater than zero')
        return
      }

      if (isDelivery) {
        const picked = Number(line.picked_quantity ?? 0)
        const packed = Number(line.packed_quantity ?? 0)
        if (!Number.isFinite(picked) || !Number.isFinite(packed) || picked < 0 || packed < 0) {
          pushToast('error', 'Picked and packed quantities must be non-negative numbers')
          return
        }
        if (mode === 'validate' && (picked < requested || packed < requested)) {
          pushToast('error', 'For validation, picked and packed quantities must cover requested quantity')
          return
        }
        if (packed > picked) {
          pushToast('error', 'Packed quantity cannot exceed picked quantity')
          return
        }
      }
    }
    if (requiresSource && !sourceLocation.trim()) {
      pushToast('error', 'Source location is required')
      return
    }
    if (requiresDestination && !destinationLocation.trim()) {
      pushToast('error', 'Destination location is required')
      return
    }
    if (requiresAdjustmentLocation && !destinationLocation.trim()) {
      pushToast('error', 'Location is required for adjustment')
      return
    }
    if (operationType === 'Receipt' && !supplier.trim()) {
      pushToast('error', 'Supplier is required for receipts')
      return
    }

    setSaving(true)
    try {
      const created = await apiRequest<{ id: number }>('/operations', 'POST', token ?? undefined, {
        type: operationType,
        supplier: supplier || undefined,
        source_location: operationType === 'Adjustment' ? undefined : sourceLocation || undefined,
        destination_location: destinationLocation || undefined,
        lines: lines.map((line) => ({
          product_id: Number(line.product_id),
          requested_quantity: Number(line.requested_quantity),
          picked_quantity: Number(line.picked_quantity ?? 0),
          packed_quantity: Number(line.packed_quantity ?? 0),
        })),
      })

      if (mode === 'validate') {
        await apiRequest(`/operations/${created.id}/validate`, 'POST', token ?? undefined)
        pushToast('success', `${operationType} validated`)
      } else {
        pushToast('success', `${operationType} draft saved`)
      }

      resetDraftForm()
      await fetchData()
      setViewMode('list')
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const updateLine = (index: number, patch: Partial<OperationDraftLine>) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line
        const next = { ...line, ...patch }
        if (isDelivery && patch.requested_quantity !== undefined && patch.picked_quantity === undefined && patch.packed_quantity === undefined) {
          next.picked_quantity = patch.requested_quantity
          next.packed_quantity = patch.requested_quantity
        }
        return next
      }),
    )
  }

  const addLine = () => {
    setLines((prev) => [...prev, { product_id: '', requested_quantity: '0', picked_quantity: '0', packed_quantity: '0' }])
  }

  const removeLine = (index: number) => {
    setLines((prev) => {
      if (prev.length === 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  const validateOperation = async (operationId: number) => {
    try {
      await apiRequest(`/operations/${operationId}/validate`, 'POST', token ?? undefined)
      pushToast('success', `${operationType} validated`)
      await fetchData()
    } catch (error) {
      pushToast('error', (error as Error).message)
    }
  }

  const updateOperationStatus = async (operationId: number, status: 'Draft' | 'Waiting' | 'Ready' | 'Canceled') => {
    try {
      await apiRequest(`/operations/${operationId}/status`, 'POST', token ?? undefined, { status })
      pushToast('success', `Status changed to ${status}`)
      await fetchData()
    } catch (error) {
      pushToast('error', (error as Error).message)
    }
  }

  const statusActions = (op: Operation): Array<'Waiting' | 'Ready' | 'Canceled' | 'Draft'> => {
    if (op.status === 'Draft') return ['Waiting', 'Ready', 'Canceled']
    if (op.status === 'Waiting') return ['Ready', 'Canceled']
    if (op.status === 'Ready') return ['Waiting', 'Canceled']
    if (op.status === 'Canceled') return ['Draft']
    return []
  }

  const deleteOperation = async (id: number) => {
    if (!canDeleteOperations) {
      pushToast('error', 'Only admin-approved roles can delete operations. Please contact admin.')
      return
    }
    if (!window.confirm('Are you sure you want to delete this operation? This will be recorded in history.')) return
    try {
      await apiRequest(`/operations/${id}`, 'DELETE', token ?? undefined)
      pushToast('success', 'Operation deleted')
      await fetchData()
    } catch (error) {
      pushToast('error', (error as Error).message)
    }
  }

  const opLabel = operationType === 'Receipt' ? 'Receipts'
    : operationType === 'Delivery' ? 'Delivery Orders'
      : operationType === 'Internal' ? 'Internal Transfers'
        : 'Inventory Adjustments'
  const singularOpLabel = operationType === 'Receipt'
    ? 'Receipt'
    : operationType === 'Delivery'
      ? 'Delivery Order'
      : operationType === 'Internal'
        ? 'Internal Transfer'
        : 'Inventory Adjustment'
  const statBaseLabel = operationType === 'Receipt'
    ? 'Receipts'
    : operationType === 'Delivery'
      ? 'Deliveries'
      : operationType === 'Internal'
        ? 'Transfers'
        : 'Adjustments'

  const draftCount = operations.filter((op) => op.status !== 'Done').length
  const doneCount = operations.filter((op) => op.status === 'Done').length

  return (
    <section>
      {viewMode === 'list' && (
        <>
          <div className="operations-overview">
            <div className="operations-overview-top">
              <div className="product-title-block">
                <h2>{opLabel}</h2>
                <p>Create, validate, and monitor stock movements with full traceability.</p>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => { resetDraftForm(); setViewMode('form') }}>
                + New {singularOpLabel}
              </button>
            </div>
            <div className="product-stats-grid operations-stats-grid">
              <article className="product-stat-card">
                <div className="product-stat-label">Total {statBaseLabel}</div>
                <div className="product-stat-value">{operations.length}</div>
              </article>
              <article className="product-stat-card">
                <div className="product-stat-label">Open {statBaseLabel}</div>
                <div className="product-stat-value">{draftCount}</div>
              </article>
              <article className="product-stat-card">
                <div className="product-stat-label">Validated {statBaseLabel}</div>
                <div className="product-stat-value product-stat-warning">{doneCount}</div>
              </article>
            </div>
          </div>

          <div className="list-card">
            <div className="list-header">
              <h2>{opLabel} List</h2>
              <p className="muted">
                Validate {statBaseLabel.toLowerCase()} normally.
                {!canDeleteOperations ? ' Delete access is restricted. Please contact admin.' : ` Remove non-done ${statBaseLabel.toLowerCase()}.`}
              </p>
            </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>
                    <button
                      type="button"
                      className="table-sort-btn"
                      onClick={() => {
                        if (sortBy === 'status') {
                          setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                        } else {
                          setSortBy('status')
                          setSortDir('asc')
                        }
                      }}
                    >
                      Status {sortBy === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>
                    <button
                      type="button"
                      className="table-sort-btn"
                      onClick={() => {
                        if (sortBy === 'date') {
                          setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                        } else {
                          setSortBy('date')
                          setSortDir('desc')
                        }
                      }}
                    >
                      Date {sortBy === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr className="empty-row"><td colSpan={6}>Loading {statBaseLabel.toLowerCase()}…</td></tr>}
                {!loading && sortedOperations.length === 0 && <tr className="empty-row"><td colSpan={6}>No {statBaseLabel.toLowerCase()} yet. Click "+ New {singularOpLabel}" to create one.</td></tr>}
                {!loading && sortedOperations.map((op) => (
                  <tr key={op.id}>
                    <td><strong>{op.reference_number}</strong></td>
                    <td>
                      <span className={`badge badge-${op.status.toLowerCase()}`}>{op.status}</span>
                    </td>
                    <td>{op.source_location_name ?? '—'}</td>
                    <td>{op.destination_location_name ?? '—'}</td>
                    <td>{formatDate(op.created_at)}</td>
                    <td>
                      <div className="operation-row-actions">
                        {op.status !== 'Done' && op.status !== 'Canceled' ? (
                          <button type="button" className="btn btn-secondary" onClick={() => validateOperation(op.id)}>Validate</button>
                        ) : (
                          <span className="muted">{op.status === 'Done' ? 'Done' : 'Canceled'}</span>
                        )}
                        {statusActions(op).map((nextStatus) => (
                          <button
                            key={`${op.id}-${nextStatus}`}
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { void updateOperationStatus(op.id, nextStatus) }}
                          >
                            {nextStatus}
                          </button>
                        ))}
                        {op.status !== 'Done' && canDeleteOperations && (
                          <button type="button" className="btn-icon" onClick={() => deleteOperation(op.id)} title="Delete document">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '14px', height: '14px' }}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </>
      )}

      {viewMode === 'form' && (
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="control-bar">
            <div className="control-bar-left">
              <button className="btn btn-secondary" type="button" disabled={saving} onClick={() => { void submit('draft') }}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button className="btn btn-success" type="button" disabled={saving || overRequested} onClick={() => { void submit('validate') }}>
                {saving ? 'Validating…' : 'Validate'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => {
                resetDraftForm()
                setViewMode('list')
              }}>Discard</button>
            </div>
          </div>

          <div className="operation-form-grid">
            <div className="form-sheet">
              <div className="form-title-area">
                <div className="form-doc-subtitle">{opLabel}</div>
                <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>New {singularOpLabel}</h2>
              </div>

              <div className="field-row">
                {operationType === 'Receipt' && (
                  <div className="field-group">
                    <label className="field-label">Receive From (Supplier)</label>
                    <input className="form-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name or vendor" required />
                  </div>
                )}
                {requiresSource && (
                  <div className="field-group">
                    <label className="field-label">Source Location</label>
                    <select className="form-select" value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)} required>
                      <option value="">Select source location…</option>
                      {locations.map((item) => (
                        <option key={item.id} value={item.name}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {requiresDestination && (
                  <div className="field-group">
                    <label className="field-label">Destination Location</label>
                    <select className="form-select" value={destinationLocation} onChange={(e) => setDestinationLocation(e.target.value)} required>
                      <option value="">Select destination location…</option>
                      {locations.map((item) => (
                        <option key={item.id} value={item.name}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {requiresAdjustmentLocation && (
                  <div className="field-group">
                    <label className="field-label">Inventory Location</label>
                    <select className="form-select" value={destinationLocation} onChange={(e) => setDestinationLocation(e.target.value)} required>
                      <option value="">Select location…</option>
                      {locations.map((item) => (
                        <option key={item.id} value={item.name}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="notebook">
                <div className="notebook-tabs">
                  <button type="button" className="notebook-tab active">Operations</button>
                </div>
                <div className="notebook-content">
                  <table className="lines-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th style={{ width: '160px' }}>{operationType === 'Adjustment' ? 'Counted Qty' : 'Demand'}</th>
                        {isDelivery && <th style={{ width: '140px' }}>Picked</th>}
                        {isDelivery && <th style={{ width: '140px' }}>Packed</th>}
                        <th style={{ width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => (
                        <tr key={index}>
                          <td>
                            <select className="form-select" value={line.product_id} onChange={(e) => updateLine(index, { product_id: e.target.value })} required>
                              <option value="">Select a product…</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input className="form-input" type="number" min={0} value={line.requested_quantity} onChange={(e) => updateLine(index, { requested_quantity: e.target.value })} required />
                          </td>
                          {isDelivery && (
                            <td>
                              <input className="form-input" type="number" min={0} value={line.picked_quantity ?? '0'} onChange={(e) => updateLine(index, { picked_quantity: e.target.value })} required />
                            </td>
                          )}
                          {isDelivery && (
                            <td>
                              <input className="form-input" type="number" min={0} value={line.packed_quantity ?? '0'} onChange={(e) => updateLine(index, { packed_quantity: e.target.value })} required />
                            </td>
                          )}
                          <td>
                            <button type="button" className="btn-icon" onClick={() => removeLine(index)} title="Remove">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" className="add-line-btn" onClick={addLine}>+ Add a line</button>
                  {overRequested && (
                    <p className="warning-text" style={{ marginTop: '12px' }}>One or more quantities exceed available stock.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="panel-card product-form-meta">
              <div className="panel-card-header">Document Tips</div>
              <div className="panel-card-body">
                <div className="info-grid">
                  <div className="info-item">
                    <dt>Save Draft</dt>
                    <dd>Use when details are still in progress.</dd>
                  </div>
                  <div className="info-item">
                    <dt>Validate</dt>
                    <dd>Commits stock movement immediately.</dd>
                  </div>
                  <div className="info-item">
                    <dt>Quantity Rule</dt>
                    <dd>Deliveries cannot exceed available stock.</dd>
                  </div>
                  <div className="info-item">
                    <dt>Traceability</dt>
                    <dd>Each document gets a reference number.</dd>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}

function MoveHistoryPage({
  token,
  pushToast,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const data = await apiRequest<LedgerEntry[]>('/ledger', 'GET', token ?? undefined)
        setEntries(Array.isArray(data) ? data : [])
      } catch (error) {
        pushToast('error', (error as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()

    const timer = setInterval(() => {
      load()
    }, LIVE_SYNC_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [token, pushToast])

  const movementCount = entries.length
  const movedQuantity = useMemo(
    () => entries.reduce((sum, entry) => sum + safeNumber(entry.quantity), 0),
    [entries],
  )

  return (
    <section className="move-history-page">
      <div className="operations-overview">
        <div className="operations-overview-top">
          <div className="product-title-block">
            <h2>Move History</h2>
            <p>Chronological stock ledger for every validated movement.</p>
          </div>
        </div>
        <div
          className="product-stats-grid warehouses-stats-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}
        >
          <article className="product-stat-card">
            <div className="product-stat-label">Ledger Entries</div>
            <div className="product-stat-value">{movementCount}</div>
          </article>
          <article className="product-stat-card">
            <div className="product-stat-label">Moved Quantity</div>
            <div className="product-stat-value">{movedQuantity}</div>
          </article>
        </div>
      </div>

      <div className="list-card">
        <div className="list-header">
          <h2>Stock Ledger</h2>
          <p className="muted">Auto-refreshed every few seconds.</p>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Product</th>
                <th>From</th>
                <th>To</th>
                <th>Quantity</th>
                <th>Reference</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="empty-row"><td colSpan={7}>Loading ledger…</td></tr>}
              {!loading && entries.length === 0 && <tr className="empty-row"><td colSpan={7}>No stock movements have been recorded yet.</td></tr>}
              {!loading && entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.timestamp)}</td>
                  <td><strong>{entry.product_name}</strong></td>
                  <td>{entry.from_location_name ?? '—'}</td>
                  <td>{entry.to_location_name ?? '—'}</td>
                  <td>{entry.quantity}</td>
                  <td>{entry.reference_number ?? '—'}</td>
                  <td><span className="muted" style={{ fontSize: '12px' }}>{entry.note ?? '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function WarehousesPage({
  token,
  pushToast,
  currentUser,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
  currentUser: UserProfile | null
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState('Internal')
  const [loading, setLoading] = useState(true)
  const canManageLocations = hasElevatedAccess(currentUser)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiRequest<Warehouse[]>('/locations', 'GET', token ?? undefined)
      setWarehouses(Array.isArray(data) ? data : [])
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [pushToast, token])

  useEffect(() => {
    load()

    const timer = setInterval(() => {
      load()
    }, LIVE_SYNC_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [load])

  const deleteWarehouse = async (id: number) => {
    if (!canManageLocations) {
      pushToast('error', 'Only admin-approved roles can change locations. Please contact admin.')
      return
    }
    if (!window.confirm('Are you sure you want to delete this warehouse? This will be recorded in history.')) return
    try {
      await apiRequest(`/locations/${id}`, 'DELETE', token ?? undefined)
      pushToast('success', 'Warehouse deleted')
      load()
    } catch (error) {
      pushToast('error', (error as Error).message)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canManageLocations) {
      pushToast('error', 'Only admin-approved roles can change locations. Please contact admin.')
      return
    }
    if (!name.trim()) {
      pushToast('error', 'Warehouse name is required')
      return
    }

    try {
      await apiRequest('/locations', 'POST', token ?? undefined, {
        name: name.trim(),
        type,
      })
      setName('')
      setType('Internal')
      pushToast('success', 'Warehouse saved')
      load()
    } catch (error) {
      pushToast('error', (error as Error).message)
    }
  }

  const internalCount = warehouses.filter((wh) => String(wh.type).trim().toLowerCase() === 'internal').length
  const vendorCount = warehouses.filter((wh) => String(wh.type).trim().toLowerCase() === 'vendor').length
  const customerCount = warehouses.filter((wh) => String(wh.type).trim().toLowerCase() === 'customer').length

  return (
    <section className="warehouses-page">
      <div className="operations-overview">
        <div className="operations-overview-top">
          <div className="product-title-block">
            <h2>Warehouses & Locations</h2>
            <p>Maintain storage points used across receipts, deliveries, and transfers.</p>
          </div>
        </div>
        <div className="product-stats-grid warehouses-stats-grid">
          <article className="product-stat-card">
            <div className="product-stat-label">Total Locations</div>
            <div className="product-stat-value">{warehouses.length}</div>
          </article>
          <article className="product-stat-card">
            <div className="product-stat-label">Internal</div>
            <div className="product-stat-value">{internalCount}</div>
          </article>
          <article className="product-stat-card">
            <div className="product-stat-label">Vendor</div>
            <div className="product-stat-value">{vendorCount}</div>
          </article>
          <article className="product-stat-card">
            <div className="product-stat-label">Customer</div>
            <div className="product-stat-value">{customerCount}</div>
          </article>
        </div>
      </div>

      <div className="split-layout warehouses-layout">
        <div className="panel-card warehouses-form-card">
          <div className="panel-card-header">Add Warehouse / Location</div>
          <div className="panel-card-body">
            {canManageLocations ? (
              <form onSubmit={submit}>
                <div className="form-field">
                  <label className="form-field-label">Location Name</label>
                  <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Warehouse" required />
                </div>
                <div className="form-field">
                  <label className="form-field-label">Location Type</label>
                  <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="Internal">Internal Location</option>
                    <option value="Vendor">Vendor Location</option>
                    <option value="Customer">Customer Location</option>
                  </select>
                </div>
                <button className="btn btn-primary" type="submit">Save Location</button>
              </form>
            ) : (
              <p className="muted">Read-only access. Only admin-approved roles can change locations. Please contact admin.</p>
            )}
          </div>
        </div>

        <div className="list-card warehouses-table-card">
          <div className="list-header">
            <h2>Registered Locations</h2>
            <p className="muted">Delete only when location has no active stock.</p>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr className="empty-row"><td colSpan={3}>Loading…</td></tr>}
                {!loading && warehouses.length === 0 && <tr className="empty-row"><td colSpan={3}>No locations configured yet.</td></tr>}
                {!loading && warehouses.map((wh) => (
                  <tr key={wh.id}>
                    <td><strong>{wh.name}</strong></td>
                    <td><span className="badge badge-draft">{wh.type}</span></td>
                    <td>
                      {canManageLocations ? (
                        <button type="button" className="btn-icon" onClick={() => deleteWarehouse(wh.id)} title="Delete location">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '14px', height: '14px' }}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      ) : (
                        <span className="muted">Contact admin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}

function ProfilePage({
  token,
  pushToast,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [roleRequestStatus, setRoleRequestStatus] = useState<UserRoleRequestStatus | null>(null)
  const [roleRequests, setRoleRequests] = useState<AdminRoleRequest[]>([])
  const [roleRequestsLoading, setRoleRequestsLoading] = useState(false)
  const [decisionBusyId, setDecisionBusyId] = useState<number | null>(null)

  const loadRoleRequests = useCallback(async () => {
    if (!token) return

    setRoleRequestsLoading(true)
    try {
      const data = await apiRequest<AdminRoleRequest[]>('/admin/role-requests', 'GET', token)
      setRoleRequests(Array.isArray(data) ? data : [])
    } catch (error) {
      if (isAdminRole(profile?.role)) {
        pushToast('error', (error as Error).message)
      }
      setRoleRequests([])
    } finally {
      setRoleRequestsLoading(false)
    }
  }, [profile?.role, pushToast, token])

  const decideRoleRequest = async (id: number, decision: 'approve' | 'reject') => {
    setDecisionBusyId(id)
    try {
      await apiRequest(
        `/admin/role-requests/${id}/${decision}`,
        'POST',
        token ?? undefined,
        decision === 'reject' ? { note: 'Rejected by admin' } : undefined,
      )
      pushToast('success', `Request ${decision}d`)
      await loadRoleRequests()
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setDecisionBusyId(null)
    }
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [nextProfile, nextRoleRequestStatus] = await Promise.all([
          apiRequest<UserProfile>('/users/me', 'GET', token ?? undefined),
          apiRequest<UserRoleRequestStatus>('/users/role-request-status', 'GET', token ?? undefined),
        ])
        setProfile(nextProfile)
        setRoleRequestStatus(nextRoleRequestStatus)
      } catch (error) {
        pushToast('error', (error as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()

    const timer = setInterval(() => {
      load()
    }, LIVE_SYNC_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [token, pushToast])

  useEffect(() => {
    if (!isAdminRole(profile?.role)) {
      setRoleRequests([])
      return
    }

    loadRoleRequests()

    const timer = setInterval(() => {
      loadRoleRequests()
    }, LIVE_SYNC_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [loadRoleRequests, profile?.role])

  const roleRequestBadgeClass =
    roleRequestStatus?.status === 'pending'
      ? 'badge-waiting'
      : roleRequestStatus?.status === 'rejected'
        ? 'badge-canceled'
        : roleRequestStatus?.status === 'completed'
          ? 'badge-done'
          : 'badge-draft'

  const roleRequestStatusLabel =
    roleRequestStatus?.status === 'pending'
      ? 'Pending Admin Review'
      : roleRequestStatus?.status === 'rejected'
        ? 'Rejected'
        : roleRequestStatus?.status === 'completed'
          ? 'Completed (Approved)'
          : 'Not Requested'

  const actionableRoleRequests = useMemo(
    () => roleRequests.filter((request) => isPendingRoleRequestStatus(request.status)),
    [roleRequests],
  )

  return (
    <section className="profile-page">
      <div className="profile-hero">
        <div className="product-title-block">
          <h2>My Profile</h2>
          <p>Your account identity and access role for this workspace.</p>
        </div>
      </div>

      <div className="profile-grid">
        <div className="panel-card profile-card">
          <div className="panel-card-header">Account Details</div>
          <div className="panel-card-body">
            {loading && <p className="muted">Loading profile…</p>}
            {!loading && !profile && <p className="muted">Unable to load profile. Please try again.</p>}
            {!loading && profile && (
              <div className="info-grid">
                <dl className="info-item">
                  <dt>Full Name</dt>
                  <dd>{profile.name}</dd>
                </dl>
                <dl className="info-item">
                  <dt>Email Address</dt>
                  <dd>{profile.email}</dd>
                </dl>
                <dl className="info-item">
                  <dt>Role</dt>
                  <dd>{profile.role}</dd>
                </dl>
                <dl className="info-item">
                  <dt>User ID</dt>
                  <dd>#{profile.id}</dd>
                </dl>
              </div>
            )}
          </div>
        </div>

        {!isAdminRole(profile?.role) && (
          <div className="panel-card profile-card">
            <div className="panel-card-header">Role Request Status</div>
            <div className="panel-card-body">
              {loading && <p className="muted">Loading role request status…</p>}
              {!loading && !roleRequestStatus && <p className="muted">Unable to load role request status.</p>}
              {!loading && roleRequestStatus && roleRequestStatus.status === 'not_requested' && (
                <p className="muted">No elevated-role request has been submitted yet.</p>
              )}
              {!loading && roleRequestStatus && roleRequestStatus.status !== 'not_requested' && (
                <div className="info-grid">
                  <dl className="info-item">
                    <dt>Status</dt>
                    <dd>
                      <span className={`badge ${roleRequestBadgeClass}`}>{roleRequestStatusLabel}</span>
                    </dd>
                  </dl>
                  <dl className="info-item">
                    <dt>Requested Role</dt>
                    <dd>{roleRequestStatus.requested_role || '—'}</dd>
                  </dl>
                  <dl className="info-item">
                    <dt>Requested At</dt>
                    <dd>{roleRequestStatus.requested_at ? formatDate(roleRequestStatus.requested_at) : '—'}</dd>
                  </dl>
                  <dl className="info-item">
                    <dt>Reviewed At</dt>
                    <dd>{roleRequestStatus.reviewed_at ? formatDate(roleRequestStatus.reviewed_at) : '—'}</dd>
                  </dl>
                  <dl className="info-item">
                    <dt>Review Note</dt>
                    <dd>{roleRequestStatus.review_note || '—'}</dd>
                  </dl>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isAdminRole(profile?.role) && (
        <div className="list-card">
          <div className="list-header">
            <h2>Pending Role Requests</h2>
            <p className="muted">Approve or reject verified requests awaiting admin decision.</p>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Requested Role</th>
                  <th>Status</th>
                  <th>Requested At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {roleRequestsLoading && <tr className="empty-row"><td colSpan={6}>Loading requests…</td></tr>}
                {!roleRequestsLoading && actionableRoleRequests.length === 0 && <tr className="empty-row"><td colSpan={6}>No pending approvals right now.</td></tr>}
                {!roleRequestsLoading && actionableRoleRequests.map((request) => (
                  <tr key={request.id}>
                    <td><strong>{request.name}</strong></td>
                    <td>{request.email}</td>
                    <td><span className="badge badge-ready">{request.requested_role}</span></td>
                    <td>
                      <span className="badge badge-waiting">
                        Pending
                      </span>
                    </td>
                    <td>{formatDate(request.created_at)}</td>
                    <td>
                      <div className="operation-row-actions">
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          onClick={() => { void decideRoleRequest(request.id, 'approve') }}
                          disabled={decisionBusyId === request.id}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-outline btn-sm"
                          onClick={() => { void decideRoleRequest(request.id, 'reject') }}
                          disabled={decisionBusyId === request.id}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default App
