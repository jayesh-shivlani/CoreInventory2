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

describe('Products internal stock and pagination behavior', () => {
  const runId = `PAG-${Date.now()}`
  const category = `CAT-${runId}`
  let internalA
  let internalB
  let vendor
  let lowStockProductId

  beforeAll(async () => {
    await initDb()
    const db = await getDb()

    const user = await db.get('SELECT id FROM Users ORDER BY id ASC LIMIT 1')
    mockTestUserId = Number(user?.id || 1)

    internalA = await ensureLocationByName(db, `Internal A ${runId}`, 'Internal')
    internalB = await ensureLocationByName(db, `Internal B ${runId}`, 'Internal')
    vendor = await ensureLocationByName(db, `Vendor ${runId}`, 'Vendor')

    for (let i = 0; i < 18; i += 1) {
      const sku = `SKU-${runId}-${i}`
      const inserted = await db.run(
        'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
        `Product ${runId} ${i}`,
        sku,
        category,
        'Units',
        5,
      )

      if (i === 0) {
        // zero-internal-stock product should still appear in listing
        continue
      }

      await db.run(
        'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
        inserted.lastID,
        internalA.id,
        i,
      )
    }

    const lowInserted = await db.run(
      'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
      `Low Stock Internal ${runId}`,
      `LOW-${runId}`,
      category,
      'Units',
      5,
    )
    lowStockProductId = Number(lowInserted.lastID)

    // Internal stock is low.
    await db.run(
      'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
      lowStockProductId,
      internalA.id,
      1,
    )

    // External stock should not affect low-stock calculation.
    await db.run(
      'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
      lowStockProductId,
      vendor.id,
      200,
    )

    const healthyInserted = await db.run(
      'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
      `Healthy Internal ${runId}`,
      `HEALTHY-${runId}`,
      category,
      'Units',
      5,
    )

    await db.run(
      'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
      healthyInserted.lastID,
      internalB.id,
      8,
    )
  })

  it('returns all matching products from DB with stable pagination totals', async () => {
    const page1 = await request(app)
      .get('/api/products')
      .query({ category, page: 1, limit: 10 })

    const page2 = await request(app)
      .get('/api/products')
      .query({ category, page: 2, limit: 10 })

    expect(page1.status).toBe(200)
    expect(page2.status).toBe(200)
    expect(Array.isArray(page1.body.data)).toBe(true)
    expect(Array.isArray(page2.body.data)).toBe(true)
    expect(page1.body.total).toBe(page2.body.total)
    expect(page1.body.total).toBeGreaterThanOrEqual(20)
    expect(page1.body.data.length).toBeLessThanOrEqual(10)
    expect(page2.body.data.length).toBeGreaterThan(0)

    const page1Ids = page1.body.data.map((p) => Number(p.id))
    const page2Ids = page2.body.data.map((p) => Number(p.id))
    const overlap = page1Ids.filter((id) => page2Ids.includes(id))
    expect(overlap).toEqual([])
  })

  it('keeps lowStockOnly based on Internal stock only', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ category, lowStockOnly: 'true', limit: 200 })

    expect(res.status).toBe(200)
    const ids = res.body.data.map((p) => Number(p.id))
    expect(ids).toContain(lowStockProductId)

    const lowProduct = res.body.data.find((p) => Number(p.id) === lowStockProductId)
    expect(Number(lowProduct.availableStock)).toBe(1)
  })

  it('filters product stock drilldown to Internal warehouses only', async () => {
    const res = await request(app).get(`/api/products/${lowStockProductId}/stock`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    for (const row of res.body) {
      expect(row.location_name).not.toContain('Vendor')
    }
  })

  it('filters by internal location and still uses matching total count', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ category, location: internalA.name, page: 1, limit: 50 })

    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThan(0)
    expect(res.body.data.length).toBeLessThanOrEqual(res.body.total)
    expect(res.body.data.every((p) => String(p.locationName || '').includes(internalA.name))).toBe(true)
  })
})
