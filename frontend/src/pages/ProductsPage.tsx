/**
 * Products page.
 * Provides product catalog management, stock drilldowns, and filtering.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiRequest, safeNumber } from '../utils/helpers'
import { hasElevatedAccess } from '../utils/authHelpers'
import { useConfirm } from '../hooks/useConfirm'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useLivePolling } from '../hooks/useLivePolling'
import { areProductFilterOptionsEqual, areProductsEqual } from '../utils/stability'
import SyncStatusChip from '../components/SyncStatusChip'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_UOMS,
  LIVE_SYNC_INTERVAL_MS,
  SEARCH_DEBOUNCE_MS,
} from '../config/constants'
import type { Product, ProductFilterOptions, ProductStockRow, Toast, UserProfile } from '../types/models'
import { downloadFileFromApi } from '../utils/downloads'

/** Shape of items returned in ProductFilterOptions.locations */
interface LocationOption {
  id: number | string
  name: string
  type?: string
}

interface Props {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
  currentUser: UserProfile | null
}

export default function ProductsPage({ token, pushToast, currentUser }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const { modal, confirm } = useConfirm()
  const canManage = hasElevatedAccess(currentUser)

  const [viewMode, setViewMode] = useState<'list' | 'form'>('list')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const LIMIT = 15
  const [filterOptions, setFilterOptions] = useState<ProductFilterOptions>({ categories: [], locations: [], uoms: [] })
  const [editingProductId, setEditingProductId]                   = useState<number | null>(null)
  const [expandedProductId, setExpandedProductId]                 = useState<number | null>(null)
  const [stockByProductId, setStockByProductId]                   = useState<Record<number, ProductStockRow[]>>({})
  const [stockLoadingForProductId, setStockLoadingForProductId]   = useState<number | null>(null)

  // Filters
  const [search,          setSearch]          = useState(() => new URLSearchParams(location.search).get('search') ?? '')
  const [filterCategory,  setFilterCategory]  = useState(() => new URLSearchParams(location.search).get('category') ?? '')
  const [filterLocation,  setFilterLocation]  = useState(() => new URLSearchParams(location.search).get('location') ?? '')
  const [lowStockOnly,    setLowStockOnly]    = useState(() => new URLSearchParams(location.search).get('lowStockOnly') === 'true')
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)

  // Form fields
  const [name,          setName]          = useState('')
  const [sku,           setSku]           = useState('')
  const [category,      setCategory]      = useState('')
  const [uom,           setUom]           = useState('Units')
  const [initialStock,  setInitialStock]  = useState('0')
  const [reorderMin,    setReorderMin]    = useState('0')
  const [initialWarehouseId, setInitialWarehouseId] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'sku' | 'category' | 'uom' | 'stock' | 'location' | 'status'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const locationSyncRef = useRef<{
    search: string
    category: string
    location: string
    lowStockOnly: boolean
  } | null>(null)
  // const initialWarehouseSelectRef = useRef<HTMLSelectElement | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nextSearch = params.get('search') ?? ''
    const nextCategory = params.get('category') ?? ''
    const nextLocation = params.get('location') ?? ''
    const nextLowStock = params.get('lowStockOnly') === 'true'

    locationSyncRef.current = {
      search: nextSearch,
      category: nextCategory,
      location: nextLocation,
      lowStockOnly: nextLowStock,
    }

    setSearch((prev) => (prev === nextSearch ? prev : nextSearch))
    setFilterCategory((prev) => (prev === nextCategory ? prev : nextCategory))
    setFilterLocation((prev) => (prev === nextLocation ? prev : nextLocation))
    setLowStockOnly((prev) => (prev === nextLowStock ? prev : nextLowStock))
  }, [location.search])

  const resetForm = () => {
    setEditingProductId(null); setName(''); setSku(''); setCategory('')
    setUom('Units'); setInitialStock('0'); setReorderMin('0'); setInitialWarehouseId('')
  }

  const startNew = () => {
    if (!canManage) { pushToast('info', 'Only admin-approved roles can change products.'); return }
    resetForm(); setViewMode('form')
  }

  const startEdit = (p: Product) => {
    if (!canManage) { pushToast('info', 'Only admin-approved roles can change products.'); return }
    setEditingProductId(p.id); setName(p.name); setSku(p.sku); setCategory(p.category)
    setUom(p.unit_of_measure)
    setReorderMin(String(safeNumber(p.reorder_minimum))); setInitialStock('0')
    setViewMode('form')
  }

  const hasLoadedProductsRef = useRef(false)

  const load = useCallback(async (showLoader = false, searchValue = debouncedSearch) => {
    if (showLoader || !hasLoadedProductsRef.current) {
      setLoading(true)
    }
    try {
      const params = new URLSearchParams()
      if (searchValue.trim()) params.set('search', searchValue.trim())
      if (filterCategory.trim()) params.set('category',     filterCategory.trim())
      if (filterLocation.trim()) params.set('location',     filterLocation.trim())
      if (lowStockOnly)          params.set('lowStockOnly', 'true')
      params.set('page', String(page))
      params.set('limit', String(LIMIT))
      const q = params.toString() ? `?${params.toString()}` : ''
      const data = await apiRequest<{ data: Product[], total: number }>(`/products${q}`, 'GET', token ?? undefined)
      const nextProducts = Array.isArray(data?.data) ? data.data.map(p => ({
        ...p,
        sku: p.sku.replace(/^(.*?)\1$/, '$1'),
        category: p.category.replace(/^(.*?)\1$/, '$1'),
        unit_of_measure: /^units\s*units$/i.test(p.unit_of_measure.trim()) ? 'Units' : p.unit_of_measure
      })) : []
      const nextTotal = typeof data?.total === 'number' ? data.total : 0
      
      setProducts((previous) => (areProductsEqual(previous, nextProducts) ? previous : nextProducts))
      setTotal(nextTotal)
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      if (showLoader || !hasLoadedProductsRef.current) {
        setLoading(false)
        hasLoadedProductsRef.current = true
      }
    }
  }, [debouncedSearch, filterCategory, filterLocation, lowStockOnly, page, token, pushToast])

  const loadFilterOptions = useCallback(async () => {
    try {
      const data = await apiRequest<ProductFilterOptions>('/products/filter-options', 'GET', token ?? undefined)
      const nextFilterOptions = {
        categories: Array.isArray(data?.categories) ? data.categories : [],
        locations:  Array.isArray(data?.locations)  ? data.locations  : [],
        uoms:       Array.isArray(data?.uoms)        ? data.uoms       : [],
      }
      setFilterOptions((previous) => (
        areProductFilterOptionsEqual(previous, nextFilterOptions) ? previous : nextFilterOptions
      ))
    } catch { /* keep defaults */ }
  }, [token])

  useEffect(() => {
    void loadFilterOptions()
  }, [loadFilterOptions])

  useEffect(() => {
    void load(!hasLoadedProductsRef.current)
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filterCategory, filterLocation, lowStockOnly])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(total / LIMIT))
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [total, page])

  useLivePolling(
    async () => {
      await Promise.all([load(false), loadFilterOptions()])
    },
    {
      enabled: Boolean(token),
      immediate: false,
      intervalMs: LIVE_SYNC_INTERVAL_MS,
    },
  )

  useEffect(() => {
    const pendingLocationSync = locationSyncRef.current
    if (pendingLocationSync) {
      const settled =
        search === pendingLocationSync.search &&
        debouncedSearch === pendingLocationSync.search &&
        filterCategory === pendingLocationSync.category &&
        filterLocation === pendingLocationSync.location &&
        lowStockOnly === pendingLocationSync.lowStockOnly

      if (!settled) {
        return
      }

      locationSyncRef.current = null
    }

    const params = new URLSearchParams()
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (filterCategory.trim()) params.set('category', filterCategory.trim())
    if (filterLocation.trim()) params.set('location', filterLocation.trim())
    if (lowStockOnly) params.set('lowStockOnly', 'true')

    const next = params.toString()
    const current = location.search.startsWith('?') ? location.search.slice(1) : location.search
    if (next !== current) {
      navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
    }
  }, [search, debouncedSearch, filterCategory, filterLocation, lowStockOnly, location.pathname, location.search, navigate])

  const productGuidelines = useMemo(() => [
    ['SKU', 'Use a unique and searchable code.'],
    ['Reorder', 'Triggers low-stock visibility in lists.'],
    ['Category', 'Used in dashboard and filtering.'],
    ['Initial Stock', 'Available only for new products.'],
  ], [])

  const guidelineChecklist = useMemo(() => {
    const parsedInitial = Number(initialStock)
    const hasRequiredFields = Boolean(name.trim() && sku.trim() && category.trim() && uom.trim())
    const stockValuesOk = !Number.isNaN(parsedInitial) && !Number.isNaN(Number(reorderMin)) && parsedInitial >= 0 && Number(reorderMin) >= 0
    const initialWarehouseOk = parsedInitial <= 0 || Boolean(initialWarehouseId)

    return [
      ['Required fields completed', hasRequiredFields],
      ['Stock values are valid', stockValuesOk],
      ['Initial warehouse selected if stock > 0', initialWarehouseOk],
    ] as [string, boolean][]
  }, [name, sku, category, uom, initialStock, reorderMin, initialWarehouseId])

  const categoryOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_CATEGORIES, ...filterOptions.categories, category].filter(Boolean))),
    [filterOptions.categories, category],
  )
  const uomOptions = useMemo(
    () => Array.from(
      new Set(
        [...DEFAULT_UOMS, ...filterOptions.uoms, uom]
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && !/^units\s*units$/i.test(value) && value.toLowerCase() !== 'unit'),
      ),
    ),
    [filterOptions.uoms, uom],
  )
  // Removed ensureInitialWarehouseDropdownSpace logic to prevent unwanted scrolling

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canManage) { pushToast('error', 'Only admin-approved roles can change products.'); return }
    if (!name.trim() || !sku.trim() || !category.trim() || !uom.trim()) {
      pushToast('error', 'Name, SKU, category, and unit of measure are required'); return
    }
    const parsedInitial = Number(initialStock)
    const parsedReorder = Number(reorderMin)
    if (Number.isNaN(parsedInitial) || Number.isNaN(parsedReorder) || parsedInitial < 0 || parsedReorder < 0) {
      pushToast('error', 'Stock values must be non-negative numbers'); return
    }
    if (parsedInitial > 0 && !initialWarehouseId) {
      pushToast('error', 'Initial Warehouse is required when Initial Stock is greater than zero.'); return
    }

    setSaving(true)
    try {
      if (editingProductId) {
        await apiRequest(`/products/${editingProductId}`, 'PUT', token ?? undefined, {
          name: name.trim(), sku: sku.trim(), category: category.trim(),
          unit_of_measure: uom.trim(), reorder_minimum: parsedReorder,
        })
        pushToast('success', 'Product updated')
      } else {
        await apiRequest('/products', 'POST', token ?? undefined, {
          name: name.trim(), sku: sku.trim(), category: category.trim(),
          unit_of_measure: uom.trim(), initial_stock: parsedInitial, reorder_minimum: parsedReorder,
          initial_warehouse_id: parsedInitial > 0 ? initialWarehouseId : undefined,
        })
        pushToast('success', 'Product saved')
      }
      resetForm(); await loadFilterOptions(); void load(false); setViewMode('list')
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const deleteProduct = async () => {
    if (!editingProductId || !canManage) return
    const ok = await confirm('Delete this product?', 'Deletion is allowed only if the product has no operation or ledger history.')
    if (!ok) return
    setSaving(true)
    try {
      await apiRequest(`/products/${editingProductId}`, 'DELETE', token ?? undefined)
      pushToast('success', 'Product deleted')
      resetForm(); await loadFilterOptions(); void load(false); setViewMode('list')
    } catch (err) {
      const message = (err as Error).message || 'Failed to delete product'
      if (message.toLowerCase().includes('cannot be deleted') || message.toLowerCase().includes('history')) {
        pushToast('info', `${message} This is expected to preserve audit traceability.`)
      } else {
        pushToast('error', message)
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleStock = async (productId: number) => {
    if (expandedProductId === productId) { setExpandedProductId(null); return }
    setExpandedProductId(productId)
    if (stockByProductId[productId]) return
    setStockLoadingForProductId(productId)
    try {
      const rows = await apiRequest<ProductStockRow[]>(`/products/${productId}/stock`, 'GET', token ?? undefined)
      setStockByProductId((prev) => ({ ...prev, [productId]: Array.isArray(rows) ? rows : [] }))
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setStockLoadingForProductId((prev) => (prev === productId ? null : prev))
    }
  }

  const totalStock  = useMemo(() => products.reduce((s, p) => s + safeNumber(p.availableStock), 0), [products])
  const lowCount    = useMemo(() => products.filter((p) => safeNumber(p.availableStock) <= safeNumber(p.reorder_minimum)).length, [products])
  const activeCount = [search.trim(), filterCategory.trim(), filterLocation.trim(), lowStockOnly ? '1' : ''].filter(Boolean).length

  const sortedProducts = useMemo(() => {
    const getStatusRank = (p: Product) => (
      safeNumber(p.availableStock) <= safeNumber(p.reorder_minimum) ? 0 : 1
    )
    const copy = [...products]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'sku') cmp = a.sku.localeCompare(b.sku)
      else if (sortBy === 'category') cmp = a.category.localeCompare(b.category)
      else if (sortBy === 'uom') cmp = a.unit_of_measure.localeCompare(b.unit_of_measure)
      else if (sortBy === 'stock') cmp = safeNumber(a.availableStock) - safeNumber(b.availableStock)
      else if (sortBy === 'location') cmp = String(a.locationName || '').localeCompare(String(b.locationName || ''))
      else if (sortBy === 'status') cmp = getStatusRank(a) - getStatusRank(b)

      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [products, sortBy, sortDir])

  const toggleSort = (key: 'name' | 'sku' | 'category' | 'uom' | 'stock' | 'location' | 'status') => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(key)
    setSortDir('asc')
  }

  const sortMark = (key: 'name' | 'sku' | 'category' | 'uom' | 'stock' | 'location' | 'status') => (
    sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )

  return (
    <section className="product-page">
      {modal}
      {viewMode === 'list' && (
        <>
          <div className="product-overview">
            <div className="product-overview-top">
              <div className="product-title-block">
                <h2>Products</h2>
                <p>Manage catalog items, monitor stock, and keep reorder levels in control.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={() => void downloadFileFromApi('/export/products', 'core_inventory_products.csv', token, pushToast)}>
                  ↓ Export CSV
                </button>
                {canManage
                  ? <button type="button" className="btn btn-primary" onClick={startNew}>+ New Product</button>
                  : <span className="muted">Read-only access. Contact admin to manage products.</span>
                }
              </div>
            </div>
            <div className="product-stats-grid">
              {[
                { label: 'Total Products',      value: products.length,       cls: '' },
                { label: 'Total Units on Hand', value: totalStock,             cls: '' },
                { label: 'Low or Out of Stock', value: lowCount,               cls: 'product-stat-warning' },
                { label: 'Active Filters',      value: activeCount,            cls: '' },
              ].map(({ label, value, cls }) => (
                <article key={label} className="product-stat-card">
                  <div className="product-stat-label">{label}</div>
                  <div className={`product-stat-value${cls ? ' ' + cls : ''}`}>{value}</div>
                </article>
              ))}
            </div>
          </div>

          <div className="list-card product-filter-card">
            <div className="list-header">
              <h2>Filter Products</h2>
              <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setFilterCategory(''); setFilterLocation(''); setLowStockOnly(false); setPage(1) }} disabled={activeCount === 0}>
                Reset
              </button>
            </div>
            <div className="product-filter-grid">
              <div className="filter-group">
                <label className="filter-label">Search</label>
                <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU, or category" />
              </div>
              <div className="filter-group">
                <label className="filter-label">Category</label>
                <select className="form-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {filterOptions.categories.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="filter-group">
                <label className="filter-label">Location</label>
                <select className="form-select" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
                  <option value="">All locations</option>
                  {Array.isArray(filterOptions.locations) && filterOptions.locations.length > 0 &&
                    (filterOptions.locations as unknown as LocationOption[])
                      .filter((loc) => loc && typeof loc === 'object' && String(loc.type || '').trim().toLowerCase().startsWith('internal'))
                      .map((loc) => (
                      <option key={loc.id || loc.name} value={String(loc.name || '').trim()}>
                        {String(loc.name || '').trim()}
                      </option>
                    ))}
                </select>
              </div>
              <div className="product-filter-actions">
                <label className="checkbox-label">
                  <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
                  Low stock only
                </label>
                <button type="button" className="btn btn-primary" onClick={() => { setPage(1); void load(false, search) }}>Apply</button>
              </div>
            </div>
          </div>

          <div className="list-card product-table-card">
            <div className="list-header">
              <h2>Product List</h2>
              <div className="list-header-meta">
                <p className="muted">{canManage ? 'Click Edit to open a product.' : 'Read-only access.'}</p>
                <SyncStatusChip show={loading && products.length > 0} />
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('name')}>Name{sortMark('name')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('sku')}>SKU{sortMark('sku')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('category')}>Category{sortMark('category')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('uom')}>UoM{sortMark('uom')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('stock')}>On Hand{sortMark('stock')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('location')}>Location{sortMark('location')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleSort('status')}>Status{sortMark('status')}</button></th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !products.length && <tr className="empty-row"><td colSpan={8}>Loading products...</td></tr>}
                  {!loading && !products.length && <tr className="empty-row"><td colSpan={8}>No products found.</td></tr>}
                  {sortedProducts.map((p) => (
                    <Fragment key={p.id}>
                      <tr>
                        <td>
                          <div className="product-name-cell">
                            <strong>{p.name}</strong>
                            <span className="muted">Min reorder: {safeNumber(p.reorder_minimum)}</span>
                          </div>
                        </td>
                        <td>{p.sku}</td>
                        <td>{p.category}</td>
                        <td>{p.unit_of_measure}</td>
                        <td>{safeNumber(p.availableStock)}</td>
                        <td>{p.locationName ?? '-'}</td>
                        <td>
                          <span className={`badge ${safeNumber(p.availableStock) <= 0 ? 'badge-danger' : safeNumber(p.availableStock) <= safeNumber(p.reorder_minimum) ? 'badge-waiting' : 'badge-done'}`}>
                            {safeNumber(p.availableStock) <= 0 ? 'Out of Stock' : safeNumber(p.availableStock) <= safeNumber(p.reorder_minimum) ? 'Low Stock' : 'In Stock'}
                          </span>
                        </td>
                        <td className="product-actions-cell">
                          <div className="action-menu">
                            <button type="button" className="btn-icon" aria-label="Actions">
                              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="1"></circle>
                                <circle cx="12" cy="5" r="1"></circle>
                                <circle cx="12" cy="19" r="1"></circle>
                              </svg>
                            </button>
                            <div className="action-menu-dropdown">
                              {canManage && <button type="button" onClick={() => startEdit(p)}>Edit</button>}
                              <button type="button" onClick={() => void toggleStock(p.id)}>
                                {expandedProductId === p.id ? 'Hide Stock' : 'View Stock'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {expandedProductId === p.id && (
                        <tr>
                          <td colSpan={8}>
                            <div className="inline-stock-card">
                              {stockLoadingForProductId === p.id && <p className="muted">Loading...</p>}
                              {stockLoadingForProductId !== p.id && !(stockByProductId[p.id] || []).length && (
                                <p className="muted">No location-wise stock found.</p>
                              )}
                              {stockLoadingForProductId !== p.id && (stockByProductId[p.id] || []).length > 0 && (
                                <table className="data-table nested-table">
                                  <thead><tr><th>Location</th><th>Quantity</th></tr></thead>
                                  <tbody>
                                    {(stockByProductId[p.id] || []).map((row) => (
                                      <tr key={`${p.id}-${row.location_id}`}>
                                        <td>{row.location_name}</td>
                                        <td>{safeNumber(row.quantity)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {total > LIMIT && (
                <div className="pagination-controls">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                  <span className="pagination-info">Page {page} of {Math.ceil(total / LIMIT)}</span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {viewMode === 'form' && (
        <form className="product-form-shell" onSubmit={submit}>
          <div className="product-form-header">
            <h2>{editingProductId ? 'Edit Product' : 'New Product'}</h2>
            <p>Provide product details, then save to update the catalog.</p>
          </div>

          <div className="control-bar">
            <div className="control-bar-left">
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setViewMode('list') }}>Discard</button>
            </div>
            {editingProductId && (
              <div className="control-bar-right">
                <button type="button" className="btn btn-danger-outline" onClick={deleteProduct} disabled={saving}>Delete</button>
              </div>
            )}
          </div>
          <div className="operation-form-grid">
            <div className="op-guidelines-banner">
              <div className="op-guidelines-banner-header">
                <span className="op-guidelines-banner-title">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fillRule="evenodd" d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
                  </svg>
                  Product Guidelines
                </span>
              </div>
              <div className="op-guidelines-banner-body">
                <div className="op-checklist-col">
                  <span className="op-checklist-label">Pre-submit checklist</span>
                  {guidelineChecklist.map(([label, done]) => (
                    <div
                      key={`product-chk-${label}`}
                      className={`op-checklist-item ${done ? 'is-done' : 'is-pending'}`}
                    >
                      <span className="op-checklist-dot" />
                      {done ? '✓ ' : ''}{label}
                    </div>
                  ))}
                </div>
                <div className="op-guideline-cards-scroll">
                  {productGuidelines.map(([title, body]) => (
                    <div key={`product-card-${title}`} className="op-guideline-card">
                      <span className="op-guideline-card-title">{title}</span>
                      <span className="op-guideline-card-body">{body}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-sheet product-form-sheet">
              <div className="form-title-area">
                <div className="form-doc-subtitle">{editingProductId ? 'Edit Product' : 'New Product'}</div>
                <input className="form-doc-title" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Steel Rods" />
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label className="field-label">Internal Reference (SKU)</label>
                  <input className="form-input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. SKU-001" required />
                </div>
                {!editingProductId && (
                  <div className="field-group">
                    <label className="field-label">Initial Warehouse</label>
                    <select
                      className="form-select"
                      value={initialWarehouseId}
                      onChange={e => setInitialWarehouseId(e.target.value)}
                      required={Number(initialStock) > 0}
                    >
                      <option value="" disabled hidden={!!initialWarehouseId}>Select initial warehouse</option>
                      {(filterOptions.locations as unknown as LocationOption[])
                        .filter((loc) => loc && typeof loc === 'object' && String((loc as LocationOption).type || '').trim().toLowerCase().startsWith('internal'))
                        .map((loc) => (
                          <option key={(loc as LocationOption).id} value={(loc as LocationOption).id}>
                            {String((loc as LocationOption).name || '').trim()}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <div className="field-group">
                  <label className="field-label">Category</label>
                  <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)} required>
                    <option value="">Select category...</option>
                    {categoryOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Unit of Measure</label>
                  <select className="form-select" value={uom} onChange={(e) => setUom(e.target.value)} required>
                    {uomOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Reorder Minimum</label>
                  <input className="form-input" type="number" min={0} value={reorderMin} onChange={(e) => setReorderMin(e.target.value)} />
                </div>
                {!editingProductId && (
                  <div className="field-group">
                    <label className="field-label">Initial Stock</label>
                    <input className="form-input" type="number" min={0} value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}