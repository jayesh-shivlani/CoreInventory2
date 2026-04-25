/**
 * Operations (stock movement documents) routes.
 *
 * GET    /api/operations                - list by type
 * POST   /api/operations                - create draft
 * POST   /api/operations/:id/validate   - validate -> moves stock atomically
 * POST   /api/operations/:id/status     - manual status transition
 * DELETE /api/operations/:id            - delete non-Done document [Manager+]
 */

const express = require('express')
const { requireAuth, requireRole } = require('../auth')
const { getDb, ensureLocationByName, buildReference } = require('../db')
const { MANAGER_ROLES } = require('../constants')

const router = express.Router()

// Helpers
async function getCurrentQty(db, productId, locationId) {
  const row = await db.get(
    'SELECT quantity FROM Stock_Quants WHERE product_id = ? AND location_id = ?',
    productId, locationId,
  )
  return Number(row?.quantity || 0)
}

async function findLocationByName(db, name) {
  if (!name) return null
  return db.get('SELECT id, name, type FROM Locations WHERE name = ?', String(name).trim())
}

async function setQty(db, productId, locationId, quantity) {
  await db.run(
    `INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(product_id, location_id) DO UPDATE SET quantity = excluded.quantity`,
    productId, locationId, quantity,
  )
}

// List
router.get('/', requireAuth, async (req, res) => {
  try {
    const db      = await getDb()
    const type    = String(req.query.type    || '').trim()
    const sortBy  = String(req.query.sortBy  || 'created_at').trim()
    const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const orderByClause =
      sortBy === 'status'
        ? `CASE o.status
             WHEN 'Draft'    THEN 1
             WHEN 'Waiting'  THEN 2
             WHEN 'Ready'    THEN 3
             WHEN 'Done'     THEN 4
             WHEN 'Canceled' THEN 5
             ELSE 99
           END ${sortDir}, o.created_at DESC`
        : `o.created_at ${sortDir}`

    const sql = `
      SELECT
        o.id, o.reference_number, o.type, o.status, o.created_at,
        src.name AS source_location_name,
        dst.name AS destination_location_name
      FROM Operations o
      LEFT JOIN Locations src ON src.id = o.source_location_id
      LEFT JOIN Locations dst ON dst.id = o.destination_location_id
      ${type ? 'WHERE o.type = ?' : ''}
      ORDER BY ${orderByClause}`

    const rows = type ? await db.all(sql, type) : await db.all(sql)
    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to load operations' })
  }
})

