// Basic backend operation creation validation tests
// Uses Jest (install with: npm install --save-dev jest supertest)

const request = require('supertest')
const app = require('../src/server') // Adjust if your express app export path differs

describe('Operation creation warehouse type validation', () => {
  it('rejects Receipt with non-Vendor source', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Receipt',
        supplier: 'Test Vendor',
        source_location: 'SomeInternal', // Should be Vendor
        destination_location: 'SomeInternal',
        lines: [{ product_id: 1, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Vendor/)
  })

  it('rejects Delivery with non-Internal source', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Delivery',
        source_location: 'SomeVendor', // Should be Internal
        destination_location: 'SomeCustomer',
        lines: [{ product_id: 1, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Internal/)
  })

  it('rejects Internal with same source/destination', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Internal',
        source_location: 'SomeInternal',
        destination_location: 'SomeInternal',
        lines: [{ product_id: 1, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/different/)
  })

  it('rejects Adjustment with non-Internal destination', async () => {
    const res = await request(app)
      .post('/api/operations')
      .send({
        type: 'Adjustment',
        destination_location: 'SomeVendor', // Should be Internal
        lines: [{ product_id: 1, requested_quantity: 10 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Internal/)
  })
})
