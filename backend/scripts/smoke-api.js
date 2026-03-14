/* eslint-disable no-console */

const BASE_URL = (process.env.SMOKE_API_BASE_URL || 'http://localhost:4000/api').replace(/\/$/, '')
const DEMO_EMAIL = process.env.SMOKE_DEMO_EMAIL || 'demo@coreinventory.app'
const DEMO_PASSWORD = process.env.SMOKE_DEMO_PASSWORD || 'demo12345'

const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? `: ${detail}` : ''}`)
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  return { response, payload }
}

async function expectOk(name, path, options = {}) {
  const { response, payload } = await api(path, options)
  if (!response.ok) {
    throw new Error(`${name} failed (${response.status}): ${(payload && payload.message) || 'unknown error'}`)
  }
  return payload
}

async function run() {
  console.log(`Running API smoke checks against ${BASE_URL}`)

  try {
    const signupEmail = `smoke+${Date.now()}@example.com`
    const signupPassword = 'smoke12345'

    const signupRequest = await api('/auth/register', {
      method: 'POST',
      body: {
        name: 'Smoke OTP User',
        email: signupEmail,
        password: signupPassword,
      },
    })

    if (signupRequest.response.status !== 202) {
      throw new Error(
        `Signup OTP request failed (${signupRequest.response.status}): ${(signupRequest.payload && signupRequest.payload.message) || 'unknown error'}`,
      )
    }
    record('Signup OTP request', true, `email=${signupEmail}`)

    const signupOtp = signupRequest.payload?.dev_otp
    if (signupOtp) {
      await expectOk('Signup OTP verify', '/auth/register', {
        method: 'POST',
        body: {
          name: 'Smoke OTP User',
          email: signupEmail,
          password: signupPassword,
          otp: signupOtp,
        },
      })

      const signupLogin = await expectOk('Signup OTP login', '/auth/login', {
        method: 'POST',
        body: { email: signupEmail, password: signupPassword },
      })

      record('Signup OTP verify', true, 'Account created')
      record('Signup OTP login', Boolean(signupLogin?.token), 'Token issued for new user')
    } else {
      record('Signup OTP verify', true, 'Skipped: OTP delivered via email provider')
    }

    const health = await expectOk('Health', '/health')
    record('Health', true, `status=${health?.status || 'ok'}`)

    const login = await expectOk('Login', '/auth/login', {
      method: 'POST',
      body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    })

    if (!login?.token) {
      throw new Error('Login response missing token')
    }
    const token = login.token
    record('Login', true, 'Token issued')

    const me = await expectOk('Profile', '/users/me', { token })
    record('Profile', Boolean(me?.id), `email=${me?.email || 'unknown'}`)

    const kpis = await expectOk('Dashboard KPIs', '/dashboard/kpis', { token })
    record(
      'Dashboard KPIs',
      typeof kpis?.totalProductsInStock !== 'undefined',
      `stock=${kpis?.totalProductsInStock ?? 'n/a'}`,
    )

    const products = await expectOk('Products list', '/products', { token })
    record('Products list', Array.isArray(products), `count=${Array.isArray(products) ? products.length : 0}`)

    const candidate = Array.isArray(products)
      ? products.find((p) => Number(p.availableStock || 0) >= 1)
      : null

    if (!candidate?.id) {
      throw new Error('No product with available stock found for operation smoke tests')
    }

    const stockRows = await expectOk('Product stock drilldown', `/products/${candidate.id}/stock`, { token })
    record('Product stock drilldown', Array.isArray(stockRows), `rows=${Array.isArray(stockRows) ? stockRows.length : 0}`)

    const createDelivery = await expectOk('Create delivery draft', '/operations', {
      method: 'POST',
      token,
      body: {
        type: 'Delivery',
        source_location: 'Main Warehouse',
        destination_location: 'Customer Location',
        lines: [
          {
            product_id: Number(candidate.id),
            requested_quantity: 1,
            picked_quantity: 1,
            packed_quantity: 1,
          },
        ],
      },
    })

    const operationId = Number(createDelivery?.id)
    if (!Number.isFinite(operationId)) {
      throw new Error('Create delivery draft did not return a valid id')
    }
    record('Create delivery draft', true, `operationId=${operationId}`)

    await expectOk('Status transition to Waiting', `/operations/${operationId}/status`, {
      method: 'POST',
      token,
      body: { status: 'Waiting' },
    })

    await expectOk('Status transition to Ready', `/operations/${operationId}/status`, {
      method: 'POST',
      token,
      body: { status: 'Ready' },
    })
    record('Status transitions', true, 'Draft -> Waiting -> Ready')

    await expectOk('Validate delivery', `/operations/${operationId}/validate`, {
      method: 'POST',
      token,
      body: {},
    })
    record('Validate delivery', true, 'Done')

    const doneStatusAttempt = await api(`/operations/${operationId}/status`, {
      method: 'POST',
      token,
      body: { status: 'Waiting' },
    })

    record(
      'Done status lock',
      !doneStatusAttempt.response.ok,
      `response=${doneStatusAttempt.response.status}`,
    )

    const sortedOps = await expectOk('Operations sorted', '/operations?type=Delivery&sortBy=status&sortDir=asc', {
      token,
    })
    record('Operations sorted', Array.isArray(sortedOps), `count=${Array.isArray(sortedOps) ? sortedOps.length : 0}`)

    const lowStock = await expectOk('Low stock feed', '/products?lowStockOnly=true', { token })
    record('Low stock feed', Array.isArray(lowStock), `count=${Array.isArray(lowStock) ? lowStock.length : 0}`)
  } catch (error) {
    record('Smoke run', false, error.message)
  }

  const passCount = results.filter((r) => r.ok).length
  const failCount = results.filter((r) => !r.ok).length

  console.log('\nSmoke Summary')
  console.log(`Passed: ${passCount}`)
  console.log(`Failed: ${failCount}`)

  if (failCount > 0) {
    process.exit(1)
  }
}

run()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
