/**
 * Operations page.
 * Manages receipt, delivery, transfer, and adjustment operation workflows.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConfirm } from '../hooks/useConfirm'
import { useLivePolling } from '../hooks/useLivePolling'
import SyncStatusChip from '../components/SyncStatusChip'
import { hasElevatedAccess } from '../utils/authHelpers'
import { apiRequest, formatDate, toOperationKind } from '../utils/helpers'
import { areOperationsEqual, areProductsEqual, areWarehousesEqual } from '../utils/stability'
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
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get('search') ?? '')
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(location.search).get('status') ?? '')
  const [sortBy, setSortBy] = useState<'reference' | 'status' | 'source' | 'destination' | 'date'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [sourceLocation, setSourceLocation] = useState('')
  const [destinationLocation, setDestinationLocation] = useState('')
  const [lines, setLines] = useState<OperationDraftLine[]>([
    { product_id: '', requested_quantity: '0', picked_quantity: '0', packed_quantity: '0' },
  ])
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const locationSyncRef = useRef<{ search: string; status: string } | null>(null)

  const focusOperationId = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('focusOp')
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [location.search])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nextSearch = params.get('search') ?? ''
    const nextStatus = params.get('status') ?? ''
    locationSyncRef.current = { search: nextSearch, status: nextStatus }
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
      const nextOperations = Array.isArray(ops) ? ops : []
      const nextProducts = Array.isArray(prods) ? prods : []
      const nextLocations = Array.isArray(locs) ? locs : []
      setOperations((previous) => (areOperationsEqual(previous, nextOperations) ? previous : nextOperations))
      setProducts((previous) => (areProductsEqual(previous, nextProducts) ? previous : nextProducts))
      setLocations((previous) => (areWarehousesEqual(previous, nextLocations) ? previous : nextLocations))
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
  }, [load])

  useLivePolling(
    async () => {
      await load(false)
    },
    {
      enabled: Boolean(token),
      immediate: false,
      intervalMs: LIVE_SYNC_INTERVAL_MS,
    },
  )

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

  const operationGuidelines = useMemo(() => {
    if (operationType === 'Delivery') {
      return [
        ['Source warehouse', 'Dispatch only from an internal warehouse with confirmed stock availability.'],
        ['Customer destination', 'Select the customer location receiving stock before saving the draft.'],
        ['Requested quantity', 'Every line must have quantity greater than zero and match order intent.'],
        ['Picked and packed', 'Populate picked and packed values before validation for accurate fulfillment tracking.'],
        ['Validation timing', 'Validate only after all lines, locations, and fulfillment quantities are reviewed.'],
      ] as const
    }

    if (operationType === 'Internal') {
      return [
        ['Source location', 'Choose the internal location sending stock for the transfer.'],
        ['Destination location', 'Choose a different internal location receiving stock.'],
        ['Transfer quantities', 'All transfer quantities must be greater than zero.'],
        ['Stock checks', 'Confirm source stock sufficiency before validation to avoid operational errors.'],
        ['Final review', 'Validate only after location and line-level details are verified.'],
      ] as const
    }

    if (operationType === 'Adjustment') {
      return [
        ['Adjustment location', 'Select the internal location where inventory correction is applied.'],
        ['Corrected quantity', 'Enter corrected quantities per product line with careful review.'],
        ['Draft before validate', 'Use Save Draft when quantities require supervisor cross-checks.'],
        ['Audit impact', 'Adjustments directly affect stock history and should be treated as high-impact changes.'],
        ['Validation control', 'Validate only when discrepancy checks are complete and accurate.'],
      ] as const
    }

    return [
      ['Supplier source', 'Select the vendor warehouse providing the incoming stock.'],
      ['Receiving destination', 'Choose the internal warehouse where received stock will be stored.'],
      ['Received quantity', 'Enter received quantity for each line, always greater than zero.'],
      ['Discrepancy handling', 'Resolve any overage or shortage before final validation.'],
      ['Validation timing', 'Validate only after physical receiving checks are complete.'],
    ] as const
  }, [operationType])

  const isDelivery = operationType === 'Delivery'
  const needsSource = operationType === 'Delivery' || operationType === 'Internal'
  const needsDestination = operationType === 'Receipt' || operationType === 'Internal' || operationType === 'Delivery' || operationType === 'Adjustment'

  const sourceLocationOptions = useMemo(() => {
    if (operationType === 'Receipt') return locations.filter((loc) => loc.type === 'Vendor')
    if (operationType === 'Delivery') return locations.filter((loc) => loc.type === 'Internal')
    if (operationType === 'Internal') return locations.filter((loc) => loc.type === 'Internal')
    return []
  }, [locations, operationType])

  const destinationLocationOptions = useMemo(() => {
    if (operationType === 'Receipt') return locations.filter((loc) => loc.type === 'Internal')
    if (operationType === 'Delivery') return locations.filter((loc) => loc.type === 'Customer')
    if (operationType === 'Internal' || operationType === 'Adjustment') return locations.filter((loc) => loc.type === 'Internal')
    return []
  }, [locations, operationType])

  const guidelineAlerts = useMemo(() => {
    const alerts: string[] = []

    if (products.length === 0) {
      alerts.push('No products are available. Create products before validating an operation.')
    }

    if (operationType === 'Receipt' && sourceLocationOptions.length === 0) {
      alerts.push('No vendor warehouses found. Add a Vendor location to create receipts.')
    }

    if (needsSource && sourceLocationOptions.length === 0) {
      alerts.push('No valid source locations available for this operation type.')
    }

    if (needsDestination && destinationLocationOptions.length === 0) {
      alerts.push('No valid destination locations available for this operation type.')
    }

    return alerts
  }, [
    destinationLocationOptions.length,
    needsDestination,
    needsSource,
    operationType,
    products.length,
    sourceLocationOptions.length,
  ])

  const guidelineChecklist = useMemo(() => {
    const hasLine = lines.length > 0
    const hasProducts = lines.every((line) => Boolean(line.product_id))
    const quantitiesOk = lines.every((line) => {
      const qty = Number(line.requested_quantity)
      if (!Number.isFinite(qty) || qty < 0) return false
      return operationType === 'Adjustment' || qty > 0
    })

    return [
      ['Required locations selected', (!needsSource || Boolean(sourceLocation.trim())) && (!needsDestination || Boolean(destinationLocation.trim()))],
      ['At least one line added', hasLine],
      ['Products selected on all lines', hasProducts],
      ['Line quantities valid', quantitiesOk],
    ] as const
  }, [destinationLocation, lines, needsDestination, needsSource, operationType, sourceLocation])

  useEffect(() => {
    setSourceLocation((previous) => (
      previous && !sourceLocationOptions.some((loc) => loc.name === previous)
        ? ''
        : previous
    ))
  }, [sourceLocationOptions])

  useEffect(() => {
    setDestinationLocation((previous) => (
      previous && !destinationLocationOptions.some((loc) => loc.name === previous)
        ? ''
        : previous
    ))
  }, [destinationLocationOptions])

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

    if (operationType === 'Receipt' && !sourceLocation.trim()) {
      pushToast('error', 'Supplier (vendor warehouse) is required for receipts')
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
    if (operationType === 'Internal' && sourceLocation.trim() === destinationLocation.trim()) {
      pushToast('error', 'Source and destination must be different for internal transfers')
      return
    }

    setSaving(true)
    try {
      const created = await apiRequest<{ id: number }>('/operations', 'POST', token ?? undefined, {
        type: operationType,
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
    return operations.filter((op) => {
      const statusOk = !statusFilter || op.status === statusFilter
      if (!statusOk) return false
      if (!deferredSearch) return true
      const hay = [
        op.reference_number,
        op.source_location_name ?? '',
        op.destination_location_name ?? '',
        op.status,
      ].join(' ').toLowerCase()
      return hay.includes(deferredSearch)
    })
  }, [deferredSearch, operations, statusFilter])

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
    const pendingLocationSync = locationSyncRef.current
    if (pendingLocationSync) {
      const settled = search === pendingLocationSync.search && statusFilter === pendingLocationSync.status
      if (!settled) {
        return
      }

      locationSyncRef.current = null
    }

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
        <div className="operations-form-shell">
          <div className="operations-form-header">
            <h2>New {createLabel}</h2>
            <p>Enter location details and line items, then save as draft or validate.</p>
          </div>

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

          <div className="operation-form-grid">
            <div className="form-sheet operations-form-sheet">
              <div className="field-row" style={{ marginBottom: 12 }}>
                {operationType === 'Receipt' && (
                  <div className="field-group">
                    <label className="field-label">Supplier (Vendor Warehouse)</label>
                    <select
                      className="form-select"
                      value={sourceLocation}
                      onChange={(e) => setSourceLocation(e.target.value)}
                    >
                      <option value="" disabled hidden={!!sourceLocation}>Select vendor warehouse</option>
                      {sourceLocationOptions.map((loc) => (
                        <option key={loc.id} value={loc.name}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {needsSource && (
                  <div className="field-group">
                    <label className="field-label">Source Location</label>
                    <select className="form-select" value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)}>
                      <option value="" disabled hidden={!!sourceLocation}>
                        {operationType === 'Delivery' || operationType === 'Internal' ? 'Select source warehouse' : 'Select source'}
                      </option>
                      {sourceLocationOptions.map((loc) => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                    </select>
                  </div>
                )}
                {needsDestination && (
                  <div className="field-group">
                    <label className="field-label">Destination Location</label>
                    <select className="form-select" value={destinationLocation} onChange={(e) => setDestinationLocation(e.target.value)}>
                      <option value="" disabled hidden={!!destinationLocation}>
                        {operationType === 'Delivery'
                          ? 'Select customer location'
                          : 'Select destination warehouse'}
                      </option>
                      {destinationLocationOptions.map((loc) => (
                        <option
                          key={loc.id}
                          value={loc.name}
                          disabled={operationType === 'Internal' && sourceLocation === loc.name}
                        >
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="data-table-wrap operations-form-table-wrap">
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
              </div>

              <div className="operations-form-add-row">
                <button type="button" className="btn btn-secondary" onClick={addLine}>+ Add Line</button>
              </div>
            </div>

            <div className="panel-card operations-form-meta">
              <div className="panel-card-header">{createLabel} Guidelines</div>
              <div className="panel-card-body">
                {guidelineAlerts.length > 0 && (
                  <div className="warning-text operations-guideline-alert">
                    <strong>Readiness checks:</strong>
                    <ul className="operations-guideline-list">
                      {guidelineAlerts.map((alert) => (
                        <li key={alert}>{alert}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="info-item operations-guideline-checklist">
                  <dt>Pre-submit checklist</dt>
                  <dd>
                    <ul className="operations-guideline-list">
                      {guidelineChecklist.map(([label, done]) => (
                        <li
                          key={`${operationType}-${label}`}
                          className={done ? 'operations-guideline-done' : 'operations-guideline-pending'}
                        >
                          {done ? 'Done: ' : 'Pending: '}
                          {label}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>

                <div className="info-grid operations-guideline-grid">
                  {operationGuidelines.map(([dt, dd]) => (
                    <div key={`${operationType}-${dt}`} className="info-item"><dt>{dt}</dt><dd>{dd}</dd></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
