/**
 * Analytics overview route.
 *
 * GET /api/analytics/overview - aggregated stats for the Reports page
 */

const express = require('express')
const { requireAuth } = require('../auth')
const { getDb } = require('../db')

const router = express.Router()

router.get('/overview', requireAuth, async (req, res) => {
  try {
    const db = await getDb()

    const [
      dailyMovements,
      categoryBreakdown,
      topProducts,
      operationStats,
      reorderSuggestions,
      totalMovementsRow,
      locationStock,
    ] = await Promise.all([

      // Daily movements - last 30 days
      db.all(`
        SELECT
          TO_CHAR(sl.timestamp::date, 'MM/DD') AS date,
          sl.timestamp::date                    AS full_date,
          COUNT(*)::INT                         AS movements,
          COALESCE(SUM(ABS(sl.quantity)), 0)::INT AS total_quantity
        FROM Stock_Ledger sl
        WHERE sl.product_id IS NOT NULL
          AND sl.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY sl.timestamp::date
        ORDER BY sl.timestamp::date ASC`),

      // On-hand stock grouped by category
      db.all(`
        SELECT
          p.category,
          COUNT(DISTINCT p.id)::INT         AS product_count,
          COALESCE(SUM(sq.quantity), 0)::INT AS total_stock
        FROM Products p
        LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
        GROUP BY p.category
        ORDER BY total_stock DESC LIMIT 8`),

      // Top 10 products by current stock
      db.all(`
        SELECT
          p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum,
          COALESCE(SUM(sq.quantity), 0)::INT AS total_stock
        FROM Products p
        LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
        GROUP BY p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum
        ORDER BY total_stock DESC LIMIT 10`),

      // Operations summary - last 30 days
      db.all(`
        SELECT
          type,
          COUNT(*)::INT                               AS total,
          COUNT(*) FILTER (WHERE status='Done')::INT  AS done_count
        FROM Operations
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY type ORDER BY total DESC`),

      // Products at or below reorder minimum
      db.all(`
        SELECT
          p.id, p.name, p.sku, p.category, p.reorder_minimum,
          COALESCE(SUM(sq.quantity), 0)::INT AS current_stock
        FROM Products p
        LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
        WHERE p.reorder_minimum > 0
        GROUP BY p.id, p.name, p.sku, p.category, p.reorder_minimum
        HAVING COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum
        ORDER BY COALESCE(SUM(sq.quantity), 0) ASC, p.name ASC LIMIT 15`),

      // All-time movement count
      db.get('SELECT COUNT(*)::INT AS count FROM Stock_Ledger WHERE product_id IS NOT NULL'),

      // Stock by internal location
      db.all(`
        SELECT
          l.name AS location_name,
          l.type AS location_type,
          COUNT(DISTINCT sq.product_id)::INT  AS product_count,
          COALESCE(SUM(sq.quantity), 0)::INT  AS total_stock
        FROM Locations l
        LEFT JOIN Stock_Quants sq ON sq.location_id = l.id
        WHERE l.type = 'Internal'
        GROUP BY l.id, l.name, l.type
        HAVING COALESCE(SUM(sq.quantity), 0) > 0
        ORDER BY total_stock DESC LIMIT 8`),
    ])

    return res.json({
      dailyMovements:     dailyMovements     || [],
      categoryBreakdown:  categoryBreakdown  || [],
      topProducts:        topProducts        || [],
      operationStats:     operationStats     || [],
      reorderSuggestions: reorderSuggestions || [],
      locationStock:      locationStock      || [],
      totalMovements: Number(totalMovementsRow?.count || 0),
    })
  } catch (error) {
    console.error('[analytics/overview]', error)
    return res.status(500).json({ message: 'Failed to load analytics' })
  }
})

module.exports = router
