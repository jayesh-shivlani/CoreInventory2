/**
 * Database adapter - PostgreSQL via the `pg` connection pool.
 *
 * CRITICAL FIX: the previous implementation called pgPool.query() for
 * BEGIN / COMMIT / ROLLBACK, which meant each call could land on a
 * **different pool connection**, making every transaction silently
 * non-atomic.  The new `transaction()` helper checks out a single
 * dedicated client, runs the callback, and releases the client when done.
 */

const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const { randomBytes } = require('crypto')

const DB_URL = process.env.DATABASE_URL

let pgPool

// Pool singleton
function getPool() {
  if (!pgPool) {
    if (!DB_URL) {
      console.warn('[db] DATABASE_URL is not set - connection will fail.')
    }
    pgPool = new Pool({
      connectionString: DB_URL,
      ssl: { rejectUnauthorized: false },
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 10000),
      query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 10000),
    })
  }
  return pgPool
}

// SQL compatibility helpers

/** Replace SQLite-style `?` placeholders with PostgreSQL `$1`, `$2`, ... */
function toPostgresSQL(sql) {
  let i = 1
  return sql
    .replace(/\?/g, () => '$' + i++)
    .replace(/datetime\("now"\)/gi, 'NOW()')
    .replace(/CURRENT_TIMESTAMP/g, 'NOW()')
}

// Query wrappers

/**
 * Build the standard `db` interface bound to an underlying query function.
 * Accepts either `pgPool.query` (normal queries) or `client.query` (inside
 * a transaction).
 */
function buildDb(queryFn) {
  return {
    /** Returns the first row or `undefined`. */
    get: async (sql, ...params) => {
      const res = await queryFn(toPostgresSQL(sql), params)
      return res.rows[0]
    },

    /** Returns all rows. */
    all: async (sql, ...params) => {
      const res = await queryFn(toPostgresSQL(sql), params)
      return res.rows
    },

    /**
     * Executes a DML statement.
     * Returns `{ lastID, changes }` - `lastID` is populated for INSERTs.
     */
    run: async (sql, ...params) => {
      const pg = toPostgresSQL(sql)
      const isInsert = pg.trim().toUpperCase().startsWith('INSERT')
      const upper = pg.toUpperCase()

      let finalSql = pg
      if (
        isInsert &&
        !upper.includes('RETURNING') &&
        !upper.includes('ON CONFLICT')
      ) {
        finalSql = pg + ' RETURNING id'
      }

      const res = await queryFn(finalSql, params)
      return {
        lastID: isInsert && res.rows.length > 0 ? res.rows[0].id : undefined,
        changes: res.rowCount,
      }
    },

    /** Execute raw SQL (DDL, schema migrations, etc.). */
    exec: async (sql) => {
      await queryFn(sql, [])
    },
  }
}

// Public API

