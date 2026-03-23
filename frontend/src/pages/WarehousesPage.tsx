/**
 * Warehouses page.
 * Handles location listing, creation, and deletion workflows.
 */

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { apiRequest } from '../utils/helpers'
import { hasElevatedAccess } from '../utils/authHelpers'
import { useConfirm } from '../hooks/useConfirm'
import SyncStatusChip from '../components/SyncStatusChip'
import { LIVE_SYNC_INTERVAL_MS } from '../config/constants'
import type { Toast, UserProfile, Warehouse } from '../types/models'

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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiRequest<Warehouse[]>('/locations', 'GET', token ?? undefined)
      setWarehouses(Array.isArray(data) ? data : [])
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, pushToast])

  useEffect(() => {
    void load()
    // Keep location lists synchronized for users that may be editing from multiple sessions.
    const t = setInterval(load, LIVE_SYNC_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canManage) { pushToast('error', 'Only admin-approved roles can change locations.'); return }
    if (!name.trim()) { pushToast('error', 'Warehouse name is required'); return }
    try {
      await apiRequest('/locations', 'POST', token ?? undefined, { name: name.trim(), type })
      setName(''); setType('Internal')
      pushToast('success', 'Warehouse saved')
      void load()
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
      void load()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const internalCount = warehouses.filter((w) => w.type.toLowerCase() === 'internal').length
  const vendorCount   = warehouses.filter((w) => w.type.toLowerCase() === 'vendor').length
  const customerCount = warehouses.filter((w) => w.type.toLowerCase() === 'customer').length

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
                <tr><th>Name</th><th>Type</th><th>Action</th></tr>
              </thead>
              <tbody>
                {loading && !warehouses.length && <tr className="empty-row"><td colSpan={3}>Loading...</td></tr>}
                {!loading && !warehouses.length && <tr className="empty-row"><td colSpan={3}>No locations configured yet.</td></tr>}
                {warehouses.map((wh) => (
                  <tr key={wh.id}>
                    <td><strong>{wh.name}</strong></td>
                    <td><span className="badge badge-draft">{wh.type}</span></td>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
