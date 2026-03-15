require('dotenv').config({ path: './.env' })
const { getDb } = require('../src/db')

const base = 'http://localhost:4000/api'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345'
const email = `smoke.role.${Date.now()}@example.com`
const password = 'smoke12345'
const name = 'Smoke Role User'
const requestedRole = 'Manager'
const jsonHeaders = { 'Content-Type': 'application/json' }

async function api(path, options = {}) {
  const res = await fetch(base + path, options)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error((data && data.message) || `HTTP ${res.status}`)
  }
  return data
}

async function main() {
  await api('/auth/register', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name, email, password, role: requestedRole }),
  })

  const db = await getDb()
  const pendingOtp = await db.get('SELECT otp_code FROM Signup_Verifications WHERE email = ?', email)
  if (!pendingOtp || !pendingOtp.otp_code) {
    throw new Error('OTP not found in Signup_Verifications')
  }

  const verifyResponse = await api('/auth/register', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name, email, password, role: requestedRole, otp: pendingOtp.otp_code }),
  })

  const userLogin = await api('/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  })

  const userProfileBefore = await api('/users/me', {
    headers: { Authorization: `Bearer ${userLogin.token}` },
  })

  const adminLogin = await api('/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })

  const pendingRequests = await api('/admin/role-requests', {
    headers: { Authorization: `Bearer ${adminLogin.token}` },
  })

  const request = (Array.isArray(pendingRequests) ? pendingRequests : []).find((item) => item.email === email)
  if (!request) {
    throw new Error(`Pending role request not found for ${email}`)
  }

  const approveResponse = await api(`/admin/role-requests/${request.id}/approve`, {
    method: 'POST',
    headers: { ...jsonHeaders, Authorization: `Bearer ${adminLogin.token}` },
    body: '{}',
  })

  const userLoginAfter = await api('/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  })

  const userProfileAfter = await api('/users/me', {
    headers: { Authorization: `Bearer ${userLoginAfter.token}` },
  })

  console.log(
    JSON.stringify({
      email,
      requestedRole,
      verifyMessage: verifyResponse.message,
      roleBeforeApproval: userProfileBefore.role,
      approveMessage: approveResponse.message,
      roleAfterApproval: userProfileAfter.role,
    }),
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