// Create draft
router.post('/', requireAuth, async (req, res) => {
  try {
    const { type, supplier, source_location, destination_location, lines } = req.body || {}

    if (!type || !['Receipt', 'Delivery', 'Internal', 'Adjustment'].includes(type)) {
      return res.status(400).json({ message: 'Invalid operation type' })
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: 'At least one line is required' })
    }

    for (const line of lines) {
      const productId = Number(line.product_id)
      const qty       = Number(line.requested_quantity)
      const picked    = Number(line.picked_quantity  ?? 0)
      const packed    = Number(line.packed_quantity  ?? 0)

      if (!Number.isFinite(productId) || productId <= 0) {
        return res.status(400).json({ message: 'Each line requires a valid product_id' })
      }
      if (!Number.isFinite(qty) || qty < 0) {
        return res.status(400).json({ message: 'Quantities must be non-negative numbers' })
      }
      if (type !== 'Adjustment' && qty <= 0) {
        return res.status(400).json({ message: 'Quantity must be greater than zero for this operation type' })
      }
      if (type === 'Delivery' && (!Number.isFinite(picked) || picked < 0 || !Number.isFinite(packed) || packed < 0)) {
        return res.status(400).json({ message: 'Picked and packed quantities must be non-negative' })
      }
    }

    const db = await getDb()

    const result = await db.transaction(async (tx) => {
      const expectedSourceType = type === 'Receipt' ? 'Vendor' : 'Internal'
      const expectedDestinationType = type === 'Delivery' ? 'Customer' : 'Internal'

      let source
      if (type === 'Adjustment') {
        source = await ensureLocationByName(tx, 'Inventory Audit', 'Internal')
      } else {
        if (!source_location || !String(source_location).trim()) {
          return res.status(400).json({ message: 'Source location is required for this operation type' })
        }
        const sourceName = String(source_location).trim()
        source = await findLocationByName(tx, sourceName)
        if (!source) {
          return res.status(400).json({ message: `Source location \"${sourceName}\" was not found` })
        }
        if (source.type !== expectedSourceType) {
          return res.status(400).json({
            message: `Source location must be of type ${expectedSourceType} for ${type}`,
          })
        }
      }

      if (!destination_location || !String(destination_location).trim()) {
        return res.status(400).json({ message: 'Destination location is required for this operation type' })
      }
      const destinationName = String(destination_location).trim()
      const destination = await findLocationByName(tx, destinationName)
      if (!destination) {
        return res.status(400).json({ message: `Destination location \"${destinationName}\" was not found` })
      }
      if (destination.type !== expectedDestinationType) {
        return res.status(400).json({
          message: `Destination location must be of type ${expectedDestinationType} for ${type}`,
        })
      }

      if (type === 'Internal' && source.id === destination.id) {
        return res.status(400).json({
          message: 'Source and destination must be different for internal transfers',
        })
      }

      const op = await tx.run(
        `INSERT INTO Operations
           (type, status, supplier, source_location_id, destination_location_id, created_by)
         VALUES (?, 'Draft', ?, ?, ?, ?)`,
        type, supplier || null,
        source ? source.id : null,
        destination ? destination.id : null,
        req.user.id,
      )

      const operationId     = op.lastID
      const referenceNumber = buildReference(type, operationId)
      await tx.run('UPDATE Operations SET reference_number = ? WHERE id = ?', referenceNumber, operationId)

      for (const line of lines) {
        const requestedQty = Number(line.requested_quantity)
        const pickedQty    = Number(line.picked_quantity  ?? 0)
        const packedQty    = Number(line.packed_quantity  ?? 0)

        await tx.run(
          `INSERT INTO Operation_Lines
             (operation_id, product_id, requested_quantity, picked_quantity, packed_quantity)
           VALUES (?, ?, ?, ?, ?)`,
          operationId, Number(line.product_id), requestedQty,
          type === 'Delivery' ? pickedQty : requestedQty,
          type === 'Delivery' ? packedQty : requestedQty,
        )
      }

      return { id: operationId, reference_number: referenceNumber }
    })

    return res.status(201).json(result)
  } catch {
    return res.status(500).json({ message: 'Failed to create operation' })
  }
})

// Validate
router.post('/:id/validate', requireAuth, async (req, res) => {
  const operationId = Number(req.params.id)
  if (!Number.isFinite(operationId)) return res.status(400).json({ message: 'Invalid operation id' })

  try {
    const db = await getDb()

    const operation = await db.get('SELECT * FROM Operations WHERE id = ?', operationId)
    if (!operation)            return res.status(404).json({ message: 'Operation not found' })
    if (operation.status === 'Done')     return res.status(400).json({ message: 'Operation is already validated' })
    if (operation.status === 'Canceled') return res.status(400).json({ message: 'Canceled operation cannot be validated' })

    const lines = await db.all('SELECT * FROM Operation_Lines WHERE operation_id = ?', operationId)
    if (!lines.length) return res.status(400).json({ message: 'Operation has no lines to validate' })

    await db.transaction(async (tx) => {
      for (const line of lines) {
        const productId = Number(line.product_id)
        const requested = Number(line.requested_quantity)

        if (!Number.isFinite(requested) || requested < 0) {
          throw new Error('Invalid line quantity')
        }

        if (operation.type === 'Receipt') {
          const current = await getCurrentQty(tx, productId, operation.destination_location_id)
          await setQty(tx, productId, operation.destination_location_id, current + requested)
          await tx.run(
            'INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id) VALUES (?, ?, ?, ?, ?)',
            productId, operation.source_location_id, operation.destination_location_id, requested, operationId,
          )
        }

        if (operation.type === 'Delivery') {
          const currentSource = await getCurrentQty(tx, productId, operation.source_location_id)
          const picked = Number(line.picked_quantity ?? 0)
          const packed = Number(line.packed_quantity ?? 0)

          if (!Number.isFinite(picked) || picked < 0 || !Number.isFinite(packed) || packed < 0) {
            throw new Error('Picked and packed quantities must be non-negative numbers')
          }
          if (picked < requested) {
            throw new Error(`Picked quantity (${picked}) must be ≥ requested quantity (${requested}) for delivery validation`)
          }
          if (packed < requested) {
            throw new Error(`Packed quantity (${packed}) must be ≥ requested quantity (${requested}) for delivery validation`)
          }
          if (packed > picked) {
            throw new Error(`Packed quantity (${packed}) cannot exceed picked quantity (${picked})`)
          }
          if (currentSource < requested) {
            throw new Error('Insufficient stock for delivery validation')
          }

          await setQty(tx, productId, operation.source_location_id, currentSource - requested)
          await tx.run(
            'INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id) VALUES (?, ?, ?, ?, ?)',
            productId, operation.source_location_id, operation.destination_location_id, requested, operationId,
          )
        }

        if (operation.type === 'Internal') {
          const currentSource = await getCurrentQty(tx, productId, operation.source_location_id)
          if (currentSource < requested) {
            throw new Error('Insufficient stock for internal transfer validation')
          }
          const currentDest = await getCurrentQty(tx, productId, operation.destination_location_id)
          await setQty(tx, productId, operation.source_location_id, currentSource - requested)
          await setQty(tx, productId, operation.destination_location_id, currentDest + requested)
          await tx.run(
            'INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id) VALUES (?, ?, ?, ?, ?)',
            productId, operation.source_location_id, operation.destination_location_id, requested, operationId,
          )
        }

        if (operation.type === 'Adjustment') {
          const targetLocationId = operation.destination_location_id || operation.source_location_id
          if (!targetLocationId) throw new Error('Adjustment requires a target location')

          const current = await getCurrentQty(tx, productId, targetLocationId)
          const diff    = requested - current

          await setQty(tx, productId, targetLocationId, requested)

          if (diff !== 0) {
            const fromLoc = diff > 0 ? operation.source_location_id : targetLocationId
            const toLoc   = diff > 0 ? targetLocationId : operation.source_location_id
            await tx.run(
              'INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id) VALUES (?, ?, ?, ?, ?)',
              productId, fromLoc, toLoc, Math.abs(diff), operationId,
            )
          }
        }

        await tx.run('UPDATE Operation_Lines SET done_quantity = requested_quantity WHERE id = ?', line.id)
      }

      await tx.run("UPDATE Operations SET status = 'Done' WHERE id = ?", operationId)
    })

    return res.json({ message: 'Operation validated' })
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('insufficient stock')) {
      return res.status(400).json({ message: error.message })
    }
    return res.status(400).json({ message: error.message || 'Validation failed' })
  }
})

