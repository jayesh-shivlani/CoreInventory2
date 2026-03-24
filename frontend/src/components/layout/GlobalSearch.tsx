import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { API_BASE, MIN_GLOBAL_SEARCH_CHARS, SEARCH_DEBOUNCE_MS } from '../../config/constants'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import type { GlobalSearchResult } from '../../types/models'

type Props = {
  token: string | null
}

type QuickAction = GlobalSearchResult & {
  keywords: string[]
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'quick-low-stock',
    kind: 'product',
    title: 'Open Low Stock Products',
    subtitle: 'Jump to products filtered by reorder risk.',
    meta: 'Quick action',
    path: '/products?lowStockOnly=true',
    tone: 'warning',
    keywords: ['low', 'stock', 'reorder', 'risk'],
  },
  {
    id: 'quick-pending-deliveries',
    kind: 'operation',
    title: 'Open Pending Deliveries',
    subtitle: 'Review delivery orders waiting for action.',
    meta: 'Quick action',
    path: '/operations/deliveries?status=Waiting',
    keywords: ['delivery', 'dispatch', 'shipment', 'pending'],
  },
  {
    id: 'quick-pending-receipts',
    kind: 'operation',
    title: 'Open Pending Receipts',
    subtitle: 'Review inbound receipts waiting to be processed.',
    meta: 'Quick action',
    path: '/operations/receipts?status=Waiting',
    keywords: ['receipt', 'receiving', 'inbound', 'pending'],
  },
  {
    id: 'quick-reports',
    kind: 'operation',
    title: 'Open Reports',
    subtitle: 'Go to analytics, exports, and reorder monitoring.',
    meta: 'Quick action',
    path: '/reports',
    keywords: ['report', 'analytics', 'export', 'dashboard'],
  },
]

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    Boolean(target.closest('[contenteditable="true"]'))
  )
}

function iconForResult(kind: GlobalSearchResult['kind']) {
  if (kind === 'product') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    )
  }
  if (kind === 'location') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

/**
 * Top-bar command search for products, operations, locations, and quick actions.
 */
export default function GlobalSearch({ token }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [remoteResults, setRemoteResults] = useState<GlobalSearchResult[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)

  const quickActions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return QUICK_ACTIONS.slice(0, 3)
    }

    return QUICK_ACTIONS.filter((action) =>
      action.keywords.some((keyword) => keyword.includes(normalizedQuery) || normalizedQuery.includes(keyword)),
    )
  }, [query])

  const selectableResults = useMemo(
    () => [...quickActions, ...remoteResults],
    [quickActions, remoteResults],
  )

  useEffect(() => {
    if (highlightedIndex >= selectableResults.length) {
      setHighlightedIndex(0)
    }
  }, [highlightedIndex, selectableResults.length])

  useEffect(() => {
    setOpen(false)
    setQuery('')
    setRemoteResults([])
    setHighlightedIndex(0)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (debouncedQuery.length < MIN_GLOBAL_SEARCH_CHARS) {
      setRemoteResults([])
      setLoading(false)
      return
    }

    const controller = new AbortController()

    const loadResults = async () => {
      setLoading(true)
      try {
        const response = await fetch(
          `${API_BASE}/search?q=${encodeURIComponent(debouncedQuery)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: controller.signal,
          },
        )

        let body: unknown = null
        try {
          body = await response.json()
        } catch {
          body = null
        }

        if (!response.ok) {
          throw new Error((body as { message?: string } | null)?.message ?? 'Search failed')
        }

        const results = (body as { results?: GlobalSearchResult[] } | null)?.results
        setRemoteResults(Array.isArray(results) ? results : [])
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return
        }
        setRemoteResults([])
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadResults()

    return () => {
      controller.abort()
    }
  }, [debouncedQuery, token])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (isEditableTarget(event.target)) {
        return
      }

      event.preventDefault()
      inputRef.current?.focus()
      setOpen(true)
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleShortcut)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleShortcut)
    }
  }, [])

  const handleSelect = (result: GlobalSearchResult) => {
    setOpen(false)
    setQuery('')
    setRemoteResults([])
    setHighlightedIndex(0)

    const target = new URL(result.path, window.location.origin)
    const isCurrentTarget =
      target.pathname === location.pathname && target.search === location.search

    if (isCurrentTarget) {
      return
    }

    navigate(result.path)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true)
      return
    }

    if (!selectableResults.length) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((prev) => (prev + 1) % selectableResults.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((prev) => (prev - 1 + selectableResults.length) % selectableResults.length)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      handleSelect(selectableResults[highlightedIndex] ?? selectableResults[0])
      return
    }

    if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const showEmptyState =
    open &&
    !loading &&
    selectableResults.length === 0 &&
    debouncedQuery.length >= MIN_GLOBAL_SEARCH_CHARS
  const shouldShowPanel =
    open &&
    (
      loading ||
      query.trim().length > 0 ||
      selectableResults.length > 0
    )

  return (
    <div className="global-search" ref={containerRef}>
      <div className={`global-search-field${open ? ' is-open' : ''}`}>
        <svg className="global-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          className="global-search-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setHighlightedIndex(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search products, operations, locations"
          aria-label="Global search"
          aria-expanded={open}
          aria-controls="global-search-results"
          autoComplete="off"
        />
        <span className="global-search-shortcut">/</span>
      </div>

      {shouldShowPanel && (
        <div className="global-search-panel" id="global-search-results">
          {quickActions.length > 0 && (
            <div className="global-search-section">
              <div className="global-search-section-title">Quick Actions</div>
              {quickActions.map((result, index) => {
                const isActive = highlightedIndex === index
                return (
                  <button
                    key={result.id}
                    type="button"
                    className={`global-search-result${isActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleSelect(result)}
                  >
                    <span className={`global-search-result-icon is-${result.kind}`}>
                      {iconForResult(result.kind)}
                    </span>
                    <span className="global-search-result-copy">
                      <strong>{result.title}</strong>
                      <span>{result.subtitle}</span>
                    </span>
                    {result.meta && <span className="global-search-result-meta">{result.meta}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {remoteResults.length > 0 && (
            <div className="global-search-section">
              <div className="global-search-section-title">Search Results</div>
              {remoteResults.map((result, index) => {
                const flattenedIndex = quickActions.length + index
                const isActive = highlightedIndex === flattenedIndex
                return (
                  <button
                    key={result.id}
                    type="button"
                    className={`global-search-result${isActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setHighlightedIndex(flattenedIndex)}
                    onClick={() => handleSelect(result)}
                  >
                    <span className={`global-search-result-icon is-${result.kind}`}>
                      {iconForResult(result.kind)}
                    </span>
                    <span className="global-search-result-copy">
                      <strong>{result.title}</strong>
                      <span>{result.subtitle}</span>
                    </span>
                    {result.meta && (
                      <span className={`global-search-result-meta${result.tone ? ` tone-${result.tone}` : ''}`}>
                        {result.meta}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {loading && (
            <div className="global-search-empty">
              <div className="page-loading-spinner" aria-hidden="true" />
              Searching inventory...
            </div>
          )}

          {showEmptyState && (
            <div className="global-search-empty">
              No matching products, operations, or locations were found.
            </div>
          )}

          {!loading && quickActions.length === 0 && debouncedQuery.length > 0 && debouncedQuery.length < MIN_GLOBAL_SEARCH_CHARS && (
            <div className="global-search-empty">
              Type at least {MIN_GLOBAL_SEARCH_CHARS} characters to search inventory data.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
