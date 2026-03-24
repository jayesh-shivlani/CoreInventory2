const express = require('express')
const { requireAuth } = require('../auth')
const { getDb } = require('../db')

const router = express.Router()

function escapeLikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&')
}

function pathForOperation(type, id) {
  if (type === 'Delivery') return `/operations/deliveries?focusOp=${id}`
  if (type === 'Internal') return `/operations/transfers?focusOp=${id}`
  if (type === 'Adjustment') return `/operations/adjustments?focusOp=${id}`
  return `/operations/receipts?focusOp=${id}`
}

/**
 * Lightweight global search for top-bar command results.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const rawQuery = String(req.query.q || '').trim()
    if (rawQuery.length < 2) {
      return res.json({ query: rawQuery, results: [] })
    }

    const db = await getDb()
    const pattern = `%${escapeLikePattern(rawQuery)}%`
    const prefixPattern = `${escapeLikePattern(rawQuery)}%`

    const [products, operations, locations] = await Promise.all([
      db.all(
        `WITH product_stock AS (
           SELECT
             p.id,
             p.name,
             p.sku,
             p.category,
             p.reorder_minimum,
             COALESCE(SUM(sq.quantity), 0)::INT AS available_stock
           FROM Products p
           LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
           GROUP BY p.id, p.name, p.sku, p.category, p.reorder_minimum
         )
         SELECT *
         FROM product_stock
         WHERE name ILIKE ? ESCAPE '\\'
            OR sku ILIKE ? ESCAPE '\\'
            OR category ILIKE ? ESCAPE '\\'
         ORDER BY
           CASE
             WHEN sku ILIKE ? ESCAPE '\\' THEN 0
             WHEN name ILIKE ? ESCAPE '\\' THEN 1
             ELSE 2
           END,
           name ASC
         LIMIT 5`,
        pattern,
        pattern,
        pattern,
        prefixPattern,
        prefixPattern,
      ),
      db.all(
        `SELECT
           o.id,
           o.reference_number,
           o.type,
           o.status,
           o.created_at,
           src.name AS source_location_name,
           dst.name AS destination_location_name
         FROM Operations o
         LEFT JOIN Locations src ON src.id = o.source_location_id
         LEFT JOIN Locations dst ON dst.id = o.destination_location_id
         WHERE o.reference_number ILIKE ? ESCAPE '\\'
            OR o.type ILIKE ? ESCAPE '\\'
            OR o.status ILIKE ? ESCAPE '\\'
            OR COALESCE(src.name, '') ILIKE ? ESCAPE '\\'
            OR COALESCE(dst.name, '') ILIKE ? ESCAPE '\\'
         ORDER BY
           CASE
             WHEN o.reference_number ILIKE ? ESCAPE '\\' THEN 0
             WHEN o.status IN ('Waiting', 'Ready') THEN 1
             ELSE 2
           END,
           o.created_at DESC
         LIMIT 5`,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        prefixPattern,
      ),
      db.all(
        `SELECT
           l.id,
           l.name,
           l.type,
           COUNT(DISTINCT sq.product_id)::INT AS product_count,
           COALESCE(SUM(sq.quantity), 0)::INT AS total_stock
         FROM Locations l
         LEFT JOIN Stock_Quants sq ON sq.location_id = l.id
         WHERE l.name ILIKE ? ESCAPE '\\'
            OR l.type ILIKE ? ESCAPE '\\'
         GROUP BY l.id, l.name, l.type
         ORDER BY
           CASE
             WHEN l.name ILIKE ? ESCAPE '\\' THEN 0
             ELSE 1
           END,
           l.name ASC
         LIMIT 4`,
        pattern,
        pattern,
        prefixPattern,
      ),
    ])

    const results = [
      ...products.map((product) => {
        const availableStock = Number(product.available_stock || 0)
        const reorderMinimum = Number(product.reorder_minimum || 0)
        const isOutOfStock = availableStock <= 0
        const isLowStock = reorderMinimum > 0 && availableStock <= reorderMinimum

        return {
          id: `product-${product.id}`,
          kind: 'product',
          title: product.name,
          subtitle: `${product.sku} • ${product.category}`,
          meta: isOutOfStock
            ? 'Out of stock'
            : isLowStock
              ? `Low stock • ${availableStock} on hand`
              : `${availableStock} on hand`,
          path: `/products?search=${encodeURIComponent(product.sku)}`,
          tone: isOutOfStock ? 'danger' : isLowStock ? 'warning' : 'default',
        }
      }),
      ...operations.map((operation) => ({
        id: `operation-${operation.id}`,
        kind: 'operation',
        title: operation.reference_number || `${operation.type} #${operation.id}`,
        subtitle: `${operation.type} • ${operation.source_location_name || 'No source'} → ${operation.destination_location_name || 'No destination'}`,
        meta: operation.status,
        path: pathForOperation(operation.type, operation.id),
        tone: operation.status === 'Ready' || operation.status === 'Waiting' ? 'warning' : 'default',
      })),
      ...locations.map((location) => ({
        id: `location-${location.id}`,
        kind: 'location',
        title: location.name,
        subtitle: `${location.type} location`,
        meta: `${Number(location.product_count || 0)} products • ${Number(location.total_stock || 0)} units`,
        path: '/settings/warehouses',
      })),
    ]

    return res.json({ query: rawQuery, results })
  } catch (error) {
    console.error('[search]', error)
    return res.status(500).json({ message: 'Failed to search inventory' })
  }
})

module.exports = router
