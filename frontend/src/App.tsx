import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import PageLoadingState from './components/PageLoadingState'
import ToastStack from './components/ToastStack'
import { AUTH_INVALID_EVENT, LIVE_SYNC_INTERVAL_MS, TOKEN_KEY } from './config/constants'
import { useLivePolling } from './hooks/useLivePolling'
import type { Toast, UserProfile } from './types/models'
import { apiRequest } from './utils/helpers'

const loadAuthPage = () => import('./pages/AuthPage')
const loadDashboardPage = () => import('./pages/DashboardPage')
const loadMoveHistoryPage = () => import('./pages/MoveHistoryPage')
const loadOperationsPage = () => import('./pages/OperationsPage')
const loadProductsPage = () => import('./pages/ProductsPage')
const loadProfilePage = () => import('./pages/ProfilePage')
const loadReportsPage = () => import('./pages/ReportsPage')
const loadWarehousesPage = () => import('./pages/WarehousesPage')

const AuthPage = lazy(loadAuthPage)
const DashboardPage = lazy(loadDashboardPage)
const MoveHistoryPage = lazy(loadMoveHistoryPage)
const OperationsPage = lazy(loadOperationsPage)
const ProductsPage = lazy(loadProductsPage)
const ProfilePage = lazy(loadProfilePage)
const ReportsPage = lazy(loadReportsPage)
const WarehousesPage = lazy(loadWarehousesPage)

function isSameUserProfile(left: UserProfile | null, right: UserProfile | null) {
  return (
    left?.id === right?.id &&
    left?.name === right?.name &&
    left?.email === right?.email &&
    left?.role === right?.role
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastTimersRef = useRef<number[]>([])

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const nextToast = { id: Date.now() + Math.floor(Math.random() * 1000), kind, text }
    setToasts((previous) => [...previous, nextToast])

    const timerId = window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== nextToast.id))
      toastTimersRef.current = toastTimersRef.current.filter((currentId) => currentId !== timerId)
    }, 3500)

    toastTimersRef.current.push(timerId)
  }, [])

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      toastTimersRef.current = []
    }
  }, [])

  const login = useCallback((nextToken: string) => {
    localStorage.setItem(TOKEN_KEY, nextToken)
    setToken(nextToken)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setCurrentUser(null)
    pushToast('info', 'Logged out')
  }, [pushToast])

  const loadCurrentUser = useCallback(async () => {
    if (!token) {
      setCurrentUser(null)
      return
    }

    try {
      const profile = await apiRequest<UserProfile>('/users/me', 'GET', token)
      setCurrentUser((previous) => (isSameUserProfile(previous, profile) ? previous : profile))
    } catch {
      setCurrentUser((previous) => (previous === null ? previous : null))
    }
  }, [token])

  useLivePolling(loadCurrentUser, {
    enabled: Boolean(token),
    immediate: true,
    intervalMs: LIVE_SYNC_INTERVAL_MS * 3,
  })

  useEffect(() => {
    const handleAuthInvalid = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setCurrentUser(null)
      pushToast('error', detail?.message || 'Session expired. Please sign in again.')
    }

    window.addEventListener(AUTH_INVALID_EVENT, handleAuthInvalid)
    return () => {
      window.removeEventListener(AUTH_INVALID_EVENT, handleAuthInvalid)
    }
  }, [pushToast])

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void Promise.allSettled([
        loadAuthPage(),
        loadDashboardPage(),
        loadMoveHistoryPage(),
        loadOperationsPage(),
        loadProductsPage(),
        loadProfilePage(),
        loadReportsPage(),
        loadWarehousesPage(),
      ])
    }, 300)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [])

  return (
    <>
      <Suspense fallback={<PageLoadingState />}>
        <Routes>
          <Route path="/" element={<Navigate to={token ? '/dashboard' : '/auth'} replace />} />
          <Route
            path="/auth"
            element={<AuthPage token={token} onLogin={login} pushToast={pushToast} />}
          />
          <Route
            element={<AppShell token={token} onLogout={logout} currentUser={currentUser} />}
          >
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
      </Suspense>

      <ToastStack toasts={toasts} />
    </>
  )
}
