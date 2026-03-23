/**
 * Operations page.
 * Manages receipt, delivery, transfer, and adjustment operation workflows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConfirm } from '../hooks/useConfirm'
import SyncStatusChip from '../components/SyncStatusChip'
import { hasElevatedAccess } from '../utils/authHelpers'
import { apiRequest, formatDate, toOperationKind } from '../utils/helpers'
import { LIVE_SYNC_INTERVAL_MS } from '../config/constants'
import type { Operation, OperationDraftLine, Product, Toast, UserProfile, Warehouse } from '../types/models'

type Props = {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
  currentUser: UserProfile | null
}

export default function OperationsPage({ token, pushToast, currentUser }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const { modal, confirm } = useConfirm()
  const operationType = toOperationKind(location.pathname)
  const canDelete = hasElevatedAccess(currentUser)

  const [viewMode, setViewMode] = useState<'list' | 'form'>('list')
  const [operations, setOperations] = useState<Operation[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [locations, setLocations] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [focusedOperationId, setFocusedOperationId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState<'reference' | 'status' | 'source' | 'destination' | 'date'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [supplier, setSupplier] = useState('')
  const [sourceLocation, setSourceLocation] = useState('')
  const [destinationLocation, setDestinationLocation] = useState('')
  const [lines, setLines] = useState<OperationDraftLine[]>([
    { product_id: '', requested_quantity: '0', picked_quantity: '0', packed_quantity: '0' },
  ])

  const focusOperationId = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('focusOp')
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [location.search])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nextSearch = params.get('search') ?? ''
    const nextStatus = params.get('status') ?? ''
    setSearch((prev) => (prev === nextSearch ? prev : nextSearch))
    setStatusFilter((prev) => (prev === nextStatus ? prev : nextStatus))
  }, [location.search])

  const hasLoadedOperationsRef = useRef(false)

  const load = useCallback(async (showLoader = false) => {
    if (showLoader || !hasLoadedOperationsRef.current) {
      setLoading(true)
    }
    try {
      const [ops, prods, locs] = await Promise.all([
        apiRequest<Operation[]>(`/operations?type=${operationType}`, 'GET', token ?? undefined),
        apiRequest<Product[]>('/products', 'GET', token ?? undefined),
        apiRequest<Warehouse[]>('/locations', 'GET', token ?? undefined),
      ])
      setOperations(Array.isArray(ops) ? ops : [])
      setProducts(Array.isArray(prods) ? prods : [])
      setLocations(Array.isArray(locs) ? locs : [])
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      if (showLoader || !hasLoadedOperationsRef.current) {
        setLoading(false)
        hasLoadedOperationsRef.current = true
      }
    }
  }, [operationType, token, pushToast])

  useEffect(() => {
    void load(true)
    const timer = setInterval(() => {
      void load(false)
    }, LIVE_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!focusOperationId) return
    if (viewMode !== 'list') {
      setViewMode('list')
      return
    }
    if (!operations.some((op) => op.id === focusOperationId)) return

    setFocusedOperationId(focusOperationId)
    const rafId = window.requestAnimationFrame(() => {
      const row = document.getElementById(`operation-row-${focusOperationId}`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const timer = window.setTimeout(() => setFocusedOperationId(null), 2600)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(timer)
    }
  }, [focusOperationId, operations, viewMode])

  const resetDraft = () => {
    setSupplier('')
    setSourceLocation('')
    setDestinationLocation('')
    setLines([{ product_id: '', requested_quantity: '0', picked_quantity: '0', packed_quantity: '0' }])
  }

  const opLabel = useMemo(() => {
    if (operationType === 'Delivery') return 'Delivery Orders'
    if (operationType === 'Internal') return 'Internal Transfers'
    if (operationType === 'Adjustment') return 'Inventory Adjustments'
    return 'Receipts'
  }, [operationType])

  const createLabel = useMemo(() => {
    if (operationType === 'Delivery') return 'Delivery Order'
    if (operationType === 'Internal') return 'Internal Transfer'
    if (operationType === 'Adjustment') return 'Inventory Adjustment'
    return 'Receipt'
  }, [operationType])

  const isDelivery = operationType === 'Delivery'
  const needsSource = operationType === 'Delivery' || operationType === 'Internal'
  const needsDestination = operationType === 'Internal' || operationType === 'Delivery' || operationType === 'Adjustment'

  const updateLine = (index: number, patch: Partial<OperationDraftLine>) => {
    setLines((prev) => prev.map((line, i) => {
      if (i !== index) return line
      return { ...line, ...patch }
    }))
  }

  const addLine = () => {
    setLines((prev) => [...prev, { product_id: '', requested_quantity: '0', picked_quantity: '0', packed_quantity: '0' }])
  }

  const removeLine = (index: number) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  const submit = async (validateNow: boolean) => {
    if (!lines.length) {
      pushToast('error', 'Add at least one line')
      return
    }

    for (const line of lines) {
      if (!line.product_id) {
        pushToast('error', 'Select a product for each line')
        return
      }
      const requested = Number(line.requested_quantity)
      if (!Number.isFinite(requested) || requested < 0) {
        pushToast('error', 'Quantities must be non-negative numbers')
        return
      }
      if (operationType !== 'Adjustment' && requested <= 0) {
        pushToast('error', 'Quantity must be greater than zero')
        return
      }
    }

    if (operationType === 'Receipt' && !supplier.trim()) {
      pushToast('error', 'Supplier is required for receipts')
      return
    }
    if (needsSource && !sourceLocation.trim()) {
      pushToast('error', 'Source location is required')
      return
    }
    if (needsDestination && !destinationLocation.trim()) {
      pushToast('error', 'Destination location is required')
      return
    }

    setSaving(true)
    try {
      const created = await apiRequest<{ id: number }>('/operations', 'POST', token ?? undefined, {
        type: operationType,
        supplier: supplier || undefined,
        source_location: sourceLocation || undefined,
        destination_location: destinationLocation || undefined,
        lines: lines.map((line) => ({
          product_id: Number(line.product_id),
          requested_quantity: Number(line.requested_quantity),
          picked_quantity: Number(line.picked_quantity ?? 0),
          packed_quantity: Number(line.packed_quantity ?? 0),
        })),
      })

      if (validateNow) {
        await apiRequest(`/operations/${created.id}/validate`, 'POST', token ?? undefined)
        pushToast('success', `${createLabel} validated`)
      } else {
        pushToast('success', `${createLabel} saved as draft`)
      }

      resetDraft()
      setViewMode('list')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const validateOperation = async (id: number) => {
    try {
      await apiRequest(`/operations/${id}/validate`, 'POST', token ?? undefined)
      pushToast('success', 'Operation validated')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const updateStatus = async (id: number, nextStatus: 'Draft' | 'Waiting' | 'Ready' | 'Canceled') => {
    try {
      await apiRequest(`/operations/${id}/status`, 'POST', token ?? undefined, { status: nextStatus })
      pushToast('success', `Status changed to ${nextStatus}`)
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const deleteOperation = async (id: number) => {
    if (!canDelete) {
      pushToast('error', 'Only admin-approved roles can delete operations')
      return
    }
    const ok = await confirm('Delete this operation?', 'This will permanently remove the draft operation.')
    if (!ok) return
    try {
      await apiRequest(`/operations/${id}`, 'DELETE', token ?? undefined)
      pushToast('success', 'Operation deleted')
      await load()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const nextStatuses = (status: Operation['status']): Array<'Draft' | 'Waiting' | 'Ready' | 'Canceled'> => {
    if (status === 'Draft') return ['Waiting', 'Ready', 'Canceled']
    if (status === 'Waiting') return ['Ready', 'Canceled']
    if (status === 'Ready') return ['Waiting', 'Canceled']
    if (status === 'Canceled') return ['Draft']
    return []
  }

  const filteredOperations = useMemo(() => {
    const query = search.trim().toLowerCase()
    return operations.filter((op) => {
      const statusOk = !statusFilter || op.status === statusFilter
      if (!statusOk) return false
      if (!query) return true
      const hay = [
        op.reference_number,
        op.source_location_name ?? '',
        op.destination_location_name ?? '',
        op.status,
      ].join(' ').toLowerCase()
      return hay.includes(query)
    })
  }, [operations, search, statusFilter])

  const sortedOperations = useMemo(() => {
    const rank: Record<Operation['status'], number> = {
      Draft: 1,
      Waiting: 2,
      Ready: 3,
      Done: 4,
      Canceled: 5,
    }

    const copy = [...filteredOperations]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'reference') cmp = a.reference_number.localeCompare(b.reference_number)
      else if (sortBy === 'status') cmp = (rank[a.status] ?? 99) - (rank[b.status] ?? 99)
      else if (sortBy === 'source') cmp = String(a.source_location_name || '').localeCompare(String(b.source_location_name || ''))
      else if (sortBy === 'destination') cmp = String(a.destination_location_name || '').localeCompare(String(b.destination_location_name || ''))
      else if (sortBy === 'date') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filteredOperations, sortBy, sortDir])

  const toggleSort = (key: 'reference' | 'status' | 'source' | 'destination' | 'date') => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(key)
    setSortDir(key === 'date' ? 'desc' : 'asc')
  }

  const sortMark = (key: 'reference' | 'status' | 'source' | 'destination' | 'date') => (
    sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )

  const activeFilters = [search.trim(), statusFilter].filter(Boolean).length

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (search.trim()) params.set('search', search.trim())
    else params.delete('search')
    if (statusFilter) params.set('status', statusFilter)
    else params.delete('status')

    const next = params.toString()
    const current = location.search.startsWith('?') ? location.search.slice(1) : location.search
    if (next !== current) {
      navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
    }
  }, [search, statusFilter, location.pathname, location.search, navigate])

  return (
    <section>
      {modal}
      {viewMode === 'list' && (
        <div className="list-card">
          <div className="list-header">
            <h2>{opLabel}</h2>
            <div className="list-header-meta">
              <SyncStatusChip show={loading && operations.length > 0} />
              <button type="button" className="btn btn-primary" onClick={() => { resetDraft(); setViewMode('form') }}>
                + New {createLabel}
              </button>
            </div>
          </div>
          <div className="ledger-filter-grid" style={{ marginBottom: 14 }}>
            <div className="filter-group">
              <label className="filter-label">Search</label>
              <input
                className="search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Reference or location"
              />
            </div>
            <div className="filter-group">
              <label className="filter-label">Status</label>
              <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="Draft">Draft</option>
                <option value="Waiting">Waiting</option>
                <option value="Ready">Ready</option>
                <option value="Done">Done</option>
                <option value="Canceled">Canceled</option>
              </select>
            </div>
            <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
              <label className="filter-label" style={{ visibility: 'hidden' }}>Reset</label>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setSearch(''); setStatusFilter('') }}
                disabled={activeFilters === 0}
              >
                Reset
              </button>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('reference')}>Reference{sortMark('reference')}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('status')}>Status{sortMark('status')}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('source')}>Source{sortMark('source')}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('destination')}>Destination{sortMark('destination')}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('date')}>Date{sortMark('date')}</button></th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && sortedOperations.length === 0 && <tr className="empty-row"><td colSpan={6}>Loading...</td></tr>}
                {!loading && sortedOperations.length === 0 && <tr className="empty-row"><td colSpan={6}>No operations match the current filters</td></tr>}
                {sortedOperations.map((op) => (
                  <tr
                    key={op.id}
                    id={`operation-row-${op.id}`}
                    className={focusedOperationId === op.id ? 'row-focus' : undefined}
                  >
                    <td><strong>{op.reference_number}</strong></td>
                    <td><span className={`badge badge-${op.status.toLowerCase()}`}>{op.status}</span></td>
                    <td>{op.source_location_name ?? '-'}</td>
                    <td>{op.destination_location_name ?? '-'}</td>
                    <td>{formatDate(op.created_at)}</td>
                    <td>
                      <div className="operation-row-actions">
                        {op.status !== 'Done' && op.status !== 'Canceled' && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void validateOperation(op.id) }}>
                            Validate
                          </button>
                        )}
                        {nextStatuses(op.status).map((status) => (
                          <button
                            key={`${op.id}-${status}`}
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { void updateStatus(op.id, status) }}
                          >
                            {status}
                          </button>
                        ))}
                        {op.status !== 'Done' && canDelete && (
                          <button type="button" className="btn-icon" onClick={() => { void deleteOperation(op.id) }} title="Delete operation">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
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
      )}

      {viewMode === 'form' && (
        <div className="form-sheet">
          <div className="control-bar">
            <div className="control-bar-left">
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => { void submit(false) }}>
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button type="button" className="btn btn-success" disabled={saving} onClick={() => { void submit(true) }}>
                {saving ? 'Validating...' : 'Validate'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('list')}>Back</button>
            </div>
          </div>

          <div className="field-row" style={{ marginBottom: 12 }}>
            {operationType === 'Receipt' && (
              <div className="field-group">
                <label className="field-label">Supplier</label>
                <input className="form-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </div>
            )}
            {needsSource && (
              <div className="field-group">
                <label className="field-label">Source Location</label>
                <select className="form-select" value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)}>
                  <option value="">Select source</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                </select>
              </div>
            )}
            {needsDestination && (
              <div className="field-group">
                <label className="field-label">Destination Location</label>
                <select className="form-select" value={destinationLocation} onChange={(e) => setDestinationLocation(e.target.value)}>
                  <option value="">Select destination</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                {isDelivery && <th>Picked</th>}
                {isDelivery && <th>Packed</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td>
                    <select className="form-select" value={line.product_id} onChange={(e) => updateLine(idx, { product_id: e.target.value })}>
                      <option value="">Select product</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="form-input" type="number" min={0} value={line.requested_quantity} onChange={(e) => updateLine(idx, { requested_quantity: e.target.value })} />
                  </td>
                  {isDelivery && (
                    <td>
                      <input className="form-input" type="number" min={0} value={line.picked_quantity ?? '0'} onChange={(e) => updateLine(idx, { picked_quantity: e.target.value })} />
                    </td>
                  )}
                  {isDelivery && (
                    <td>
                      <input className="form-input" type="number" min={0} value={line.packed_quantity ?? '0'} onChange={(e) => updateLine(idx, { packed_quantity: e.target.value })} />
                    </td>
                  )}
                  <td>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeLine(idx)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={addLine}>+ Add Line</button>
          </div>
        </div>
      )}
    </section>
  )
}
