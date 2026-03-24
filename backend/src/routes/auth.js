/**
 * Authentication & user-profile routes.
 *
 * POST /api/auth/register          - OTP signup request / verification
 * POST /api/auth/login             - credential login -> JWT
 * POST /api/auth/reset-password    - OTP-based password reset
 * GET  /api/users/me               - current user profile
 * GET  /api/users/role-request-status
 * POST /api/users/role-requests    - warehouse staff -> request Manager role
 */

const express = require('express')
const bcrypt = require('bcryptjs')
const dns = require('dns').promises

const { requireAuth } = require('../auth')
const { getDb } = require('../db')
const { OTP_TTL_MINUTES, RESET_OTP_TTL_MINUTES, STRICT_EMAIL_DOMAIN_CHECK } = require('../config')
const {
  sendOtpEmail,
  toOtpDeliveryMessage,
} = require('../services/emailService')
const { withTimeout } = require('../utils/withTimeout')
const {
  ALLOWED_SIGNUP_ROLES,
} = require('../constants')
const {
  isPendingRoleRequestStatus,
  isValidEmailFormat,
  isStrongPassword,
} = require('../utils/validation')

const router = express.Router()

// Helpers

async function hasMxRecord(email) {
  try {
    const [, domain] = String(email || '').trim().toLowerCase().split('@')
    if (!domain) return false
    const records = await withTimeout(dns.resolveMx(domain), 4000).catch(() => null)
    return records === null || (Array.isArray(records) && records.length > 0)
  } catch {
    return true
  }
}

// Routes

