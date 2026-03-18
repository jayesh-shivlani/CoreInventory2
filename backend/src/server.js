const path = require('path')
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const dns = require('dns').promises
const fs = require('fs')
const {
  OTP_TTL_MINUTES,
  PORT,
  RESET_OTP_TTL_MINUTES,
  STRICT_EMAIL_DOMAIN_CHECK,
  isCorsOriginAllowed,
  validateRuntimeConfig,
} = require('./config')
const {
  getEmailProviderState,
  sendOtpEmail,
  sendRoleApprovedEmail,
  toOtpDeliveryMessage,
} = require('./services/emailService')
const { withTimeout } = require('./utils/withTimeout')
const { buildReference, ensureLocationByName, getDb, initDb } = require('./db')
const { requireAuth, requireRole, signToken } = require('./auth')

const app = express()
const ALLOWED_SIGNUP_ROLES = ['Warehouse Staff', 'Manager']
const ADMIN_ROLES = ['Admin']
const MANAGER_ROLES = ['Manager', 'Admin']
const PENDING_ROLE_REQUEST_STATUSES = new Set(['AWAITING_ADMIN_APPROVAL', 'PENDING', 'PENDING_ADMIN_APPROVAL'])

function isPendingRoleRequestStatus(status) {
  return PENDING_ROLE_REQUEST_STATUSES.has(String(status || '').trim().toUpperCase())
}

function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function isStrongPassword(password) {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(password || ''))
}

async function hasMxRecord(email) {
  try {
    const normalized = String(email || '').trim().toLowerCase()
    const [, domain] = normalized.split('@')
    if (!domain) return false
    // On some cloud environments (like Render), DNS MX lookup might fail or timeout.
    // If we can't resolve MX, we'll allow the email to proceed to avoid false negatives.
    const records = await withTimeout(dns.resolveMx(domain), 4000).catch(() => null)
    if (records === null) return true // DNS error or timeout, assume valid to be safe
    return Array.isArray(records) && records.length > 0
  } catch {
    return true // Fallback to true on any error to avoid blocking valid signups
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin)) {
        callback(null, true)
      } else {
        callback(new Error('CORS blocked'))
      }
    },
  }),
)
app.use(express.json())

app.get('/api/health', async (req, res) => {
  const db = await getDb()
  const row = await db.get('SELECT datetime("now") AS now')
  const emailState = getEmailProviderState()
  res.json({
    status: 'ok',
    databaseTime: row.now,
    emailProvider: emailState.provider,
    emailConfigured: emailState.configured,
    emailSender: emailState.sender,
  })
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, otp } = req.body || {}
    const normalizedEmail = String(email || '').toLowerCase().trim()

    if (!normalizedEmail) {
      return res.status(400).json({ message: 'email is required' })
    }

    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address' })
    }

    if (STRICT_EMAIL_DOMAIN_CHECK) {
      const emailLooksDeliverable = await hasMxRecord(normalizedEmail)
      if (!emailLooksDeliverable) {
        return res.status(400).json({ message: 'Email domain is not valid for receiving emails' })
      }
    }

    const db = await getDb()

    const existing = await db.get('SELECT id FROM Users WHERE email = ?', normalizedEmail)
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' })
    }

    if (!name || !password) {
      return res.status(400).json({ message: 'name, email, and password are required' })
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and include letters and numbers' })
    }

    const normalizedName = String(name).trim()
    const requestedRole = role && typeof role === 'string' ? String(role).trim() : 'Warehouse Staff'
    const normalizedRole = ALLOWED_SIGNUP_ROLES.includes(requestedRole) ? requestedRole : 'Warehouse Staff'

    if (!otp) {
      const generatedOtp = String(Math.floor(100000 + Math.random() * 900000))
      const hash = await bcrypt.hash(String(password), 10)

      await db.run(
        `
          INSERT INTO Signup_Verifications (email, name, password_hash, role, status, otp_code, otp_expires_at, created_at)
          VALUES (?, ?, ?, ?, 'OTP_PENDING', ?, (CURRENT_TIMESTAMP + (?::text || ' minutes')::interval), CURRENT_TIMESTAMP)
          ON CONFLICT (email)
          DO UPDATE SET
            name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            status = 'OTP_PENDING',
            otp_code = EXCLUDED.otp_code,
            otp_expires_at = EXCLUDED.otp_expires_at,
            reviewed_by = NULL,
            reviewed_at = NULL,
            review_note = NULL,
            created_at = CURRENT_TIMESTAMP
        `,
        normalizedEmail,
        normalizedName,
        hash,
        normalizedRole,
        generatedOtp,
        OTP_TTL_MINUTES,
      )

      try {
        const delivery = await sendOtpEmail(normalizedEmail, generatedOtp, 'signup verification')
        if (delivery.exposed) {
          return res.status(202).json({ message: 'OTP generated and logged in console', dev_otp: generatedOtp })
        }
        if (!delivery.delivered) {
          return res.status(503).json({ message: 'OTP email delivery is unavailable. Please try again shortly.' })
        }
      } catch (error) {
        return res.status(500).json({ message: toOtpDeliveryMessage(error) })
      }

      return res.status(202).json({ message: 'OTP sent to your email' })
    }

    const pending = await db.get(
      'SELECT id, name, email, password_hash, role, status, otp_code, otp_expires_at FROM Signup_Verifications WHERE email = ?',
      normalizedEmail,
    )

    if (!pending) {
      return res.status(400).json({ message: 'Please request an OTP first' })
    }

    if (String(pending.status || '').toUpperCase() === 'AWAITING_ADMIN_APPROVAL') {
      return res.status(409).json({ message: 'Account already created. Waiting for admin role approval.' })
    }

    if (String(pending.status || '').toUpperCase() === 'APPROVED') {
      return res.status(409).json({ message: 'This request was already approved. Please sign in.' })
    }

    if (String(otp).trim() !== String(pending.otp_code || '').trim()) {
      return res.status(400).json({ message: 'Invalid OTP code. If you requested a new OTP, use the latest one from your email.' })
    }

    const notExpired = await db.get(
      'SELECT id FROM Signup_Verifications WHERE email = ? AND otp_expires_at > CURRENT_TIMESTAMP',
      normalizedEmail,
    )
    if (!notExpired) {
      await db.run('DELETE FROM Signup_Verifications WHERE email = ?', normalizedEmail)
      return res.status(400).json({ message: 'OTP expired. Please request a new one.' })
    }

    const existingUser = await db.get('SELECT id FROM Users WHERE email = ?', normalizedEmail)
    if (!existingUser) {
      await db.run(
        'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        pending.name,
        pending.email,
        pending.password_hash,
        'Warehouse Staff',
      )
    }

    await db.run(
      `
        UPDATE Signup_Verifications
        SET status = 'AWAITING_ADMIN_APPROVAL', otp_code = NULL
        WHERE email = ?
      `,
      normalizedEmail,
    )

    return res.status(201).json({
      message: 'Account created with default access. Your requested role was sent to admin for one-time approval.',
    })
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' })
    }

    const db = await getDb()
    const user = await db.get('SELECT * FROM Users WHERE email = ?', String(email).toLowerCase().trim())
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const valid = await bcrypt.compare(String(password), user.password_hash)
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const token = signToken(user)
    return res.json({ token })
  } catch (error) {
    return res.status(500).json({ message: 'Login failed' })
  }
})

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {}
    if (!email) {
      return res.status(400).json({ message: 'email is required' })
    }

    const db = await getDb()
    const user = await db.get(
      'SELECT id, otp_code, reset_otp_expires_at FROM Users WHERE email = ?',
      String(email).toLowerCase().trim(),
    )
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!otp || !newPassword) {
      const generatedOtp = String(Math.floor(100000 + Math.random() * 900000))
      await db.run(
        `UPDATE Users
         SET otp_code = ?, reset_otp_expires_at = (CURRENT_TIMESTAMP + (?::text || ' minutes')::interval)
         WHERE id = ?`,
        generatedOtp,
        RESET_OTP_TTL_MINUTES,
        user.id,
      )

      try {
        const delivery = await sendOtpEmail(String(email).toLowerCase().trim(), generatedOtp, 'password reset')
        if (delivery.exposed) {
          return res.json({ message: 'OTP generated and logged in console', dev_otp: generatedOtp })
        }
        if (!delivery.delivered) {
          return res.status(503).json({ message: 'OTP email delivery is unavailable. Please try again shortly.' })
        }
      } catch (error) {
        return res.status(500).json({ message: toOtpDeliveryMessage(error) })
      }

      return res.json({ message: 'OTP sent to your email' })
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ message: 'newPassword must be at least 8 characters and include letters and numbers' })
    }

    if (String(otp).trim() !== String(user.otp_code || '').trim()) {
      return res.status(400).json({ message: 'Invalid OTP code. If you requested a new OTP, use the latest one from your email.' })
    }

    const notExpired = await db.get(
      'SELECT id FROM Users WHERE id = ? AND reset_otp_expires_at > CURRENT_TIMESTAMP',
      user.id,
    )
    if (!notExpired) {
      await db.run('UPDATE Users SET otp_code = NULL, reset_otp_expires_at = NULL WHERE id = ?', user.id)
      return res.status(400).json({ message: 'OTP expired. Please request a new one.' })
    }

    const hash = await bcrypt.hash(String(newPassword), 10)
    await db.run('UPDATE Users SET password_hash = ?, otp_code = NULL, reset_otp_expires_at = NULL WHERE id = ?', hash, user.id)

    return res.json({ message: 'Password reset successful' })
  } catch (error) {
    return res.status(500).json({ message: 'Password reset failed' })
  }
})

