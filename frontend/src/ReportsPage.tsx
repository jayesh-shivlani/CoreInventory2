/**
 * Reports and analytics dashboard module.
 * Renders KPI widgets, charts, and CSV export actions.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { LIVE_SYNC_INTERVAL_MS } from './config/constants'
import { apiRequest } from './utils/helpers'
import { downloadCSV } from './utils/reports'
import type { AnalyticsOverview, Toast } from './types/models'

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

  const maxVal = Math.max(...data.map((d) => d.value), 1)
  const W = 680
  const H = 150
  const padL = 38
  const padR = 12
  const padT = 8
  const padB = 30
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const n = data.length
  // Keep bars readable for both short and long series by dynamically sizing step and bar width.
  const step = plotW / n
  const barW = Math.max(4, Math.min(28, step * 0.62))

  return (
    <div className="chart-shell" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {[0.25, 0.5, 0.75, 1].map((r) => {
        const y = padT + plotH * (1 - r)
        return (
          <g key={r}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--border)" strokeDasharray="3,3" />
            <text x={padL - 5} y={y + 4} textAnchor="end" fontSize="9" fill="var(--text-muted)">
              {Math.round(maxVal * r)}
            </text>
          </g>
        )
      })}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="var(--border)" />
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--border)" />
      {data.map((d, i) => {
        const bh = Math.max(2, (d.value / maxVal) * plotH)
        const x = padL + i * step + (step - barW) / 2
        const y = padT + plotH - bh
        const label = `${d.label}`
        const value = d.value.toLocaleString()
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={bh}
              fill={color}
              rx="2"
              opacity="0.85"
              className="rep-bar"
              onMouseMove={(evt) => {
                const bounds = (evt.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setHover({
                  x: evt.clientX - bounds.left + 12,
                  y: evt.clientY - bounds.top - 10,
                  label,
                  value,
                })
              }}
              onFocus={() => {
                setHover({
                  x: x + barW / 2,
                  y,
                  label,
                  value,
                })
              }}
              onBlur={() => setHover(null)}
              tabIndex={0}
            >
              <title>{d.label}: {d.value}</title>
            </rect>
            {n <= 20 && (
              <text
                x={x + barW / 2}
                y={H - padB + 13}
                textAnchor="middle"
                fontSize={n > 14 ? '7' : '8'}
                fill="var(--text-muted)"
              >
                {d.label.slice(-5)}
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
  const [active, setActive] = useState<number | null>(null)
  if (!data.length) return <div className="chart-empty">No category data.</div>
  const maxVal = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="hbars">
      {data.map((d, i) => (
        <div
          key={i}
          className={`hbar-row${active === i ? ' is-active' : ''}`}
        >
          <span className="hbar-label" title={d.label}>{d.label}</span>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{ width: `${Math.max((d.value / maxVal) * 100, 2)}%`, background: color }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              tabIndex={0}
            />
            {active === i && (
              <div className="hbar-tooltip">{d.value.toLocaleString()}</div>
            )}
          </div>
          <span className="hbar-val">{d.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export default function ReportsPage({
  token,
  pushToast,
}: {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}) {
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
      const resp = await apiRequest<AnalyticsOverview>('/analytics/overview', 'GET', token ?? undefined)
      setData(resp)
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      if (showLoader || !hasLoadedReportsRef.current) {
        setLoading(false)
        hasLoadedReportsRef.current = true
      }
    }
  }, [token, pushToast])

  useEffect(() => {
    void load(true)
    // Reports are heavier to query than dashboard tiles, so poll less frequently.
    const t = setInterval(() => { void load(false) }, LIVE_SYNC_INTERVAL_MS * 4)
    return () => clearInterval(t)
  }, [load])

  const movChart = (data?.dailyMovements ?? []).map((d) => ({
    label: d.date,
    value: d.total_quantity,
  }))

  const catChart = (data?.categoryBreakdown ?? []).map((c) => ({
    label: c.category,
    value: c.total_stock,
  }))

  const locChart = (data?.locationStock ?? []).map((l) => ({
    label: l.location_name,
    value: l.total_stock,
  }))

  const OP_COLORS: Record<string, string> = {
    Receipt: 'var(--success)',
    Delivery: 'var(--danger)',
    Internal: '#1565c0',
    Adjustment: 'var(--warning)',
  }

  const OP_BADGES: Record<string, string> = {
    Receipt: 'badge-done',
    Delivery: 'badge-canceled',
    Internal: 'badge-ready',
    Adjustment: 'badge-waiting',
  }

  const sortedReorderSuggestions = useMemo(() => {
    const list = data?.reorderSuggestions ?? []
    const copy = [...list]
    copy.sort((a, b) => {
      const urgencyA = a.current_stock <= 0 ? 0 : 1
      const urgencyB = b.current_stock <= 0 ? 0 : 1
      let cmp = 0
      if (reorderSortBy === 'product') cmp = a.name.localeCompare(b.name)
      else if (reorderSortBy === 'sku') cmp = a.sku.localeCompare(b.sku)
      else if (reorderSortBy === 'category') cmp = a.category.localeCompare(b.category)
      else if (reorderSortBy === 'current') cmp = a.current_stock - b.current_stock
      else if (reorderSortBy === 'reorder') cmp = a.reorder_minimum - b.reorder_minimum
      else if (reorderSortBy === 'urgency') cmp = urgencyA - urgencyB
      return reorderSortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [data?.reorderSuggestions, reorderSortBy, reorderSortDir])

  const sortedTopProducts = useMemo(() => {
    const list = data?.topProducts ?? []
    const copy = [...list]
    copy.sort((a, b) => {
      const statusA = a.total_stock <= a.reorder_minimum ? 0 : 1
      const statusB = b.total_stock <= b.reorder_minimum ? 0 : 1
      let cmp = 0
      if (topSortBy === 'product') cmp = a.name.localeCompare(b.name)
      else if (topSortBy === 'sku') cmp = a.sku.localeCompare(b.sku)
      else if (topSortBy === 'category') cmp = a.category.localeCompare(b.category)
      else if (topSortBy === 'uom') cmp = a.unit_of_measure.localeCompare(b.unit_of_measure)
      else if (topSortBy === 'stock') cmp = a.total_stock - b.total_stock
      else if (topSortBy === 'reorder') cmp = a.reorder_minimum - b.reorder_minimum
      else if (topSortBy === 'status') cmp = statusA - statusB
      return topSortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [data?.topProducts, topSortBy, topSortDir])

  const toggleReorderSort = (key: 'product' | 'sku' | 'category' | 'current' | 'reorder' | 'urgency') => {
    if (reorderSortBy === key) {
      setReorderSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setReorderSortBy(key)
    setReorderSortDir(key === 'urgency' ? 'asc' : 'desc')
  }

  const toggleTopSort = (key: 'product' | 'sku' | 'category' | 'uom' | 'stock' | 'reorder' | 'status') => {
    if (topSortBy === key) {
      setTopSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setTopSortBy(key)
    setTopSortDir(key === 'stock' ? 'desc' : 'asc')
  }

  const reorderSortMark = (key: 'product' | 'sku' | 'category' | 'current' | 'reorder' | 'urgency') => (
    reorderSortBy === key ? (reorderSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )
  const topSortMark = (key: 'product' | 'sku' | 'category' | 'uom' | 'stock' | 'reorder' | 'status') => (
    topSortBy === key ? (topSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )

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
            onClick={() => void downloadCSV('/export/products', 'core_inventory_products.csv', token, pushToast)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Products (CSV)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void downloadCSV('/export/ledger', 'core_inventory_ledger.csv', token, pushToast)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
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
            {loading ? '-' : (data?.operationStats.reduce((s, o) => s + o.total, 0) ?? 0)}
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
              : <BarChart
                  data={movChart}
                  emptyMsg="No stock movements in the last 30 days."
                />
            }
          </div>
        </div>

        <div className="reports-card">
          <div className="reports-card-head">
            <h3>Stock by Category</h3>
            <span className="reports-card-sub">Units on hand</span>
          </div>
          <div className="reports-card-body">
            {loading ? <div className="chart-empty">Loading...</div> : <HBars data={catChart} />}
          </div>
        </div>

        <div className="reports-card">
          <div className="reports-card-head">
            <h3>Stock by Location</h3>
            <span className="reports-card-sub">Internal locations only</span>
          </div>
          <div className="reports-card-body">
            {loading
              ? <div className="chart-empty">Loading...</div>
              : <HBars data={locChart} color="var(--accent)" />
            }
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
                {data.operationStats.map((op) => (
                  <div key={op.type} className="reports-ops-item">
                    <span className={`badge ${OP_BADGES[op.type] ?? 'badge-draft'} reports-ops-badge`}>
                      {op.type}
                    </span>
                    <div className="reports-ops-track">
                      <div
                        className="reports-ops-fill"
                        style={{
                          width: `${(op.done_count / Math.max(op.total, 1)) * 100}%`,
                          background: OP_COLORS[op.type] ?? 'var(--accent)',
                        }}
                        title={`${op.type}: ${op.done_count}/${op.total} done`}
                      />
                    </div>
                    <span className="reports-ops-value">{op.done_count}/{op.total} done</span>
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
                      const isOut = item.current_stock <= 0
                      return (
                        <tr key={item.id}>
                          <td><strong>{item.name}</strong></td>
                          <td>{item.sku}</td>
                          <td>{item.category}</td>
                          <td>
                            <strong style={{ color: isOut ? 'var(--danger)' : 'var(--warning)' }}>
                              {item.current_stock}
                            </strong>
                          </td>
                          <td>{item.reorder_minimum}</td>
                          <td>
                            <span className={`badge ${isOut ? 'badge-canceled' : 'badge-waiting'}`}>
                              {isOut ? 'Out of Stock' : 'Low Stock'}
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
                    {sortedTopProducts.map((p) => {
                      const isLow = p.total_stock <= p.reorder_minimum
                      return (
                        <tr key={p.id}>
                          <td><strong>{p.name}</strong></td>
                          <td>{p.sku}</td>
                          <td>{p.category}</td>
                          <td>{p.unit_of_measure}</td>
                          <td>{p.total_stock.toLocaleString()}</td>
                          <td>{p.reorder_minimum}</td>
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