/** Returns the shared pool-based `db` object for non-transactional queries. */
async function getDb() {
  const pool = getPool()
  return {
    ...buildDb((...args) => pool.query(...args)),

    /**
     * Run `fn` inside a single PostgreSQL transaction.
     *
     * The callback receives a `tx` object with the same interface as `db`
     * (get / all / run / exec) but every call is routed through the same
     * dedicated pool client.
     *
     * The transaction is automatically committed on success and rolled back
     * on any thrown error.
     *
     * @param {(tx: ReturnType<typeof buildDb>) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    transaction: async (fn) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tx = buildDb((...args) => client.query(...args))
        const result = await fn(tx)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
  }
}

// Schema helpers

/** Upsert a location row by name, creating it if it does not exist yet. */
async function ensureLocationByName(db, name, type = 'Internal') {
  if (!name) return null
  const existing = await db.get(
    'SELECT id, name, type FROM Locations WHERE name = ?',
    name,
  )
  if (existing) return existing
  const result = await db.run(
    'INSERT INTO Locations (name, type) VALUES (?, ?)',
    name,
    type,
  )
  return { id: result.lastID, name, type }
}

/** Generate a human-readable operation reference number, e.g. `RCV-000042`. */
function buildReference(type, id) {
  const prefix =
    type === 'Receipt'
      ? 'RCV'
      : type === 'Delivery'
        ? 'DEL'
        : type === 'Internal'
          ? 'INT'
          : 'ADJ'
  return `${prefix}-${String(id).padStart(6, '0')}`
}

// Database bootstrap

async function initDb() {
  const db = await getDb()

  const DEFAULT_ADMIN_EMAIL = (
    process.env.ADMIN_EMAIL || 'admin@example.com'
  )
    .toLowerCase()
    .trim()
  const configuredAdminPassword = String(process.env.ADMIN_PASSWORD || '').trim()
  const DEFAULT_ADMIN_PASSWORD = configuredAdminPassword || randomBytes(18).toString('base64url')
  const DEFAULT_ADMIN_NAME = process.env.ADMIN_NAME || 'Admin User'

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Warehouse Staff',
      otp_code TEXT,
      reset_otp_expires_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Signup_Verifications (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Warehouse Staff',
      status TEXT NOT NULL DEFAULT 'OTP_PENDING',
      otp_code TEXT NOT NULL,
      otp_expires_at TIMESTAMP NOT NULL,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMP,
      review_note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Locations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      unit_of_measure TEXT NOT NULL,
      reorder_minimum INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS Stock_Quants (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      UNIQUE(product_id, location_id),
      FOREIGN KEY (product_id) REFERENCES Products(id) ON DELETE CASCADE,
      FOREIGN KEY (location_id) REFERENCES Locations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Operations (
      id SERIAL PRIMARY KEY,
      reference_number TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      supplier TEXT,
      source_location_id INTEGER,
      destination_location_id INTEGER,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_location_id) REFERENCES Locations(id),
      FOREIGN KEY (destination_location_id) REFERENCES Locations(id),
      FOREIGN KEY (created_by) REFERENCES Users(id)
    );

    CREATE TABLE IF NOT EXISTS Operation_Lines (
      id SERIAL PRIMARY KEY,
      operation_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      requested_quantity NUMERIC NOT NULL,
      picked_quantity NUMERIC NOT NULL DEFAULT 0,
      packed_quantity NUMERIC NOT NULL DEFAULT 0,
      done_quantity NUMERIC NOT NULL DEFAULT 0,
      FOREIGN KEY (operation_id) REFERENCES Operations(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES Products(id)
    );

    CREATE TABLE IF NOT EXISTS Stock_Ledger (
      id SERIAL PRIMARY KEY,
      product_id INTEGER,
      from_location_id INTEGER,
      to_location_id INTEGER,
      quantity NUMERIC NOT NULL DEFAULT 0,
      operation_id INTEGER,
      note TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES Products(id),
      FOREIGN KEY (from_location_id) REFERENCES Locations(id),
      FOREIGN KEY (to_location_id) REFERENCES Locations(id),
      FOREIGN KEY (operation_id) REFERENCES Operations(id)
    );

    CREATE TABLE IF NOT EXISTS Role_Audit_Log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      target_user_email TEXT,
      old_role TEXT,
      new_role TEXT,
      performed_by_id INTEGER,
      performed_by_email TEXT,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Row-Level Security (Supabase hardening)
  await db.exec(`
    ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.stock_quants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.locations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.operations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.operation_lines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.stock_ledger ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.role_audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.signup_verifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.audit_history ENABLE ROW LEVEL SECURITY;

    DO $$
    DECLARE
      t text;
      table_names text[] := ARRAY[
        'products','stock_quants','locations','operations','users',
        'operation_lines','stock_ledger','role_audit_log',
        'signup_verifications','audit_history'
      ];
    BEGIN
      FOREACH t IN ARRAY table_names LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
          IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t
              AND policyname = t || '_authenticated_all'
          ) THEN
            EXECUTE format('DROP POLICY %I ON public.%I', t || '_authenticated_all', t);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t
              AND policyname = t || '_authenticated_select'
          ) THEN
            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
              t || '_authenticated_select', t
            );
          END IF;
        END IF;
      END LOOP;
    END $$;
  `)

  // Migrations (idempotent)
  const migrations = [
    'ALTER TABLE Stock_Ledger ADD COLUMN IF NOT EXISTS note TEXT',
    'ALTER TABLE Stock_Ledger ALTER COLUMN quantity SET DEFAULT 0',
    'ALTER TABLE Stock_Ledger ALTER COLUMN product_id DROP NOT NULL',
    'ALTER TABLE Operation_Lines ADD COLUMN IF NOT EXISTS picked_quantity NUMERIC NOT NULL DEFAULT 0',
    'ALTER TABLE Operation_Lines ADD COLUMN IF NOT EXISTS packed_quantity NUMERIC NOT NULL DEFAULT 0',
    'ALTER TABLE Users ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMP',
    "ALTER TABLE Signup_Verifications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OTP_PENDING'",
    'ALTER TABLE Signup_Verifications ADD COLUMN IF NOT EXISTS reviewed_by INTEGER',
    'ALTER TABLE Signup_Verifications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP',
    'ALTER TABLE Signup_Verifications ADD COLUMN IF NOT EXISTS review_note TEXT',
  ]

  for (const sql of migrations) {
    try {
      await db.exec(sql)
    } catch {
      // Column already exists - safe to ignore.
    }
  }

  // Read-heavy pages repeatedly filter and sort on these columns.
  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_products_name ON Products (name)',
    'CREATE INDEX IF NOT EXISTS idx_products_sku ON Products (sku)',
    'CREATE INDEX IF NOT EXISTS idx_products_category ON Products (category)',
    'CREATE INDEX IF NOT EXISTS idx_stock_quants_product_id ON Stock_Quants (product_id)',
    'CREATE INDEX IF NOT EXISTS idx_stock_quants_location_id ON Stock_Quants (location_id)',
    'CREATE INDEX IF NOT EXISTS idx_operation_lines_operation_id ON Operation_Lines (operation_id)',
    'CREATE INDEX IF NOT EXISTS idx_operations_type_status_created_at ON Operations (type, status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_operations_status_created_at ON Operations (status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_stock_ledger_timestamp ON Stock_Ledger (timestamp DESC)',
    'CREATE INDEX IF NOT EXISTS idx_stock_ledger_product_id ON Stock_Ledger (product_id)',
    'CREATE INDEX IF NOT EXISTS idx_signup_verifications_email ON Signup_Verifications (email)',
    'CREATE INDEX IF NOT EXISTS idx_signup_verifications_status_created_at ON Signup_Verifications (status, created_at DESC)',
  ]

  for (const sql of indexStatements) {
    await db.exec(sql)
  }

  // Demo seed user
  const userCount = await db.get('SELECT COUNT(*) AS count FROM Users')
  if (!userCount || Number(userCount.count) === 0) {
    const hashed = await bcrypt.hash('demo12345', 10)
    await db.run(
      'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      'Demo Manager',
      'demo@coreinventory.app',
      hashed,
      'Manager',
    )
  }

  // Admin upsert
  const adminHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10)
  const existingAdmin = await db.get(
    'SELECT id FROM Users WHERE email = ?',
    DEFAULT_ADMIN_EMAIL,
  )
  if (!existingAdmin) {
    await db.run(
      'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      DEFAULT_ADMIN_NAME,
      DEFAULT_ADMIN_EMAIL,
      adminHash,
      'Admin',
    )
    if (!configuredAdminPassword) {
      console.warn('[security] ADMIN_PASSWORD is not configured. A temporary admin password was generated for first-time bootstrap. Set ADMIN_PASSWORD and restart to rotate credentials.')
    }
  } else {
    if (configuredAdminPassword) {
      await db.run(
        'UPDATE Users SET name = ?, password_hash = ?, role = ? WHERE id = ?',
        DEFAULT_ADMIN_NAME,
        adminHash,
        'Admin',
        existingAdmin.id,
      )
    } else {
      await db.run(
        'UPDATE Users SET name = ?, role = ? WHERE id = ?',
        DEFAULT_ADMIN_NAME,
        'Admin',
        existingAdmin.id,
      )
    }
  }

  // Default locations
  await ensureLocationByName(db, 'Main Warehouse', 'Internal')
  await ensureLocationByName(db, 'Vendor Location', 'Vendor')
  await ensureLocationByName(db, 'Customer Location', 'Customer')

  return db
}

module.exports = {
  buildReference,
  ensureLocationByName,
  getDb,
  initDb,
}
