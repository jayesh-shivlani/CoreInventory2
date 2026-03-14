require('dotenv').config()
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const nodemailer = require('nodemailer')
const fs = require('fs')
const path = require('path')
const { buildReference, ensureLocationByName, getDb, initDb } = require('./db')
const { requireAuth, signToken } = require('./auth')

const app = express()
const PORT = Number(process.env.PORT || 4000)

async function sendOtpEmail(toEmail, otp) {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.FROM_EMAIL || user

  if (!host || !user || !pass || !from) {
    console.warn(`[DEV] Email service is not configured. OTP for ${toEmail} is ${otp}`)
    return
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  })

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'Core Inventory OTP for password reset',
    text: `Your OTP code is ${otp}. It is required to reset your Core Inventory password.`,
    html: `<p>Your OTP code is <strong>${otp}</strong>.</p><p>Use this code to reset your Core Inventory password.</p>`,
  })
}

const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('CORS blocked'))
      }
    },
  }),
)
app.use(express.json())

app.get('/api/health', async (req, res) => {
  const db = await getDb()
  const row = await db.get('SELECT datetime("now") AS now')
  res.json({ status: 'ok', databaseTime: row.now })
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {}

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email, and password are required' })
    }

    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }

    const db = await getDb()
    const existing = await db.get('SELECT id FROM Users WHERE email = ?', String(email).toLowerCase())
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' })
    }

    const hash = await bcrypt.hash(String(password), 10)
    await db.run(
      'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      String(name).trim(),
      String(email).toLowerCase().trim(),
      hash,
      role && typeof role === 'string' ? role : 'Warehouse Staff',
    )

    return res.status(201).json({ message: 'Registered successfully' })
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' })
    }

    const db = await getDb()
    const user = await db.get('SELECT * FROM Users WHERE email = ?', String(email).toLowerCase().trim())
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const valid = await bcrypt.compare(String(password), user.password_hash)
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const token = signToken(user)
    return res.json({ token })
  } catch (error) {
    return res.status(500).json({ message: 'Login failed' })
  }
})

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {}
    if (!email) {
      return res.status(400).json({ message: 'email is required' })
    }

    const db = await getDb()
    const user = await db.get('SELECT id, otp_code FROM Users WHERE email = ?', String(email).toLowerCase().trim())
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!otp || !newPassword) {
      const generatedOtp = String(Math.floor(100000 + Math.random() * 900000))
      await db.run('UPDATE Users SET otp_code = ? WHERE id = ?', generatedOtp, user.id)

      try {
        await sendOtpEmail(String(email).toLowerCase().trim(), generatedOtp)
      } catch (error) {
        return res.status(500).json({ message: 'Failed to send OTP email. Please contact support.' })
      }

      return res.json({ message: 'OTP sent to your email' })
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'newPassword must be at least 6 characters' })
    }

    if (String(otp).trim() !== String(user.otp_code || '').trim()) {
      return res.status(400).json({ message: 'Invalid OTP code' })
    }

    const hash = await bcrypt.hash(String(newPassword), 10)
    await db.run('UPDATE Users SET password_hash = ?, otp_code = NULL WHERE id = ?', hash, user.id)

    return res.json({ message: 'Password reset successful' })
  } catch (error) {
    return res.status(500).json({ message: 'Password reset failed' })
  }
})

app.get('/api/users/me', requireAuth, async (req, res) => {
  res.json(req.user)
})

app.get('/api/locations', requireAuth, async (req, res) => {
  const db = await getDb()
  const rows = await db.all('SELECT id, name, type FROM Locations ORDER BY name')
  res.json(rows)
})

