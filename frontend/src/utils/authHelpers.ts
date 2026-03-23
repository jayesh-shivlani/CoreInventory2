/**
 * Authentication and authorization utility helpers.
 * Includes role checks, pending-status checks, and password validation.
 */

import type { UserProfile } from '../types/models'

/** True when the user has Manager or Admin role. */
export function hasElevatedAccess(user: UserProfile | null): boolean {
  const role = String(user?.role || '').trim().toLowerCase()
  return role === 'admin' || role === 'manager'
}

/** True when the user has the Admin role. */
export function isAdminRole(role: string | undefined | null): boolean {
  return String(role || '').trim().toLowerCase() === 'admin'
}

/**
 * True for any status string that means "waiting for an admin decision".
 * Normalised to UPPERCASE before checking.
 */
export function isPendingRoleRequestStatus(status: string | undefined | null): boolean {
  const normalised = String(status || '').trim().toUpperCase()
  return (
    normalised === 'AWAITING_ADMIN_APPROVAL' ||
    normalised === 'PENDING' ||
    normalised === 'PENDING_ADMIN_APPROVAL'
  )
}

/**
 * Enforces minimum password strength:
 *  - At least 8 characters
 *  - At least one letter AND one digit
 */
export function isStrongPassword(password: string): boolean {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(password || ''))
}
