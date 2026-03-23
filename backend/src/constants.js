/**
 * Shared constants used across route files and middleware.
 * Centralising these prevents divergence between route files.
 */

const ALLOWED_SIGNUP_ROLES = ['Warehouse Staff', 'Manager']

const ADMIN_ROLES = ['Admin']

const MANAGER_ROLES = ['Manager', 'Admin']

/** All status strings that mean "waiting for an admin decision". */
const PENDING_ROLE_REQUEST_STATUSES = new Set([
  'AWAITING_ADMIN_APPROVAL',
  'PENDING',
  'PENDING_ADMIN_APPROVAL',
])

module.exports = {
  ALLOWED_SIGNUP_ROLES,
  ADMIN_ROLES,
  MANAGER_ROLES,
  PENDING_ROLE_REQUEST_STATUSES,
}
