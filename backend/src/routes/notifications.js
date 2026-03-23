/**
 * In-app notifications route.
 *
 * GET /api/notifications
 */

const express = require('express')
const { requireAuth } = require('../auth')
const { getDb } = require('../db')
const { PENDING_ROLE_REQUEST_STATUSES } = require('../constants')

const router = express.Router()

router.get('/', requireAuth, async (req, res) => {
  const db   = await getDb()
  const role = String(req.user.role || '').trim().toLowerCase()
  const isAdmin    = role === 'admin'
  const isElevated = isAdmin || role === 'manager'

  const notifications = []

  try {
    // Own role-request status
    const ownRequest = await db.get(
      `SELECT status, role AS requested_role, created_at
       FROM Signup_Verifications
       WHERE LOWER(email) = LOWER(?)
       ORDER BY created_at DESC LIMIT 1`,
      String(req.user.email).toLowerCase().trim(),
    )

    if (ownRequest) {
      const s = String(ownRequest.status || '').toUpperCase()
      if (PENDING_ROLE_REQUEST_STATUSES.has(s)) {
        notifications.push({
          id: 'role-pending', kind: 'info',
          title: 'Role request pending',
          message: `Your request for ${ownRequest.requested_role} is awaiting admin approval.`,
          link: '/profile',
        })
      } else if (s === 'APPROVED') {
        notifications.push({
          id: 'role-approved', kind: 'success',
          title: 'Role request approved',
          message: `Your ${ownRequest.requested_role} role has been approved.`,
          link: '/profile',
        })
      } else if (s === 'REJECTED') {
        notifications.push({
          id: 'role-rejected', kind: 'warning',
          title: 'Role request rejected',
          message: `Your request for ${ownRequest.requested_role} was rejected.`,
          link: '/profile',
        })
      } else if (s === 'REVOKED') {
        notifications.push({
          id: 'role-revoked', kind: 'warning',
          title: 'Role updated by admin',
          message: `Your access was updated to ${ownRequest.requested_role}.`,
          link: '/profile',
        })
      }
    }

    // Admin: pending role approvals
    if (isAdmin) {
      const pending = await db.get(
        `SELECT COUNT(*) AS count FROM Signup_Verifications
         WHERE UPPER(COALESCE(status,'')) = ANY(?)`,
        Array.from(PENDING_ROLE_REQUEST_STATUSES),
      )
      const count = Number(pending?.count || 0)
      if (count > 0) {
        notifications.push({
          id: 'admin-pending-roles', kind: 'warning',
          title: `${count} pending role request${count > 1 ? 's' : ''}`,
          message: 'Users are waiting for role approval.',
          link: '/profile',
        })
      }
    }

    // Elevated: low stock alerts
    if (isElevated) {
      const lowStock = await db.all(
        `SELECT p.name, COALESCE(SUM(sq.quantity), 0) AS stock, p.reorder_minimum
         FROM Products p
         LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
         GROUP BY p.id, p.name, p.reorder_minimum
         HAVING p.reorder_minimum > 0 AND COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum
         ORDER BY stock ASC LIMIT 10`,
      )
      for (const item of lowStock) {
        const stock = Number(item.stock)
        const isOut = stock <= 0
        notifications.push({
          id: `low-stock-${item.name}`,
          kind: isOut ? 'error' : 'warning',
          title: isOut ? `Out of stock: ${item.name}` : `Low stock: ${item.name}`,
          message: isOut
            ? `${item.name} is completely out of stock.`
            : `Only ${stock} units left (reorder at ${item.reorder_minimum}).`,
          link: '/products',
        })
      }
    }

    // Elevated: operations pending action (direct links to each operation)
    if (isElevated) {
      const pendingRows = await db.all(
        `SELECT id, reference_number, type, status, created_at
           FROM Operations
          WHERE status IN ('Waiting', 'Ready')
          ORDER BY created_at ASC
          LIMIT 8`,
      )

      const routeByType = {
        Receipt: '/operations/receipts',
        Delivery: '/operations/deliveries',
        Internal: '/operations/transfers',
        Adjustment: '/operations/adjustments',
      }

      for (const op of pendingRows) {
        const opType = String(op.type || 'Receipt')
        const baseRoute = routeByType[opType] || '/operations/receipts'
        const opId = Number(op.id)
        const ref = String(op.reference_number || `#${opId}`)
        const status = String(op.status || 'Waiting')
        notifications.push({
          id: `pending-op-${opId}`,
          kind: status === 'Ready' ? 'warning' : 'info',
          title: `${opType} pending: ${ref}`,
          message: `Status is ${status}. Click View to open this exact operation.`,
          link: `${baseRoute}?focusOp=${opId}`,
        })
      }

      const pendingCount = await db.get(
        "SELECT COUNT(*) AS count FROM Operations WHERE status IN ('Waiting', 'Ready')",
      )
      const totalPending = Number(pendingCount?.count || 0)
      if (totalPending > pendingRows.length) {
        notifications.push({
          id: 'pending-ops-more',
          kind: 'info',
          title: `${totalPending} operations pending`,
          message: `${pendingRows.length} shown here. Open Operations to view all pending records.`,
          link: '/operations/receipts',
        })
      }
    }

    return res.json(notifications)
  } catch (error) {
    console.error('[notifications]', error)
    return res.status(500).json({ message: 'Failed to load notifications' })
  }
})

module.exports = router
