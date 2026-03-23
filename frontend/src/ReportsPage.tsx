import { useEffect, useState, useCallback } from 'react'
import { API_BASE, LIVE_SYNC_INTERVAL_MS } from './config/constants'
import { apiRequest } from './utils/helpers'
import type { AnalyticsOverview, Toast } from './types/models'

export async function downloadCSV(
  path: string,
  filename: string,
  token: string | null,
  pushToast: (kind: Toast['kind'], text: string) => void,
) {
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    })
    if (!resp.ok) throw new Error('Export failed')
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    pushToast('success', `${filename} downloaded`)
  } catch {
    pushToast('error', 'Export failed - please try again.')
  }
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
  const step = plotW / n
  const barW = Math.max(4, Math.min(28, step * 0.62))

  return (
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
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} fill={color} rx="2" opacity="0.85">
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
  )
}

function HBars({
  data,
  color = 'var(--accent)',
}: {
  data: Array<{ label: string; value: number }>
  color?: string
}) {
  if (!data.length) return <div className="chart-empty">No category data.</div>
  const maxVal = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="hbars">
      {data.map((d, i) => (
        <div key={i} className="hbar-row">
          <span className="hbar-label" title={d.label}>{d.label}</span>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{ width: `${Math.max((d.value / maxVal) * 100, 2)}%`, background: color }}
            />
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
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AnalyticsOverview | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await apiRequest<AnalyticsOverview>('/analytics/overview', 'GET', token ?? undefined)
      setData(resp)
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, pushToast])

  useEffect(() => {
    void load()
    const t = setInterval(load, LIVE_SYNC_INTERVAL_MS * 4)
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
    Receipt: '#28a745',
    Delivery: '#dc3545',
    Internal: '#1565c0',
    Adjustment: '#e0802b',
  }

  return (
    <section className="reports-page">
      <div className="reports-header">
        <div className="product-title-block">
          <h2>Reports &amp; Analytics</h2>
          <p>Stock movement trends, inventory health, and export tools.</p>
        </div>
        <div className="reports-export-row">
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

      <div className="rep-kpi-grid">
        <article className="rep-kpi">
          <div className="rep-kpi-val">{loading ? '-' : data?.totalMovements.toLocaleString()}</div>
          <div className="rep-kpi-lbl">Total Movements</div>
        </article>
        <article className="rep-kpi">
          <div className="rep-kpi-val">{loading ? '-' : data?.categoryBreakdown.length}</div>
          <div className="rep-kpi-lbl">Categories</div>
        </article>
        <article className="rep-kpi rep-kpi-warn">
          <div className="rep-kpi-val">{loading ? '-' : data?.reorderSuggestions.length}</div>
          <div className="rep-kpi-lbl">Need Reordering</div>
        </article>
        <article className="rep-kpi">
          <div className="rep-kpi-val">{loading ? '-' : data?.dailyMovements.length}</div>
          <div className="rep-kpi-lbl">Active Days (30d)</div>
        </article>
        <article className="rep-kpi">
          <div className="rep-kpi-val">
            {loading ? '-' : (data?.operationStats.reduce((s, o) => s + o.total, 0) ?? 0)}
          </div>
          <div className="rep-kpi-lbl">Ops (Last 30d)</div>
        </article>
      </div>

      <div className="rep-grid">
        <div className="rep-card rep-card-wide">
          <div className="rep-card-hd">
            <h3>Stock Movements - Last 30 Days</h3>
            <span className="muted" style={{ fontSize: '12px' }}>Total units moved per day</span>
          </div>
          <div className="rep-card-body">
            {loading
              ? <div className="chart-empty">Loading chart...</div>
              : <BarChart
                  data={movChart}
                  emptyMsg="No stock movements in the last 30 days."
                />
            }
          </div>
        </div>

        <div className="rep-card">
          <div className="rep-card-hd">
            <h3>Stock by Category</h3>
            <span className="muted" style={{ fontSize: '12px' }}>Units on hand</span>
          </div>
          <div className="rep-card-body">
            {loading ? <div className="chart-empty">Loading...</div> : <HBars data={catChart} />}
          </div>
        </div>

        <div className="rep-card">
          <div className="rep-card-hd">
            <h3>Stock by Location</h3>
            <span className="muted" style={{ fontSize: '12px' }}>Internal locations only</span>
          </div>
          <div className="rep-card-body">
            {loading
              ? <div className="chart-empty">Loading...</div>
              : <HBars data={locChart} color="#1565c0" />
            }
          </div>
        </div>

        <div className="rep-card">
          <div className="rep-card-hd">
            <h3>Operations - Last 30 Days</h3>
            <span className="muted" style={{ fontSize: '12px' }}>Completion by type</span>
          </div>
          <div className="rep-card-body">
            {loading ? (
              <div className="chart-empty">Loading...</div>
            ) : !(data?.operationStats.length) ? (
              <div className="chart-empty">No operations in the last 30 days.</div>
            ) : (
              <div className="ops-stat-list">
                {data.operationStats.map((op) => (
                  <div key={op.type} className="ops-stat-item">
                    <span
                      className="ops-stat-badge"
                      style={{ background: OP_COLORS[op.type] ?? 'var(--accent)' }}
                    >
                      {op.type}
                    </span>
                    <div className="ops-stat-track">
                      <div
                        className="ops-stat-fill"
                        style={{
                          width: `${(op.done_count / Math.max(op.total, 1)) * 100}%`,
                          background: OP_COLORS[op.type] ?? 'var(--accent)',
                        }}
                      />
                    </div>
                    <span className="ops-stat-val">{op.done_count}/{op.total} done</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rep-card rep-card-wide rep-card-alert">
          <div className="rep-card-hd">
            <h3>Reorder Suggestions</h3>
            <span className="muted" style={{ fontSize: '12px' }}>
              Products at or below reorder minimum - action required
            </span>
          </div>
          <div className="rep-card-body" style={{ padding: 0 }}>
            {loading ? (
              <div className="chart-empty">Loading...</div>
            ) : !(data?.reorderSuggestions.length) ? (
              <div className="chart-empty" style={{ padding: '24px' }}>
                All products are above their reorder minimums. No action needed.
              </div>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Category</th>
                      <th>Current Stock</th>
                      <th>Reorder Min</th>
                      <th>Urgency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reorderSuggestions.map((item) => {
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

        <div className="rep-card rep-card-wide">
          <div className="rep-card-hd">
            <h3>Top Products by On-Hand Stock</h3>
            <span className="muted" style={{ fontSize: '12px' }}>Highest available inventory</span>
          </div>
          <div className="rep-card-body" style={{ padding: 0 }}>
            {loading ? (
              <div className="chart-empty">Loading...</div>
            ) : !(data?.topProducts.length) ? (
              <div className="chart-empty" style={{ padding: '24px' }}>No products found.</div>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Category</th>
                      <th>UoM</th>
                      <th>Stock</th>
                      <th>Reorder Min</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p) => {
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
