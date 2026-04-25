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

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (docType)   params.set('documentType', docType)
    if (status)    params.set('status',        status)
    if (warehouse) params.set('warehouse',     warehouse)
    if (category)  params.set('category',      category)
    const s = params.toString()
    return s ? `?${s}` : ''
  }, [docType, status, warehouse, category])

  const loadDashboard = useCallback(async (showLoader = false) => {
    if (showLoader || !hasLoadedDashboardRef.current) {
      setLoading(true)
    }

    try {
      const [opts, raw, lowStockRows] = await Promise.all([
        apiRequest<DashboardFilterResponse>('/dashboard/filters', 'GET', token ?? undefined),
        apiRequest<Partial<KPIResponse> | null>(`/dashboard/kpis${query}`, 'GET', token ?? undefined),
        apiRequest<Product[]>('/products?lowStockOnly=true', 'GET', token ?? undefined),
      ])

      const nextFilters = {
        documentTypes: Array.isArray(opts?.documentTypes) ? opts.documentTypes : [],
        statuses: Array.isArray(opts?.statuses) ? opts.statuses : [],
        warehouses: Array.isArray(opts?.warehouses) ? opts.warehouses : [],
        categories: Array.isArray(opts?.categories) ? opts.categories : [],
      }
      setFilterOptions((previous) => (areDashboardFiltersEqual(previous, nextFilters) ? previous : nextFilters))

      const nextLowStock = Array.isArray(lowStockRows) ? lowStockRows : []
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
      pushToast('error', `Dashboard load failed: ${(error as Error).message}`)
    } finally {
      if (showLoader || !hasLoadedDashboardRef.current) {
        setLoading(false)
        hasLoadedDashboardRef.current = true
      }
    }
  }, [pushToast, query, token])

  useEffect(() => {
    void loadDashboard(!hasLoadedDashboardRef.current)
  }, [loadDashboard])

  useLivePolling(
    async () => {
      await loadDashboard(false)
    },
    {
      enabled: Boolean(token),
      immediate: false,
      intervalMs: LIVE_SYNC_INTERVAL_MS,
    },
  )

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
            { label: 'Document Type', value: docType,   set: setDocType,   opts: filterOptions.documentTypes },
            { label: 'Status',        value: status,    set: setStatus,    opts: filterOptions.statuses      },
            { label: 'Warehouse',     value: warehouse, set: setWarehouse, opts: filterOptions.warehouses    },
            { label: 'Category',      value: category,  set: setCategory,  opts: filterOptions.categories    },
          ].map(({ label, value, set, opts }) => (
            <div key={label} className="filter-group">
              <label className="filter-label">{label}</label>
              <select className="form-select" value={value} onChange={(e) => set(e.target.value)}>
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
            onClick={() => navigate('/products')}
          />
          <KpiCard
            label="Low / Out of Stock"
            value={kpis.lowOrOutOfStockItems}
            icon="alert"
            variant="warning"
            onClick={() => navigate('/products?lowStockOnly=true')}
          />
          <KpiCard
            label="Pending Receipts"
            value={kpis.pendingReceipts}
            icon="receipt"
            onClick={() => navigate('/operations/receipts?status=Waiting')}
          />
          <KpiCard
            label="Pending Deliveries"
            value={kpis.pendingDeliveries}
            icon="truck"
            onClick={() => navigate('/operations/deliveries?status=Waiting')}
          />
          <KpiCard
            label="Transfers Scheduled"
            value={kpis.scheduledInternalTransfers}
            icon="transfer"
            variant="success"
            onClick={() => navigate('/operations/transfers?status=Ready')}
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
