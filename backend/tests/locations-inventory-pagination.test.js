const request = require('supertest')
const { getDb, initDb, ensureLocationByName } = require('../src/db')

let mockTestUserId = 1

jest.mock('../src/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: mockTestUserId,
      name: 'Test User',
      email: 'test.user@coreinventory.app',
      role: 'Admin',
    }
    next()
  },
  requireRole: () => (_req, _res, next) => next(),
  signToken: () => 'test-token',
}))

const app = require('../src/server')

describe('Warehouse inventory view pagination behavior', () => {
  const runId = `INV-${Date.now()}`
  let internalWarehouse
  let vendorWarehouse

  beforeAll(async () => {
    await initDb()
    const db = await getDb()

    const user = await db.get('SELECT id FROM Users ORDER BY id ASC LIMIT 1')
    mockTestUserId = Number(user?.id || 1)

    internalWarehouse = await ensureLocationByName(db, `Inventory Internal ${runId}`, 'Internal')
    vendorWarehouse = await ensureLocationByName(db, `Inventory Vendor ${runId}`, 'Vendor')

    for (let i = 0; i < 19; i += 1) {
      const inserted = await db.run(
        'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
        `Inventory Product ${runId} ${i}`,
        `INV-SKU-${runId}-${i}`,
        `INV-CAT-${runId}`,
        'Units',
        3,
      )
      await db.run(
        'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
        inserted.lastID,
        internalWarehouse.id,
        i === 0 ? 0 : i,
      )
    }
  })

  it('returns paginated inventory payload for internal warehouse', async () => {
    const page1 = await request(app)
      .get(`/api/locations/${internalWarehouse.id}/inventory`)
      .query({ page: 1, limit: 10 })

    const page2 = await request(app)
      .get(`/api/locations/${internalWarehouse.id}/inventory`)
      .query({ page: 2, limit: 10 })

    expect(page1.status).toBe(200)
    expect(page2.status).toBe(200)

    expect(Array.isArray(page1.body.data)).toBe(true)
    expect(Array.isArray(page2.body.data)).toBe(true)
    expect(Number(page1.body.total)).toBe(19)
    expect(Number(page2.body.total)).toBe(19)
    expect(Number(page1.body.page)).toBe(1)
    expect(Number(page2.body.page)).toBe(2)
    expect(Number(page1.body.limit)).toBe(10)
    expect(Number(page2.body.limit)).toBe(10)

    expect(page1.body.data.length).toBe(10)
    expect(page2.body.data.length).toBe(9)
  })

  it('rejects inventory page request for non-internal warehouse', async () => {
    const res = await request(app)
      .get(`/api/locations/${vendorWarehouse.id}/inventory`)
      .query({ page: 1, limit: 10 })

    expect(res.status).toBe(400)
    expect(String(res.body.message || '')).toMatch(/internal/i)
  })
})
