/**
 * Admin-only routes (require Admin role).
 *
 * GET  /api/admin/role-requests
 * POST /api/admin/role-requests/:id/approve
 * POST /api/admin/role-requests/:id/reject
 * GET  /api/admin/users
 * POST /api/admin/users/:id/upgrade-role
 * POST /api/admin/users/:id/revoke-role
 * DELETE /api/admin/users/:id
 * GET  /api/admin/role-audit-log
 */

const express = require('express')
const { requireAuth, requireRole } = require('../auth')
const { getDb } = require('../db')
const { ADMIN_ROLES, PENDING_ROLE_REQUEST_STATUSES } = require('../constants')
const { isPendingRoleRequestStatus } = require('../utils/validation')
const {
  sendRoleApprovedEmail,
  sendRoleRejectedEmail,
  sendRoleUpdatedEmail,
} = require('../services/emailService')

const router = express.Router()

// All admin routes require Admin role
router.use(requireAuth, requireRole(ADMIN_ROLES))

// Role requests
router.get('/role-requests', async (req, res) => {
  try {
    const db      = await getDb()
    const scope   = String(req.query.scope || 'pending').toLowerCase()
    const showAll = scope === 'all'

    const rows = showAll
      ? await db.all(`
          SELECT sv.id, sv.name, sv.email, sv.role AS requested_role,
                 sv.status, sv.created_at, sv.reviewed_at, sv.review_note,
                 u.name AS reviewed_by_name
          FROM Signup_Verifications sv
          LEFT JOIN Users u ON u.id = sv.reviewed_by
          ORDER BY sv.created_at DESC`)
      : await db.all(`
          SELECT sv.id, sv.name, sv.email, sv.role AS requested_role,
                 sv.status, sv.created_at, sv.reviewed_at, sv.review_note,
                 u.name AS reviewed_by_name
          FROM Signup_Verifications sv
          LEFT JOIN Users u ON u.id = sv.reviewed_by
          WHERE UPPER(COALESCE(sv.status, '')) = ANY(?)
          ORDER BY sv.created_at ASC`,
        Array.from(PENDING_ROLE_REQUEST_STATUSES),
      )

    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to load role requests' })
  }
})

