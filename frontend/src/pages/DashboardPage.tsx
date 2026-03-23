/**
 * Dashboard page.
 * Presents operational KPIs, filters, and low-stock alert summaries.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest, safeNumber } from '../utils/helpers'
import KpiCard from '../components/KpiCard'
import SyncStatusChip from '../components/SyncStatusChip'
import { LIVE_SYNC_INTERVAL_MS } from '../config/constants'
import type { DashboardFilterResponse, KPIResponse, Product, Toast } from '../types/models'

interface Props {
  token:     string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}

export default function DashboardPage({ token, pushToast }: Props) {
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

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (docType)   params.set('documentType', docType)
    if (status)    params.set('status',        status)
    if (warehouse) params.set('warehouse',     warehouse)
    if (category)  params.set('category',      category)
    const s = params.toString()
    return s ? `?${s}` : ''
  }, [docType, status, warehouse, category])

  useEffect(() => {
    let active = true

    const loadFilters = async () => {
      try {
        const opts = await apiRequest<DashboardFilterResponse>('/dashboard/filters', 'GET', token ?? undefined)
        if (active) {
          setFilterOptions({
            documentTypes: Array.isArray(opts?.documentTypes) ? opts.documentTypes : [],
            statuses:      Array.isArray(opts?.statuses)      ? opts.statuses      : [],
            warehouses:    Array.isArray(opts?.warehouses)    ? opts.warehouses    : [],
            categories:    Array.isArray(opts?.categories)    ? opts.categories    : [],
          })
        }
      } catch { /* keep defaults */ }
    }

    const load = async () => {
      setLoading(true)
      try {
        const [raw, lowStockRows] = await Promise.all([
          apiRequest<Partial<KPIResponse> | null>(`/dashboard/kpis${query}`, 'GET', token ?? undefined),
          apiRequest<Product[]>('/products?lowStockOnly=true',               'GET', token ?? undefined),
        ])

        const items = Array.isArray(lowStockRows) ? lowStockRows : []
        if (active) setLowStockProducts(items)

        const latest = items.length
        if (previousLowStockCount.current !== 0 && latest > previousLowStockCount.current) {
          pushToast('info', `Low stock alerts increased to ${latest}`)
        }
        previousLowStockCount.current = latest

        const data = ((raw ?? {}) as Partial<KPIResponse>)
        if (!active) return
        setKpis({
          totalProductsInStock:       safeNumber(data.totalProductsInStock),
          lowOrOutOfStockItems:       safeNumber(data.lowOrOutOfStockItems),
          pendingReceipts:            safeNumber(data.pendingReceipts),
          pendingDeliveries:          safeNumber(data.pendingDeliveries),
          scheduledInternalTransfers: safeNumber(data.scheduledInternalTransfers),
        })
      } catch (err) {
        pushToast('error', `Dashboard load failed: ${(err as Error).message}`)
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadFilters()
    void load()
    const timer = setInterval(() => { void load(); void loadFilters() }, LIVE_SYNC_INTERVAL_MS)
    return () => { active = false; clearInterval(timer) }
  }, [query, token, pushToast])

  const activeFilters = [docType, status, warehouse, category].filter(Boolean).length

  return (
    <section className="dashboard-page">
      {/* -- Filters -- */}
      <div className="dashboard-header-card">
        <div className="list-header dashboard-section-header">
          <h2>Dashboard Filters</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setDocType(''); setStatus(''); setWarehouse(''); setCategory('') }}
            disabled={activeFilters === 0}
          >
            Reset
          </button>
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
      </div>

      {/* -- Hero -- */}
      <div className="dashboard-hero-card">
        <div className="dashboard-title">Inventory Dashboard</div>
        <p className="dashboard-subtitle">Real-time status of inventory, operations, and transfer workload.</p>
        <div className="dashboard-meta-grid">
          <div className="dashboard-meta-item"><span>Filters Applied</span><strong>{activeFilters}</strong></div>
          <div className="dashboard-meta-item"><span>Pending Work</span><strong>{kpis.pendingReceipts + kpis.pendingDeliveries + kpis.scheduledInternalTransfers}</strong></div>
          <div className="dashboard-meta-item"><span>Stock Risk</span><strong>{kpis.lowOrOutOfStockItems}</strong></div>
        </div>
      </div>

      {/* -- KPI Cards -- */}
      <div className="dashboard-header-card">
        <div className="list-header dashboard-section-header">
          <h2>Operational Metrics</h2>
          <SyncStatusChip show={loading} />
        </div>
        <div className="kpi-grid">
          <KpiCard label="Total Products in Stock"   value={kpis.totalProductsInStock}       icon="box"      />
          <KpiCard label="Low / Out of Stock"        value={kpis.lowOrOutOfStockItems}        icon="alert"    variant="warning" />
          <KpiCard label="Pending Receipts"          value={kpis.pendingReceipts}             icon="receipt"  />
          <KpiCard label="Pending Deliveries"        value={kpis.pendingDeliveries}           icon="truck"    />
          <KpiCard label="Transfers Scheduled"       value={kpis.scheduledInternalTransfers} icon="transfer" variant="success" />
        </div>
      </div>

      {/* -- Low Stock Alerts -- */}
      {lowStockProducts.length > 0 && (
        <div className="dashboard-header-card low-stock-alert-card">
          <div className="list-header dashboard-section-header">
            <h2>Low Stock Alerts</h2>
            <span className="alert-count-pill">{lowStockProducts.length} product(s)</span>
          </div>
          <div className="low-stock-alert-list">
            {lowStockProducts.slice(0, 6).map((p) => (
              <div key={p.id} className="low-stock-alert-item">
                <strong>{p.name}</strong>
                <span>{p.sku}</span>
                <span>On hand {safeNumber(p.availableStock)} / Reorder min {safeNumber(p.reorder_minimum)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