app.get('/api/users/me', requireAuth, async (req, res) => {
  res.json(req.user)
})

app.get('/api/users/role-request-status', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const latest = await db.get(
      `
        SELECT
          role,
          status,
          created_at,
          reviewed_at,
          review_note
        FROM Signup_Verifications
        WHERE email = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      String(req.user.email || '').toLowerCase().trim(),
    )

    if (!latest) {
      return res.json({
        status: 'not_requested',
        requested_role: null,
        requested_at: null,
        reviewed_at: null,
        review_note: null,
      })
    }

    const normalized = String(latest.status || '').trim().toUpperCase()
    const status = isPendingRoleRequestStatus(normalized)
      ? 'pending'
      : normalized === 'APPROVED'
        ? 'completed'
        : normalized === 'REJECTED'
          ? 'rejected'
          : 'pending'

    return res.json({
      status,
      requested_role: latest.role || null,
      requested_at: latest.created_at || null,
      reviewed_at: latest.reviewed_at || null,
      review_note: latest.review_note || null,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load role request status' })
  }
})

app.get('/api/admin/role-requests', requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const scope = String(req.query.scope || 'pending').trim().toLowerCase()
    const showAll = scope === 'all'
    const db = await getDb()
    const rows = showAll
      ? await db.all(
          `
            SELECT
              sv.id,
              sv.name,
              sv.email,
              sv.role AS requested_role,
              sv.status,
              sv.created_at,
              sv.reviewed_at,
              sv.review_note,
              u.name AS reviewed_by_name
            FROM Signup_Verifications sv
            LEFT JOIN Users u ON u.id = sv.reviewed_by
            ORDER BY sv.created_at DESC
          `,
        )
      : await db.all(
          `
            SELECT
              sv.id,
              sv.name,
              sv.email,
              sv.role AS requested_role,
              sv.status,
              sv.created_at,
              sv.reviewed_at,
              sv.review_note,
              u.name AS reviewed_by_name
            FROM Signup_Verifications sv
            LEFT JOIN Users u ON u.id = sv.reviewed_by
            WHERE UPPER(COALESCE(sv.status, '')) = ANY(?)
            ORDER BY sv.created_at ASC
          `,
          Array.from(PENDING_ROLE_REQUEST_STATUSES),
        )

    return res.json(rows)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load role requests' })
  }
})

app.post('/api/admin/role-requests/:id/approve', requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  const requestId = Number(req.params.id)
  if (!Number.isFinite(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' })
  }

  const db = await getDb()
  try {
    const pending = await db.get('SELECT * FROM Signup_Verifications WHERE id = ?', requestId)
    if (!pending) {
      return res.status(404).json({ message: 'Role request not found' })
    }

    if (!isPendingRoleRequestStatus(pending.status)) {
      return res.status(400).json({ message: 'Role request is not pending admin approval' })
    }

    const existingUser = await db.get('SELECT id FROM Users WHERE email = ?', String(pending.email).toLowerCase().trim())

    await db.exec('BEGIN')
    try {
      if (!existingUser) {
        await db.run(
          'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
          pending.name,
          String(pending.email).toLowerCase().trim(),
          pending.password_hash,
          pending.role,
        )
      } else {
        await db.run('UPDATE Users SET role = ? WHERE id = ?', pending.role, existingUser.id)
      }

      await db.run(
        `
          UPDATE Signup_Verifications
          SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
          WHERE id = ?
        `,
        req.user.id,
        `Approved for role ${pending.role}`,
        requestId,
      )

      await db.exec('COMMIT')

      // Audit trail
      try {
        await db.run(
          `INSERT INTO Role_Audit_Log (action, target_user_email, new_role, performed_by_id, performed_by_email, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          'ROLE_APPROVED',
          String(pending.email).toLowerCase().trim(),
          pending.role,
          req.user.id,
          String(req.user.email).toLowerCase().trim(),
          `Approved role request for ${pending.role}`,
        )
      } catch (_auditErr) { /* non-fatal */ }

      void sendRoleApprovedEmail(
        String(pending.email).toLowerCase().trim(),
        pending.name,
        pending.role,
      ).catch((emailError) => {
        console.error('Failed to send role approval email:', emailError)
      })

      return res.json({ message: `Role request approved. User can now access ${pending.role} permissions.` })
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    return res.status(500).json({ message: 'Failed to approve role request' })
  }
})

