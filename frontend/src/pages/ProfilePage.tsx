/**
 * Profile and role-management page.
 * Shows account details and admin role-review actions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { isAdminRole, isPendingRoleRequestStatus } from '../utils/authHelpers'
import { apiRequest, formatDate } from '../utils/helpers'
import { useConfirm } from '../hooks/useConfirm'
import type { AdminManagedUser, AdminRoleRequest, RoleAuditEntry, Toast, UserProfile, UserRoleRequestStatus } from '../types/models'

type Props = {
  token: string | null
  pushToast: (kind: Toast['kind'], text: string) => void
}

export default function ProfilePage({ token, pushToast }: Props) {
  const { modal, confirm } = useConfirm()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [roleStatus, setRoleStatus] = useState<UserRoleRequestStatus | null>(null)
  const [requests, setRequests] = useState<AdminRoleRequest[]>([])
  const [users, setUsers] = useState<AdminManagedUser[]>([])
  const [auditEntries, setAuditEntries] = useState<RoleAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [requestSortBy, setRequestSortBy] = useState<'name' | 'email' | 'role' | 'status' | 'requestedAt'>('requestedAt')
  const [requestSortDir, setRequestSortDir] = useState<'asc' | 'desc'>('desc')
  const [userSortBy, setUserSortBy] = useState<'name' | 'email' | 'role'>('name')
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('asc')
  const [auditSortBy, setAuditSortBy] = useState<'action' | 'target' | 'roleChange' | 'performedBy' | 'date'>('date')
  const [auditSortDir, setAuditSortDir] = useState<'asc' | 'desc'>('desc')

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true)
    try {
      const me = await apiRequest<UserProfile>('/users/me', 'GET', token ?? undefined)
      setProfile(me)

      const status = await apiRequest<UserRoleRequestStatus>('/users/role-request-status', 'GET', token ?? undefined)
      setRoleStatus(status)

      if (isAdminRole(me.role)) {
        const [roleRequests, managedUsers, auditRows] = await Promise.all([
          apiRequest<AdminRoleRequest[]>('/admin/role-requests?scope=all', 'GET', token ?? undefined),
          apiRequest<AdminManagedUser[]>('/admin/users?scope=all', 'GET', token ?? undefined),
          apiRequest<RoleAuditEntry[]>('/admin/role-audit-log?limit=100', 'GET', token ?? undefined),
        ])
        setRequests(Array.isArray(roleRequests) ? roleRequests : [])
        setUsers(Array.isArray(managedUsers) ? managedUsers : [])
        setAuditEntries(Array.isArray(auditRows) ? auditRows : [])
      } else {
        setRequests([])
        setUsers([])
        setAuditEntries([])
      }
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [token, pushToast])

  useEffect(() => {
    void load(true)
  }, [load])

  const requestManagerRole = async () => {
    try {
      await apiRequest('/users/role-requests', 'POST', token ?? undefined, { requested_role: 'Manager' })
      pushToast('success', 'Manager role request submitted')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const approveRequest = async (id: number) => {
    try {
      await apiRequest(`/admin/role-requests/${id}/approve`, 'POST', token ?? undefined)
      pushToast('success', 'Role request approved')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const rejectRequest = async (id: number) => {
    const ok = await confirm('Reject this role request?', 'User will keep existing access and request will be marked rejected.')
    if (!ok) return
    try {
      await apiRequest(`/admin/role-requests/${id}/reject`, 'POST', token ?? undefined, { note: 'Rejected by admin' })
      pushToast('success', 'Role request rejected')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const upgradeUser = async (id: number) => {
    try {
      await apiRequest(`/admin/users/${id}/upgrade-role`, 'POST', token ?? undefined)
      pushToast('success', 'User upgraded to Manager')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const revokeUser = async (id: number) => {
    const ok = await confirm('Revoke this user role?', 'The user role will be reset to Warehouse Staff.')
    if (!ok) return
    try {
      await apiRequest(`/admin/users/${id}/revoke-role`, 'POST', token ?? undefined)
      pushToast('success', 'User role revoked')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const deleteUser = async (id: number) => {
    const ok = await confirm('Delete this user?', 'This permanently removes the account and cannot be undone.')
    if (!ok) return
    try {
      await apiRequest(`/admin/users/${id}`, 'DELETE', token ?? undefined)
      pushToast('success', 'User deleted')
      await load(false)
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const isAdmin = isAdminRole(profile?.role)
  const canRequestManager = String(profile?.role || '').toLowerCase() === 'warehouse staff' && roleStatus?.status !== 'pending'

  const roleBadgeClass = (role: string | null | undefined) => {
    const value = String(role || '').toLowerCase()
    if (value === 'admin') return 'badge-ready'
    if (value === 'manager') return 'badge-done'
    return 'badge-draft'
  }

  const requestStatusBadgeClass = (status: string | null | undefined) => {
    const value = String(status || '').toLowerCase()
    if (value === 'pending' || value === 'awaiting_admin_approval' || value === 'pending_admin_approval') return 'badge-waiting'
    if (value === 'otp_pending') return 'badge-draft'
    if (value === 'approved' || value === 'completed') return 'badge-done'
    if (value === 'rejected' || value === 'revoked') return 'badge-canceled'
    return 'badge-draft'
  }

  const auditActionBadgeClass = (action: string | null | undefined) => {
    const value = String(action || '').trim().toUpperCase()
    if (value.includes('DELETE') || value.includes('REJECT')) return 'badge-canceled'
    if (value.includes('APPROVE') || value.includes('UPGRADE')) return 'badge-done'
    if (value.includes('REVOKE')) return 'badge-waiting'
    return 'badge-draft'
  }

  const auditActionLabel = (action: string | null | undefined) => {
    const value = String(action || '').trim().toUpperCase()
    if (!value) return '-'
    if (value.includes('DELETE')) return 'DELETED'
    if (value.startsWith('ROLE_')) return value.replace('ROLE_', '').replaceAll('_', ' ')
    if (value.startsWith('USER_')) return value.replace('USER_', '').replaceAll('_', ' ')
    return value.replaceAll('_', ' ')
  }

  const statusLabel = (status: string | null | undefined) => {
    const value = String(status || '').trim().toUpperCase()
    if (value === 'AWAITING_ADMIN_APPROVAL') return 'PENDING'
    if (value === 'OTP_PENDING') return 'OTP VERIFY'
    return value.replaceAll('_', ' ')
  }

  const pendingRequests = requests.filter((r) => isPendingRoleRequestStatus(r.status))

  const sortedPendingRequests = useMemo(() => {
    const copy = [...pendingRequests]
    copy.sort((a, b) => {
      let cmp = 0
      if (requestSortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (requestSortBy === 'email') cmp = a.email.localeCompare(b.email)
      else if (requestSortBy === 'role') cmp = a.requested_role.localeCompare(b.requested_role)
      else if (requestSortBy === 'status') cmp = String(a.status || '').localeCompare(String(b.status || ''))
      else if (requestSortBy === 'requestedAt') cmp = new Date(String(a.created_at || 0)).getTime() - new Date(String(b.created_at || 0)).getTime()
      return requestSortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [pendingRequests, requestSortBy, requestSortDir])

  const sortedUsers = useMemo(() => {
    const copy = [...users]
    copy.sort((a, b) => {
      let cmp = 0
      if (userSortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (userSortBy === 'email') cmp = a.email.localeCompare(b.email)
      else if (userSortBy === 'role') cmp = String(a.role || '').localeCompare(String(b.role || ''))
      return userSortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [users, userSortBy, userSortDir])

  const sortedAuditEntries = useMemo(() => {
    const copy = [...auditEntries]
    copy.sort((a, b) => {
      let cmp = 0
      if (auditSortBy === 'action') cmp = String(a.action || '').localeCompare(String(b.action || ''))
      else if (auditSortBy === 'target') cmp = String(a.target_user_email || '').localeCompare(String(b.target_user_email || ''))
      else if (auditSortBy === 'roleChange') {
        const leftA = `${String(a.old_role || '-')}>${String(a.new_role || '-')}`
        const leftB = `${String(b.old_role || '-')}>${String(b.new_role || '-')}`
        cmp = leftA.localeCompare(leftB)
      } else if (auditSortBy === 'performedBy') cmp = String(a.performed_by_email || '').localeCompare(String(b.performed_by_email || ''))
      else if (auditSortBy === 'date') cmp = new Date(String(a.created_at || 0)).getTime() - new Date(String(b.created_at || 0)).getTime()
      return auditSortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [auditEntries, auditSortBy, auditSortDir])

  const toggleRequestSort = (key: 'name' | 'email' | 'role' | 'status' | 'requestedAt') => {
    if (requestSortBy === key) {
      setRequestSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setRequestSortBy(key)
    setRequestSortDir(key === 'requestedAt' ? 'desc' : 'asc')
  }

  const toggleUserSort = (key: 'name' | 'email' | 'role') => {
    if (userSortBy === key) {
      setUserSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setUserSortBy(key)
    setUserSortDir('asc')
  }

  const toggleAuditSort = (key: 'action' | 'target' | 'roleChange' | 'performedBy' | 'date') => {
    if (auditSortBy === key) {
      setAuditSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setAuditSortBy(key)
    setAuditSortDir(key === 'date' ? 'desc' : 'asc')
  }

  const requestSortMark = (key: 'name' | 'email' | 'role' | 'status' | 'requestedAt') => (
    requestSortBy === key ? (requestSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )
  const userSortMark = (key: 'name' | 'email' | 'role') => (
    userSortBy === key ? (userSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )
  const auditSortMark = (key: 'action' | 'target' | 'roleChange' | 'performedBy' | 'date') => (
    auditSortBy === key ? (auditSortDir === 'asc' ? ' ▲' : ' ▼') : ''
  )

  const roleStatusLabel = String(roleStatus?.status || 'not_requested').replaceAll('_', ' ').toUpperCase()

  return (
    <section className="profile-page">
      {modal}

      <div className="profile-hero">
        <div className="product-title-block">
          <h2>My Profile</h2>
          <p>Your account identity and access role for this workspace.</p>
        </div>
      </div>

      <div className="panel-card profile-account-card">
        <div className="panel-card-header">Account Details</div>
        <div className="panel-card-body">
          {loading ? (
            <p className="muted">Loading profile...</p>
          ) : (
            <>
              <div className="info-grid profile-account-grid">
                <div className="info-item"><dt>Full Name</dt><dd>{profile?.name ?? '-'}</dd></div>
                <div className="info-item"><dt>Email Address</dt><dd>{profile?.email ?? '-'}</dd></div>
                <div className="info-item"><dt>Role</dt><dd>{profile?.role ?? '-'}</dd></div>
                <div className="info-item"><dt>User ID</dt><dd>{profile?.id ? `#${profile.id}` : '-'}</dd></div>
              </div>
              {!isAdmin && (
                <div className="profile-role-request-action">
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Role request status: <span className={`badge ${requestStatusBadgeClass(roleStatus?.status)}`}>{roleStatusLabel}</span>
                  </p>
                  {canRequestManager && (
                    <button type="button" className="btn btn-secondary" onClick={() => { void requestManagerRole() }}>
                      Request Manager Role
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="list-card">
            <div className="list-header profile-list-head">
              <h2>Pending Role Requests</h2>
              <p className="muted">Approve or reject verified requests awaiting admin decision.</p>
            </div>
            <div className="data-table-wrap">
              <table className="data-table profile-admin-table">
                <thead>
                  <tr>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleRequestSort('name')}>Name{requestSortMark('name')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleRequestSort('email')}>Email{requestSortMark('email')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleRequestSort('role')}>Requested Role{requestSortMark('role')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleRequestSort('status')}>Status{requestSortMark('status')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleRequestSort('requestedAt')}>Requested At{requestSortMark('requestedAt')}</button></th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.length === 0 && <tr className="empty-row"><td colSpan={6}>No pending approvals right now.</td></tr>}
                  {sortedPendingRequests.map((req) => (
                    <tr key={req.id}>
                      <td><strong>{req.name}</strong></td>
                      <td>{req.email}</td>
                      <td><span className={`badge ${roleBadgeClass(req.requested_role)}`}>{req.requested_role.toUpperCase()}</span></td>
                      <td><span className={`badge ${requestStatusBadgeClass(req.status)}`}>{statusLabel(req.status)}</span></td>
                      <td>{req.created_at ? formatDate(req.created_at) : '-'}</td>
                      <td>
                        <div className="operation-row-actions profile-admin-actions">
                          <button type="button" className="btn btn-success btn-sm" onClick={() => { void approveRequest(req.id) }}>Approve</button>
                          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => { void rejectRequest(req.id) }}>Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="list-card">
            <div className="list-header profile-list-head">
              <h2>Role Access Management</h2>
              <p className="muted">Manage user roles and accounts. Upgrade staff, revoke elevated access, or delete users.</p>
            </div>
            <div className="data-table-wrap">
              <table className="data-table profile-admin-table">
                <thead>
                  <tr>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleUserSort('name')}>Name{userSortMark('name')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleUserSort('email')}>Email{userSortMark('email')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleUserSort('role')}>Current Role{userSortMark('role')}</button></th>
                    <th>Upgrade</th>
                    <th>Revoke Role</th>
                    <th>Delete User</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && <tr className="empty-row"><td colSpan={6}>No users</td></tr>}
                  {sortedUsers.map((user) => (
                    <tr key={user.id}>
                      <td><strong>{user.name}</strong></td>
                      <td>{user.email}</td>
                      <td><span className={`badge ${roleBadgeClass(user.role)}`}>{String(user.role || '-').toUpperCase()}</span></td>
                      <td>
                        {String(user.role || '').toLowerCase() === 'warehouse staff'
                          ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void upgradeUser(user.id) }}>Upgrade</button>
                          : <span className="muted">-</span>
                        }
                      </td>
                      <td>
                        {user.id === profile?.id ? (
                          <span className="muted">-</span>
                        ) : (String(user.role || '').toLowerCase() === 'manager' || String(user.role || '').toLowerCase() === 'admin') ? (
                          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => { void revokeUser(user.id) }}>Revoke Role</button>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        {user.id === profile?.id
                          ? <span className="muted">Current admin</span>
                          : <button type="button" className="btn btn-danger btn-sm" onClick={() => { void deleteUser(user.id) }}>Delete</button>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="list-card">
            <div className="list-header profile-list-head">
              <h2>Role Audit History</h2>
              <p className="muted">Record of role requests, approvals, rejections, upgrades, revocations, and user deletions.</p>
            </div>
            <div className="data-table-wrap">
              <table className="data-table profile-admin-table">
                <thead>
                  <tr>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleAuditSort('action')}>Action{auditSortMark('action')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleAuditSort('target')}>Target User{auditSortMark('target')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleAuditSort('roleChange')}>Role Change{auditSortMark('roleChange')}</button></th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleAuditSort('performedBy')}>Performed By{auditSortMark('performedBy')}</button></th>
                    <th>Note</th>
                    <th><button type="button" className="table-sort-btn" onClick={() => toggleAuditSort('date')}>Date{auditSortMark('date')}</button></th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.length === 0 && <tr className="empty-row"><td colSpan={6}>No audit entries found</td></tr>}
                  {sortedAuditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td><span className={`badge ${auditActionBadgeClass(entry.action)}`}>{auditActionLabel(entry.action)}</span></td>
                      <td>{entry.target_user_email ?? '-'}</td>
                      <td>{entry.old_role ?? '-'} → {entry.new_role ?? '-'}</td>
                      <td>{entry.performed_by_email ?? '-'}</td>
                      <td>{entry.note ?? '-'}</td>
                      <td>{entry.created_at ? formatDate(entry.created_at) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
