/**
 * Product catalog routes.
 *
 * GET    /api/products                - list with search & filters
 * GET    /api/products/filter-options - dynamic filter enumerations
 * POST   /api/products                - create new product   [Manager+]
 * GET    /api/products/:id            - single product
 * PUT    /api/products/:id            - update product       [Manager+]
 * DELETE /api/products/:id            - delete product       [Manager+]
 * GET    /api/products/:id/stock      - per-location stock breakdown
 */

const express = require('express')
const { requireAuth, requireRole } = require('../auth')
const { getDb, ensureLocationByName } = require('../db')
const { MANAGER_ROLES } = require('../constants')

const router = express.Router()

// Helpers
function safeNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// List + filter-options
router.get('/filter-options', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const [categories, locations, uoms] = await Promise.all([
      db.all("SELECT DISTINCT category FROM Products WHERE category <> '' ORDER BY category"),
      db.all("SELECT DISTINCT id, name, type FROM Locations WHERE name <> '' ORDER BY name"),
      db.all("SELECT DISTINCT unit_of_measure FROM Products WHERE unit_of_measure <> '' ORDER BY unit_of_measure"),
    ])
    return res.json({
      categories: categories.map((x) => x.category).filter(Boolean),
      locations:  locations.filter((x) => x && x.id && x.name && x.type),
      uoms:       uoms.map((x) => x.unit_of_measure).filter(Boolean),
    })
  } catch {
    return res.status(500).json({ message: 'Failed to load filter options' })
  }
})

router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const search       = String(req.query.search      || '').trim()
    const category     = String(req.query.category    || '').trim()
    const location     = String(req.query.location    || '').trim()
    const lowStockOnly = req.query.lowStockOnly === 'true'

    const conditions = []
    const values = []

    if (search) {
      conditions.push('(p.name ILIKE ? OR p.sku ILIKE ? OR p.category ILIKE ?)')
      values.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (category) {
      conditions.push('p.category = ?')
      values.push(category)
    }
    if (location) {
      conditions.push('l.name = ?')
      values.push(location)
    }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const having = lowStockOnly ? 'HAVING COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum' : ''

    const rows = await db.all(
      `SELECT
         p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum,
         COALESCE(SUM(sq.quantity), 0)  AS "availableStock",
         MAX(l.name)                    AS "locationName"
       FROM Products p
       LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
       LEFT JOIN Locations l    ON l.id = sq.location_id
       ${where}
       GROUP BY p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum
       ${having}
       ORDER BY p.name ASC`,
      ...values,
    )

    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to load products' })
  }
})

// Single product & per-location stock
router.get('/:id/stock', requireAuth, async (req, res) => {
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) return res.status(400).json({ message: 'Invalid product id' })

  try {
    const db = await getDb()
    const rows = await db.all(
      `SELECT sq.location_id, l.name AS location_name, sq.quantity
       FROM Stock_Quants sq
       JOIN Locations l ON l.id = sq.location_id
       WHERE sq.product_id = ?
       ORDER BY l.name`,
      productId,
    )
    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to load stock data' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) return res.status(400).json({ message: 'Invalid product id' })

  try {
    const db = await getDb()
    const row = await db.get(
      'SELECT id, name, sku, category, unit_of_measure, reorder_minimum FROM Products WHERE id = ?',
      productId,
    )
    if (!row) return res.status(404).json({ message: 'Product not found' })
    return res.json(row)
  } catch {
    return res.status(500).json({ message: 'Failed to load product' })
  }
})

