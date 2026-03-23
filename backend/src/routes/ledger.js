/**
 * Stock ledger & CSV export routes.
 *
 * GET /api/ledger                - filtered stock movement log
 * GET /api/export/products       - products -> CSV download
 * GET /api/export/ledger         - ledger -> CSV download
 */

const express = require('express')
const { requireAuth } = require('../auth')
const { getDb } = require('../db')

const router = express.Router()

// Escape a value for CSV (RFC 4180)
function csvEsc(val) {
  return `"${String(val ?? '').replace(/"/g, '""')}"`
}

function buildCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvEsc).join(',')).join('\r\n')
}

// Ledger
router.get('/ledger', requireAuth, async (req, res) => {
  try {
    const db       = await getDb()
    const search   = String(req.query.search   || '').trim()
    const dateFrom = String(req.query.dateFrom || '').trim()
    const dateTo   = String(req.query.dateTo   || '').trim()
    const opType   = String(req.query.type     || '').trim()

    const conditions = []
    const values     = []

    if (search) {
      conditions.push("(p.name ILIKE ? OR COALESCE(o.reference_number, '') ILIKE ?)")
      values.push(`%${search}%`, `%${search}%`)
    }
    if (dateFrom) {
      conditions.push('sl.timestamp >= ?::date')
      values.push(dateFrom)
    }
    if (dateTo) {
      conditions.push("sl.timestamp < (?::date + INTERVAL '1 day')")
      values.push(dateTo)
    }
    if (opType) {
      conditions.push('o.type = ?')
      values.push(opType)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await db.all(
      `SELECT
         sl.id, sl.timestamp,
         p.name   AS product_name,
         src.name AS from_location_name,
         dst.name AS to_location_name,
         sl.quantity,
         o.reference_number,
         o.type   AS operation_type,
         sl.note
       FROM Stock_Ledger sl
       LEFT JOIN Products  p   ON p.id   = sl.product_id
       LEFT JOIN Locations src ON src.id = sl.from_location_id
       LEFT JOIN Locations dst ON dst.id = sl.to_location_id
       LEFT JOIN Operations o  ON o.id   = sl.operation_id
       ${where}
       ORDER BY sl.timestamp DESC, sl.id DESC
       LIMIT 1000`,
      ...values,
    )

    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to fetch ledger' })
  }
})

// Export: Products -> CSV
router.get('/export/products', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const rows = await db.all(
      `SELECT
         p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum,
         COALESCE(SUM(sq.quantity), 0)::INT AS available_stock
       FROM Products p
       LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
       GROUP BY p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum
       ORDER BY p.name ASC`,
    )

    const headers = ['ID', 'Name', 'SKU', 'Category', 'Unit of Measure', 'Reorder Min', 'Available Stock', 'Status']
    const data    = rows.map((p) => [
      p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum,
      p.available_stock,
      Number(p.available_stock) <= Number(p.reorder_minimum) ? 'Low Stock' : 'In Stock',
    ])

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="core_inventory_products.csv"')
    return res.send('\uFEFF' + buildCsv(headers, data))  // BOM -> correct Excel display
  } catch {
    return res.status(500).json({ message: 'Products export failed' })
  }
})

// Export: Ledger -> CSV
router.get('/export/ledger', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const rows = await db.all(
      `SELECT
         sl.id,
         TO_CHAR(sl.timestamp, 'YYYY-MM-DD HH24:MI:SS') AS timestamp,
         COALESCE(p.name,   '')  AS product_name,
         COALESCE(p.sku,    '')  AS sku,
         COALESCE(src.name, '')  AS from_location,
         COALESCE(dst.name, '')  AS to_location,
         sl.quantity,
         COALESCE(o.reference_number, '') AS reference_number,
         COALESCE(o.type,   '')  AS operation_type,
         COALESCE(sl.note,  '')  AS note
       FROM Stock_Ledger sl
       LEFT JOIN Products  p   ON p.id   = sl.product_id
       LEFT JOIN Locations src ON src.id = sl.from_location_id
       LEFT JOIN Locations dst ON dst.id = sl.to_location_id
       LEFT JOIN Operations o  ON o.id   = sl.operation_id
       ORDER BY sl.timestamp DESC
       LIMIT 10000`,
    )

    const headers = ['ID', 'Timestamp', 'Product', 'SKU', 'From Location', 'To Location', 'Quantity', 'Reference', 'Type', 'Note']
    const data    = rows.map((e) => [
      e.id, e.timestamp, e.product_name, e.sku,
      e.from_location, e.to_location, e.quantity,
      e.reference_number, e.operation_type, e.note,
    ])

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="core_inventory_ledger.csv"')
    return res.send('\uFEFF' + buildCsv(headers, data))
  } catch {
    return res.status(500).json({ message: 'Ledger export failed' })
  }
})

module.exports = router
