/**
 * Core Inventory IMS - Express application entry point.
 *
 * This file is intentionally thin: it wires up middleware, mounts route
 * modules, and serves the frontend build.  All business logic lives in the
 * `routes/` directory.
 */

const path    = require('path')
const fs      = require('fs')
const express = require('express')
const cors    = require('cors')
const helmet  = require('helmet')
const rateLimit = require('express-rate-limit')

const { PORT, isCorsOriginAllowed, validateRuntimeConfig } = require('./config')
const { initDb } = require('./db')
const { getEmailProviderState } = require('./services/emailService')

// Route modules
const authRouter          = require('./routes/auth')
const productsRouter      = require('./routes/products')
const operationsRouter    = require('./routes/operations')
const locationsRouter     = require('./routes/locations')
const ledgerRouter        = require('./routes/ledger')
const dashboardRouter     = require('./routes/dashboard')
const notificationsRouter = require('./routes/notifications')
const analyticsRouter     = require('./routes/analytics')
const adminRouter         = require('./routes/admin')

const app = express()

// Security headers
app.use(
  helmet({
    // Keep CSP disabled for current frontend bundle behavior. Tighten this
    // policy before introducing third-party scripts or embeds.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
)

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin)) {
        callback(null, true)
      } else {
        callback(new Error('CORS blocked'))
      }
    },
  }),
)

// Body parsing
app.use(express.json({ limit: '1mb' }))

// Rate limiting on authentication endpoints
const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15-minute window
  max:              30,              // max 30 requests per window per IP
  standardHeaders:  true,
  legacyHeaders:    false,
  message: { message: 'Too many requests from this IP, please try again later.' },
  skip: () => process.env.NODE_ENV !== 'production', // relaxed in development
})
app.use('/api/auth', authLimiter)

// Health check
app.get('/api/health', async (req, res) => {
  const { getDb } = require('./db')
  const db         = await getDb()
  const row        = await db.get("SELECT NOW() AS now")
  const emailState = getEmailProviderState()
  res.json({
    status:          'ok',
    databaseTime:    row.now,
    emailProvider:   emailState.provider,
    emailConfigured: emailState.configured,
    emailSender:     emailState.sender,
  })
})

// API routes
app.use('/api',                authRouter)
app.use('/api/products',       productsRouter)
app.use('/api/operations',     operationsRouter)
app.use('/api/locations',      locationsRouter)
app.use('/api',                ledgerRouter)        // /api/ledger + /api/export/*
app.use('/api/dashboard',      dashboardRouter)
app.use('/api/notifications',  notificationsRouter)
app.use('/api/analytics',      analyticsRouter)
app.use('/api/admin',          adminRouter)

// Serve built frontend
const frontendDistPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.cwd(), process.env.FRONTEND_DIST_PATH)
  : path.resolve(__dirname, '../../frontend/dist')

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    return res.sendFile(path.join(frontendDistPath, 'index.html'))
  })
}

// Error handlers
app.use((error, req, res, _next) => {
  if (error?.message === 'CORS blocked') {
    return res.status(403).json({ message: 'Origin not allowed by CORS policy' })
  }
  console.error('[unhandled error]', error)
  return res.status(500).json({ message: 'Internal server error' })
})

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

// Bootstrap
async function bootstrap() {
  validateRuntimeConfig()
  await initDb()
  app.listen(PORT, () => {
    console.log(`Core Inventory backend listening on http://localhost:${PORT}`)
  })
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap backend:', error)
  process.exit(1)
})
