/**
 * Profile and role-management page.
 * Shows account details and admin role-review actions.
 */

import { useCallback, useEffect, useState } from 'react'
import { isAdminRole } from '../utils/authHelpers'
import { apiRequest } from '../utils/helpers'
import { useConfirm } from '../components/ConfirmModal'
import type { AdminManagedUser, AdminRoleRequest, Toast, UserProfile, UserRoleRequestStatus } from '../types/models'

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
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const me = await apiRequest<UserProfile>('/users/me', 'GET', token ?? undefined)
      setProfile(me)

      const status = await apiRequest<UserRoleRequestStatus>('/users/role-request-status', 'GET', token ?? undefined)
      setRoleStatus(status)

      if (isAdminRole(me.role)) {
        const [roleRequests, managedUsers] = await Promise.all([
          apiRequest<AdminRoleRequest[]>('/admin/role-requests?scope=all', 'GET', token ?? undefined),
          apiRequest<AdminManagedUser[]>('/admin/users?scope=all', 'GET', token ?? undefined),
        ])
        setRequests(Array.isArray(roleRequests) ? roleRequests : [])
        setUsers(Array.isArray(managedUsers) ? managedUsers : [])
      } else {
        setRequests([])
        setUsers([])
      }
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, pushToast])

  useEffect(() => {
    void load()
  }, [load])

  const requestManagerRole = async () => {
    try {
      await apiRequest('/users/role-requests', 'POST', token ?? undefined, { requested_role: 'Manager' })
      pushToast('success', 'Manager role request submitted')
      await load()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const approveRequest = async (id: number) => {
    try {
      await apiRequest(`/admin/role-requests/${id}/approve`, 'POST', token ?? undefined)
      pushToast('success', 'Role request approved')
      await load()
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
      await load()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const upgradeUser = async (id: number) => {
    try {
      await apiRequest(`/admin/users/${id}/upgrade-role`, 'POST', token ?? undefined)
      pushToast('success', 'User upgraded to Manager')
      await load()
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
      await load()
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
      await load()
    } catch (err) {
      pushToast('error', (err as Error).message)
    }
  }

  const isAdmin = isAdminRole(profile?.role)
  const canRequestManager = String(profile?.role || '').toLowerCase() === 'warehouse staff' && roleStatus?.status !== 'pending'

  return (
    <section className="profile-page">
      {modal}
      <div className="product-title-block">
        <h2>My Profile</h2>
        <p>View your access details and manage role requests.</p>
      </div>

      <div className="list-card" style={{ marginTop: 12 }}>
        <div className="list-header">
          <h2>Account</h2>
        </div>
        {loading ? (
          <p className="muted">Loading profile...</p>
        ) : (
          <div>
            <p><strong>Name:</strong> {profile?.name ?? '-'}</p>
            <p><strong>Email:</strong> {profile?.email ?? '-'}</p>
            <p><strong>Role:</strong> {profile?.role ?? '-'}</p>
            <p><strong>Role request status:</strong> {roleStatus?.status ?? 'not_requested'}</p>
            {canRequestManager && (
              <button type="button" className="btn btn-secondary" onClick={() => { void requestManagerRole() }}>
                Request Manager Role
              </button>
            )}
          </div>
        )}
      </div>

      {isAdmin && (
        <>
          <div className="list-card" style={{ marginTop: 12 }}>
            <div className="list-header">
              <h2>Role Requests</h2>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Requested Role</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 && <tr className="empty-row"><td colSpan={5}>No role requests</td></tr>}
                  {requests.map((req) => (
                    <tr key={req.id}>
                      <td>{req.name}</td>
                      <td>{req.email}</td>
                      <td>{req.requested_role}</td>
                      <td>{req.status}</td>
                      <td>
                        <div className="operation-row-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void approveRequest(req.id) }}>Approve</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void rejectRequest(req.id) }}>Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="list-card" style={{ marginTop: 12 }}>
            <div className="list-header">
              <h2>User Management</h2>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && <tr className="empty-row"><td colSpan={4}>No users</td></tr>}
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{user.role}</td>
                      <td>
                        <div className="operation-row-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void upgradeUser(user.id) }}>Upgrade</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void revokeUser(user.id) }}>Revoke</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void deleteUser(user.id) }}>Delete</button>
                        </div>
                      </td>
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