app.post('/api/admin/role-requests/:id/reject', requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  const requestId = Number(req.params.id)
  if (!Number.isFinite(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' })
  }

  const reviewNote = String(req.body?.note || 'Rejected by admin').trim()
  const db = await getDb()

  try {
    const pending = await db.get('SELECT id, status FROM Signup_Verifications WHERE id = ?', requestId)
    if (!pending) {
      return res.status(404).json({ message: 'Role request not found' })
    }

    if (!isPendingRoleRequestStatus(pending.status)) {
      return res.status(400).json({ message: 'Role request is not pending admin approval' })
    }

    const pendingForReject = await db.get('SELECT email, role FROM Signup_Verifications WHERE id = ?', requestId)

    await db.run(
      `
        UPDATE Signup_Verifications
        SET status = 'REJECTED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
        WHERE id = ?
      `,
      req.user.id,
      reviewNote,
      requestId,
    )

    // Audit trail
    try {
      await db.run(
        `INSERT INTO Role_Audit_Log (action, target_user_email, new_role, performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        'ROLE_REJECTED',
        pendingForReject ? String(pendingForReject.email).toLowerCase().trim() : null,
        pendingForReject ? pendingForReject.role : null,
        req.user.id,
        String(req.user.email).toLowerCase().trim(),
        reviewNote,
      )
    } catch (_auditErr) { /* non-fatal */ }

    return res.json({ message: 'Role request rejected' })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reject role request' })
  }
})

app.get('/api/admin/users', requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const scope = String(req.query.scope || 'elevated').trim().toLowerCase()
    const db = await getDb()
    const rows = scope === 'all'
      ? await db.all(
          `
            SELECT id, name, email, role
            FROM Users
            ORDER BY name ASC
          `,
        )
      : await db.all(
          `
            SELECT id, name, email, role
            FROM Users
            WHERE LOWER(role) <> LOWER(?)
            ORDER BY name ASC
          `,
          'Warehouse Staff',
        )

    return res.json(rows)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load users' })
  }
})

app.post('/api/admin/users/:id/revoke-role', requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ message: 'Invalid user id' })
  }

  if (userId === req.user.id) {
    return res.status(400).json({ message: 'You cannot revoke your own role.' })
  }

  const db = await getDb()
  try {
    const targetUser = await db.get('SELECT id, name, email, role FROM Users WHERE id = ?', userId)
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (String(targetUser.role || '').trim().toLowerCase() === 'warehouse staff') {
      return res.status(400).json({ message: 'User already has warehouse staff access.' })
    }

    if (String(targetUser.role || '').trim().toLowerCase() === 'admin') {
      const adminCountRow = await db.get("SELECT COUNT(*) AS count FROM Users WHERE LOWER(role) = 'admin'")
      const adminCount = Number(adminCountRow?.count || 0)
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot revoke the last admin account.' })
      }
    }

    await db.run('UPDATE Users SET role = ? WHERE id = ?', 'Warehouse Staff', userId)

    // Audit trail
    try {
      await db.run(
        `INSERT INTO Role_Audit_Log (action, target_user_id, target_user_email, old_role, new_role, performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'ROLE_REVOKED',
        targetUser.id,
        String(targetUser.email).toLowerCase().trim(),
        targetUser.role,
        'Warehouse Staff',
        req.user.id,
        String(req.user.email).toLowerCase().trim(),
        `Role revoked from ${targetUser.role} to Warehouse Staff by admin`,
      )
    } catch (_auditErr) { /* non-fatal */ }

    return res.json({ message: 'User role revoked to Warehouse Staff.' })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to revoke user role' })
  }
})

app.delete('/api/admin/users/:id', requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ message: 'Invalid user id' })
  }

  if (userId === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own account.' })
  }

  const db = await getDb()
  try {
    const targetUser = await db.get('SELECT id, name, email, role FROM Users WHERE id = ?', userId)
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (String(targetUser.role || '').trim().toLowerCase() === 'admin') {
      const adminCountRow = await db.get("SELECT COUNT(*) AS count FROM Users WHERE LOWER(role) = 'admin'")
      const adminCount = Number(adminCountRow?.count || 0)
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last admin account.' })
      }
    }

    await db.run('UPDATE Operations SET created_by = NULL WHERE created_by = ?', userId)
    await db.run('UPDATE Signup_Verifications SET reviewed_by = NULL WHERE reviewed_by = ?', userId)
    await db.run('DELETE FROM Users WHERE id = ?', userId)

    // Audit trail
    try {
      await db.run(
        `INSERT INTO Role_Audit_Log (action, target_user_id, target_user_email, old_role, new_role, performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'USER_DELETED',
        targetUser.id,
        String(targetUser.email).toLowerCase().trim(),
        targetUser.role,
        null,
        req.user.id,
        String(req.user.email).toLowerCase().trim(),
        `User account deleted by admin`,
      )
    } catch (_auditErr) { /* non-fatal */ }

    return res.json({ message: `User ${targetUser.name} has been deleted.` })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete user', detail: error && error.message ? error.message : String(error) })
  }
})


app.get('/api/admin/role-audit-log', requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const db = await getDb()
    const rows = await db.all(
      `SELECT id, action, target_user_id, target_user_email, old_role, new_role,
              performed_by_id, performed_by_email, note, created_at
       FROM Role_Audit_Log
       ORDER BY created_at DESC
       LIMIT ?`,
      limit,
    )
    return res.json(rows)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load audit log' })
  }
})

app.get('/api/notifications', requireAuth, async (req, res) => {
  const db = await getDb()
  const role = String(req.user.role || '').trim().toLowerCase()
  const isAdmin = role === 'admin'
  const isManager = role === 'manager'
  const isElevated = isAdmin || isManager

  const notifications = []

  try {
    // ── All users: own role request status ──────────────────────
    const ownRequest = await db.get(
      `SELECT status, role AS requested_role, created_at
       FROM Signup_Verifications
       WHERE LOWER(email) = LOWER(?)
       ORDER BY created_at DESC
       LIMIT 1`,
      String(req.user.email).toLowerCase().trim(),
    )
    if (ownRequest) {
      const s = String(ownRequest.status || '').toUpperCase()
      if (s === 'AWAITING_ADMIN_APPROVAL' || s === 'PENDING' || s === 'PENDING_ADMIN_APPROVAL') {
        notifications.push({
          id: 'role-pending',
          kind: 'info',
          title: 'Role request pending',
          message: `Your request for ${ownRequest.requested_role} is awaiting admin approval.`,
          link: '/profile',
        })
      } else if (s === 'APPROVED') {
        notifications.push({
          id: 'role-approved',
          kind: 'success',
          title: 'Role request approved',
          message: `Your ${ownRequest.requested_role} role has been approved.`,
          link: '/profile',
        })
      } else if (s === 'REJECTED') {
        notifications.push({
          id: 'role-rejected',
          kind: 'warning',
          title: 'Role request rejected',
          message: `Your request for ${ownRequest.requested_role} was rejected.`,
          link: '/profile',
        })
      }
    }

    // ── Admin: pending role approval requests ───────────────────
    if (isAdmin) {
      const pendingRoleRequests = await db.get(
        `SELECT COUNT(*) AS count FROM Signup_Verifications
         WHERE UPPER(COALESCE(status,'')) = ANY(?)`,
        Array.from(PENDING_ROLE_REQUEST_STATUSES),
      )
      const pendingCount = Number(pendingRoleRequests?.count || 0)
      if (pendingCount > 0) {
        notifications.push({
          id: 'admin-pending-roles',
          kind: 'warning',
          title: `${pendingCount} pending role request${pendingCount > 1 ? 's' : ''}`,
          message: 'Users are waiting for role approval.',
          link: '/profile',
        })
      }
    }

    // ── Elevated: low stock alerts ──────────────────────────────
    if (isElevated) {
      const lowStockItems = await db.all(
        `SELECT p.name, COALESCE(SUM(sq.quantity), 0) AS stock, p.reorder_minimum
         FROM Products p
         LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
         GROUP BY p.id, p.name, p.reorder_minimum
         HAVING p.reorder_minimum > 0 AND COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum
         ORDER BY stock ASC
         LIMIT 10`,
      )
      for (const item of lowStockItems) {
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

    // ── Elevated: operations waiting/ready to process ───────────
    if (isElevated) {
      const pendingOps = await db.get(
        `SELECT COUNT(*) AS count FROM Operations WHERE status IN ('Waiting', 'Ready')`,
      )
      const opCount = Number(pendingOps?.count || 0)
      if (opCount > 0) {
        notifications.push({
          id: 'pending-ops',
          kind: 'info',
          title: `${opCount} operation${opCount > 1 ? 's' : ''} pending`,
          message: `${opCount} operation${opCount > 1 ? 's are' : ' is'} waiting to be processed.`,
          link: '/operations/receipts',
        })
      }
    }

    return res.json(notifications)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load notifications' })
  }
})

app.get('/api/locations', requireAuth, async (req, res) => {
  const db = await getDb()
  const rows = await db.all('SELECT id, name, type FROM Locations ORDER BY name')
  res.json(rows)
})

app.post('/api/locations', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { name, type } = req.body || {}
    if (!name || !type) {
      return res.status(400).json({ message: 'name and type are required' })
    }

    const db = await getDb()
    const existing = await db.get('SELECT id FROM Locations WHERE name = ?', String(name).trim())
    if (existing) {
      return res.status(409).json({ message: 'Location name already exists' })
    }

    const result = await db.run(
      'INSERT INTO Locations (name, type) VALUES (?, ?)',
      String(name).trim(),
      String(type).trim(),
    )

    res.status(201).json({ id: result.lastID, name: String(name).trim(), type: String(type).trim() })
  } catch (error) {
    res.status(500).json({ message: 'Failed to create location' })
  }
})

app.get('/api/products', requireAuth, async (req, res) => {
  const db = await getDb()
  const search = String(req.query.search || '').trim()
  const category = String(req.query.category || '').trim()
  const location = String(req.query.location || '').trim()
  const lowStockOnly = String(req.query.lowStockOnly || '').trim() === 'true'

  const values = []
  const conditions = []

  if (search) {
    conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)')
    values.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (category) {
    conditions.push('p.category = ?')
    values.push(category)
  }
  if (location) {
    conditions.push('l.name = ?')
    values.push(location)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const having = lowStockOnly ? 'HAVING COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum' : ''

  const rows = await db.all(
    `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.category,
        p.unit_of_measure,
        p.reorder_minimum,
        COALESCE(SUM(sq.quantity), 0) AS "availableStock",
        MAX(l.name) AS "locationName"
      FROM Products p
      LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
      LEFT JOIN Locations l ON l.id = sq.location_id
      ${where}
      GROUP BY p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum
      ${having}
      ORDER BY p.name ASC
    `,
    ...values,
  )

  res.json(rows)
})

app.get('/api/products/filter-options', requireAuth, async (req, res) => {
  const db = await getDb()

  const [categories, locations, uoms] = await Promise.all([
    db.all("SELECT DISTINCT category FROM Products WHERE category IS NOT NULL AND category <> '' ORDER BY category"),
    db.all("SELECT DISTINCT name FROM Locations WHERE name IS NOT NULL AND name <> '' ORDER BY name"),
    db.all("SELECT DISTINCT unit_of_measure FROM Products WHERE unit_of_measure IS NOT NULL AND unit_of_measure <> '' ORDER BY unit_of_measure"),
  ])

  res.json({
    categories: categories.map((x) => x.category).filter(Boolean),
    locations: locations.map((x) => x.name).filter(Boolean),
    uoms: uoms.map((x) => x.unit_of_measure).filter(Boolean),
  })
})

app.post('/api/products', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { name, sku, category, unit_of_measure, initial_stock, reorder_minimum } = req.body || {}

    if (!name || !sku || !category || !unit_of_measure) {
      return res.status(400).json({ message: 'name, sku, category and unit_of_measure are required' })
    }

    const stock = Number(initial_stock || 0)
    const reorder = Number(reorder_minimum || 0)

    if (!Number.isFinite(stock) || stock < 0 || !Number.isFinite(reorder) || reorder < 0) {
      return res.status(400).json({ message: 'initial_stock and reorder_minimum must be non-negative numbers' })
    }

    const db = await getDb()
    const existing = await db.get('SELECT id FROM Products WHERE sku = ?', String(sku).trim())
    if (existing) {
      return res.status(409).json({ message: 'SKU already exists' })
    }

    await db.exec('BEGIN TRANSACTION')
    try {
      const inserted = await db.run(
        'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
        String(name).trim(),
        String(sku).trim(),
        String(category).trim(),
        String(unit_of_measure).trim(),
        reorder,
      )

      const productId = inserted.lastID
      if (stock > 0) {
        const mainLocation = await ensureLocationByName(db, 'Main Warehouse', 'Internal')
        await db.run(
          'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
          productId,
          mainLocation.id,
          stock,
        )
      }

      await db.exec('COMMIT')
      return res.status(201).json({ id: productId })
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save product' })
  }
})

app.get('/api/products/:id/stock', requireAuth, async (req, res) => {
  const db = await getDb()
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ message: 'Invalid product id' })
  }

  const rows = await db.all(
    `
      SELECT
        sq.location_id,
        l.name AS location_name,
        sq.quantity
      FROM Stock_Quants sq
      JOIN Locations l ON l.id = sq.location_id
      WHERE sq.product_id = ?
      ORDER BY l.name
    `,
    productId,
  )

  return res.json(rows)
})

app.get('/api/products/:id', requireAuth, async (req, res) => {
  const db = await getDb()
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ message: 'Invalid product id' })
  }

  const row = await db.get(
    `
      SELECT id, name, sku, category, unit_of_measure, reorder_minimum
      FROM Products
      WHERE id = ?
    `,
    productId,
  )

  if (!row) {
    return res.status(404).json({ message: 'Product not found' })
  }

  return res.json(row)
})

app.put('/api/products/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const db = await getDb()
    const productId = Number(req.params.id)
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const existing = await db.get('SELECT id FROM Products WHERE id = ?', productId)
    if (!existing) {
      return res.status(404).json({ message: 'Product not found' })
    }

    const { name, sku, category, unit_of_measure, reorder_minimum } = req.body || {}
    if (!name || !sku || !category || !unit_of_measure) {
      return res.status(400).json({ message: 'name, sku, category and unit_of_measure are required' })
    }

    const reorder = Number(reorder_minimum ?? 0)
    if (!Number.isFinite(reorder) || reorder < 0) {
      return res.status(400).json({ message: 'reorder_minimum must be a non-negative number' })
    }

    const conflict = await db.get('SELECT id FROM Products WHERE sku = ? AND id <> ?', String(sku).trim(), productId)
    if (conflict) {
      return res.status(409).json({ message: 'SKU already exists' })
    }

    await db.run(
      `
        UPDATE Products
        SET name = ?, sku = ?, category = ?, unit_of_measure = ?, reorder_minimum = ?
        WHERE id = ?
      `,
      String(name).trim(),
      String(sku).trim(),
      String(category).trim(),
      String(unit_of_measure).trim(),
      reorder,
      productId,
    )

    return res.json({ message: 'Product updated', id: productId })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update product' })
  }
})

app.delete('/api/products/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const db = await getDb()
    const productId = Number(req.params.id)
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const product = await db.get('SELECT id, name FROM Products WHERE id = ?', productId)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    const operationLineRef = await db.get(
      'SELECT COUNT(*)::INT AS count FROM Operation_Lines WHERE product_id = ?',
      productId,
    )
    if (Number(operationLineRef?.count || 0) > 0) {
      return res.status(400).json({ message: 'Cannot delete product that is used in operations' })
    }

    const ledgerRef = await db.get(
      'SELECT COUNT(*)::INT AS count FROM Stock_Ledger WHERE product_id = ?',
      productId,
    )
    if (Number(ledgerRef?.count || 0) > 0) {
      return res.status(400).json({ message: 'Cannot delete product that has stock movement history' })
    }

    await db.exec('BEGIN')
    try {
      await db.run('DELETE FROM Stock_Quants WHERE product_id = ?', productId)
      await db.run('DELETE FROM Products WHERE id = ?', productId)
      await db.exec('COMMIT')
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }

    return res.json({ message: 'Product deleted', id: productId })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete product' })
  }
})

app.get('/api/dashboard/kpis', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const documentType = req.query.documentType ? String(req.query.documentType) : ''
    const status = req.query.status ? String(req.query.status) : ''
    const warehouse = req.query.warehouse ? String(req.query.warehouse) : ''
    const category = req.query.category ? String(req.query.category) : ''

    const productConditions = []
    const productValues = []

    if (category) {
      productConditions.push('p.category LIKE ?')
      productValues.push(`%${category}%`)
    }

    if (warehouse) {
      productConditions.push('l.name LIKE ?')
      productValues.push(`%${warehouse}%`)
    }

    const productWhere = productConditions.length ? `WHERE ${productConditions.join(' AND ')}` : ''

    const totalRow = await db.get(
      `
        SELECT COALESCE(SUM(sq.quantity), 0)::INT AS "totalProductsInStock"
        FROM Stock_Quants sq
        JOIN Products p ON p.id = sq.product_id
        JOIN Locations l ON l.id = sq.location_id
        ${productWhere}
      `,
      ...productValues,
    )

    const lowRow = await db.get(
      `
        SELECT COUNT(*)::INT AS "lowOrOutOfStockItems"
        FROM (
          SELECT p.id, p.reorder_minimum, COALESCE(SUM(sq.quantity), 0) AS total_quantity
          FROM Products p
          LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
          LEFT JOIN Locations l ON l.id = sq.location_id
          ${productWhere}
          GROUP BY p.id, p.reorder_minimum
          HAVING COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum
        ) t
      `,
      ...productValues,
    )

    const opConditions = []
    const opValues = []

    if (documentType) {
      opConditions.push('o.type = ?')
      opValues.push(documentType)
    }
    if (status) {
      opConditions.push('o.status = ?')
      opValues.push(status)
    }
    if (warehouse) {
      opConditions.push('(src.name LIKE ? OR dst.name LIKE ?)')
      opValues.push(`%${warehouse}%`, `%${warehouse}%`)
    }

    const opWhere = opConditions.length ? `AND ${opConditions.join(' AND ')}` : ''

    const pendingReceiptRow = await db.get(
      `
        SELECT COUNT(*)::INT AS "pendingReceipts"
        FROM Operations o
        LEFT JOIN Locations src ON src.id = o.source_location_id
        LEFT JOIN Locations dst ON dst.id = o.destination_location_id
        WHERE o.type = 'Receipt'
          AND o.status IN ('Draft', 'Waiting', 'Ready')
          ${opWhere}
      `,
      ...opValues,
    )

    const pendingDeliveryRow = await db.get(
      `
        SELECT COUNT(*)::INT AS "pendingDeliveries"
        FROM Operations o
        LEFT JOIN Locations src ON src.id = o.source_location_id
        LEFT JOIN Locations dst ON dst.id = o.destination_location_id
        WHERE o.type = 'Delivery'
          AND o.status IN ('Draft', 'Waiting', 'Ready')
          ${opWhere}
      `,
      ...opValues,
    )

    const internalRow = await db.get(
      `
        SELECT COUNT(*)::INT AS "scheduledInternalTransfers"
        FROM Operations o
        LEFT JOIN Locations src ON src.id = o.source_location_id
        LEFT JOIN Locations dst ON dst.id = o.destination_location_id
        WHERE o.type = 'Internal'
          AND o.status IN ('Draft', 'Waiting', 'Ready')
          ${opWhere}
      `,
      ...opValues,
    )

    return res.json({
      totalProductsInStock: Number(totalRow?.totalProductsInStock || 0),
      lowOrOutOfStockItems: Number(lowRow?.lowOrOutOfStockItems || 0),
      pendingReceipts: Number(pendingReceiptRow?.pendingReceipts || 0),
      pendingDeliveries: Number(pendingDeliveryRow?.pendingDeliveries || 0),
      scheduledInternalTransfers: Number(internalRow?.scheduledInternalTransfers || 0),
    })
  } catch (error) {
    console.error('KPIs error:', error)
    return res.status(500).json({ message: 'Failed to load dashboard KPIs' })
  }
})

app.get('/api/dashboard/filters', requireAuth, async (req, res) => {
  try {
    const db = await getDb()

    const [warehouses, categories] = await Promise.all([
      db.all('SELECT DISTINCT name FROM Locations ORDER BY name'),
      db.all('SELECT DISTINCT category FROM Products ORDER BY category'),
    ])

    return res.json({
      documentTypes: ['Receipt', 'Delivery', 'Internal', 'Adjustment'],
      statuses: ['Draft', 'Waiting', 'Ready', 'Done', 'Canceled'],
      warehouses: warehouses.map((x) => x.name).filter(Boolean),
      categories: categories.map((x) => x.category).filter(Boolean),
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard filters' })
  }
})

app.get('/api/operations', requireAuth, async (req, res) => {
  const db = await getDb()
  const type = req.query.type ? String(req.query.type) : ''
  const sortBy = req.query.sortBy ? String(req.query.sortBy) : 'created_at'
  const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const orderByClause =
    sortBy === 'status'
      ? `
          CASE o.status
            WHEN 'Draft' THEN 1
            WHEN 'Waiting' THEN 2
            WHEN 'Ready' THEN 3
            WHEN 'Done' THEN 4
            WHEN 'Canceled' THEN 5
            ELSE 99
          END ${sortDir},
          o.created_at DESC
        `
      : `o.created_at ${sortDir}`

  const rows = type
    ? await db.all(
      `
          SELECT
            o.id,
            o.reference_number,
            o.type,
            o.status,
            o.created_at,
            src.name AS source_location_name,
            dst.name AS destination_location_name
          FROM Operations o
          LEFT JOIN Locations src ON src.id = o.source_location_id
          LEFT JOIN Locations dst ON dst.id = o.destination_location_id
          WHERE o.type = ?
          ORDER BY ${orderByClause}
        `,
      type,
    )
    : await db.all(
      `
          SELECT
            o.id,
            o.reference_number,
            o.type,
            o.status,
            o.created_at,
            src.name AS source_location_name,
            dst.name AS destination_location_name
          FROM Operations o
          LEFT JOIN Locations src ON src.id = o.source_location_id
          LEFT JOIN Locations dst ON dst.id = o.destination_location_id
          ORDER BY ${orderByClause}
        `,
    )

  return res.json(rows)
})

app.post('/api/operations', requireAuth, async (req, res) => {
  const db = await getDb()
  const { type, supplier, source_location, destination_location, lines } = req.body || {}

  if (!type || !['Receipt', 'Delivery', 'Internal', 'Adjustment'].includes(type)) {
    return res.status(400).json({ message: 'Invalid operation type' })
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'At least one operation line is required' })
  }

  for (const line of lines) {
    const productId = Number(line.product_id)
    const qty = Number(line.requested_quantity)
    const picked = Number(line.picked_quantity ?? 0)
    const packed = Number(line.packed_quantity ?? 0)
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ message: 'Each line requires a valid product_id' })
    }
    if (!Number.isFinite(qty) || qty < 0) {
      return res.status(400).json({ message: 'Quantities must be non-negative numbers' })
    }
    if (type !== 'Adjustment' && qty <= 0) {
      return res.status(400).json({ message: 'Quantity must be greater than zero for this operation type' })
    }
    if (type === 'Delivery') {
      if (!Number.isFinite(picked) || picked < 0 || !Number.isFinite(packed) || packed < 0) {
        return res.status(400).json({ message: 'Picked and packed quantities must be non-negative numbers' })
      }
    }
  }

  try {
    await db.exec('BEGIN TRANSACTION')
    try {
      const srcName =
        source_location ||
        (type === 'Receipt' ? supplier || 'Vendor Location' : type === 'Adjustment' ? 'Inventory Audit' : 'Main Warehouse')
      const dstName =
        destination_location ||
        (type === 'Delivery'
          ? 'Customer Location'
          : type === 'Adjustment'
            ? source_location || 'Main Warehouse'
            : type === 'Receipt'
              ? 'Main Warehouse'
              : 'Main Warehouse')

      const sourceType = type === 'Receipt' ? 'Vendor' : 'Internal'
      const destinationType = type === 'Delivery' ? 'Customer' : 'Internal'

      const source = await ensureLocationByName(db, String(srcName).trim(), sourceType)
      const destination = await ensureLocationByName(db, String(dstName).trim(), destinationType)

      const result = await db.run(
        `
          INSERT INTO Operations (
            type, status, supplier, source_location_id, destination_location_id, created_by
          ) VALUES (?, 'Draft', ?, ?, ?, ?)
        `,
        type,
        supplier || null,
        source ? source.id : null,
        destination ? destination.id : null,
        req.user.id,
      )

      const operationId = result.lastID
      const referenceNumber = buildReference(type, operationId)
      await db.run('UPDATE Operations SET reference_number = ? WHERE id = ?', referenceNumber, operationId)

      for (const line of lines) {
        const requestedQty = Number(line.requested_quantity)
        const pickedQty = Number(line.picked_quantity ?? 0)
        const packedQty = Number(line.packed_quantity ?? 0)
        await db.run(
          `
            INSERT INTO Operation_Lines (operation_id, product_id, requested_quantity, picked_quantity, packed_quantity)
            VALUES (?, ?, ?, ?, ?)
          `,
          operationId,
          Number(line.product_id),
          requestedQty,
          type === 'Delivery' ? pickedQty : requestedQty,
          type === 'Delivery' ? packedQty : requestedQty,
        )
      }

      await db.exec('COMMIT')
      return res.status(201).json({ id: operationId, reference_number: referenceNumber })
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create operation' })
  }
})

async function getCurrentQty(db, productId, locationId) {
  const row = await db.get(
    'SELECT quantity FROM Stock_Quants WHERE product_id = ? AND location_id = ?',
    productId,
    locationId,
  )
  return Number(row?.quantity || 0)
}

async function setQty(db, productId, locationId, quantity) {
  await db.run(
    `
      INSERT INTO Stock_Quants (product_id, location_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(product_id, location_id)
      DO UPDATE SET quantity = excluded.quantity
    `,
    productId,
    locationId,
    quantity,
  )
}

app.post('/api/operations/:id/validate', requireAuth, async (req, res) => {
  const operationId = Number(req.params.id)
  if (!Number.isFinite(operationId)) {
    return res.status(400).json({ message: 'Invalid operation id' })
  }

  const db = await getDb()

  try {
    const operation = await db.get('SELECT * FROM Operations WHERE id = ?', operationId)
    if (!operation) {
      return res.status(404).json({ message: 'Operation not found' })
    }

    if (operation.status === 'Done') {
      return res.status(400).json({ message: 'Operation is already validated' })
    }
    if (operation.status === 'Canceled') {
      return res.status(400).json({ message: 'Canceled operation cannot be validated' })
    }

    const lines = await db.all('SELECT * FROM Operation_Lines WHERE operation_id = ?', operationId)
    if (!lines.length) {
      return res.status(400).json({ message: 'Operation has no lines to validate' })
    }

    await db.exec('BEGIN TRANSACTION')
    try {
      for (const line of lines) {
        const productId = Number(line.product_id)
        const requested = Number(line.requested_quantity)

        if (!Number.isFinite(requested) || requested < 0) {
          throw new Error('Invalid line quantity')
        }

        if (operation.type === 'Receipt') {
          const currentDest = await getCurrentQty(db, productId, operation.destination_location_id)
          await setQty(db, productId, operation.destination_location_id, currentDest + requested)

          await db.run(
            `
              INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
              VALUES (?, ?, ?, ?, ?)
            `,
            productId,
            operation.source_location_id,
            operation.destination_location_id,
            requested,
            operationId,
          )
        }

        if (operation.type === 'Delivery') {
          const currentSource = await getCurrentQty(db, productId, operation.source_location_id)
          const picked = Number(line.picked_quantity ?? 0)
          const packed = Number(line.packed_quantity ?? 0)
          const effectivePicked = picked > 0 ? picked : requested
          const effectivePacked = packed > 0 ? packed : requested

          if (effectivePicked < requested || effectivePacked < requested) {
            throw new Error('Delivery validation requires picked and packed quantities to cover requested quantity')
          }
          if (effectivePacked > effectivePicked) {
            throw new Error('Packed quantity cannot exceed picked quantity')
          }

          if (currentSource < requested) {
            throw new Error('Insufficient stock for delivery validation')
          }

          await setQty(db, productId, operation.source_location_id, currentSource - requested)

          await db.run(
            `
              INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
              VALUES (?, ?, ?, ?, ?)
            `,
            productId,
            operation.source_location_id,
            operation.destination_location_id,
            requested,
            operationId,
          )
        }

        if (operation.type === 'Internal') {
          const currentSource = await getCurrentQty(db, productId, operation.source_location_id)
          if (currentSource < requested) {
            throw new Error('Insufficient stock for internal transfer validation')
          }

          const currentDest = await getCurrentQty(db, productId, operation.destination_location_id)
          await setQty(db, productId, operation.source_location_id, currentSource - requested)
          await setQty(db, productId, operation.destination_location_id, currentDest + requested)

          await db.run(
            `
              INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
              VALUES (?, ?, ?, ?, ?)
            `,
            productId,
            operation.source_location_id,
            operation.destination_location_id,
            requested,
            operationId,
          )
        }

        if (operation.type === 'Adjustment') {
          const targetLocationId = operation.destination_location_id || operation.source_location_id
          if (!targetLocationId) {
            throw new Error('Adjustment requires a target location')
          }

          const current = await getCurrentQty(db, productId, targetLocationId)
          const countedQuantity = requested
          const diff = countedQuantity - current

          await setQty(db, productId, targetLocationId, countedQuantity)

          if (diff !== 0) {
            const fromLocation = diff > 0 ? operation.source_location_id : targetLocationId
            const toLocation = diff > 0 ? targetLocationId : operation.source_location_id

            await db.run(
              `
                INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
                VALUES (?, ?, ?, ?, ?)
              `,
              productId,
              fromLocation,
              toLocation,
              Math.abs(diff),
              operationId,
            )
          }
        }

        await db.run(
          'UPDATE Operation_Lines SET done_quantity = requested_quantity WHERE id = ?',
          line.id,
        )
      }

      await db.run("UPDATE Operations SET status = 'Done' WHERE id = ?", operationId)
      await db.exec('COMMIT')

      return res.json({ message: 'Operation validated' })
    } catch (error) {
      await db.exec('ROLLBACK')

      if (error.message && error.message.toLowerCase().includes('insufficient stock')) {
        return res.status(400).json({ message: error.message })
      }

      return res.status(400).json({ message: error.message || 'Validation failed' })
    }
  } catch (error) {
    return res.status(500).json({ message: 'Operation validation failed' })
  }
})

app.delete('/api/operations/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  const operationId = Number(req.params.id)
  if (!Number.isFinite(operationId)) {
    return res.status(400).json({ message: 'Invalid operation id' })
  }

  const db = await getDb()
  try {
    const operation = await db.get('SELECT * FROM Operations WHERE id = ?', operationId)
    if (!operation) {
      return res.status(404).json({ message: 'Operation not found' })
    }

    if (operation.status === 'Done') {
      return res.status(400).json({ message: 'Cannot delete a validated operation' })
    }

    await db.exec('BEGIN')
    try {
      await db.run('DELETE FROM Operation_Lines WHERE operation_id = ?', operationId)
      await db.run('DELETE FROM Operations WHERE id = ?', operationId)

      await db.exec('COMMIT')
      return res.json({ message: 'Operation deleted' })
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete operation' })
  }
})

app.post('/api/operations/:id/status', requireAuth, async (req, res) => {
  const operationId = Number(req.params.id)
  if (!Number.isFinite(operationId)) {
    return res.status(400).json({ message: 'Invalid operation id' })
  }

  const nextStatus = String(req.body?.status || '').trim()
  const allowedStatuses = ['Draft', 'Waiting', 'Ready', 'Canceled']
  if (!allowedStatuses.includes(nextStatus)) {
    return res.status(400).json({ message: 'Invalid status value' })
  }

  const db = await getDb()
  try {
    const operation = await db.get('SELECT id, status FROM Operations WHERE id = ?', operationId)
    if (!operation) {
      return res.status(404).json({ message: 'Operation not found' })
    }

    if (operation.status === 'Done') {
      return res.status(400).json({ message: 'Validated operation status cannot be changed' })
    }

    if (operation.status === nextStatus) {
      return res.json({ message: 'Status unchanged', id: operationId, status: operation.status })
    }

    const transitionMap = {
      Draft: ['Waiting', 'Ready', 'Canceled'],
      Waiting: ['Ready', 'Canceled'],
      Ready: ['Waiting', 'Canceled'],
      Canceled: ['Draft'],
    }
    const allowedNext = transitionMap[operation.status] || []
    if (!allowedNext.includes(nextStatus)) {
      return res.status(400).json({ message: `Cannot move status from ${operation.status} to ${nextStatus}` })
    }

    await db.run('UPDATE Operations SET status = ? WHERE id = ?', nextStatus, operationId)
    return res.json({ message: 'Status updated', id: operationId, status: nextStatus })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update operation status' })
  }
})

app.delete('/api/locations/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  const locationId = Number(req.params.id)
  if (!Number.isFinite(locationId)) {
    return res.status(400).json({ message: 'Invalid location id' })
  }

  const db = await getDb()
  try {
    const location = await db.get('SELECT * FROM Locations WHERE id = ?', locationId)
    if (!location) {
      return res.status(404).json({ message: 'Location not found' })
    }

    const stock = await db.get('SELECT SUM(quantity) as total FROM Stock_Quants WHERE location_id = ?', locationId)
    if (stock && Number(stock.total) > 0) {
      return res.status(400).json({ message: 'Cannot delete location with existing stock' })
    }

    await db.exec('BEGIN TRANSACTION')
    try {
      await db.run('DELETE FROM Stock_Quants WHERE location_id = ?', locationId)
      await db.run('DELETE FROM Locations WHERE id = ?', locationId)

      await db.run(
        `
          INSERT INTO Stock_Ledger (note, timestamp)
          VALUES (?, datetime("now"))
        `,
        `Deleted Location: ${location.name}`
      )

      await db.exec('COMMIT')
      res.json({ message: 'Location deleted' })
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete location' })
  }
})

app.get('/api/ledger', requireAuth, async (req, res) => {
  const db = await getDb()
  const rows = await db.all(
    `
      SELECT
        sl.id,
        sl.timestamp,
        p.name AS product_name,
        src.name AS from_location_name,
        dst.name AS to_location_name,
        sl.quantity,
        o.reference_number,
        sl.note
      FROM Stock_Ledger sl
      LEFT JOIN Products p ON p.id = sl.product_id
      LEFT JOIN Locations src ON src.id = sl.from_location_id
      LEFT JOIN Locations dst ON dst.id = sl.to_location_id
      LEFT JOIN Operations o ON o.id = sl.operation_id
      ORDER BY sl.timestamp DESC, sl.id DESC
    `,
  )

  res.json(rows)
})

const frontendDistPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.cwd(), process.env.FRONTEND_DIST_PATH)
  : path.resolve(__dirname, '../../frontend/dist')

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath))

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next()
    }
    return res.sendFile(path.join(frontendDistPath, 'index.html'))
  })
}

app.use((error, req, res, next) => {
  if (error && error.message === 'CORS blocked') {
    return res.status(403).json({ message: 'Origin not allowed by CORS policy' })
  }
  return next(error)
})

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

async function bootstrap() {
  validateRuntimeConfig()
  await initDb()
  app.listen(PORT, () => {
    console.log(`Core Inventory backend listening on http://localhost:${PORT}`)
  })
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap backend:', error)
  process.exit(1)
})
