/**
 * Pure validation helpers - no I/O, no side-effects.
 * Safe to import anywhere without circular-dependency risk.
 */

const { PENDING_ROLE_REQUEST_STATUSES } = require('../constants')

/**
 * Returns true when the given role-request status string
 * represents an item that is still waiting for admin review.
 */
function isPendingRoleRequestStatus(status) {
  return PENDING_ROLE_REQUEST_STATUSES.has(
    String(status || '').trim().toUpperCase(),
  )
}

/** Basic RFC-5322 email format check (not a deliverability check). */
function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

/**
 * Enforces a minimum-strength password:
 *   - At least 8 characters
 *   - Contains at least one letter AND one digit
 */
function isStrongPassword(password) {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(password || ''))
}

module.exports = {
  isPendingRoleRequestStatus,
  isValidEmailFormat,
  isStrongPassword,
}
