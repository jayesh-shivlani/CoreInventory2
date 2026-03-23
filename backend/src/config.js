/**
 * Runtime configuration loader and validator.
 * Centralizes environment parsing and startup safety checks.
 */

const path = require('path')
const dotenv = require('dotenv')

// Always load backend/.env, even when the server is started from repo root.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })
dotenv.config()

const PORT = Number(process.env.PORT || 4000)
const OTP_TTL_MINUTES = Number(process.env.SIGNUP_OTP_TTL_MINUTES || 10)
const RESET_OTP_TTL_MINUTES = Number(process.env.RESET_OTP_TTL_MINUTES || 10)
const EMAIL_TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS || 15000)
const STRICT_EMAIL_DOMAIN_CHECK = String(process.env.STRICT_EMAIL_DOMAIN_CHECK || 'false').toLowerCase() === 'true'
const EXPOSE_DEV_OTP =
  process.env.NODE_ENV !== 'production' &&
  String(process.env.EXPOSE_DEV_OTP || 'false').toLowerCase() === 'true'

const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)

function isLocalDevOrigin(origin) {
  try {
    const url = new URL(origin)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function isCorsOriginAllowed(origin) {
  // In local development, allow localhost callers when an explicit allow-list is not set.
  const isDevLocalOrigin = process.env.NODE_ENV !== 'production' && origin && isLocalDevOrigin(origin)
  if (!origin) return true
  if (configuredOrigins.length > 0) return configuredOrigins.includes(origin)
  return Boolean(isDevLocalOrigin)
}

function validateRuntimeConfig() {
  const issues = []

  if (!process.env.DATABASE_URL || !String(process.env.DATABASE_URL).trim()) {
    issues.push('DATABASE_URL is required')
  }

  if (!Number.isFinite(PORT) || PORT <= 0) {
    issues.push('PORT must be a positive number')
  }

  if (!Number.isFinite(OTP_TTL_MINUTES) || OTP_TTL_MINUTES <= 0) {
    issues.push('SIGNUP_OTP_TTL_MINUTES must be a positive number')
  }

  if (!Number.isFinite(RESET_OTP_TTL_MINUTES) || RESET_OTP_TTL_MINUTES <= 0) {
    issues.push('RESET_OTP_TTL_MINUTES must be a positive number')
  }

  if (!Number.isFinite(EMAIL_TIMEOUT_MS) || EMAIL_TIMEOUT_MS <= 0) {
    issues.push('EMAIL_TIMEOUT_MS must be a positive number')
  }

  const jwtSecret = String(process.env.JWT_SECRET || '').trim()
  if (!jwtSecret) {
    issues.push('JWT_SECRET is required')
  }

  if (process.env.NODE_ENV === 'production') {
    // Production requires stricter defaults so weak local/dev settings cannot leak into deployment.
    if (jwtSecret === 'change-me-in-production' || jwtSecret.length < 32) {
      issues.push('JWT_SECRET must be at least 32 characters and not a placeholder in production')
    }

    if (!String(process.env.ADMIN_PASSWORD || '').trim()) {
      issues.push('ADMIN_PASSWORD must be explicitly set in production')
    }

    if (EXPOSE_DEV_OTP) {
      issues.push('EXPOSE_DEV_OTP must be false in production')
    }

    if (configuredOrigins.length === 0) {
      issues.push('ALLOWED_ORIGINS (or CLIENT_ORIGIN) should be configured in production')
    }
  }

  if (issues.length > 0) {
    throw new Error(`Invalid runtime configuration: ${issues.join('; ')}`)
  }
}

module.exports = {
  EMAIL_TIMEOUT_MS,
  EXPOSE_DEV_OTP,
  OTP_TTL_MINUTES,
  PORT,
  RESET_OTP_TTL_MINUTES,
  STRICT_EMAIL_DOMAIN_CHECK,
  isCorsOriginAllowed,
  validateRuntimeConfig,
}
