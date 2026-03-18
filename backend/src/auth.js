const jwt = require('jsonwebtoken')
const { getDb } = require('./db')

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '8h' },
  )
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Missing bearer token' })
    }

    const payload = jwt.verify(token, JWT_SECRET)
    const db = await getDb()
    const user = await db.get('SELECT id, name, email, role FROM Users WHERE id = ?', payload.sub)

    if (!user) {
      return res.status(401).json({ message: 'Invalid token user' })
    }

    req.user = user
    return next()
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

function requireRole(allowedRoles = []) {
  const normalized = new Set(
    (Array.isArray(allowedRoles) ? allowedRoles : [])
      .map((role) => String(role || '').trim().toLowerCase())
      .filter(Boolean),
  )

  return (req, res, next) => {
    const currentRole = String(req.user?.role || '').trim().toLowerCase()
    if (!currentRole || !normalized.has(currentRole)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' })
    }
    return next()
  }
}

module.exports = {
  requireAuth,
  requireRole,
  signToken,
}
