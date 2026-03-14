import { useEffect, useMemo, useState } from 'react'
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

type Toast = {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

type OperationDraftLine = {
  product_id: string
  requested_quantity: string
}

const TOKEN_KEY = 'ims-auth-token'
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api').replace(/\/$/, '')

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
  method: 'GET' | 'POST' | 'PUT' = 'GET',
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
    throw new Error(message)
  }

  return body as T
}

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [toasts, setToasts] = useState<Toast[]>([])

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
    pushToast('info', 'Logged out')
  }

  return (
    <>
      <Routes>
        <Route
          path="/auth"
          element={<AuthPage token={token} onLogin={login} pushToast={pushToast} />}
        />
        <Route element={<ProtectedLayout token={token} onLogout={logout} />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={<DashboardPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/products"
            element={<ProductsPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/operations/receipts"
            element={<OperationsPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/operations/deliveries"
            element={<OperationsPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/operations/transfers"
            element={<OperationsPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/operations/adjustments"
            element={<OperationsPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/move-history"
            element={<MoveHistoryPage token={token} pushToast={pushToast} />}
          />
          <Route
            path="/settings/warehouses"
            element={<WarehousesPage token={token} pushToast={pushToast} />}
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
}: {
  token: string | null
  onLogout: () => void
}) {
  const location = useLocation()
  if (!token) {
    return <Navigate to="/auth" replace />
  }

  const breadcrumb = location.pathname
    .split('/')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' > ')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p>Core Inventory</p>
          <h1>IMS Console</h1>
        </div>
        <nav className="sidebar-nav" aria-label="Primary">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/operations/receipts">Receipts</NavLink>
          <NavLink to="/operations/deliveries">Delivery Orders</NavLink>
          <NavLink to="/operations/transfers">Internal Transfers</NavLink>
          <NavLink to="/operations/adjustments">Inventory Adjustment</NavLink>
          <NavLink to="/move-history">Move History</NavLink>
          <NavLink to="/settings/warehouses">Warehouse Settings</NavLink>
          <NavLink to="/profile">My Profile</NavLink>
        </nav>
        <button type="button" className="ghost-btn" onClick={onLogout}>
          Logout
        </button>
      </aside>
      <main className="content">
        <header className="topbar">
          <span>{breadcrumb || 'Dashboard'}</span>
        </header>
        <Outlet />
      </main>
    </div>
  )
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
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
    if (resetNewPassword.length < 6) {
      pushToast('error', 'New password must be at least 6 characters')
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
    if (password.length < 6) {
      pushToast('error', 'Password must be at least 6 characters')
      return
    }
    if (mode === 'signup' && !name.trim()) {
      pushToast('error', 'Name is required for sign up')
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
        await apiRequest('/auth/register', 'POST', undefined, { name, email, password })
        pushToast('success', 'Account created, please log in')
        setMode('login')
      }

    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <section className="auth-card">
        <h2>Core Inventory IMS</h2>
        <p>Centralized stock control for receipts, deliveries, transfers, and adjustments.</p>
        <div className="tab-row">
          <button type="button" className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>
            Login
          </button>
          <button type="button" className={mode === 'signup' ? 'tab active' : 'tab'} onClick={() => setMode('signup')}>
            Sign Up
          </button>
        </div>

        <form className="form-grid" onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              Full Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setShowReset((prev) => !prev)
                setResetStep('request')
                setResetOtp('')
                setResetNewPassword('')
                setResetEmail(email)
                setOtpSentTo('')
                setResendCooldown(0)
              }}
            >
              {showReset ? 'Close reset password' : 'Reset password'}
            </button>
          )}

          {mode === 'login' && showReset && (
            <div className="reset-box">
              <h3>Reset Password</h3>
              <label>
                Email
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </label>

              {resetStep === 'verify' && otpSentTo && (
                <p className="muted">OTP sent to {otpSentTo}</p>
              )}

              {resetStep === 'verify' && (
                <>
                  <label>
                    OTP Code
                    <input value={resetOtp} onChange={(e) => setResetOtp(e.target.value)} required />
                  </label>
                  <label>
                    New Password
                    <input
                      type="password"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      minLength={6}
                      required
                    />
                  </label>
                </>
              )}

              <div className="action-row">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={requestResetOtp}
                  disabled={resetBusy || resendCooldown > 0}
                >
                  {resetBusy
                    ? resetStep === 'request'
                      ? 'Sending...'
                      : 'Sending again...'
                    : resendCooldown > 0
                      ? `Resend OTP in ${resendCooldown}s`
                      : resetStep === 'request'
                        ? 'Send OTP'
                        : 'Resend OTP'}
                </button>
                {resetStep === 'verify' && (
                  <button type="button" className="primary-btn" onClick={submitPasswordReset} disabled={resetBusy}>
                    {resetBusy ? 'Resetting...' : 'Reset Password'}
                  </button>
                )}
              </div>
            </div>
          )}

          {import.meta.env.DEV && mode === 'login' && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                onLogin('dev-token')
                navigate('/dashboard', { replace: true })
              }}
            >
              Development quick access
            </button>
          )}
        </form>
      </section>
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
        const raw = await apiRequest<Partial<KPIResponse> | null>(
          `/dashboard/kpis${query}`,
          'GET',
          token ?? undefined,
        )
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
    return () => {
      active = false
    }
  }, [query, token, pushToast])

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Inventory Dashboard</h2>
      </div>

      <div className="filters-grid">
        <label>
          Document Type
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All</option>
            {filterOptions.documentTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {filterOptions.statuses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Warehouse
          <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">All</option>
            {filterOptions.warehouses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {filterOptions.categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading dashboard...</p>
      ) : (
        <div className="kpi-grid">
          <KpiCard label="Total Products in Stock" value={kpis.totalProductsInStock} />
          <KpiCard label="Low / Out of Stock" value={kpis.lowOrOutOfStockItems} />
          <KpiCard label="Pending Receipts" value={kpis.pendingReceipts} />
          <KpiCard label="Pending Deliveries" value={kpis.pendingDeliveries} />
          <KpiCard label="Internal Transfers Scheduled" value={kpis.scheduledInternalTransfers} />
        </div>
      )}
    </section>
  )
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="kpi-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function ProductsPage({
  token,
  pushToast,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
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

  const resetForm = () => {
    setEditingProductId(null)
    setName('')
    setSku('')
    setCategory('')
    setUom('Units')
    setInitialStock('0')
    setReorderMinimum('0')
  }

  const startEdit = (product: Product) => {
    setEditingProductId(product.id)
    setName(product.name)
    setSku(product.sku)
    setCategory(product.category)
    setUom(product.unit_of_measure)
    setReorderMinimum(String(safeNumber(product.reorder_minimum)))
    setInitialStock('0')
  }

  const load = async () => {
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
  }

  useEffect(() => {
    load()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
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
      load()
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Products</h2>
      </div>

      <div className="split-grid">
        <form className="form-grid card" onSubmit={submit}>
          <h3>Create / Update Product</h3>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            SKU / Code
            <input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </label>
          <label>
            Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} required />
          </label>
          <label>
            Unit of Measure
            <input value={uom} onChange={(e) => setUom(e.target.value)} required />
          </label>
          <label>
            Initial Stock
            <input
              type="number"
              min={0}
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              disabled={editingProductId !== null}
            />
          </label>
          <label>
            Reorder Minimum
            <input
              type="number"
              min={0}
              value={reorderMinimum}
              onChange={(e) => setReorderMinimum(e.target.value)}
            />
          </label>
          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? 'Saving...' : editingProductId ? 'Update Product' : 'Save Product'}
          </button>
          {editingProductId && (
            <button type="button" className="ghost-btn" onClick={resetForm}>
              Cancel Editing
            </button>
          )}
        </form>

        <div className="card">
          <div className="table-toolbar">
            <h3>Inventory List</h3>
            <div className="table-search">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by SKU or name"
              />
              <input
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                placeholder="Filter category"
              />
              <input
                value={filterLocation}
                onChange={(e) => setFilterLocation(e.target.value)}
                placeholder="Filter location"
              />
              <label>
                <input
                  type="checkbox"
                  checked={lowStockOnly}
                  onChange={(e) => setLowStockOnly(e.target.checked)}
                />
                Low stock only
              </label>
              <button type="button" className="ghost-btn" onClick={load}>
                Search
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>UoM</th>
                  <th>Stock</th>
                  <th>Location</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7}>Loading products...</td>
                  </tr>
                )}
                {!loading && products.length === 0 && (
                  <tr>
                    <td colSpan={7}>No products found.</td>
                  </tr>
                )}
                {!loading &&
                  products.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.sku}</td>
                      <td>{product.category}</td>
                      <td>{product.unit_of_measure}</td>
                      <td>{safeNumber(product.availableStock)}</td>
                      <td>{product.locationName ?? '-'}</td>
                      <td>
                        <button type="button" className="ghost-btn" onClick={() => startEdit(product)}>
                          Edit
                        </button>
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

