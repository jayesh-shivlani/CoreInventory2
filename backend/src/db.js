const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

const DB_URL = process.env.DATABASE_URL

let pgPool

async function getDb() {
  if (!pgPool) {
    if (!DB_URL) {
      console.warn('DATABASE_URL is not set. Database connection will fail unless provided.')
    }
    pgPool = new Pool({
      connectionString: DB_URL,
      ssl: {
        rejectUnauthorized: false
      }
    })
  }

  return {
    get: async (sql, ...params) => {
      let i = 1
      const pgSql = sql.replace(/\?/g, () => '$' + (i++))
      const text = pgSql.replace(/datetime\("now"\)/gi, 'NOW()')
      const res = await pgPool.query(text, params)
      return res.rows[0]
    },
    all: async (sql, ...params) => {
      let i = 1
      const pgSql = sql.replace(/\?/g, () => '$' + (i++))
      const text = pgSql.replace(/datetime\("now"\)/gi, 'NOW()')
      const res = await pgPool.query(text, params)
      return res.rows
    },
    run: async (sql, ...params) => {
      let i = 1
      let pgSql = sql.replace(/\?/g, () => '$' + (i++))
      const text = pgSql.replace(/datetime\("now"\)/gi, 'NOW()')
      
      const isInsert = text.trim().toUpperCase().startsWith('INSERT')
      if (isInsert && !text.toUpperCase().includes('RETURNING') && !text.toUpperCase().includes('ON CONFLICT')) {
        pgSql = text + ' RETURNING id'
      } else {
        pgSql = text
      }

      const res = await pgPool.query(pgSql, params)
      return {
        lastID: isInsert && res.rows.length > 0 ? res.rows[0].id : undefined,
        changes: res.rowCount
      }
    },
    exec: async (sql) => {
      await pgPool.query(sql)
    }
  }
}

async function ensureLocationByName(db, name, type = 'Internal') {
  if (!name) return null
  const existing = await db.get('SELECT id, name, type FROM Locations WHERE name = ?', name)
  if (existing) return existing

  const result = await db.run('INSERT INTO Locations (name, type) VALUES (?, ?)', name, type)
  return { id: result.lastID, name, type }
}

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

async function initDb() {
  const db = await getDb()

  await db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Warehouse Staff',
      otp_code TEXT
    );

    CREATE TABLE IF NOT EXISTS Signup_Verifications (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Warehouse Staff',
      otp_code TEXT NOT NULL,
      otp_expires_at TIMESTAMP NOT NULL,
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
  `)

  // Supabase security hardening: enable RLS on tables exposed via public schema.
  // Keep authenticated read access while avoiding permissive write policies.
  await db.exec(`
    ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.stock_quants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.locations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.operations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.operation_lines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.stock_ledger ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.signup_verifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE IF EXISTS public.audit_history ENABLE ROW LEVEL SECURITY;

    DO $$
    DECLARE
      t text;
      table_names text[] := ARRAY[
        'products',
        'stock_quants',
        'locations',
        'operations',
        'users',
        'operation_lines',
        'stock_ledger',
        'signup_verifications',
        'audit_history'
      ];
    BEGIN
      FOREACH t IN ARRAY table_names LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
          IF EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = t
              AND policyname = t || '_authenticated_all'
          ) THEN
            EXECUTE format('DROP POLICY %I ON public.%I', t || '_authenticated_all', t);
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = t
              AND policyname = t || '_authenticated_select'
          ) THEN
            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
              t || '_authenticated_select',
              t
            );
          END IF;
        END IF;
      END LOOP;
    END
    $$;
  `)

  // Migration: Ensure columns exist
  try {
    await db.exec('ALTER TABLE Stock_Ledger ADD COLUMN IF NOT EXISTS note TEXT')
    await db.exec('ALTER TABLE Stock_Ledger ALTER COLUMN quantity SET DEFAULT 0')
    await db.exec('ALTER TABLE Stock_Ledger ALTER COLUMN product_id DROP NOT NULL')
    await db.exec('ALTER TABLE Operation_Lines ADD COLUMN IF NOT EXISTS picked_quantity NUMERIC NOT NULL DEFAULT 0')
    await db.exec('ALTER TABLE Operation_Lines ADD COLUMN IF NOT EXISTS packed_quantity NUMERIC NOT NULL DEFAULT 0')
  } catch (err) {
    console.log('Migration note: Stock_Ledger columns check done.')
  }

  const userCountRow = await db.get('SELECT COUNT(*) AS count FROM Users')
  if (!userCountRow || Number(userCountRow.count) === 0) {
    const hashed = await bcrypt.hash('demo12345', 10)
    await db.run(
      'INSERT INTO Users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      'Demo Manager',
      'demo@coreinventory.app',
      hashed,
      'Manager',
    )
  }

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
