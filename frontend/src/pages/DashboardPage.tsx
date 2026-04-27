/**
 * Dashboard page.
 * Presents operational KPIs, filters, and low-stock alert summaries.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest, safeNumber } from '../utils/helpers'
import {
  areDashboardFiltersEqual,
  areKpisEqual,
  areProductsEqual,
} from '../utils/stability'
import KpiCard from '../components/KpiCard'
import SyncStatusChip from '../components/SyncStatusChip'
import { LIVE_SYNC_INTERVAL_MS } from '../config/constants'
import { useLivePolling } from '../hooks/useLivePolling'
import type { DashboardFilterResponse, KPIResponse, Product, Toast } from '../types/models'

interface Props {
  token:     string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}

export default function DashboardPage({ token, pushToast }: Props) {
  const navigate = useNavigate()
  const [loading, setLoading]   = useState(true)
  const [kpis, setKpis]         = useState<KPIResponse>({
    totalProductsInStock:       0,
    lowOrOutOfStockItems:       0,
    pendingReceipts:            0,
    pendingDeliveries:          0,
    scheduledInternalTransfers: 0,
  })
  const [docType,   setDocType]   = useState('')
  const [status,    setStatus]    = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [category,  setCategory]  = useState('')
  const [filterOptions, setFilterOptions] = useState<DashboardFilterResponse>({
    documentTypes: [], statuses: [], warehouses: [], categories: [],
  })
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([])
  const previousLowStockCount = useRef(0)
  const hasLoadedDashboardRef = useRef(false)
  const requestSeqRef = useRef(0)
  const activeAbortControllerRef = useRef<AbortController | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (docType)   params.set('documentType', docType)
    if (status)    params.set('status',        status)
    if (warehouse) params.set('warehouse',     warehouse)
    if (category)  params.set('category',      category)
    const s = params.toString()
    return s ? `?${s}` : ''
  }, [docType, status, warehouse, category])

  const lowStockQuery = useMemo(() => {
    const params = new URLSearchParams()
    params.set('lowStockOnly', 'true')
    params.set('limit', '200')
    if (category) params.set('category', category)
    if (warehouse) params.set('location', warehouse)
    return `?${params.toString()}`
  }, [category, warehouse])

  const loadDashboard = useCallback(async (showLoader = false) => {
    requestSeqRef.current += 1
    const requestId = requestSeqRef.current

    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort()
    }

    const controller = new AbortController()
    activeAbortControllerRef.current = controller

    if (showLoader || !hasLoadedDashboardRef.current) {
      setLoading(true)
    }

    try {
      const [opts, raw, lowStockRows] = await Promise.all([
        apiRequest<DashboardFilterResponse>('/dashboard/filters', 'GET', token ?? undefined, undefined, { signal: controller.signal }),
        apiRequest<Partial<KPIResponse> | null>(`/dashboard/kpis${query}`, 'GET', token ?? undefined, undefined, { signal: controller.signal }),
        apiRequest<{data: Product[], total: number}>(`/products${lowStockQuery}`, 'GET', token ?? undefined, undefined, { signal: controller.signal }),
      ])

      // Ignore stale responses from older request generations.
      if (requestId !== requestSeqRef.current || controller.signal.aborted) {
        return
      }

      const nextFilters = {
        documentTypes: Array.isArray(opts?.documentTypes) ? opts.documentTypes : [],
        statuses: Array.isArray(opts?.statuses) ? opts.statuses : [],
        warehouses: Array.isArray(opts?.warehouses) ? opts.warehouses.filter((name) => String(name || '').trim().length > 0) : [],
        categories: Array.isArray(opts?.categories) ? opts.categories : [],
      }
      setFilterOptions((previous) => (areDashboardFiltersEqual(previous, nextFilters) ? previous : nextFilters))

      const nextLowStock = Array.isArray(lowStockRows?.data) ? lowStockRows.data : []
      setLowStockProducts((previous) => (areProductsEqual(previous, nextLowStock) ? previous : nextLowStock))

      const latest = nextLowStock.length
      if (previousLowStockCount.current !== 0 && latest > previousLowStockCount.current) {
        pushToast('info', `Low stock alerts increased to ${latest}`)
      }
      previousLowStockCount.current = latest

      const data = (raw ?? {}) as Partial<KPIResponse>
      const nextKpis = {
        totalProductsInStock: safeNumber(data.totalProductsInStock),
        lowOrOutOfStockItems: safeNumber(data.lowOrOutOfStockItems),
        pendingReceipts: safeNumber(data.pendingReceipts),
        pendingDeliveries: safeNumber(data.pendingDeliveries),
        scheduledInternalTransfers: safeNumber(data.scheduledInternalTransfers),
      }
      setKpis((previous) => (areKpisEqual(previous, nextKpis) ? previous : nextKpis))
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return
      }
      pushToast('error', `Dashboard load failed: ${(error as Error).message}`)
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
      }
      if (showLoader || !hasLoadedDashboardRef.current) {
        setLoading(false)
        hasLoadedDashboardRef.current = true
      }
    }
  }, [lowStockQuery, pushToast, query, token])

  useEffect(() => {
    if (docType && !filterOptions.documentTypes.includes(docType)) {
      setDocType('')
    }
    if (status && !filterOptions.statuses.includes(status)) {
      setStatus('')
    }
    if (warehouse && !filterOptions.warehouses.includes(warehouse)) {
      setWarehouse('')
    }
    if (category && !filterOptions.categories.includes(category)) {
      setCategory('')
    }
  }, [category, docType, filterOptions, status, warehouse])

  useEffect(() => {
    void loadDashboard(!hasLoadedDashboardRef.current)
    return () => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort()
      }
    }
  }, [loadDashboard])

  useLivePolling(
    async () => {
      await loadDashboard(false)
    },
    {
      enabled: Boolean(token),
      immediate: false,
      intervalMs: LIVE_SYNC_INTERVAL_MS,
      backoffOnError: true,
      maxIntervalMs: 60_000,
    },
  )

  const buildProductsSearch = useCallback((includeLowStockOnly: boolean) => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (warehouse) params.set('location', warehouse)
    if (includeLowStockOnly) params.set('lowStockOnly', 'true')
    const serialized = params.toString()
    return serialized ? `?${serialized}` : ''
  }, [category, warehouse])

  const buildOperationsSearch = useCallback((defaultStatus: string | null = null) => {
    const params = new URLSearchParams()
    const nextStatus = status || defaultStatus
    if (nextStatus) params.set('status', nextStatus)
    if (warehouse) params.set('search', warehouse)
    const serialized = params.toString()
    return serialized ? `?${serialized}` : ''
  }, [status, warehouse])

  const goToProducts = useCallback(() => {
    navigate(`/products${buildProductsSearch(false)}`)
  }, [buildProductsSearch, navigate])

  const goToLowStockProducts = useCallback(() => {
    navigate(`/products${buildProductsSearch(true)}`)
  }, [buildProductsSearch, navigate])

  const goToPendingReceipts = useCallback(() => {
    navigate(`/operations/receipts${buildOperationsSearch(null)}`)
  }, [buildOperationsSearch, navigate])

  const goToPendingDeliveries = useCallback(() => {
    navigate(`/operations/deliveries${buildOperationsSearch(null)}`)
  }, [buildOperationsSearch, navigate])

  const goToPendingTransfers = useCallback(() => {
    navigate(`/operations/transfers${buildOperationsSearch(null)}`)
  }, [buildOperationsSearch, navigate])

  const activeFilters = [docType, status, warehouse, category].filter(Boolean).length

  return (
    <section className="dashboard-page">
      {/* -- Premium Hero -- */}
      <div className="dashboard-hero-premium">
        <div className="dashboard-hero-content">
          <h1>Inventory Overview</h1>
          <p>Real-time pulse of your warehouse operations</p>
        </div>
        <div className="dashboard-hero-stats">
          <div className="hero-stat-glass">
            <span className="hero-stat-label">Stock Risk</span>
            <strong className="hero-stat-value text-warning">{kpis.lowOrOutOfStockItems}</strong>
          </div>
          <div className="hero-stat-glass">
            <span className="hero-stat-label">Pending Work</span>
            <strong className="hero-stat-value">{kpis.pendingReceipts + kpis.pendingDeliveries + kpis.scheduledInternalTransfers}</strong>
          </div>
        </div>
      </div>

      {/* -- Sleek Filter Bar -- */}
      <div className="dashboard-filter-bar">
        <div className="list-header">
          <h2>Filters</h2>
          <span className="text-muted" style={{ fontSize: 11 }}>{activeFilters} active</span>
        </div>
        <div className="filters-row">
          {[
            { id: 'dashboard-filter-document-type', label: 'Document Type', value: docType, set: setDocType, opts: filterOptions.documentTypes },
            { id: 'dashboard-filter-status', label: 'Status', value: status, set: setStatus, opts: filterOptions.statuses },
            { id: 'dashboard-filter-warehouse', label: 'Warehouse', value: warehouse, set: setWarehouse, opts: filterOptions.warehouses },
            { id: 'dashboard-filter-category', label: 'Category', value: category, set: setCategory, opts: filterOptions.categories },
          ].map(({ id, label, value, set, opts }) => (
            <div key={label} className="filter-group">
              <label className="filter-label" htmlFor={id}>{label}</label>
              <select id={id} className="form-select" value={value} onChange={(e) => set(e.target.value)}>
                <option value="">All</option>
                {opts.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => { setDocType(''); setStatus(''); setWarehouse(''); setCategory('') }}
          disabled={activeFilters === 0}
        >
          Reset
        </button>
      </div>

      {/* -- KPI Cards -- */}
      <div>
        <div className="list-header dashboard-section-header" style={{ marginBottom: 16 }}>
          <h2>Operational Metrics</h2>
          <SyncStatusChip show={loading} />
        </div>
        <div className="kpi-grid">
          <KpiCard
            label="Total Products in Stock"
            value={kpis.totalProductsInStock}
            icon="box"
            onClick={goToProducts}
          />
          <KpiCard
            label="Low / Out of Stock"
            value={kpis.lowOrOutOfStockItems}
            icon="alert"
            variant="warning"
            onClick={goToLowStockProducts}
          />
          <KpiCard
            label="Pending Receipts"
            value={kpis.pendingReceipts}
            icon="receipt"
            onClick={goToPendingReceipts}
          />
          <KpiCard
            label="Pending Deliveries"
            value={kpis.pendingDeliveries}
            icon="truck"
            onClick={goToPendingDeliveries}
          />
          <KpiCard
            label="Transfers Scheduled"
            value={kpis.scheduledInternalTransfers}
            icon="transfer"
            variant="success"
            onClick={goToPendingTransfers}
          />
        </div>
      </div>

      {/* -- Low Stock Alerts -- */}
      {lowStockProducts.length > 0 && (
        <div className="low-stock-premium-card">
          <div className="low-stock-header">
            <h2>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2.5" width="18" height="18">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Low Stock Alerts
            </h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/products?lowStockOnly=true')}>
              View all {lowStockProducts.length}
            </button>
          </div>
          <div className="low-stock-list">
            {lowStockProducts.slice(0, 6).map((p) => (
              <div key={p.id} className="low-stock-item">
                <div className="low-stock-info">
                  <span className="low-stock-name">{p.name}</span>
                  <span className="low-stock-sku">SKU: {p.sku}</span>
                </div>
                <div className="low-stock-metrics">
                  <span className="text-muted" style={{ fontSize: 13 }}>Reorder min: {safeNumber(p.reorder_minimum)}</span>
                  <span className={`low-stock-pill ${safeNumber(p.availableStock) <= 0 ? 'out-of-stock' : ''}`}>
                    {safeNumber(p.availableStock)} on hand
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