router.post('/role-requests/:id/approve', async (req, res) => {
  const requestId = Number(req.params.id)
  if (!Number.isFinite(requestId)) return res.status(400).json({ message: 'Invalid request id' })

  try {
    const db      = await getDb()
    const pending = await db.get('SELECT * FROM Signup_Verifications WHERE id = ?', requestId)

    if (!pending) return res.status(404).json({ message: 'Role request not found' })
    if (!isPendingRoleRequestStatus(pending.status)) {
      return res.status(400).json({ message: 'Role request is not pending admin approval' })
    }

    const existingUser = await db.get('SELECT id FROM Users WHERE email = ?', String(pending.email).toLowerCase().trim())

    await db.transaction(async (tx) => {
      if (!existingUser) {
        await tx.run(
          'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
          pending.name, String(pending.email).toLowerCase().trim(), pending.password_hash, pending.role,
        )
      } else {
        await tx.run('UPDATE Users SET role = ? WHERE id = ?', pending.role, existingUser.id)
      }
      await tx.run(
        `UPDATE Signup_Verifications
         SET status='APPROVED', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, review_note=?
         WHERE id=?`,
        req.user.id, `Approved for role ${pending.role}`, requestId,
      )
    })

    try {
      await db.run(
        `INSERT INTO Role_Audit_Log (action, target_user_email, new_role, performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        'ROLE_APPROVED', String(pending.email).toLowerCase().trim(), pending.role,
        req.user.id, String(req.user.email).toLowerCase().trim(),
        `Approved role request for ${pending.role}`,
      )
    } catch { /* non-fatal */ }

    void sendRoleApprovedEmail(
      String(pending.email).toLowerCase().trim(), pending.name, pending.role,
    ).catch((e) => console.error('[admin/approve email]', e))

    return res.json({ message: `Role request approved. User can now access ${pending.role} permissions.` })
  } catch {
    return res.status(500).json({ message: 'Failed to approve role request' })
  }
})

router.post('/role-requests/:id/reject', async (req, res) => {
  const requestId  = Number(req.params.id)
  if (!Number.isFinite(requestId)) return res.status(400).json({ message: 'Invalid request id' })

  const reviewNote = String(req.body?.note || 'Rejected by admin').trim()
  if (!reviewNote || reviewNote.length > 500) {
    return res.status(400).json({ message: 'Rejection note must be 1-500 characters' })
  }

  try {
    const db = await getDb()
    const pending = await db.get('SELECT id, status, email, name, role FROM Signup_Verifications WHERE id = ?', requestId)
    if (!pending) return res.status(404).json({ message: 'Role request not found' })
    if (!isPendingRoleRequestStatus(pending.status)) {
      return res.status(400).json({ message: 'Role request is not pending admin approval' })
    }

    await db.run(
      `UPDATE Signup_Verifications
       SET status='REJECTED', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, review_note=?
       WHERE id=?`,
      req.user.id, reviewNote, requestId,
    )

    try {
      await db.run(
        `INSERT INTO Role_Audit_Log (action, target_user_email, new_role, performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        'ROLE_REJECTED', String(pending.email).toLowerCase().trim(), pending.role,
        req.user.id, String(req.user.email).toLowerCase().trim(), reviewNote,
      )
    } catch { /* non-fatal */ }

    void sendRoleRejectedEmail(
      String(pending.email).toLowerCase().trim(), pending.name, pending.role, reviewNote,
    ).catch((e) => console.error('[admin/reject email]', e))

    return res.json({ message: 'Role request rejected' })
  } catch {
    return res.status(500).json({ message: 'Failed to reject role request' })
  }
})

// User management
router.get('/users', async (req, res) => {
  try {
    const db    = await getDb()
    const scope = String(req.query.scope || 'elevated').toLowerCase()

    const rows = scope === 'all'
      ? await db.all('SELECT id, name, email, role FROM Users ORDER BY name ASC')
      : await db.all(
          "SELECT id, name, email, role FROM Users WHERE LOWER(role) <> 'warehouse staff' ORDER BY name ASC",
        )

    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to load users' })
  }
})

router.post('/users/:id/upgrade-role', async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId)) return res.status(400).json({ message: 'Invalid user id' })

  try {
    const db         = await getDb()
    const targetUser = await db.get('SELECT id, name, email, role, password_hash FROM Users WHERE id = ?', userId)
    if (!targetUser) return res.status(404).json({ message: 'User not found' })
    if (String(targetUser.role || '').trim().toLowerCase() !== 'warehouse staff') {
      return res.status(400).json({ message: 'Only warehouse staff can be upgraded with this action.' })
    }

    await db.transaction(async (tx) => {
      await tx.run('UPDATE Users SET role = ? WHERE id = ?', 'Manager', userId)
      await tx.run(
        `INSERT INTO Signup_Verifications
           (email, name, password_hash, role, status, otp_code, otp_expires_at,
            reviewed_by, reviewed_at, review_note, created_at)
         VALUES (?, ?, ?, ?, 'APPROVED', 'ADMIN_UPGRADE',
           CURRENT_TIMESTAMP + INTERVAL '10 minutes',
           ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role,
           status='APPROVED', otp_code='ADMIN_UPGRADE',
           otp_expires_at=EXCLUDED.otp_expires_at,
           reviewed_by=EXCLUDED.reviewed_by, reviewed_at=EXCLUDED.reviewed_at,
           review_note=EXCLUDED.review_note, created_at=CURRENT_TIMESTAMP`,
        String(targetUser.email).toLowerCase().trim(), targetUser.name, targetUser.password_hash,
        'Manager', req.user.id, 'Upgraded directly to Manager by admin',
      )
    })

    try {
      await db.run(
        `INSERT INTO Role_Audit_Log
           (action, target_user_id, target_user_email, old_role, new_role,
            performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'ROLE_UPGRADED', targetUser.id, String(targetUser.email).toLowerCase().trim(),
        'Warehouse Staff', 'Manager',
        req.user.id, String(req.user.email).toLowerCase().trim(),
        'Role upgraded from Warehouse Staff to Manager by admin',
      )
    } catch { /* non-fatal */ }

    void sendRoleUpdatedEmail(
      String(targetUser.email).toLowerCase().trim(), targetUser.name,
      'Warehouse Staff', 'Manager', 'Your role has been upgraded to Manager by admin',
    ).catch((e) => console.error('[admin/upgrade email]', e))

    return res.json({ message: `${targetUser.name} has been upgraded to Manager.` })
  } catch {
    return res.status(500).json({ message: 'Failed to upgrade user role' })
  }
})

router.post('/users/:id/revoke-role', async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId)) return res.status(400).json({ message: 'Invalid user id' })
  if (userId === req.user.id) return res.status(400).json({ message: 'You cannot revoke your own role.' })

  try {
    const db         = await getDb()
    const targetUser = await db.get('SELECT id, name, email, role, password_hash FROM Users WHERE id = ?', userId)
    if (!targetUser) return res.status(404).json({ message: 'User not found' })

    if (String(targetUser.role || '').trim().toLowerCase() === 'warehouse staff') {
      return res.status(400).json({ message: 'User already has warehouse staff access.' })
    }
    if (String(targetUser.role || '').trim().toLowerCase() === 'admin') {
      const adminCount = await db.get("SELECT COUNT(*) AS count FROM Users WHERE LOWER(role) = 'admin'")
      if (Number(adminCount?.count || 0) <= 1) {
        return res.status(400).json({ message: 'Cannot revoke the last admin account.' })
      }
    }

    await db.transaction(async (tx) => {
      await tx.run('UPDATE Users SET role = ? WHERE id = ?', 'Warehouse Staff', userId)
      await tx.run(
        `INSERT INTO Signup_Verifications
           (email, name, password_hash, role, status, otp_code, otp_expires_at,
            reviewed_by, reviewed_at, review_note, created_at)
         VALUES (?, ?, ?, ?, 'REVOKED', 'ADMIN_REVOKE',
           CURRENT_TIMESTAMP + INTERVAL '10 minutes',
           ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (email) DO UPDATE SET
           name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role,
           status='REVOKED', otp_code='ADMIN_REVOKE',
           otp_expires_at=EXCLUDED.otp_expires_at,
           reviewed_by=EXCLUDED.reviewed_by, reviewed_at=EXCLUDED.reviewed_at,
           review_note=EXCLUDED.review_note, created_at=CURRENT_TIMESTAMP`,
        String(targetUser.email).toLowerCase().trim(), targetUser.name, targetUser.password_hash,
        'Warehouse Staff', req.user.id, `Role revoked from ${targetUser.role} to Warehouse Staff by admin`,
      )
    })

    try {
      await db.run(
        `INSERT INTO Role_Audit_Log
           (action, target_user_id, target_user_email, old_role, new_role,
            performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'ROLE_REVOKED', targetUser.id, String(targetUser.email).toLowerCase().trim(),
        targetUser.role, 'Warehouse Staff',
        req.user.id, String(req.user.email).toLowerCase().trim(),
        `Role revoked from ${targetUser.role} to Warehouse Staff by admin`,
      )
    } catch { /* non-fatal */ }

    void sendRoleUpdatedEmail(
      String(targetUser.email).toLowerCase().trim(), targetUser.name,
      targetUser.role, 'Warehouse Staff', 'Your role has been revoked to Warehouse Staff by admin',
    ).catch((e) => console.error('[admin/revoke email]', e))

    return res.json({ message: 'User role revoked to Warehouse Staff.' })
  } catch {
    return res.status(500).json({ message: 'Failed to revoke user role' })
  }
})

