import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { LIVE_SYNC_INTERVAL_MS } from '../../config/constants'
import { useLivePolling } from '../../hooks/useLivePolling'
import type {
  NotificationItem,
  UserProfile,
} from '../../types/models'
import { playNotificationTing } from '../../utils/audio'
import { apiRequest } from '../../utils/helpers'
import GlobalSearch from './GlobalSearch'

type Props = {
  token: string | null
  onLogout: () => void
  currentUser: UserProfile | null
}

type NavigationSection = {
  label: string
  items: Array<{
    to: string
    label: string
    icon: ReactNode
  }>
}

const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    label: 'Overview',
    items: [
      {
        to: '/dashboard',
        label: 'Dashboard',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Catalog',
    items: [
      {
        to: '/products',
        label: 'Products',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        to: '/operations/receipts',
        label: 'Receipts',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        ),
      },
      {
        to: '/operations/deliveries',
        label: 'Delivery Orders',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="1" y="3" width="15" height="13" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
        ),
      },
      {
        to: '/operations/transfers',
        label: 'Internal Transfers',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        ),
      },
      {
        to: '/operations/adjustments',
        label: 'Inventory Adjustment',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        ),
      },
      {
        to: '/move-history',
        label: 'Move History',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="14 2 14 8 20 8" />
            <path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9.34" />
            <polygon points="18 2 22 6 12 16 8 16 8 12 18 2" />
          </svg>
        ),
      },
      {
        to: '/reports',
        label: 'Reports',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Settings & Account',
    items: [
      {
        to: '/settings/warehouses',
        label: 'Warehouses',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        ),
      },
      {
        to: '/profile',
        label: 'My Profile',
        icon: (
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ),
      },
    ],
  },
]

function areNotificationsEqual(left: NotificationItem[], right: NotificationItem[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((item, index) => {
    const other = right[index]
    return (
      item.id === other?.id &&
      item.kind === other?.kind &&
      item.title === other?.title &&
      item.message === other?.message &&
      item.link === other?.link
    )
  })
}

/**
 * Shared authenticated application shell with navigation, notifications, and search.
 */
export default function AppShell({ token, onLogout, currentUser }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const notifRef = useRef<HTMLDivElement>(null)
  const knownNotificationIdsRef = useRef<Set<string>>(new Set())
  const notificationInitRef = useRef(false)

  useLivePolling(
    async () => {
      if (!token) {
        return
      }

      try {
        const data = await apiRequest<NotificationItem[]>('/notifications', 'GET', token)
        const nextNotifications = Array.isArray(data) ? data : []
        setNotifications((previous) => (
          areNotificationsEqual(previous, nextNotifications) ? previous : nextNotifications
        ))
      } catch {
        // Notifications should not block navigation or page rendering.
      }
    },
    {
      enabled: Boolean(token),
      intervalMs: LIVE_SYNC_INTERVAL_MS * 2,
    },
  )

  useEffect(() => {
    const nextIds = new Set(notifications.map((notification) => notification.id))

    if (!notificationInitRef.current) {
      knownNotificationIdsRef.current = nextIds
      notificationInitRef.current = true
      return
    }

    const hasNewNotifications = notifications.some(
      (notification) => !knownNotificationIdsRef.current.has(notification.id),
    )

    knownNotificationIdsRef.current = nextIds

    if (hasNewNotifications) {
      playNotificationTing()
    }
  }, [notifications])

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [])

  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => !dismissed.has(notification.id)),
    [dismissed, notifications],
  )

  const breadcrumbs = useMemo(
    () =>
      location.pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => segment.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')),
    [location.pathname],
  )

  if (!token) {
    return <Navigate to="/auth" replace />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-title">Core Inventory</div>
          <div className="sidebar-brand-sub">Inventory Management System</div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAVIGATION_SECTIONS.map((section) => (
            <div key={section.label} className="sidebar-nav-section">
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="logout-btn" onClick={onLogout}>
            <svg style={{ width: '18px', height: '18px', flexShrink: 0, opacity: 0.7 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <span>Inventory</span>
            {breadcrumbs.map((segment, index) => (
              <span key={`${segment}-${index}`}>
                <span className="sep">{'>'}</span>
                <span className={index === breadcrumbs.length - 1 ? 'current' : ''}>{segment}</span>
              </span>
            ))}
          </div>

          <div className="topbar-search-slot">
            <GlobalSearch token={token} />
          </div>

          <div className="topbar-right">

            <div className="notif-wrapper" ref={notifRef}>
              <button
                type="button"
                className="notif-bell"
                aria-label="Notifications"
                onClick={() => setNotifOpen((current) => !current)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {visibleNotifications.length > 0 && (
                  <span className="notif-badge">
                    {visibleNotifications.length > 9 ? '9+' : visibleNotifications.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="notif-dropdown">
                  <div className="notif-dropdown-head">
                    <span>Notifications</span>
                    {visibleNotifications.length > 0 && (
                      <button
                        type="button"
                        className="notif-clear-all"
                        onClick={() => {
                          setDismissed(new Set(notifications.map((notification) => notification.id)))
                          setNotifOpen(false)
                        }}
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {visibleNotifications.length === 0 ? (
                    <div className="notif-empty">You&apos;re all caught up!</div>
                  ) : (
                    <ul className="notif-list">
                      {visibleNotifications.map((notification) => (
                        <li key={notification.id} className={`notif-item notif-${notification.kind}`}>
                          <div className="notif-item-body">
                            <div className="notif-item-title">{notification.title}</div>
                            <div className="notif-item-msg">{notification.message}</div>
                          </div>
                          <div className="notif-item-actions">
                            <button
                              type="button"
                              className="notif-view-link notif-view-btn"
                              onClick={() => {
                                setNotifOpen(false)
                                navigate(notification.link)
                              }}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="notif-dismiss"
                              aria-label="Dismiss"
                              onClick={() =>
                                setDismissed((previous) => new Set([...previous, notification.id]))
                              }
                            >
                              x
                            </button>
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
