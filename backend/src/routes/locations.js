/**
 * Location (warehouse) routes.
 *
 * GET    /api/locations        - list all
 * POST   /api/locations        - create [Manager+]
 * DELETE /api/locations/:id    - delete [Manager+]
 */

const express = require('express')
const { requireAuth, requireRole } = require('../auth')
const { getDb } = require('../db')
const { MANAGER_ROLES } = require('../constants')

const router = express.Router()

router.get('/', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const rows = await db.all('SELECT id, name, type FROM Locations ORDER BY name')
    return res.json(rows)
  } catch {
    return res.status(500).json({ message: 'Failed to load locations' })
  }
})

router.post('/', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  try {
    const { name, type } = req.body || {}
    if (!name || !type) return res.status(400).json({ message: 'name and type are required' })

    const db = await getDb()
    const existing = await db.get('SELECT id FROM Locations WHERE name = ?', String(name).trim())
    if (existing) return res.status(409).json({ message: 'Location name already exists' })

    const result = await db.run(
      'INSERT INTO Locations (name, type) VALUES (?, ?)',
      String(name).trim(), String(type).trim(),
    )
    return res.status(201).json({ id: result.lastID, name: String(name).trim(), type: String(type).trim() })
  } catch {
    return res.status(500).json({ message: 'Failed to create location' })
  }
})

router.delete('/:id', requireAuth, requireRole(MANAGER_ROLES), async (req, res) => {
  const locationId = Number(req.params.id)
  if (!Number.isFinite(locationId)) return res.status(400).json({ message: 'Invalid location id' })

  try {
    const db = await getDb()
    const location = await db.get('SELECT * FROM Locations WHERE id = ?', locationId)
    if (!location) return res.status(404).json({ message: 'Location not found' })

    const stock = await db.get('SELECT SUM(quantity) AS total FROM Stock_Quants WHERE location_id = ?', locationId)
    if (stock && Number(stock.total) > 0) {
      return res.status(400).json({ message: 'Cannot delete a location that has existing stock' })
    }

    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM Stock_Quants WHERE location_id = ?', locationId)
      await tx.run('DELETE FROM Locations WHERE id = ?', locationId)
      await tx.run(
        "INSERT INTO Stock_Ledger (note, timestamp) VALUES (?, NOW())",
        `Deleted Location: ${location.name}`,
      )
    })

    return res.json({ message: 'Location deleted' })
  } catch {
    return res.status(500).json({ message: 'Failed to delete location' })
  }
})

module.exports = router
