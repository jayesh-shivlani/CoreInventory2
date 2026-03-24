import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LIVE_SYNC_INTERVAL_MS } from '../config/constants'
import { useLivePolling } from '../hooks/useLivePolling'
import type { AnalyticsOverview, Toast } from '../types/models'
import { downloadFileFromApi } from '../utils/downloads'
import { apiRequest } from '../utils/helpers'
import { areAnalyticsOverviewsEqual } from '../utils/stability'

type HoverState = {
  x: number
  y: number
  label: string
  value: string
}

function BarChart({
  data,
  color = 'var(--accent)',
  emptyMsg = 'No data available.',
}: {
  data: Array<{ label: string; value: number }>
  color?: string
  emptyMsg?: string
}) {
  const [hover, setHover] = useState<HoverState | null>(null)
  if (!data.length) return <div className="chart-empty">{emptyMsg}</div>

  const maxVal = Math.max(...data.map((item) => item.value), 1)
  const width = 680
  const height = 150
  const padLeft = 38
  const padRight = 12
  const padTop = 8
  const padBottom = 30
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const step = plotWidth / data.length
  const barWidth = Math.max(4, Math.min(28, step * 0.62))

  return (
    <div className="chart-shell" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', display: 'block' }}>
        {[0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padTop + plotHeight * (1 - ratio)
          return (
            <g key={ratio}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="var(--border)" strokeDasharray="3,3" />
              <text x={padLeft - 5} y={y + 4} textAnchor="end" fontSize="9" fill="var(--text-muted)">
                {Math.round(maxVal * ratio)}
              </text>
            </g>
          )
        })}

        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotHeight} stroke="var(--border)" />
        <line x1={padLeft} y1={padTop + plotHeight} x2={width - padRight} y2={padTop + plotHeight} stroke="var(--border)" />

        {data.map((item, index) => {
          const barHeight = Math.max(2, (item.value / maxVal) * plotHeight)
          const x = padLeft + index * step + (step - barWidth) / 2
          const y = padTop + plotHeight - barHeight
          const value = item.value.toLocaleString()

          return (
            <g key={`${item.label}-${index}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={color}
                rx="2"
                opacity="0.85"
                className="rep-bar"
                onMouseMove={(event) => {
                  const bounds = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHover({
                    x: event.clientX - bounds.left + 12,
                    y: event.clientY - bounds.top - 10,
                    label: item.label,
                    value,
                  })
                }}
                onFocus={() => {
                  setHover({
                    x: x + barWidth / 2,
                    y,
                    label: item.label,
                    value,
                  })
                }}
                onBlur={() => setHover(null)}
                tabIndex={0}
              >
                <title>{item.label}: {item.value}</title>
              </rect>
              {data.length <= 20 && (
                <text
                  x={x + barWidth / 2}
                  y={height - padBottom + 13}
                  textAnchor="middle"
                  fontSize={data.length > 14 ? '7' : '8'}
                  fill="var(--text-muted)"
                >
                  {item.label.slice(-5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {hover && (
        <div className="chart-tooltip" style={{ left: hover.x, top: hover.y }}>
          <strong>{hover.label}</strong>
          <span>{hover.value}</span>
        </div>
      )}
    </div>
  )
}

function HBars({
  data,
  color = 'var(--accent)',
}: {
  data: Array<{ label: string; value: number }>
  color?: string
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (!data.length) return <div className="chart-empty">No category data.</div>

  const maxVal = Math.max(...data.map((item) => item.value), 1)

  return (
    <div className="hbars">
      {data.map((item, index) => (
        <div key={`${item.label}-${index}`} className={`hbar-row${activeIndex === index ? ' is-active' : ''}`}>
          <span className="hbar-label" title={item.label}>{item.label}</span>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{ width: `${Math.max((item.value / maxVal) * 100, 2)}%`, background: color }}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              tabIndex={0}
            />
            {activeIndex === index && (
              <div className="hbar-tooltip">{item.value.toLocaleString()}</div>
            )}
          </div>
          <span className="hbar-val">{item.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

type Props = {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}

export default function ReportsPage({ token, pushToast }: Props) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AnalyticsOverview | null>(null)
  const hasLoadedReportsRef = useRef(false)
  const [reorderSortBy, setReorderSortBy] = useState<'product' | 'sku' | 'category' | 'current' | 'reorder' | 'urgency'>('urgency')
  const [reorderSortDir, setReorderSortDir] = useState<'asc' | 'desc'>('asc')
  const [topSortBy, setTopSortBy] = useState<'product' | 'sku' | 'category' | 'uom' | 'stock' | 'reorder' | 'status'>('stock')
  const [topSortDir, setTopSortDir] = useState<'asc' | 'desc'>('desc')

  const load = useCallback(async (showLoader = false) => {
    if (showLoader || !hasLoadedReportsRef.current) {
      setLoading(true)
    }

    try {
      const response = await apiRequest<AnalyticsOverview>('/analytics/overview', 'GET', token ?? undefined)
      setData((previous) => (areAnalyticsOverviewsEqual(previous, response) ? previous : response))
    } catch (error) {
      pushToast('error', (error as Error).message)
    } finally {
      if (showLoader || !hasLoadedReportsRef.current) {
        setLoading(false)
        hasLoadedReportsRef.current = true
      }
    }
  }, [pushToast, token])

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
      intervalMs: LIVE_SYNC_INTERVAL_MS * 4,
    },
  )

  const movementChart = (data?.dailyMovements ?? []).map((item) => ({
    label: item.date,
    value: item.total_quantity,
  }))

  const categoryChart = (data?.categoryBreakdown ?? []).map((item) => ({
    label: item.category,
    value: item.total_stock,
  }))

  const locationChart = (data?.locationStock ?? []).map((item) => ({
    label: item.location_name,
    value: item.total_stock,
  }))

  const operationColors: Record<string, string> = {
    Receipt: 'var(--success)',
    Delivery: 'var(--danger)',
    Internal: '#1565c0',
    Adjustment: 'var(--warning)',
  }

  const operationBadges: Record<string, string> = {
    Receipt: 'badge-done',
    Delivery: 'badge-canceled',
    Internal: 'badge-ready',
    Adjustment: 'badge-waiting',
  }

  const sortedReorderSuggestions = useMemo(() => {
    const list = [...(data?.reorderSuggestions ?? [])]

    list.sort((left, right) => {
      const leftUrgency = left.current_stock <= 0 ? 0 : 1
      const rightUrgency = right.current_stock <= 0 ? 0 : 1
      let comparison = 0

      if (reorderSortBy === 'product') comparison = left.name.localeCompare(right.name)
      else if (reorderSortBy === 'sku') comparison = left.sku.localeCompare(right.sku)
      else if (reorderSortBy === 'category') comparison = left.category.localeCompare(right.category)
      else if (reorderSortBy === 'current') comparison = left.current_stock - right.current_stock
      else if (reorderSortBy === 'reorder') comparison = left.reorder_minimum - right.reorder_minimum
      else comparison = leftUrgency - rightUrgency

      return reorderSortDir === 'asc' ? comparison : -comparison
    })

    return list
  }, [data?.reorderSuggestions, reorderSortBy, reorderSortDir])

  const sortedTopProducts = useMemo(() => {
    const list = [...(data?.topProducts ?? [])]

    list.sort((left, right) => {
      const leftStatus = left.total_stock <= left.reorder_minimum ? 0 : 1
      const rightStatus = right.total_stock <= right.reorder_minimum ? 0 : 1
      let comparison = 0

      if (topSortBy === 'product') comparison = left.name.localeCompare(right.name)
      else if (topSortBy === 'sku') comparison = left.sku.localeCompare(right.sku)
      else if (topSortBy === 'category') comparison = left.category.localeCompare(right.category)
      else if (topSortBy === 'uom') comparison = left.unit_of_measure.localeCompare(right.unit_of_measure)
      else if (topSortBy === 'stock') comparison = left.total_stock - right.total_stock
      else if (topSortBy === 'reorder') comparison = left.reorder_minimum - right.reorder_minimum
      else comparison = leftStatus - rightStatus

      return topSortDir === 'asc' ? comparison : -comparison
    })

    return list
  }, [data?.topProducts, topSortBy, topSortDir])

  const reorderSortMark = (key: 'product' | 'sku' | 'category' | 'current' | 'reorder' | 'urgency') => (
    reorderSortBy === key ? (reorderSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )
  const topSortMark = (key: 'product' | 'sku' | 'category' | 'uom' | 'stock' | 'reorder' | 'status') => (
    topSortBy === key ? (topSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )

  const toggleReorderSort = (key: 'product' | 'sku' | 'category' | 'current' | 'reorder' | 'urgency') => {
    if (reorderSortBy === key) {
      setReorderSortDir((previous) => (previous === 'asc' ? 'desc' : 'asc'))
      return
    }

    setReorderSortBy(key)
    setReorderSortDir(key === 'urgency' ? 'asc' : 'desc')
  }

  const toggleTopSort = (key: 'product' | 'sku' | 'category' | 'uom' | 'stock' | 'reorder' | 'status') => {
    if (topSortBy === key) {
      setTopSortDir((previous) => (previous === 'asc' ? 'desc' : 'asc'))
      return
    }

    setTopSortBy(key)
    setTopSortDir(key === 'stock' ? 'desc' : 'asc')
  }

  const completedOps = (data?.operationStats ?? []).reduce((sum, item) => sum + item.done_count, 0)
  const totalOps = (data?.operationStats ?? []).reduce((sum, item) => sum + item.total, 0)
  const completionRate = totalOps > 0 ? Math.round((completedOps / totalOps) * 100) : 0
  const topLocation = data?.locationStock?.[0]
  const topCategory = data?.categoryBreakdown?.[0]

  return (
    <section className="reports-page reports-revamp">
      <div className="reports-hero">
        <div className="product-title-block">
          <h2>Reports &amp; Analytics</h2>
          <p>Stock movement trends, inventory health, and export tools for operational decisions.</p>
        </div>
        <div className="reports-actions">
          <button type="button" className="btn btn-primary" onClick={() => void load(true)}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void downloadFileFromApi('/export/products', 'core_inventory_products.csv', token, pushToast)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Products (CSV)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void downloadFileFromApi('/export/ledger', 'core_inventory_ledger.csv', token, pushToast)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Ledger (CSV)
          </button>
        </div>
      </div>

      <div className="reports-kpi-grid">
        <article className="reports-kpi-card">
          <div className="reports-kpi-value">{loading ? '-' : data?.totalMovements.toLocaleString()}</div>
          <div className="reports-kpi-label">Total Movements</div>
        </article>
        <article className="reports-kpi-card">
          <div className="reports-kpi-value">{loading ? '-' : data?.categoryBreakdown.length}</div>
          <div className="reports-kpi-label">Categories</div>
        </article>
        <article className="reports-kpi-card reports-kpi-card-warn">
          <div className="reports-kpi-value">{loading ? '-' : data?.reorderSuggestions.length}</div>
          <div className="reports-kpi-label">Need Reordering</div>
        </article>
        <article className="reports-kpi-card">
          <div className="reports-kpi-value">{loading ? '-' : data?.dailyMovements.length}</div>
          <div className="reports-kpi-label">Active Days (30d)</div>
        </article>
        <article className="reports-kpi-card">
          <div className="reports-kpi-value">
            {loading ? '-' : (data?.operationStats.reduce((sum, item) => sum + item.total, 0) ?? 0)}
          </div>
          <div className="reports-kpi-label">Ops (Last 30d)</div>
        </article>
      </div>

      <div className="reports-grid">
        <div className="reports-card reports-card-wide reports-card-chart">
          <div className="reports-card-head">
            <h3>Stock Movements - Last 30 Days</h3>
            <span className="reports-card-sub">Total units moved per day</span>
          </div>
          <div className="reports-card-body reports-chart-body">
            {loading
              ? <div className="chart-empty">Loading chart...</div>
              : <BarChart data={movementChart} emptyMsg="No stock movements in the last 30 days." />}
          </div>
        </div>

        <div className="reports-card">
          <div className="reports-card-head">
            <h3>Stock by Category</h3>
            <span className="reports-card-sub">Units on hand</span>
          </div>
          <div className="reports-card-body">
            {loading ? <div className="chart-empty">Loading...</div> : <HBars data={categoryChart} />}
          </div>
        </div>

        <div className="reports-card">
          <div className="reports-card-head">
            <h3>Stock by Location</h3>
            <span className="reports-card-sub">Internal locations only</span>
          </div>
          <div className="reports-card-body">
            {loading ? <div className="chart-empty">Loading...</div> : <HBars data={locationChart} color="var(--accent)" />}
          </div>
        </div>

        <div className="reports-card">
          <div className="reports-card-head">
            <h3>Insights Snapshot</h3>
            <span className="reports-card-sub">Quick view for this cycle</span>
          </div>
          <div className="reports-card-body">
            {loading ? (
              <div className="chart-empty">Loading...</div>
            ) : (
              <div className="reports-insight-list">
                <div className="reports-insight-item">
                  <span className="reports-insight-label">Operations completion</span>
                  <strong className="reports-insight-value">{completionRate}% ({completedOps}/{totalOps})</strong>
                </div>
                <div className="reports-insight-item">
                  <span className="reports-insight-label">Top stocked location</span>
                  <strong className="reports-insight-value">{topLocation ? `${topLocation.location_name} (${topLocation.total_stock.toLocaleString()})` : 'N/A'}</strong>
                </div>
                <div className="reports-insight-item">
                  <span className="reports-insight-label">Largest category</span>
                  <strong className="reports-insight-value">{topCategory ? `${topCategory.category} (${topCategory.total_stock.toLocaleString()})` : 'N/A'}</strong>
                </div>
                <div className="reports-insight-item">
                  <span className="reports-insight-label">Products needing reorder</span>
                  <strong className="reports-insight-value">{(data?.reorderSuggestions.length ?? 0).toLocaleString()}</strong>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="reports-card reports-card-ops">
          <div className="reports-card-head">
            <h3>Operations - Last 30 Days</h3>
            <span className="reports-card-sub">Completion by type</span>
          </div>
          <div className="reports-card-body">
            {loading ? (
              <div className="chart-empty">Loading...</div>
            ) : !(data?.operationStats.length) ? (
              <div className="chart-empty">No operations in the last 30 days.</div>
            ) : (
              <div className="reports-ops-list">
                {data.operationStats.map((operation) => (
                  <div key={operation.type} className="reports-ops-item">
                    <span className={`badge ${operationBadges[operation.type] ?? 'badge-draft'} reports-ops-badge`}>
                      {operation.type}
                    </span>
                    <div className="reports-ops-track">
                      <div
                        className="reports-ops-fill"
                        style={{
                          width: `${(operation.done_count / Math.max(operation.total, 1)) * 100}%`,
                          background: operationColors[operation.type] ?? 'var(--accent)',
                        }}
                        title={`${operation.type}: ${operation.done_count}/${operation.total} done`}
                      />
                    </div>
                    <span className="reports-ops-value">{operation.done_count}/{operation.total} done</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="reports-card reports-card-wide reports-card-warn">
          <div className="reports-card-head">
            <h3>Reorder Suggestions</h3>
            <div className="reports-card-meta">
              <span className="reports-card-sub">
                Products at or below reorder minimum - action required
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/products?lowStockOnly=true')}
              >
                Open in Products
              </button>
            </div>
          </div>
          <div className="reports-table-wrap">
            {loading ? (
              <div className="chart-empty">Loading...</div>
            ) : !(data?.reorderSuggestions.length) ? (
              <div className="chart-empty reports-table-empty">
                All products are above their reorder minimums. No action needed.
              </div>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleReorderSort('product')}>Product{reorderSortMark('product')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleReorderSort('sku')}>SKU{reorderSortMark('sku')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleReorderSort('category')}>Category{reorderSortMark('category')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleReorderSort('current')}>Current Stock{reorderSortMark('current')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleReorderSort('reorder')}>Reorder Min{reorderSortMark('reorder')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleReorderSort('urgency')}>Urgency{reorderSortMark('urgency')}</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReorderSuggestions.map((item) => {
                      const isOutOfStock = item.current_stock <= 0
                      return (
                        <tr key={item.id}>
                          <td><strong>{item.name}</strong></td>
                          <td>{item.sku}</td>
                          <td>{item.category}</td>
                          <td>
                            <strong style={{ color: isOutOfStock ? 'var(--danger)' : 'var(--warning)' }}>
                              {item.current_stock}
                            </strong>
                          </td>
                          <td>{item.reorder_minimum}</td>
                          <td>
                            <span className={`badge ${isOutOfStock ? 'badge-canceled' : 'badge-waiting'}`}>
                              {isOutOfStock ? 'Out of Stock' : 'Low Stock'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="reports-card reports-card-wide">
          <div className="reports-card-head">
            <h3>Top Products by On-Hand Stock</h3>
            <span className="reports-card-sub">Highest available inventory</span>
          </div>
          <div className="reports-table-wrap">
            {loading ? (
              <div className="chart-empty">Loading...</div>
            ) : !(data?.topProducts.length) ? (
              <div className="chart-empty reports-table-empty">No products found.</div>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleTopSort('product')}>Product{topSortMark('product')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleTopSort('sku')}>SKU{topSortMark('sku')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleTopSort('category')}>Category{topSortMark('category')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleTopSort('uom')}>UoM{topSortMark('uom')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleTopSort('stock')}>Stock{topSortMark('stock')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleTopSort('reorder')}>Reorder Min{topSortMark('reorder')}</button></th>
                      <th><button type="button" className="table-sort-btn" onClick={() => toggleTopSort('status')}>Status{topSortMark('status')}</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTopProducts.map((product) => {
                      const isLow = product.total_stock <= product.reorder_minimum
                      return (
                        <tr key={product.id}>
                          <td><strong>{product.name}</strong></td>
                          <td>{product.sku}</td>
                          <td>{product.category}</td>
                          <td>{product.unit_of_measure}</td>
                          <td>{product.total_stock.toLocaleString()}</td>
                          <td>{product.reorder_minimum}</td>
                          <td>
                            <span className={`badge ${isLow ? 'badge-waiting' : 'badge-done'}`}>
                              {isLow ? 'Low Stock' : 'In Stock'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
