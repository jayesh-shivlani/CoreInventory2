/**
 * Dashboard KPI & filter routes.
 *
 * GET /api/dashboard/kpis     - aggregated operational metrics
 * GET /api/dashboard/filters  - dropdown options for dashboard filters
 */

const express = require('express')
const { requireAuth } = require('../auth')
const { getDb } = require('../db')
const { withTimeout } = require('../utils/withTimeout')

const router = express.Router()
const DASHBOARD_QUERY_TIMEOUT_MS = 7000
const FILTER_CACHE_TTL_MS = 5 * 60 * 1000

const filterCache = {
  expiresAt: 0,
  payload: null,
}

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
      withTimeout(
        db.get(
          `SELECT COALESCE(SUM(sq.quantity), 0)::INT AS "totalProductsInStock"
           FROM Stock_Quants sq
           JOIN Products  p ON p.id  = sq.product_id
           JOIN Locations l ON l.id  = sq.location_id
           ${productWhere}`,
          ...productValues,
        ),
        DASHBOARD_QUERY_TIMEOUT_MS,
        'Dashboard total stock query timed out',
      ),
      withTimeout(
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
        DASHBOARD_QUERY_TIMEOUT_MS,
        'Dashboard low stock query timed out',
      ),
    ])

    // Operation-level filters
    const opConditions = []
    const opValues     = []
    if (documentType) { opConditions.push('o.type = ?'); opValues.push(documentType) }
    if (status)       { opConditions.push('o.status = ?'); opValues.push(status) }
    if (warehouse)    { opConditions.push('(src.name ILIKE ? OR dst.name ILIKE ?)'); opValues.push(`%${warehouse}%`, `%${warehouse}%`) }
    const opFilter = opConditions.length ? `AND ${opConditions.join(' AND ')}` : ''

    const opQuery = `
      SELECT o.type, COUNT(*)::INT AS cnt
      FROM Operations o
      LEFT JOIN Locations src ON src.id = o.source_location_id
      LEFT JOIN Locations dst ON dst.id = o.destination_location_id
      WHERE o.status IN ('Draft', 'Waiting', 'Ready')
        ${opFilter}
      GROUP BY o.type`

    const opRows = await withTimeout(
      db.all(opQuery, ...opValues),
      DASHBOARD_QUERY_TIMEOUT_MS,
      'Dashboard operation counts query timed out',
    )

    const opCountByType = new Map(opRows.map((row) => [String(row.type || ''), Number(row.cnt || 0)]))

    return res.json({
      totalProductsInStock:       Number(totalRow?.totalProductsInStock   || 0),
      lowOrOutOfStockItems:       Number(lowRow?.lowOrOutOfStockItems       || 0),
      pendingReceipts:            opCountByType.get('Receipt') || 0,
      pendingDeliveries:          opCountByType.get('Delivery') || 0,
      scheduledInternalTransfers: opCountByType.get('Internal') || 0,
    })
  } catch (error) {
    console.error('[dashboard/kpis]', error)
    return res.status(500).json({ message: 'Failed to load dashboard KPIs' })
  }
})

router.get('/filters', requireAuth, async (req, res) => {
  try {
    if (filterCache.payload && Date.now() < filterCache.expiresAt) {
      return res.json(filterCache.payload)
    }

    const db = await getDb()
    const [warehouses, categories] = await Promise.all([
      withTimeout(
        db.all("SELECT DISTINCT name FROM Locations WHERE LOWER(BTRIM(COALESCE(type, ''))) LIKE 'internal%' ORDER BY name"),
        DASHBOARD_QUERY_TIMEOUT_MS,
        'Dashboard warehouse filter query timed out',
      ),
      withTimeout(
        db.all('SELECT DISTINCT category FROM Products ORDER BY category'),
        DASHBOARD_QUERY_TIMEOUT_MS,
        'Dashboard category filter query timed out',
      ),
    ])

    const payload = {
      documentTypes: ['Receipt', 'Delivery', 'Internal', 'Adjustment'],
      statuses:      ['Draft', 'Waiting', 'Ready', 'Done', 'Canceled'],
      warehouses:    warehouses.map((x) => x.name).filter(Boolean),
      categories:    categories.map((x) => x.category).filter(Boolean),
    }

    filterCache.payload = payload
    filterCache.expiresAt = Date.now() + FILTER_CACHE_TTL_MS

    return res.json(payload)
  } catch (error) {
    console.error('[dashboard/filters]', error)
    return res.status(500).json({ message: 'Failed to load dashboard filters' })
  }
})

module.exports = router
