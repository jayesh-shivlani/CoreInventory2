/**
 * Move history page.
 * Displays stock ledger events with filtering and CSV export support.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiRequest, formatDate, safeNumber } from '../utils/helpers'
import SyncStatusChip from '../components/SyncStatusChip'
import { API_BASE, LIVE_SYNC_INTERVAL_MS } from '../config/constants'
import type { LedgerEntry, Toast } from '../types/models'

interface Props {
  token:     string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}

function downloadLedger(token: string | null, pushToast: Props['pushToast']) {
  void (async () => {
    try {
      const resp = await fetch(`${API_BASE}/export/ledger`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      })
      if (!resp.ok) throw new Error('Export failed')
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = 'core_inventory_ledger.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      pushToast('success', 'core_inventory_ledger.csv downloaded')
    } catch {
      pushToast('error', 'Export failed - please try again.')
    }
  })()
}

const TYPE_BADGE: Record<string, string> = {
  Receipt:    'badge-done',
  Delivery:   'badge-canceled',
  Internal:   'badge-ready',
  Adjustment: 'badge-waiting',
}

export default function MoveHistoryPage({ token, pushToast }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [search,     setSearch]     = useState('')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'product' | 'type' | 'from' | 'to' | 'quantity' | 'reference'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nextSearch = params.get('search') ?? ''
    const nextDateFrom = params.get('dateFrom') ?? ''
    const nextDateTo = params.get('dateTo') ?? ''
    const nextType = params.get('type') ?? ''

    setSearch((prev) => (prev === nextSearch ? prev : nextSearch))
    setDateFrom((prev) => (prev === nextDateFrom ? prev : nextDateFrom))
    setDateTo((prev) => (prev === nextDateTo ? prev : nextDateTo))
    setTypeFilter((prev) => (prev === nextType ? prev : nextType))
  }, [location.search])

  const activeFilters = [search.trim(), dateFrom, dateTo, typeFilter].filter(Boolean).length

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams()
    if (search.trim()) p.set('search',   search.trim())
    if (dateFrom)      p.set('dateFrom', dateFrom)
    if (dateTo)        p.set('dateTo',   dateTo)
    if (typeFilter)    p.set('type',     typeFilter)
    return p.toString() ? `?${p.toString()}` : ''
  }, [search, dateFrom, dateTo, typeFilter])

  const hasLoadedLedgerRef = useRef(false)

  const load = useCallback(async (showLoader = false) => {
    if (showLoader || !hasLoadedLedgerRef.current) {
      setLoading(true)
    }
    try {
      const data = await apiRequest<LedgerEntry[]>(`/ledger${buildQuery()}`, 'GET', token ?? undefined)
      setEntries(Array.isArray(data) ? data : [])
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      if (showLoader || !hasLoadedLedgerRef.current) {
        setLoading(false)
        hasLoadedLedgerRef.current = true
      }
    }
  }, [buildQuery, token, pushToast])

  useEffect(() => { void load(true) }, [load])
  useEffect(() => {
    const t = setInterval(() => { void load(false) }, LIVE_SYNC_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (typeFilter) params.set('type', typeFilter)

    const next = params.toString()
    const current = location.search.startsWith('?') ? location.search.slice(1) : location.search
    if (next !== current) {
      navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
    }
  }, [search, dateFrom, dateTo, typeFilter, location.pathname, location.search, navigate])

  const movedQty = useMemo(() => entries.reduce((s, e) => s + safeNumber(e.quantity), 0), [entries])

  const sortedEntries = useMemo(() => {
    const copy = [...entries]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'date') cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      else if (sortBy === 'product') cmp = String(a.product_name || '').localeCompare(String(b.product_name || ''))
      else if (sortBy === 'type') cmp = String(a.operation_type || '').localeCompare(String(b.operation_type || ''))
      else if (sortBy === 'from') cmp = String(a.from_location_name || '').localeCompare(String(b.from_location_name || ''))
      else if (sortBy === 'to') cmp = String(a.to_location_name || '').localeCompare(String(b.to_location_name || ''))
      else if (sortBy === 'quantity') cmp = safeNumber(a.quantity) - safeNumber(b.quantity)
      else if (sortBy === 'reference') cmp = String(a.reference_number || '').localeCompare(String(b.reference_number || ''))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [entries, sortBy, sortDir])

  const toggleSort = (key: 'date' | 'product' | 'type' | 'from' | 'to' | 'quantity' | 'reference') => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(key)
    setSortDir(key === 'date' ? 'desc' : 'asc')
  }

  const sortMark = (key: 'date' | 'product' | 'type' | 'from' | 'to' | 'quantity' | 'reference') => (
    sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )

  return (
    <section className="move-history-page">
      <div className="operations-overview">
        <div className="operations-overview-top">
          <div className="product-title-block">
            <h2>Move History</h2>
            <p>Chronological stock ledger for every validated movement.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => downloadLedger(token, pushToast)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        </div>
        <div className="product-stats-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
          {[
            ['Ledger Entries', entries.length],
            ['Units Moved',    movedQty],
            ['Active Filters', activeFilters],
            ['Max Rows',       1000],
          ].map(([label, value]) => (
            <article key={label as string} className="product-stat-card">
              <div className="product-stat-label">{label}</div>
              <div className="product-stat-value">{Number(value).toLocaleString()}</div>
            </article>
          ))}
        </div>
      </div>

      {/* -- Filters -- */}
      <div className="list-card">
        <div className="list-header">
          <h2>Filter Movements</h2>
          <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setTypeFilter('') }} disabled={activeFilters === 0}>
            Reset
          </button>
        </div>
        <div className="ledger-filter-grid">
          <div className="filter-group">
            <label className="filter-label">Search product / reference</label>
            <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Steel Rods or RCV-000012" style={{ minHeight: 36 }} />
          </div>
          <div className="filter-group">
            <label className="filter-label">Operation type</label>
            <select className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="Receipt">Receipt</option>
              <option value="Delivery">Delivery</option>
              <option value="Internal">Internal Transfer</option>
              <option value="Adjustment">Adjustment</option>
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">From date</label>
            <input className="form-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="filter-group">
            <label className="filter-label">To date</label>
            <input className="form-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* -- Table -- */}
      <div className="list-card">
        <div className="list-header">
          <h2>Stock Ledger</h2>
          <div className="list-header-meta">
            <p className="muted">Auto-refreshed · Max 1,000 rows per query.</p>
            <SyncStatusChip show={loading && entries.length > 0} />
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('date')}>Date &amp; Time{sortMark('date')}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('product')}>Product{sortMark('product')}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('type')}>Type{sortMark('type')}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('from')}>From{sortMark('from')}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('to')}>To{sortMark('to')}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('quantity')}>Quantity{sortMark('quantity')}</button></th>
                <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('reference')}>Reference{sortMark('reference')}</button></th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading && !entries.length && <tr className="empty-row"><td colSpan={8}>Loading ledger...</td></tr>}
              {!loading && !entries.length && (
                <tr className="empty-row">
                  <td colSpan={8}>
                    {activeFilters > 0 ? 'No entries match the current filters.' : 'No stock movements have been recorded yet.'}
                  </td>
                </tr>
              )}
              {sortedEntries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.timestamp)}</td>
                  <td><strong>{e.product_name}</strong></td>
                  <td>
                    {e.operation_type
                      ? <span className={`badge ${TYPE_BADGE[e.operation_type] ?? 'badge-draft'}`}>{e.operation_type}</span>
                      : <span className="muted">-</span>
                    }
                  </td>
                  <td>{e.from_location_name ?? '-'}</td>
                  <td>{e.to_location_name   ?? '-'}</td>
                  <td><strong>{e.quantity}</strong></td>
                  <td>{e.reference_number ?? '-'}</td>
                  <td><span className="muted" style={{ fontSize: 12 }}>{e.note ?? '-'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
