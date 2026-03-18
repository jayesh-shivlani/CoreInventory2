const { EMAIL_TIMEOUT_MS, EXPOSE_DEV_OTP } = require('../config')
const { withTimeout } = require('../utils/withTimeout')

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'
const DEFAULT_FROM_EMAIL = 'coreinventory.support@gmail.com'
const FROM_NAME = 'Core Inventory'

function getEmailProviderState() {
  const brevoConfigured = Boolean(process.env.BREVO_API_KEY)
  return {
    provider: brevoConfigured ? 'brevo' : 'none',
    configured: brevoConfigured,
    sender: process.env.FROM_EMAIL || DEFAULT_FROM_EMAIL,
    brevoOnly: brevoConfigured,
  }
}

function toOtpDeliveryMessage(error) {
  const lower = String(error?.message || '').toLowerCase()
  if (lower.includes('brevo')) {
    return 'Brevo email delivery failed. Please verify your Brevo API key and sender domain.'
  }
  if (lower.includes('email service is not configured')) {
    return 'Email service is not configured. Please contact support.'
  }
  return 'OTP email service is unavailable right now. Please try again.'
}

function getAuthPageLink() {
  const base = String(process.env.CLIENT_ORIGIN || '').trim()
  if (!base) return ''
  return `${base.replace(/\/$/, '')}/auth`
}

async function sendBrevoEmail(toEmail, subject, htmlContent) {
  const apiKey = process.env.BREVO_API_KEY
  const fromEmail = process.env.FROM_EMAIL || DEFAULT_FROM_EMAIL
  if (!apiKey) return null

  try {
    const response = await withTimeout(
      fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: FROM_NAME, email: fromEmail },
          to: [{ email: toEmail }],
          subject,
          htmlContent,
        }),
      }),
      EMAIL_TIMEOUT_MS,
      'Brevo API timed out',
    )

    if (response.ok) {
      return { delivered: true }
    }

    const data = await response.json().catch(() => null)
    console.error('Brevo API error:', data)
    return null
  } catch (error) {
    console.error('Brevo API failed:', error)
    return null
  }
}

async function sendOtpEmail(toEmail, otp, purpose = 'password reset') {
  const emailState = getEmailProviderState()
  if (!emailState.configured) {
    if (EXPOSE_DEV_OTP) {
      console.warn(`[DEV] Brevo is not configured. OTP for ${toEmail} (${purpose}) is ${otp}`)
      return { delivered: false, exposed: true }
    }
    throw new Error('Email service is not configured')
  }

  const delivery = await sendBrevoEmail(
    toEmail,
    `Core Inventory OTP for ${purpose}`,
    `<p>Your OTP code is <strong>${otp}</strong>.</p><p>Use this code to complete your ${purpose}.</p>`,
  )

  if (delivery && delivery.delivered) {
    return delivery
  }

  throw new Error('Brevo email delivery failed')
}

async function sendRoleApprovedEmail(toEmail, recipientName, approvedRole) {
  const normalizedEmail = String(toEmail || '').toLowerCase().trim()
  if (!normalizedEmail) {
    return { delivered: false }
  }

  const emailState = getEmailProviderState()
  if (!emailState.configured) {
    return { delivered: false }
  }

  const safeName = String(recipientName || '').trim() || 'there'
  const roleName = String(approvedRole || 'Manager').trim()
  const authLink = getAuthPageLink()
  const linkHtml = authLink ? `<p>You can sign in here: <a href="${authLink}">${authLink}</a></p>` : ''

  const delivery = await sendBrevoEmail(
    normalizedEmail,
    'Your role request has been approved',
    `<p>Hi ${safeName},</p><p>Your request for the <strong>${roleName}</strong> role has been approved by an admin.</p>${linkHtml}<p>Thanks,<br/>Core Inventory Team</p>`,
  )

  if (delivery && delivery.delivered) {
    return delivery
  }

  throw new Error('Brevo role approval email delivery failed')
}

module.exports = {
  getEmailProviderState,
  sendOtpEmail,
  sendRoleApprovedEmail,
  toOtpDeliveryMessage,
}
