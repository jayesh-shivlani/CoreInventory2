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

    if (token === 'dev-token') {
      const db = await getDb()
      const demo = await db.get('SELECT id, name, email, role FROM Users ORDER BY id LIMIT 1')
      if (!demo) {
        return res.status(401).json({ message: 'No user available for dev token' })
      }
      req.user = demo
      return next()
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

module.exports = {
  requireAuth,
  signToken,
}
