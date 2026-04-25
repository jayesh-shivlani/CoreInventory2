// Basic backend operation creation validation tests
// Uses Jest (install with: npm install --save-dev jest supertest)

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

const app = require('../src/server') // Adjust if your express app export path differs

let productId

beforeAll(async () => {
  await initDb()
  const db = await getDb()

  const user = await db.get('SELECT id FROM Users ORDER BY id ASC LIMIT 1')
  mockTestUserId = Number(user?.id || 1)

  await ensureLocationByName(db, 'Main Warehouse', 'Internal')
  await ensureLocationByName(db, 'Vendor Location', 'Vendor')
  await ensureLocationByName(db, 'Customer Location', 'Customer')

  const product = await db.get('SELECT id FROM Products ORDER BY id ASC LIMIT 1')
  if (product?.id) {
    productId = Number(product.id)
    return
  }

  const inserted = await db.run(
    'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
    'Operation Test Product',
    `OP-TEST-${Date.now()}`,
    'Test',
    'pcs',
    0,
  )
  productId = Number(inserted.lastID)
})

describe('Operation creation warehouse type validation', () => {
  it('rejects Receipt with non-Vendor source', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Receipt',
        supplier: 'Test Vendor',
        source_location: 'Main Warehouse', // Should be Vendor
        destination_location: 'Main Warehouse',
        lines: [{ product_id: productId, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Vendor/)
  })

  it('rejects Receipt with non-Internal destination', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Receipt',
        supplier: 'Test Vendor',
        source_location: 'Vendor Location',
        destination_location: 'Customer Location', // Should be Internal
        lines: [{ product_id: productId, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Internal/)
  })

  it('accepts Receipt with Vendor source and Internal destination', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Receipt',
        supplier: 'Test Vendor',
        source_location: 'Vendor Location',
        destination_location: 'Main Warehouse',
        lines: [{ product_id: productId, requested_quantity: 3 }],
      })
    expect(res.status).toBe(201)
    expect(res.body).toEqual(expect.objectContaining({ id: expect.any(Number), reference_number: expect.any(String) }))
  })

  it('rejects Delivery with non-Internal source', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Delivery',
        source_location: 'Vendor Location', // Should be Internal
        destination_location: 'Customer Location',
        lines: [{ product_id: productId, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Internal/)
  })

  it('rejects Internal with same source/destination', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Internal',
        source_location: 'Main Warehouse',
        destination_location: 'Main Warehouse',
        lines: [{ product_id: productId, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/different/)
  })

  it('rejects Adjustment with non-Internal destination', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Adjustment',
        destination_location: 'Vendor Location', // Should be Internal
        lines: [{ product_id: productId, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Internal/)
  })
})
