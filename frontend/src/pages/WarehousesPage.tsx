/**
 * Warehouses page.
 * Handles location listing, creation, and deletion workflows.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { apiRequest, safeNumber } from '../utils/helpers'
import { hasElevatedAccess } from '../utils/authHelpers'
import { useConfirm } from '../hooks/useConfirm'
import { useLivePolling } from '../hooks/useLivePolling'
import SyncStatusChip from '../components/SyncStatusChip'
import { LIVE_SYNC_INTERVAL_MS } from '../config/constants'
import { areWarehousesEqual } from '../utils/stability'
import type {
  PaginatedWarehouseInventoryResponse,
  Toast,
  UserProfile,
  Warehouse,
  WarehouseInventoryRow,
} from '../types/models'

interface Props {
  token:       string | null
  pushToast:   (kind: Toast['kind'], text: string) => void
  currentUser: UserProfile | null
}

export default function WarehousesPage({ token, pushToast, currentUser }: Props) {
  const { modal, confirm } = useConfirm()
  // Warehouses are mutable only for elevated roles; everyone else remains read-only.
  const canManage = hasElevatedAccess(currentUser)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading,    setLoading]    = useState(true)
  const [name, setName] = useState('')
  const [type, setType] = useState('Internal')
  const [expandedLocationId, setExpandedLocationId] = useState<number | null>(null)
  const [inventoryLoadingId, setInventoryLoadingId] = useState<number | null>(null)
  const [locationInventory, setLocationInventory] = useState<Record<number, WarehouseInventoryRow[]>>({})
  const [inventoryPageByLocation, setInventoryPageByLocation] = useState<Record<number, number>>({})
  const [inventoryTotalByLocation, setInventoryTotalByLocation] = useState<Record<number, number>>({})
  const INVENTORY_LIMIT = 15
  const [inventorySearchByLocation, setInventorySearchByLocation] = useState<Record<number, string>>({})
  const [adjustingKey, setAdjustingKey] = useState<string | null>(null)
  const [warehouseSortBy, setWarehouseSortBy] = useState<'name' | 'type'>('name')
  const [warehouseSortDir, setWarehouseSortDir] = useState<'asc' | 'desc'>('asc')
  const [inventorySortByLocation, setInventorySortByLocation] = useState<Record<number, { key: 'product' | 'sku' | 'quantity' | 'uom' | 'reorder' | 'status'; dir: 'asc' | 'desc' }>>({})

  const hasLoadedWarehousesRef = useRef(false)

  const load = useCallback(async (showLoader = false) => {
    if (showLoader || !hasLoadedWarehousesRef.current) {
      setLoading(true)
    }
    try {
      const data = await apiRequest<Warehouse[]>('/locations', 'GET', token ?? undefined)
      const nextWarehouses = Array.isArray(data) ? data : []
      setWarehouses((previous) => (areWarehousesEqual(previous, nextWarehouses) ? previous : nextWarehouses))
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      if (showLoader || !hasLoadedWarehousesRef.current) {
        setLoading(false)
        hasLoadedWarehousesRef.current = true
      }
    }
  }, [token, pushToast])

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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canManage) { pushToast('error', 'Only admin-approved roles can change locations.'); return }
    if (!name.trim()) { pushToast('error', 'Warehouse name is required'); return }
    try {
      await apiRequest('/locations', 'POST', token ?? undefined, { name: name.trim(), type })
      setName(''); setType('Internal')
      pushToast('success', 'Warehouse saved')
      void load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const deleteWarehouse = async (id: number) => {
    if (!canManage) { pushToast('error', 'Only admin-approved roles can delete locations.'); return }
    const ok = await confirm('Delete this warehouse?', 'This will be permanently removed.')
    if (!ok) return
    try {
      await apiRequest(`/locations/${id}`, 'DELETE', token ?? undefined)
      pushToast('success', 'Warehouse deleted')
      void load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const fetchWarehouseInventoryPage = async (warehouseId: number, page: number) => {
    setInventoryLoadingId(warehouseId)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(INVENTORY_LIMIT),
      })
      const payload = await apiRequest<PaginatedWarehouseInventoryResponse>(
        `/locations/${warehouseId}/inventory?${params.toString()}`,
        'GET',
        token ?? undefined,
      )
      const rows = Array.isArray(payload?.data) ? payload.data : []
      setLocationInventory((prev) => ({
        ...prev,
        [warehouseId]: rows,
      }))
      setInventoryTotalByLocation((prev) => ({
        ...prev,
        [warehouseId]: typeof payload?.total === 'number' ? payload.total : rows.length,
      }))
      setInventoryPageByLocation((prev) => ({ ...prev, [warehouseId]: page }))
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setInventoryLoadingId(null)
    }
  }

  const toggleWarehouseInventory = async (warehouseId: number) => {
    if (expandedLocationId === warehouseId) {
      setExpandedLocationId(null)
      return
    }

    setExpandedLocationId(warehouseId)
    const page = inventoryPageByLocation[warehouseId] || 1
    await fetchWarehouseInventoryPage(warehouseId, page)
  }

  const exportWarehouseInventory = (warehouseName: string, rows: WarehouseInventoryRow[]) => {
    const escapeCsv = (value: string | number) => String(value).replaceAll('"', '""')
    const header = ['Product', 'SKU', 'Quantity', 'UoM', 'Reorder Min', 'Status']
    const dataRows = rows.map((row) => {
      const qty = safeNumber(row.quantity)
      const reorderMin = safeNumber(row.reorder_minimum)
      const status = reorderMin > 0 && qty <= reorderMin ? 'Low Stock' : 'In Stock'
      return [
        `"${escapeCsv(row.product_name)}"`,
        `"${escapeCsv(row.sku)}"`,
        qty,
        `"${escapeCsv(row.unit_of_measure)}"`,
        reorderMin,
        `"${status}"`,
      ].join(',')
    })
    const csv = `${header.join(',')}\n${dataRows.join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${warehouseName.toLowerCase().replace(/\s+/g, '_')}_inventory.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    pushToast('success', `${warehouseName} inventory exported`) 
  }

  const adjustWarehouseStock = async (warehouse: Warehouse, row: WarehouseInventoryRow) => {
    if (!canManage) {
      pushToast('error', 'Only admin-approved roles can adjust stock.')
      return
    }

    const currentQty = safeNumber(row.quantity)
    const raw = window.prompt(`Set new quantity for ${row.product_name} (${row.sku})`, String(currentQty))
    if (raw === null) return

    const nextQty = Number(raw)
    if (!Number.isFinite(nextQty) || nextQty < 0) {
      pushToast('error', 'Quantity must be a non-negative number')
      return
    }

    const key = `${warehouse.id}-${row.product_id}`
    setAdjustingKey(key)
    try {
      const created = await apiRequest<{ id: number }>('/operations', 'POST', token ?? undefined, {
        type: 'Adjustment',
        source_location: warehouse.name,
        destination_location: warehouse.name,
        lines: [{ product_id: row.product_id, requested_quantity: nextQty }],
      })

      await apiRequest(`/operations/${created.id}/validate`, 'POST', token ?? undefined)

      // Clear the inventory cache for this warehouse so re-expanding fetches fresh data
      setLocationInventory((prev) => {
        const next = { ...prev }
        delete next[warehouse.id]
        return next
      })
      setInventoryTotalByLocation((prev) => {
        const next = { ...prev }
        delete next[warehouse.id]
        return next
      })
      setInventoryPageByLocation((prev) => {
        const next = { ...prev }
        delete next[warehouse.id]
        return next
      })

      pushToast('success', `Stock adjusted for ${row.product_name}`)
      void load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setAdjustingKey(null)
    }
  }

  const internalCount = warehouses.filter((w) => String(w.type || '').trim().toLowerCase().startsWith('internal')).length
  const vendorCount   = warehouses.filter((w) => w.type.toLowerCase() === 'vendor').length
  const customerCount = warehouses.filter((w) => w.type.toLowerCase() === 'customer').length
  const locationTypeBadges: Record<string, string> = {
    internal: 'badge-ready',
    vendor: 'badge-done',
    customer: 'badge-canceled',
  }

  const sortedWarehouses = useMemo(() => {
    const copy = [...warehouses]
    copy.sort((a, b) => {
      const cmp = warehouseSortBy === 'name'
        ? a.name.localeCompare(b.name)
        : a.type.localeCompare(b.type)
      return warehouseSortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [warehouses, warehouseSortBy, warehouseSortDir])

  const toggleWarehouseSort = (key: 'name' | 'type') => {
    if (warehouseSortBy === key) {
      setWarehouseSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setWarehouseSortBy(key)
    setWarehouseSortDir('asc')
  }

  const warehouseSortMark = (key: 'name' | 'type') => (
    warehouseSortBy === key ? (warehouseSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )

  const toggleInventorySort = (locationId: number, key: 'product' | 'sku' | 'quantity' | 'uom' | 'reorder' | 'status') => {
    setInventorySortByLocation((prev) => {
      const current = prev[locationId]
      if (current?.key === key) {
        return {
          ...prev,
          [locationId]: { key, dir: current.dir === 'asc' ? 'desc' : 'asc' },
        }
      }
      return {
        ...prev,
        [locationId]: { key, dir: 'asc' },
      }
    })
  }

  const inventorySortMark = (locationId: number, key: 'product' | 'sku' | 'quantity' | 'uom' | 'reorder' | 'status') => {
    const current = inventorySortByLocation[locationId]
    if (!current || current.key !== key) return ''
    return current.dir === 'asc' ? ' ▲' : ' ▼'
  }

  return (
    <section className="warehouses-page">
      {modal}
      <div className="operations-overview">
        <div className="operations-overview-top">
          <div className="product-title-block">
            <h2>Warehouses &amp; Locations</h2>
            <p>Maintain storage points used across receipts, deliveries, and transfers.</p>
          </div>
        </div>
        <div className="product-stats-grid warehouses-stats-grid">
          {[
            ['Total Locations', warehouses.length],
            ['Internal',        internalCount],
            ['Vendor',          vendorCount],
            ['Customer',        customerCount],
          ].map(([label, value]) => (
            <article key={label as string} className="product-stat-card">
              <div className="product-stat-label">{label}</div>
              <div className="product-stat-value">{value}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="split-layout warehouses-layout">
        <div className="panel-card warehouses-form-card">
          <div className="panel-card-header">Add Warehouse / Location</div>
          <div className="panel-card-body">
            {canManage ? (
              <form onSubmit={submit}>
                <div className="form-field">
                  <label className="form-field-label">Location Name</label>
                  <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Warehouse" required />
                </div>
                <div className="form-field">
                  <label className="form-field-label">Location Type</label>
                  <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="Internal">Internal Location</option>
                    <option value="Vendor">Vendor Location</option>
                    <option value="Customer">Customer Location</option>
                  </select>
                </div>
                <button className="btn btn-primary" type="submit">Save Location</button>
              </form>
            ) : (
              <p className="muted">Read-only access. Only admin-approved roles can change locations.</p>
            )}
          </div>
        </div>

        <div className="list-card warehouses-table-card">
          <div className="list-header">
            <h2>Registered Locations</h2>
            <div className="list-header-meta">
              <p className="muted">Delete only when location has no active stock.</p>
              <SyncStatusChip show={loading && warehouses.length > 0} />
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleWarehouseSort('name')}>Name{warehouseSortMark('name')}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleWarehouseSort('type')}>Type{warehouseSortMark('type')}</button></th>
                  <th>Inventory</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && !warehouses.length && <tr className="empty-row"><td colSpan={4}>Loading...</td></tr>}
                {!loading && !warehouses.length && <tr className="empty-row"><td colSpan={4}>No locations configured yet.</td></tr>}
                {sortedWarehouses.map((wh) => (
                  <Fragment key={wh.id}>
                    <tr>
                      <td><strong>{wh.name}</strong></td>
                      <td><span className={`badge ${locationTypeBadges[wh.type.toLowerCase()] ?? 'badge-draft'}`}>{wh.type}</span></td>
                      <td>
                        {String(wh.type || '').trim().toLowerCase().startsWith('internal') ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { void toggleWarehouseInventory(wh.id) }}
                          >
                            {expandedLocationId === wh.id ? 'Hide Stock' : 'View Stock'}
                          </button>
                        ) : (
                          <span className="muted">Internal only</span>
                        )}
                      </td>
                      <td>
                        {canManage ? (
                          <button type="button" className="btn-icon" onClick={() => void deleteWarehouse(wh.id)} title="Delete location">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </button>
                        ) : (
                          <span className="muted">Contact admin</span>
                        )}
                      </td>
                    </tr>
                    {expandedLocationId === wh.id && (
                      <tr>
                        <td colSpan={4}>
                          {inventoryLoadingId === wh.id ? (
                            <p className="muted">Loading stock details...</p>
                          ) : (locationInventory[wh.id] || []).length === 0 ? (
                            <p className="muted">No products currently stocked in this location.</p>
                          ) : (
                            <>
                              {(() => {
                                const rows = locationInventory[wh.id] || []
                                const inventoryPage = inventoryPageByLocation[wh.id] || 1
                                const totalInventoryRows = inventoryTotalByLocation[wh.id] ?? rows.length
                                const totalInventoryPages = Math.max(1, Math.ceil(totalInventoryRows / INVENTORY_LIMIT))
                                const query = (inventorySearchByLocation[wh.id] || '').trim().toLowerCase()
                                const filteredRows = query
                                  ? rows.filter((row) =>
                                      row.product_name.toLowerCase().includes(query)
                                      || row.sku.toLowerCase().includes(query),
                                    )
                                  : rows
                                const inventorySort = inventorySortByLocation[wh.id] || { key: 'product', dir: 'asc' as const }
                                const sortedFilteredRows = [...filteredRows].sort((a, b) => {
                                  const aQty = safeNumber(a.quantity)
                                  const bQty = safeNumber(b.quantity)
                                  const aReorder = safeNumber(a.reorder_minimum)
                                  const bReorder = safeNumber(b.reorder_minimum)
                                  const aLow = aReorder > 0 && aQty <= aReorder ? 0 : 1
                                  const bLow = bReorder > 0 && bQty <= bReorder ? 0 : 1

                                  let cmp = 0
                                  if (inventorySort.key === 'product') cmp = a.product_name.localeCompare(b.product_name)
                                  else if (inventorySort.key === 'sku') cmp = a.sku.localeCompare(b.sku)
                                  else if (inventorySort.key === 'quantity') cmp = aQty - bQty
                                  else if (inventorySort.key === 'uom') cmp = a.unit_of_measure.localeCompare(b.unit_of_measure)
                                  else if (inventorySort.key === 'reorder') cmp = aReorder - bReorder
                                  else if (inventorySort.key === 'status') cmp = aLow - bLow

                                  return inventorySort.dir === 'asc' ? cmp : -cmp
                                })
                                const totalUnits = rows.reduce((sum, row) => sum + safeNumber(row.quantity), 0)
                                const lowStockCount = rows.filter((row) => {
                                  const reorderMin = safeNumber(row.reorder_minimum)
                                  return reorderMin > 0 && safeNumber(row.quantity) <= reorderMin
                                }).length

                                return (
                                  <div className="inline-stock-card" style={{ marginTop: 8 }}>
                                    <div className="operations-overview-top" style={{ marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                                      <div className="list-header-meta" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                        <span className="muted">Products: <strong>{totalInventoryRows}</strong></span>
                                        <span className="muted">Total Units: <strong>{safeNumber(totalUnits)}</strong></span>
                                        <span className="muted">Low Stock: <strong>{lowStockCount}</strong></span>
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                                        <input
                                          className="search-input"
                                          value={inventorySearchByLocation[wh.id] || ''}
                                          onChange={(e) => {
                                            const value = e.target.value
                                            setInventorySearchByLocation((prev) => ({ ...prev, [wh.id]: value }))
                                          }}
                                          placeholder="Search product or SKU"
                                          style={{ minHeight: 34, width: 220 }}
                                        />
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => exportWarehouseInventory(wh.name, filteredRows)}
                                        >
                                          Export CSV
                                        </button>
                                      </div>
                                    </div>

                                    <div className="data-table-wrap">
                                      <table className="data-table nested-table">
                                        <thead>
                                          <tr>
                                            <th><button type="button" className="table-sort-btn" onClick={() => toggleInventorySort(wh.id, 'product')}>Product{inventorySortMark(wh.id, 'product')}</button></th>
                                            <th><button type="button" className="table-sort-btn" onClick={() => toggleInventorySort(wh.id, 'sku')}>SKU{inventorySortMark(wh.id, 'sku')}</button></th>
                                            <th><button type="button" className="table-sort-btn" onClick={() => toggleInventorySort(wh.id, 'quantity')}>Quantity{inventorySortMark(wh.id, 'quantity')}</button></th>
                                            <th><button type="button" className="table-sort-btn" onClick={() => toggleInventorySort(wh.id, 'uom')}>UoM{inventorySortMark(wh.id, 'uom')}</button></th>
                                            <th><button type="button" className="table-sort-btn" onClick={() => toggleInventorySort(wh.id, 'reorder')}>Reorder Min{inventorySortMark(wh.id, 'reorder')}</button></th>
                                            <th><button type="button" className="table-sort-btn" onClick={() => toggleInventorySort(wh.id, 'status')}>Status{inventorySortMark(wh.id, 'status')}</button></th>
                                            <th>Action</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {!sortedFilteredRows.length && (
                                            <tr className="empty-row"><td colSpan={7}>No matching products for this location.</td></tr>
                                          )}
                                          {sortedFilteredRows.map((row) => {
                                            const qty = safeNumber(row.quantity)
                                            const reorderMin = safeNumber(row.reorder_minimum)
                                            const isLow = reorderMin > 0 && qty <= reorderMin
                                            return (
                                              <tr key={`${wh.id}-${row.product_id}`}>
                                                <td><strong>{row.product_name}</strong></td>
                                                <td>{row.sku}</td>
                                                <td>{qty}</td>
                                                <td>{row.unit_of_measure}</td>
                                                <td>{reorderMin}</td>
                                                <td>
                                                  <span className={`badge ${isLow ? 'badge-waiting' : 'badge-done'}`}>
                                                    {isLow ? 'Low Stock' : 'In Stock'}
                                                  </span>
                                                </td>
                                                <td>
                                                  {canManage ? (
                                                    <button
                                                      type="button"
                                                      className="btn btn-secondary btn-sm"
                                                      disabled={adjustingKey === `${wh.id}-${row.product_id}`}
                                                      onClick={() => { void adjustWarehouseStock(wh, row) }}
                                                    >
                                                      {adjustingKey === `${wh.id}-${row.product_id}` ? 'Adjusting...' : 'Adjust'}
                                                    </button>
                                                  ) : (
                                                    <span className="muted">Read-only</span>
                                                  )}
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                    {totalInventoryRows > INVENTORY_LIMIT && (
                                      <div className="pagination-controls" style={{ marginTop: 10 }}>
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          disabled={inventoryPage <= 1 || inventoryLoadingId === wh.id}
                                          onClick={() => { void fetchWarehouseInventoryPage(wh.id, inventoryPage - 1) }}
                                        >
                                          Previous
                                        </button>
                                        <span className="pagination-info">Page {inventoryPage} of {totalInventoryPages}</span>
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          disabled={inventoryPage >= totalInventoryPages || inventoryLoadingId === wh.id}
                                          onClick={() => { void fetchWarehouseInventoryPage(wh.id, inventoryPage + 1) }}
                                        >
                                          Next
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