router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, otp } = req.body || {}
    const normalizedEmail = String(email || '').toLowerCase().trim()

    if (!normalizedEmail) return res.status(400).json({ message: 'email is required' })
    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address' })
    }

    if (STRICT_EMAIL_DOMAIN_CHECK) {
      const deliverable = await hasMxRecord(normalizedEmail)
      if (!deliverable) {
        return res.status(400).json({ message: 'Email domain is not valid for receiving emails' })
      }
    }

    const db = await getDb()

    const existing = await db.get('SELECT id FROM Users WHERE email = ?', normalizedEmail)
    if (existing) return res.status(409).json({ message: 'Email already registered' })

    if (!name || !password) {
      return res.status(400).json({ message: 'name, email, and password are required' })
    }
    if (!isStrongPassword(password)) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 8 characters and include letters and numbers' })
    }

    const normalizedName = String(name).trim()
    const requestedRole = ALLOWED_SIGNUP_ROLES.includes(String(role || '').trim())
      ? String(role).trim()
      : 'Warehouse Staff'

    // Step 1: Request OTP
    if (!otp) {
      const generatedOtp = String(Math.floor(100000 + Math.random() * 900000))
      const hash = await bcrypt.hash(String(password), 10)

      await db.run(
        `INSERT INTO Signup_Verifications
           (email, name, password_hash, role, status, otp_code, otp_expires_at, created_at)
         VALUES (?, ?, ?, ?, 'OTP_PENDING', ?,
           (CURRENT_TIMESTAMP + (?::text || ' minutes')::interval),
           CURRENT_TIMESTAMP)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           status = 'OTP_PENDING',
           otp_code = EXCLUDED.otp_code,
           otp_expires_at = EXCLUDED.otp_expires_at,
           reviewed_by = NULL, reviewed_at = NULL, review_note = NULL,
           created_at = CURRENT_TIMESTAMP`,
        normalizedEmail, normalizedName, hash, requestedRole, generatedOtp, OTP_TTL_MINUTES,
      )

      try {
        const delivery = await sendOtpEmail(normalizedEmail, generatedOtp, 'signup verification')
        if (delivery.exposed) {
          return res.status(202).json({ message: 'OTP generated for local development. Check backend logs.' })
        }
        if (!delivery.delivered) {
          return res.status(503).json({ message: 'OTP email delivery is unavailable. Please try again.' })
        }
      } catch (err) {
        return res.status(500).json({ message: toOtpDeliveryMessage(err) })
      }

      return res.status(202).json({ message: 'OTP sent to your email' })
    }

    // Step 2: Verify OTP
    const pending = await db.get(
      'SELECT id, name, email, password_hash, role, status, otp_code, otp_expires_at FROM Signup_Verifications WHERE email = ?',
      normalizedEmail,
    )

    if (!pending) return res.status(400).json({ message: 'Please request an OTP first' })

    const statusUp = String(pending.status || '').toUpperCase()
    if (statusUp === 'AWAITING_ADMIN_APPROVAL') {
      return res.status(409).json({ message: 'Account already created. Waiting for admin role approval.' })
    }
    if (statusUp === 'APPROVED') {
      return res.status(409).json({ message: 'This request was already approved. Please sign in.' })
    }
    if (String(otp).trim() !== String(pending.otp_code || '').trim()) {
      return res.status(400).json({ message: 'Invalid OTP. Use the latest code from your email.' })
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
    const requestedSignupRole = String(pending.role || 'Warehouse Staff').trim()
    const grantedRole = requestedSignupRole === 'Manager' ? 'Warehouse Staff' : requestedSignupRole

    if (!existingUser) {
      await db.run(
        'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        pending.name, pending.email, pending.password_hash, grantedRole,
      )
    }

    if (requestedSignupRole === 'Manager') {
      await db.run(
        "UPDATE Signup_Verifications SET status = 'AWAITING_ADMIN_APPROVAL', otp_code = NULL WHERE email = ?",
        normalizedEmail,
      )

      return res.status(201).json({
        message: 'Account created. Manager access is pending admin approval. You can sign in with warehouse staff access now.',
      })
    }

    await db.run('DELETE FROM Signup_Verifications WHERE email = ?', normalizedEmail)

    try {
      const createdUser = await db.get('SELECT id FROM Users WHERE email = ?', normalizedEmail)
      await db.run(
        `INSERT INTO Role_Audit_Log
           (action, target_user_id, target_user_email, old_role, new_role, performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'USER_REGISTERED', createdUser?.id ?? null, normalizedEmail, null, grantedRole,
        createdUser?.id ?? null, normalizedEmail, 'Self-service warehouse staff signup completed after OTP verification',
      )
    } catch { /* non-fatal */ }

    return res.status(201).json({
      message: 'Account created. You can sign in now.',
    })
  } catch {
    return res.status(500).json({ message: 'Registration failed' })
  }
})

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' })
    }

    const db = await getDb()
    const { signToken } = require('../auth')

    const user = await db.get(
      'SELECT * FROM Users WHERE email = ?',
      String(email).toLowerCase().trim(),
    )
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })

    const valid = await bcrypt.compare(String(password), user.password_hash)
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' })

    return res.json({ token: signToken(user) })
  } catch {
    return res.status(500).json({ message: 'Login failed' })
  }
})

router.post('/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {}
    if (!email) return res.status(400).json({ message: 'email is required' })

    const db = await getDb()
    const user = await db.get(
      'SELECT id, otp_code, reset_otp_expires_at FROM Users WHERE email = ?',
      String(email).toLowerCase().trim(),
    )
    if (!user) return res.status(404).json({ message: 'User not found' })

    // Step 1: Generate and send OTP
    if (!otp || !newPassword) {
      const generatedOtp = String(Math.floor(100000 + Math.random() * 900000))
      await db.run(
        `UPDATE Users
         SET otp_code = ?, reset_otp_expires_at = (CURRENT_TIMESTAMP + (?::text || ' minutes')::interval)
         WHERE id = ?`,
        generatedOtp, RESET_OTP_TTL_MINUTES, user.id,
      )

      try {
        const delivery = await sendOtpEmail(String(email).toLowerCase().trim(), generatedOtp, 'password reset')
        if (delivery.exposed) {
          return res.json({ message: 'OTP generated for local development. Check backend logs.' })
        }
        if (!delivery.delivered) {
          return res.status(503).json({ message: 'OTP email delivery is unavailable. Please try again.' })
        }
      } catch (err) {
        return res.status(500).json({ message: toOtpDeliveryMessage(err) })
      }

      return res.json({ message: 'OTP sent to your email' })
    }

    // Step 2: Verify OTP and set new password
    if (!isStrongPassword(newPassword)) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 8 characters with letters and numbers' })
    }
    if (String(otp).trim() !== String(user.otp_code || '').trim()) {
      return res.status(400).json({ message: 'Invalid OTP. Use the latest code from your email.' })
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
    await db.run(
      'UPDATE Users SET password_hash = ?, otp_code = NULL, reset_otp_expires_at = NULL WHERE id = ?',
      hash, user.id,
    )

    return res.json({ message: 'Password reset successful' })
  } catch {
    return res.status(500).json({ message: 'Password reset failed' })
  }
})

// Authenticated user routes

router.get('/users/me', requireAuth, (req, res) => {
  res.json(req.user)
})

router.get('/users/role-request-status', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const email = String(req.user.email || '').toLowerCase().trim()

    const latest = await db.get(
      `SELECT role, status, created_at, reviewed_at, review_note
       FROM Signup_Verifications
       WHERE email = ?
       ORDER BY created_at DESC LIMIT 1`,
      email,
    )

    if (!latest) {
      return res.json({ status: 'not_requested', requested_role: null, requested_at: null, reviewed_at: null, review_note: null })
    }

    const normalized = String(latest.status || '').trim().toUpperCase()
    const status = normalized === 'OTP_PENDING'
      ? 'not_requested'
      : isPendingRoleRequestStatus(normalized)
        ? 'pending'
        : normalized === 'APPROVED'
          ? 'completed'
          : normalized === 'REVOKED'
            ? 'revoked'
            : normalized === 'REJECTED'
              ? 'rejected'
              : 'not_requested'

    return res.json({
      status,
      requested_role: latest.role || null,
      requested_at: latest.created_at || null,
      reviewed_at: latest.reviewed_at || null,
      review_note: latest.review_note || null,
    })
  } catch {
    return res.status(500).json({ message: 'Failed to load role request status' })
  }
})

router.post('/users/role-requests', requireAuth, async (req, res) => {
  try {
    if (String(req.user.role || '').trim().toLowerCase() !== 'warehouse staff') {
      return res.status(400).json({ message: 'Only warehouse staff can submit a manager role request.' })
    }

    const requestedRole = String(req.body?.requested_role || 'Manager').trim()
    if (requestedRole !== 'Manager') {
      return res.status(400).json({ message: 'Only manager role requests are supported.' })
    }

    const db = await getDb()
    const email = String(req.user.email || '').toLowerCase().trim()

    const existingRequest = await db.get('SELECT status FROM Signup_Verifications WHERE email = ?', email)
    if (existingRequest && isPendingRoleRequestStatus(existingRequest.status)) {
      return res.status(409).json({ message: 'A manager role request is already pending admin approval.' })
    }

    const userRow = await db.get('SELECT id, name, email, password_hash FROM Users WHERE id = ?', req.user.id)
    if (!userRow) return res.status(404).json({ message: 'User not found' })

    await db.run(
      `INSERT INTO Signup_Verifications
         (email, name, password_hash, role, status, otp_code, otp_expires_at,
          reviewed_by, reviewed_at, review_note, created_at)
       VALUES (?, ?, ?, ?, 'AWAITING_ADMIN_APPROVAL', 'LOGIN_VERIFIED',
         CURRENT_TIMESTAMP + INTERVAL '10 minutes', NULL, NULL, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role, status = 'AWAITING_ADMIN_APPROVAL',
         otp_code = 'LOGIN_VERIFIED',
         otp_expires_at = EXCLUDED.otp_expires_at,
         reviewed_by = NULL, reviewed_at = NULL,
         review_note = EXCLUDED.review_note,
         created_at = CURRENT_TIMESTAMP`,
      email, userRow.name, userRow.password_hash, 'Manager', 'Requested after login by warehouse staff',
    )

    try {
      await db.run(
        `INSERT INTO Role_Audit_Log
           (action, target_user_id, target_user_email, old_role, new_role, performed_by_id, performed_by_email, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'ROLE_REQUESTED', userRow.id, email, 'Warehouse Staff', 'Manager',
        userRow.id, email, 'Manager role requested by user after login',
      )
    } catch { /* non-fatal */ }

    return res.status(201).json({ message: 'Manager role request submitted for admin approval.' })
  } catch {
    return res.status(500).json({ message: 'Failed to submit manager role request' })
  }
})

module.exports = router