function OperationsPage({
  token,
  pushToast,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
  const location = useLocation()
  const operationType = toOperationKind(location.pathname)

  const [operations, setOperations] = useState<Operation[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [sourceLocation, setSourceLocation] = useState('')
  const [destinationLocation, setDestinationLocation] = useState('')
  const [supplier, setSupplier] = useState('')
  const [lines, setLines] = useState<OperationDraftLine[]>([{ product_id: '', requested_quantity: '0' }])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [docs, productList] = await Promise.all([
        apiRequest<Operation[]>(`/operations?type=${operationType}`, 'GET', token ?? undefined),
        apiRequest<Product[]>('/products', 'GET', token ?? undefined),
      ])
      setOperations(Array.isArray(docs) ? docs : [])
      setProducts(Array.isArray(productList) ? productList : [])
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [operationType])

  const requiresSource = operationType === 'Delivery' || operationType === 'Internal'
  const requiresDestination = operationType === 'Internal'
  const requiresAdjustmentLocation = operationType === 'Adjustment'
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()

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
        })),
      })

      await apiRequest(`/operations/${created.id}/validate`, 'POST', token ?? undefined)
      pushToast('success', `${operationType} validated`)
      setLines([{ product_id: '', requested_quantity: '0' }])
      setSupplier('')
      setSourceLocation('')
      setDestinationLocation('')
      fetchData()
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const updateLine = (index: number, patch: Partial<OperationDraftLine>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  const addLine = () => {
    setLines((prev) => [...prev, { product_id: '', requested_quantity: '0' }])
  }

  const removeLine = (index: number) => {
    setLines((prev) => {
      if (prev.length === 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{operationType} Operations</h2>
      </div>

      <div className="split-grid">
        <form className="form-grid card" onSubmit={submit}>
          <h3>New {operationType}</h3>

          {operationType === 'Receipt' && (
            <label>
              Supplier
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} required />
            </label>
          )}

          {requiresSource && (
            <label>
              Source Location
              <input value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)} required />
            </label>
          )}

          {requiresDestination && (
            <label>
              Destination Location
              <input
                value={destinationLocation}
                onChange={(e) => setDestinationLocation(e.target.value)}
                required
              />
            </label>
          )}

          {requiresAdjustmentLocation && (
            <label>
              Location
              <input
                value={destinationLocation}
                onChange={(e) => setDestinationLocation(e.target.value)}
                required
              />
            </label>
          )}

          {lines.map((line, index) => (
            <div key={index} className="op-line-row">
              <p className="line-title">Line {index + 1}</p>
              <label>
                Product
                <select
                  value={line.product_id}
                  onChange={(e) => updateLine(index, { product_id: e.target.value })}
                  required
                >
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                {operationType === 'Adjustment' ? 'Counted Quantity' : 'Quantity'}
                <input
                  type="number"
                  min={0}
                  value={line.requested_quantity}
                  onChange={(e) => updateLine(index, { requested_quantity: e.target.value })}
                  required
                />
              </label>

              <button type="button" className="ghost-btn" onClick={() => removeLine(index)}>
                Remove Line
              </button>
            </div>
          ))}

          <button type="button" className="ghost-btn" onClick={addLine}>
            Add Product Line
          </button>

          {overRequested && (
            <p className="warning-text">
              One or more lines exceed known available stock.
            </p>
          )}

          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? 'Validating...' : `Validate ${operationType}`}
          </button>
        </form>

        <div className="card">
          <h3>{operationType} Documents</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5}>Loading documents...</td>
                  </tr>
                )}
                {!loading && operations.length === 0 && (
                  <tr>
                    <td colSpan={5}>No operation documents yet.</td>
                  </tr>
                )}
                {!loading &&
                  operations.map((operation) => (
                    <tr key={operation.id}>
                      <td>{operation.reference_number}</td>
                      <td>{operation.status}</td>
                      <td>{operation.source_location_name ?? '-'}</td>
                      <td>{operation.destination_location_name ?? '-'}</td>
                      <td>{formatDate(operation.created_at)}</td>
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
  }, [token, pushToast])

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Move History / Stock Ledger</h2>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>From</th>
                <th>To</th>
                <th>Quantity</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6}>Loading ledger...</td>
                </tr>
              )}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={6}>No ledger entries found.</td>
                </tr>
              )}
              {!loading &&
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.timestamp)}</td>
                    <td>{entry.product_name}</td>
                    <td>{entry.from_location_name ?? '-'}</td>
                    <td>{entry.to_location_name ?? '-'}</td>
                    <td>{entry.quantity}</td>
                    <td>{entry.reference_number ?? '-'}</td>
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
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState('Internal')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await apiRequest<Warehouse[]>('/locations', 'GET', token ?? undefined)
      setWarehouses(Array.isArray(data) ? data : [])
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
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

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Warehouse Settings</h2>
      </div>

      <div className="split-grid">
        <form className="form-grid card" onSubmit={submit}>
          <h3>Add Warehouse / Location</h3>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="Internal">Internal Location</option>
              <option value="Vendor">Vendor Location</option>
              <option value="Customer">Customer Location</option>
            </select>
          </label>
          <button className="primary-btn" type="submit">
            Save Warehouse
          </button>
        </form>

        <div className="card">
          <h3>Registered Warehouses</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={2}>Loading locations...</td>
                  </tr>
                )}
                {!loading && warehouses.length === 0 && (
                  <tr>
                    <td colSpan={2}>No locations configured.</td>
                  </tr>
                )}
                {!loading &&
                  warehouses.map((wh) => (
                    <tr key={wh.id}>
                      <td>{wh.name}</td>
                      <td>{wh.type}</td>
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

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const data = await apiRequest<UserProfile>('/users/me', 'GET', token ?? undefined)
        setProfile(data)
      } catch (error) {
        pushToast('error', (error as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token, pushToast])

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>My Profile</h2>
      </div>
      <div className="card">
        {loading && <p>Loading profile...</p>}
        {!loading && !profile && <p>Unable to load profile.</p>}
        {!loading && profile && (
          <dl className="profile-grid">
            <div>
              <dt>Name</dt>
              <dd>{profile.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{profile.role}</dd>
            </div>
            <div>
              <dt>User ID</dt>
              <dd>{profile.id}</dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  )
}

export default App