router.delete('/users/:id', async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId)) return res.status(400).json({ message: 'Invalid user id' })
  if (userId === req.user.id) return res.status(400).json({ message: 'You cannot delete your own account.' })

  try {
    const db         = await getDb()
    const targetUser = await db.get('SELECT id, name, email, role FROM Users WHERE id = ?', userId)
    if (!targetUser) return res.status(404).json({ message: 'User not found' })

    if (String(targetUser.role || '').trim().toLowerCase() === 'admin') {
      const adminCount = await db.get("SELECT COUNT(*) AS count FROM Users WHERE LOWER(role) = 'admin'")
      if (Number(adminCount?.count || 0) <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last admin account.' })
      }
    }

    await db.run('UPDATE Operations SET created_by = NULL WHERE created_by = ?', userId)
    await db.run('UPDATE Signup_Verifications SET reviewed_by = NULL WHERE reviewed_by = ?', userId)
    await db.run('DELETE FROM Users WHERE id = ?', userId)

    try {
      await db.run(
        `INSERT INTO Role_Audit_Log
           (action, target_user_id, target_user_email, old_role, new_role,
            performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'USER_DELETED', targetUser.id, String(targetUser.email).toLowerCase().trim(),
        targetUser.role, null,
        req.user.id, String(req.user.email).toLowerCase().trim(),
        'User account deleted by admin',
      )
    } catch { /* non-fatal */ }

    return res.json({ message: `User ${targetUser.name} has been deleted.` })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete user', detail: error?.message })
  }
})

// Role audit log
router.get('/role-audit-log', async (req, res) => {
  try {
    const db    = await getDb()
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const rows  = await db.all(
      `SELECT id, action, target_user_id, target_user_email, old_role, new_role,
              performed_by_id, performed_by_email, note, created_at
       FROM Role_Audit_Log ORDER BY created_at DESC LIMIT ?`,
      limit,
    )
    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to load audit log' })
  }
})

module.exports = router