// Create
router.post('/', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { name, sku, category, unit_of_measure, initial_stock, reorder_minimum, initial_warehouse_id } = req.body || {}

    if (!name || !sku || !category || !unit_of_measure) {
      return res.status(400).json({ message: 'name, sku, category and unit_of_measure are required' })
    }

    const stock   = safeNum(initial_stock)
    const reorder = safeNum(reorder_minimum)
    if (stock < 0 || reorder < 0) {
      return res.status(400).json({ message: 'Stock values must be non-negative' })
    }

    const db = await getDb()

    const existing = await db.get('SELECT id FROM Products WHERE sku = ?', String(sku).trim())
    if (existing) return res.status(409).json({ message: 'SKU already exists' })

    const result = await db.transaction(async (tx) => {
      const inserted = await tx.run(
        'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
        String(name).trim(), String(sku).trim(), String(category).trim(), String(unit_of_measure).trim(), reorder,
      )

      if (stock > 0) {
        let warehouseId = null
        if (initial_warehouse_id) {
          // Validate warehouse exists and is internal
          const warehouse = await tx.get('SELECT id, type FROM Locations WHERE id = ?', initial_warehouse_id)
          if (!warehouse) throw new Error('Selected warehouse does not exist')
          if (warehouse.type !== 'Internal') throw new Error('Selected warehouse is not internal')
          warehouseId = warehouse.id
        } else {
          const mainLoc = await ensureLocationByName(tx, 'Main Warehouse', 'Internal')
          warehouseId = mainLoc.id
        }
        await tx.run(
          'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
          inserted.lastID, warehouseId, stock,
        )
      }

      return { id: inserted.lastID }
    })

    return res.status(201).json(result)
  } catch (err) {
    let message = 'Failed to save product'
    if (err && err.message) message = err.message
    return res.status(500).json({ message })
  }
})

// Update
router.put('/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) return res.status(400).json({ message: 'Invalid product id' })

  try {
    const { name, sku, category, unit_of_measure, reorder_minimum } = req.body || {}
    if (!name || !sku || !category || !unit_of_measure) {
      return res.status(400).json({ message: 'name, sku, category and unit_of_measure are required' })
    }

    const reorder = safeNum(reorder_minimum)
    if (reorder < 0) return res.status(400).json({ message: 'reorder_minimum must be non-negative' })

    const db = await getDb()

    const existing = await db.get('SELECT id FROM Products WHERE id = ?', productId)
    if (!existing) return res.status(404).json({ message: 'Product not found' })

    const conflict = await db.get('SELECT id FROM Products WHERE sku = ? AND id <> ?', String(sku).trim(), productId)
    if (conflict) return res.status(409).json({ message: 'SKU already in use' })

    await db.run(
      'UPDATE Products SET name=?, sku=?, category=?, unit_of_measure=?, reorder_minimum=? WHERE id=?',
      String(name).trim(), String(sku).trim(), String(category).trim(), String(unit_of_measure).trim(), reorder, productId,
    )

    return res.json({ message: 'Product updated', id: productId })
  } catch {
    return res.status(500).json({ message: 'Failed to update product' })
  }
})

// Delete
router.delete('/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) return res.status(400).json({ message: 'Invalid product id' })

  try {
    const db = await getDb()

    const product = await db.get('SELECT id, name FROM Products WHERE id = ?', productId)
    if (!product) return res.status(404).json({ message: 'Product not found' })

    const lineCount = await db.get(
      'SELECT COUNT(*)::INT AS count FROM Operation_Lines WHERE product_id = ?', productId,
    )
    if (Number(lineCount?.count || 0) > 0) {
      return res.status(409).json({
        message: 'This product is part of operation history and cannot be deleted. Keep it for traceability, or update its details instead.',
      })
    }

    const ledgerCount = await db.get(
      'SELECT COUNT(*)::INT AS count FROM Stock_Ledger WHERE product_id = ?', productId,
    )
    if (Number(ledgerCount?.count || 0) > 0) {
      return res.status(409).json({
        message: 'This product has stock movement history and cannot be deleted. Keep it for audit integrity, or update it instead.',
      })
    }

    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM Stock_Quants WHERE product_id = ?', productId)
      await tx.run('DELETE FROM Products WHERE id = ?', productId)
    })

    return res.json({ message: 'Product deleted', id: productId })
  } catch {
    return res.status(500).json({ message: 'Failed to delete product' })
  }
})

module.exports = router
