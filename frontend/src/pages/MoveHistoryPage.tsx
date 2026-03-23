/**
 * Move history page.
 * Displays stock ledger events with filtering and CSV export support.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [search,     setSearch]     = useState('')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const activeFilters = [search.trim(), dateFrom, dateTo, typeFilter].filter(Boolean).length

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams()
    if (search.trim()) p.set('search',   search.trim())
    if (dateFrom)      p.set('dateFrom', dateFrom)
    if (dateTo)        p.set('dateTo',   dateTo)
    if (typeFilter)    p.set('type',     typeFilter)
    return p.toString() ? `?${p.toString()}` : ''
  }, [search, dateFrom, dateTo, typeFilter])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiRequest<LedgerEntry[]>(`/ledger${buildQuery()}`, 'GET', token ?? undefined)
      setEntries(Array.isArray(data) ? data : [])
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [buildQuery, token, pushToast])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const t = setInterval(load, LIVE_SYNC_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load])

  const movedQty = useMemo(() => entries.reduce((s, e) => s + safeNumber(e.quantity), 0), [entries])

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
                <th>Date &amp; Time</th>
                <th>Product</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Quantity</th>
                <th>Reference</th>
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
              {entries.map((e) => (
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