// Status transition
const STATUS_TRANSITIONS = {
  Draft:    ['Waiting', 'Ready', 'Canceled'],
  Waiting:  ['Ready', 'Canceled'],
  Ready:    ['Waiting', 'Canceled'],
  Canceled: ['Draft'],
}

router.post('/:id/status', requireAuth, async (req, res) => {
  const operationId = Number(req.params.id)
  if (!Number.isFinite(operationId)) return res.status(400).json({ message: 'Invalid operation id' })

  const nextStatus = String(req.body?.status || '').trim()
  const allowed    = ['Draft', 'Waiting', 'Ready', 'Canceled']
  if (!allowed.includes(nextStatus)) return res.status(400).json({ message: 'Invalid status value' })

  try {
    const db        = await getDb()
    const operation = await db.get('SELECT id, status FROM Operations WHERE id = ?', operationId)
    if (!operation)                    return res.status(404).json({ message: 'Operation not found' })
    if (operation.status === 'Done')   return res.status(400).json({ message: 'Validated operation status cannot be changed' })
    if (operation.status === nextStatus) {
      return res.json({ message: 'Status unchanged', id: operationId, status: operation.status })
    }

    const allowedNext = STATUS_TRANSITIONS[operation.status] || []
    if (!allowedNext.includes(nextStatus)) {
      return res.status(400).json({
        message: `Cannot move status from ${operation.status} to ${nextStatus}`,
      })
    }

    await db.run('UPDATE Operations SET status = ? WHERE id = ?', nextStatus, operationId)
    return res.json({ message: 'Status updated', id: operationId, status: nextStatus })
  } catch {
    return res.status(500).json({ message: 'Failed to update status' })
  }
})

// Delete
router.delete('/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  const operationId = Number(req.params.id)
  if (!Number.isFinite(operationId)) return res.status(400).json({ message: 'Invalid operation id' })

  try {
    const db        = await getDb()
    const operation = await db.get('SELECT * FROM Operations WHERE id = ?', operationId)
    if (!operation)                    return res.status(404).json({ message: 'Operation not found' })
    if (operation.status === 'Done')   return res.status(400).json({ message: 'Cannot delete a validated operation' })

    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM Operation_Lines WHERE operation_id = ?', operationId)
      await tx.run('DELETE FROM Operations WHERE id = ?', operationId)
    })

    return res.json({ message: 'Operation deleted' })
  } catch {
    return res.status(500).json({ message: 'Failed to delete operation' })
  }
})

module.exports = router