app.post('/api/locations', requireAuth, async (req, res) => {
  try {
    const { name, type } = req.body || {}
    if (!name || !type) {
      return res.status(400).json({ message: 'name and type are required' })
    }

    const db = await getDb()
    const existing = await db.get('SELECT id FROM Locations WHERE name = ?', String(name).trim())
    if (existing) {
      return res.status(409).json({ message: 'Location name already exists' })
    }

    const result = await db.run(
      'INSERT INTO Locations (name, type) VALUES (?, ?)',
      String(name).trim(),
      String(type).trim(),
    )

    res.status(201).json({ id: result.lastID, name: String(name).trim(), type: String(type).trim() })
  } catch (error) {
    res.status(500).json({ message: 'Failed to create location' })
  }
})

app.get('/api/products', requireAuth, async (req, res) => {
  const db = await getDb()
  const search = String(req.query.search || '').trim()
  const category = String(req.query.category || '').trim()
  const location = String(req.query.location || '').trim()
  const lowStockOnly = String(req.query.lowStockOnly || '').trim() === 'true'

  const values = []
  const conditions = []

  if (search) {
    conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)')
    values.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (category) {
    conditions.push('p.category LIKE ?')
    values.push(`%${category}%`)
  }
  if (location) {
    conditions.push('l.name LIKE ?')
    values.push(`%${location}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const having = lowStockOnly ? 'HAVING availableStock <= p.reorder_minimum' : ''

  const rows = await db.all(
    `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.category,
        p.unit_of_measure,
        p.reorder_minimum,
        COALESCE(SUM(sq.quantity), 0) AS availableStock,
        MAX(l.name) AS locationName
      FROM Products p
      LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
      LEFT JOIN Locations l ON l.id = sq.location_id
      ${where}
      GROUP BY p.id, p.name, p.sku, p.category, p.unit_of_measure, p.reorder_minimum
      ${having}
      ORDER BY p.name ASC
    `,
    ...values,
  )

  res.json(rows)
})

app.post('/api/products', requireAuth, async (req, res) => {
  try {
    const { name, sku, category, unit_of_measure, initial_stock, reorder_minimum } = req.body || {}

    if (!name || !sku || !category || !unit_of_measure) {
      return res.status(400).json({ message: 'name, sku, category and unit_of_measure are required' })
    }

    const stock = Number(initial_stock || 0)
    const reorder = Number(reorder_minimum || 0)

    if (!Number.isFinite(stock) || stock < 0 || !Number.isFinite(reorder) || reorder < 0) {
      return res.status(400).json({ message: 'initial_stock and reorder_minimum must be non-negative numbers' })
    }

    const db = await getDb()
    const existing = await db.get('SELECT id FROM Products WHERE sku = ?', String(sku).trim())
    if (existing) {
      return res.status(409).json({ message: 'SKU already exists' })
    }

    await db.exec('BEGIN TRANSACTION')
    try {
      const inserted = await db.run(
        'INSERT INTO Products (name, sku, category, unit_of_measure, reorder_minimum) VALUES (?, ?, ?, ?, ?)',
        String(name).trim(),
        String(sku).trim(),
        String(category).trim(),
        String(unit_of_measure).trim(),
        reorder,
      )

      const productId = inserted.lastID
      if (stock > 0) {
        const mainLocation = await ensureLocationByName(db, 'Main Warehouse', 'Internal')
        await db.run(
          'INSERT INTO Stock_Quants (product_id, location_id, quantity) VALUES (?, ?, ?)',
          productId,
          mainLocation.id,
          stock,
        )
      }

      await db.exec('COMMIT')
      return res.status(201).json({ id: productId })
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save product' })
  }
})

app.get('/api/products/:id/stock', requireAuth, async (req, res) => {
  const db = await getDb()
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ message: 'Invalid product id' })
  }

  const rows = await db.all(
    `
      SELECT
        sq.location_id,
        l.name AS location_name,
        sq.quantity
      FROM Stock_Quants sq
      JOIN Locations l ON l.id = sq.location_id
      WHERE sq.product_id = ?
      ORDER BY l.name
    `,
    productId,
  )

  return res.json(rows)
})

app.get('/api/products/:id', requireAuth, async (req, res) => {
  const db = await getDb()
  const productId = Number(req.params.id)
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ message: 'Invalid product id' })
  }

  const row = await db.get(
    `
      SELECT id, name, sku, category, unit_of_measure, reorder_minimum
      FROM Products
      WHERE id = ?
    `,
    productId,
  )

  if (!row) {
    return res.status(404).json({ message: 'Product not found' })
  }

  return res.json(row)
})

app.put('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const productId = Number(req.params.id)
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ message: 'Invalid product id' })
    }

    const existing = await db.get('SELECT id FROM Products WHERE id = ?', productId)
    if (!existing) {
      return res.status(404).json({ message: 'Product not found' })
    }

    const { name, sku, category, unit_of_measure, reorder_minimum } = req.body || {}
    if (!name || !sku || !category || !unit_of_measure) {
      return res.status(400).json({ message: 'name, sku, category and unit_of_measure are required' })
    }

    const reorder = Number(reorder_minimum ?? 0)
    if (!Number.isFinite(reorder) || reorder < 0) {
      return res.status(400).json({ message: 'reorder_minimum must be a non-negative number' })
    }

    const conflict = await db.get('SELECT id FROM Products WHERE sku = ? AND id <> ?', String(sku).trim(), productId)
    if (conflict) {
      return res.status(409).json({ message: 'SKU already exists' })
    }

    await db.run(
      `
        UPDATE Products
        SET name = ?, sku = ?, category = ?, unit_of_measure = ?, reorder_minimum = ?
        WHERE id = ?
      `,
      String(name).trim(),
      String(sku).trim(),
      String(category).trim(),
      String(unit_of_measure).trim(),
      reorder,
      productId,
    )

    return res.json({ message: 'Product updated', id: productId })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update product' })
  }
})

app.get('/api/dashboard/kpis', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const documentType = req.query.documentType ? String(req.query.documentType) : ''
    const status = req.query.status ? String(req.query.status) : ''
    const warehouse = req.query.warehouse ? String(req.query.warehouse) : ''
    const category = req.query.category ? String(req.query.category) : ''

    const productConditions = []
    const productValues = []

    if (category) {
      productConditions.push('p.category LIKE ?')
      productValues.push(`%${category}%`)
    }

    if (warehouse) {
      productConditions.push('l.name LIKE ?')
      productValues.push(`%${warehouse}%`)
    }

    const productWhere = productConditions.length ? `WHERE ${productConditions.join(' AND ')}` : ''

    const totalRow = await db.get(
      `
        SELECT COALESCE(SUM(sq.quantity), 0) AS totalProductsInStock
        FROM Stock_Quants sq
        JOIN Products p ON p.id = sq.product_id
        JOIN Locations l ON l.id = sq.location_id
        ${productWhere}
      `,
      ...productValues,
    )

    const lowRow = await db.get(
      `
        SELECT COUNT(*) AS lowOrOutOfStockItems
        FROM (
          SELECT p.id, p.reorder_minimum, COALESCE(SUM(sq.quantity), 0) AS total_quantity
          FROM Products p
          LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
          LEFT JOIN Locations l ON l.id = sq.location_id
          ${productWhere}
          GROUP BY p.id, p.reorder_minimum
          HAVING total_quantity <= p.reorder_minimum
        ) t
      `,
      ...productValues,
    )

    const opConditions = []
    const opValues = []

    if (documentType) {
      opConditions.push('o.type = ?')
      opValues.push(documentType)
    }
    if (status) {
      opConditions.push('o.status = ?')
      opValues.push(status)
    }
    if (warehouse) {
      opConditions.push('(src.name LIKE ? OR dst.name LIKE ?)')
      opValues.push(`%${warehouse}%`, `%${warehouse}%`)
    }

    const opWhere = opConditions.length ? `AND ${opConditions.join(' AND ')}` : ''

    const pendingReceiptRow = await db.get(
      `
        SELECT COUNT(*) AS pendingReceipts
        FROM Operations o
        LEFT JOIN Locations src ON src.id = o.source_location_id
        LEFT JOIN Locations dst ON dst.id = o.destination_location_id
        WHERE o.type = 'Receipt'
          AND o.status IN ('Draft', 'Waiting', 'Ready')
          ${opWhere}
      `,
      ...opValues,
    )

    const pendingDeliveryRow = await db.get(
      `
        SELECT COUNT(*) AS pendingDeliveries
        FROM Operations o
        LEFT JOIN Locations src ON src.id = o.source_location_id
        LEFT JOIN Locations dst ON dst.id = o.destination_location_id
        WHERE o.type = 'Delivery'
          AND o.status IN ('Draft', 'Waiting', 'Ready')
          ${opWhere}
      `,
      ...opValues,
    )

    const internalRow = await db.get(
      `
        SELECT COUNT(*) AS scheduledInternalTransfers
        FROM Operations o
        LEFT JOIN Locations src ON src.id = o.source_location_id
        LEFT JOIN Locations dst ON dst.id = o.destination_location_id
        WHERE o.type = 'Internal'
          AND o.status IN ('Draft', 'Waiting', 'Ready')
          ${opWhere}
      `,
      ...opValues,
    )

    return res.json({
      totalProductsInStock: Number(totalRow?.totalProductsInStock || 0),
      lowOrOutOfStockItems: Number(lowRow?.lowOrOutOfStockItems || 0),
      pendingReceipts: Number(pendingReceiptRow?.pendingReceipts || 0),
      pendingDeliveries: Number(pendingDeliveryRow?.pendingDeliveries || 0),
      scheduledInternalTransfers: Number(internalRow?.scheduledInternalTransfers || 0),
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard KPIs' })
  }
})

app.get('/api/dashboard/filters', requireAuth, async (req, res) => {
  try {
    const db = await getDb()

    const [warehouses, categories] = await Promise.all([
      db.all('SELECT DISTINCT name FROM Locations ORDER BY name'),
      db.all('SELECT DISTINCT category FROM Products ORDER BY category'),
    ])

    return res.json({
      documentTypes: ['Receipt', 'Delivery', 'Internal', 'Adjustment'],
      statuses: ['Draft', 'Waiting', 'Ready', 'Done', 'Canceled'],
      warehouses: warehouses.map((x) => x.name).filter(Boolean),
      categories: categories.map((x) => x.category).filter(Boolean),
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard filters' })
  }
})

app.get('/api/operations', requireAuth, async (req, res) => {
  const db = await getDb()
  const type = req.query.type ? String(req.query.type) : ''

  const rows = type
    ? await db.all(
        `
          SELECT
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
          WHERE o.type = ?
          ORDER BY o.created_at DESC
        `,
        type,
      )
    : await db.all(
        `
          SELECT
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
          ORDER BY o.created_at DESC
        `,
      )

  return res.json(rows)
})

app.post('/api/operations', requireAuth, async (req, res) => {
  const db = await getDb()
  const { type, supplier, source_location, destination_location, lines } = req.body || {}

  if (!type || !['Receipt', 'Delivery', 'Internal', 'Adjustment'].includes(type)) {
    return res.status(400).json({ message: 'Invalid operation type' })
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'At least one operation line is required' })
  }

  for (const line of lines) {
    const qty = Number(line.requested_quantity)
    if (!Number.isFinite(qty) || qty < 0) {
      return res.status(400).json({ message: 'Quantities must be non-negative numbers' })
    }
    if (type !== 'Adjustment' && qty <= 0) {
      return res.status(400).json({ message: 'Quantity must be greater than zero for this operation type' })
    }
  }

  try {
    await db.exec('BEGIN TRANSACTION')
    try {
      const srcName =
        source_location ||
        (type === 'Receipt' ? supplier || 'Vendor Location' : type === 'Adjustment' ? 'Inventory Audit' : 'Main Warehouse')
      const dstName =
        destination_location ||
        (type === 'Delivery'
          ? 'Customer Location'
          : type === 'Adjustment'
            ? source_location || 'Main Warehouse'
            : type === 'Receipt'
              ? 'Main Warehouse'
              : 'Main Warehouse')

      const sourceType = type === 'Receipt' ? 'Vendor' : 'Internal'
      const destinationType = type === 'Delivery' ? 'Customer' : 'Internal'

      const source = await ensureLocationByName(db, String(srcName).trim(), sourceType)
      const destination = await ensureLocationByName(db, String(dstName).trim(), destinationType)

      const result = await db.run(
        `
          INSERT INTO Operations (
            type, status, supplier, source_location_id, destination_location_id, created_by
          ) VALUES (?, 'Draft', ?, ?, ?, ?)
        `,
        type,
        supplier || null,
        source ? source.id : null,
        destination ? destination.id : null,
        req.user.id,
      )

      const operationId = result.lastID
      const referenceNumber = buildReference(type, operationId)
      await db.run('UPDATE Operations SET reference_number = ? WHERE id = ?', referenceNumber, operationId)

      for (const line of lines) {
        await db.run(
          `
            INSERT INTO Operation_Lines (operation_id, product_id, requested_quantity)
            VALUES (?, ?, ?)
          `,
          operationId,
          Number(line.product_id),
          Number(line.requested_quantity),
        )
      }

      await db.exec('COMMIT')
      return res.status(201).json({ id: operationId, reference_number: referenceNumber })
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create operation' })
  }
})

async function getCurrentQty(db, productId, locationId) {
  const row = await db.get(
    'SELECT quantity FROM Stock_Quants WHERE product_id = ? AND location_id = ?',
    productId,
    locationId,
  )
  return Number(row?.quantity || 0)
}

async function setQty(db, productId, locationId, quantity) {
  await db.run(
    `
      INSERT INTO Stock_Quants (product_id, location_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(product_id, location_id)
      DO UPDATE SET quantity = excluded.quantity
    `,
    productId,
    locationId,
    quantity,
  )
}

app.post('/api/operations/:id/validate', requireAuth, async (req, res) => {
  const operationId = Number(req.params.id)
  if (!Number.isFinite(operationId)) {
    return res.status(400).json({ message: 'Invalid operation id' })
  }

  const db = await getDb()

  try {
    const operation = await db.get('SELECT * FROM Operations WHERE id = ?', operationId)
    if (!operation) {
      return res.status(404).json({ message: 'Operation not found' })
    }

    if (operation.status === 'Done') {
      return res.status(400).json({ message: 'Operation is already validated' })
    }

    const lines = await db.all('SELECT * FROM Operation_Lines WHERE operation_id = ?', operationId)
    if (!lines.length) {
      return res.status(400).json({ message: 'Operation has no lines to validate' })
    }

    await db.exec('BEGIN TRANSACTION')
    try {
      for (const line of lines) {
        const productId = Number(line.product_id)
        const requested = Number(line.requested_quantity)

        if (!Number.isFinite(requested) || requested < 0) {
          throw new Error('Invalid line quantity')
        }

        if (operation.type === 'Receipt') {
          const currentDest = await getCurrentQty(db, productId, operation.destination_location_id)
          await setQty(db, productId, operation.destination_location_id, currentDest + requested)

          await db.run(
            `
              INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
              VALUES (?, ?, ?, ?, ?)
            `,
            productId,
            operation.source_location_id,
            operation.destination_location_id,
            requested,
            operationId,
          )
        }

        if (operation.type === 'Delivery') {
          const currentSource = await getCurrentQty(db, productId, operation.source_location_id)
          if (currentSource < requested) {
            throw new Error('Insufficient stock for delivery validation')
          }

          await setQty(db, productId, operation.source_location_id, currentSource - requested)

          await db.run(
            `
              INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
              VALUES (?, ?, ?, ?, ?)
            `,
            productId,
            operation.source_location_id,
            operation.destination_location_id,
            requested,
            operationId,
          )
        }

        if (operation.type === 'Internal') {
          const currentSource = await getCurrentQty(db, productId, operation.source_location_id)
          if (currentSource < requested) {
            throw new Error('Insufficient stock for internal transfer validation')
          }

          const currentDest = await getCurrentQty(db, productId, operation.destination_location_id)
          await setQty(db, productId, operation.source_location_id, currentSource - requested)
          await setQty(db, productId, operation.destination_location_id, currentDest + requested)

          await db.run(
            `
              INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
              VALUES (?, ?, ?, ?, ?)
            `,
            productId,
            operation.source_location_id,
            operation.destination_location_id,
            requested,
            operationId,
          )
        }

        if (operation.type === 'Adjustment') {
          const targetLocationId = operation.destination_location_id || operation.source_location_id
          if (!targetLocationId) {
            throw new Error('Adjustment requires a target location')
          }

          const current = await getCurrentQty(db, productId, targetLocationId)
          const countedQuantity = requested
          const diff = countedQuantity - current

          await setQty(db, productId, targetLocationId, countedQuantity)

          if (diff !== 0) {
            const fromLocation = diff > 0 ? operation.source_location_id : targetLocationId
            const toLocation = diff > 0 ? targetLocationId : operation.source_location_id

            await db.run(
              `
                INSERT INTO Stock_Ledger (product_id, from_location_id, to_location_id, quantity, operation_id)
                VALUES (?, ?, ?, ?, ?)
              `,
              productId,
              fromLocation,
              toLocation,
              Math.abs(diff),
              operationId,
            )
          }
        }

        await db.run(
          'UPDATE Operation_Lines SET done_quantity = requested_quantity WHERE id = ?',
          line.id,
        )
      }

      await db.run("UPDATE Operations SET status = 'Done' WHERE id = ?", operationId)
      await db.exec('COMMIT')

      return res.json({ message: 'Operation validated' })
    } catch (error) {
      await db.exec('ROLLBACK')

      if (error.message && error.message.toLowerCase().includes('insufficient stock')) {
        return res.status(400).json({ message: error.message })
      }

      return res.status(400).json({ message: error.message || 'Validation failed' })
    }
  } catch (error) {
    return res.status(500).json({ message: 'Operation validation failed' })
  }
})

app.get('/api/ledger', requireAuth, async (req, res) => {
  const db = await getDb()
  const rows = await db.all(
    `
      SELECT
        sl.id,
        sl.timestamp,
        p.name AS product_name,
        src.name AS from_location_name,
        dst.name AS to_location_name,
        sl.quantity,
        o.reference_number
      FROM Stock_Ledger sl
      JOIN Products p ON p.id = sl.product_id
      LEFT JOIN Locations src ON src.id = sl.from_location_id
      LEFT JOIN Locations dst ON dst.id = sl.to_location_id
      LEFT JOIN Operations o ON o.id = sl.operation_id
      ORDER BY sl.timestamp DESC, sl.id DESC
    `,
  )

  res.json(rows)
})

const frontendDistPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.cwd(), process.env.FRONTEND_DIST_PATH)
  : path.resolve(__dirname, '../../frontend/dist')

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath))

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next()
    }
    return res.sendFile(path.join(frontendDistPath, 'index.html'))
  })
}

app.use((error, req, res, next) => {
  if (error && error.message === 'CORS blocked') {
    return res.status(403).json({ message: 'Origin not allowed by CORS policy' })
  }
  return next(error)
})

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

async function bootstrap() {
  await initDb()
  app.listen(PORT, () => {
    console.log(`Core Inventory backend listening on http://localhost:${PORT}`)
  })
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap backend:', error)
  process.exit(1)
})
