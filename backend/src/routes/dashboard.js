/**
 * Dashboard KPI & filter routes.
 *
 * GET /api/dashboard/kpis     - aggregated operational metrics
 * GET /api/dashboard/filters  - dropdown options for dashboard filters
 */

const express = require('express')
const { requireAuth } = require('../auth')
const { getDb } = require('../db')

const router = express.Router()

router.get('/kpis', requireAuth, async (req, res) => {
  try {
    const db = await getDb()

    const documentType = String(req.query.documentType || '').trim()
    const status       = String(req.query.status       || '').trim()
    const warehouse    = String(req.query.warehouse    || '').trim()
    const category     = String(req.query.category     || '').trim()

    // Product-level filters
    const productConditions = []
    const productValues     = []
    if (category) { productConditions.push('p.category ILIKE ?'); productValues.push(`%${category}%`) }
    if (warehouse) { productConditions.push('l.name ILIKE ?'); productValues.push(`%${warehouse}%`) }
    const productWhere = productConditions.length ? `WHERE ${productConditions.join(' AND ')}` : ''

    const [totalRow, lowRow] = await Promise.all([
      db.get(
        `SELECT COALESCE(SUM(sq.quantity), 0)::INT AS "totalProductsInStock"
         FROM Stock_Quants sq
         JOIN Products  p ON p.id  = sq.product_id
         JOIN Locations l ON l.id  = sq.location_id
         ${productWhere}`,
        ...productValues,
      ),
      db.get(
        `SELECT COUNT(*)::INT AS "lowOrOutOfStockItems"
         FROM (
           SELECT p.id, p.reorder_minimum, COALESCE(SUM(sq.quantity), 0) AS total_qty
           FROM Products p
           LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
           LEFT JOIN Locations    l  ON l.id = sq.location_id
           ${productWhere}
           GROUP BY p.id, p.reorder_minimum
           HAVING COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum
         ) t`,
        ...productValues,
      ),
    ])

    // Operation-level filters
    const opConditions = []
    const opValues     = []
    if (documentType) { opConditions.push('o.type = ?'); opValues.push(documentType) }
    if (status)       { opConditions.push('o.status = ?'); opValues.push(status) }
    if (warehouse)    { opConditions.push('(src.name ILIKE ? OR dst.name ILIKE ?)'); opValues.push(`%${warehouse}%`, `%${warehouse}%`) }
    const opFilter = opConditions.length ? `AND ${opConditions.join(' AND ')}` : ''

    const buildOpQuery = () => `
      SELECT COUNT(*)::INT AS cnt
      FROM Operations o
      LEFT JOIN Locations src ON src.id = o.source_location_id
      LEFT JOIN Locations dst ON dst.id = o.destination_location_id
      WHERE o.type = ?
        AND o.status IN ('Draft', 'Waiting', 'Ready')
        ${opFilter}`

    const opQuery = buildOpQuery()
    const getOpCount = (type) => db.get(opQuery, type, ...opValues)

    const [receiptRow, deliveryRow, internalRow] = await Promise.all([
      getOpCount('Receipt'),
      getOpCount('Delivery'),
      getOpCount('Internal'),
    ])

    return res.json({
      totalProductsInStock:       Number(totalRow?.totalProductsInStock   || 0),
      lowOrOutOfStockItems:       Number(lowRow?.lowOrOutOfStockItems       || 0),
      pendingReceipts:            Number(receiptRow?.cnt                   || 0),
      pendingDeliveries:          Number(deliveryRow?.cnt                  || 0),
      scheduledInternalTransfers: Number(internalRow?.cnt                  || 0),
    })
  } catch (error) {
    console.error('[dashboard/kpis]', error)
    return res.status(500).json({ message: 'Failed to load dashboard KPIs' })
  }
})

router.get('/filters', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const [warehouses, categories] = await Promise.all([
      db.all('SELECT DISTINCT name FROM Locations ORDER BY name'),
      db.all('SELECT DISTINCT category FROM Products ORDER BY category'),
    ])
    return res.json({
      documentTypes: ['Receipt', 'Delivery', 'Internal', 'Adjustment'],
      statuses:      ['Draft', 'Waiting', 'Ready', 'Done', 'Canceled'],
      warehouses:    warehouses.map((x) => x.name).filter(Boolean),
      categories:    categories.map((x) => x.category).filter(Boolean),
    })
  } catch {
    return res.status(500).json({ message: 'Failed to load dashboard filters' })
  }
})

module.exports = router
