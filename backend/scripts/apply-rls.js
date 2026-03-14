require('dotenv').config()
const { Pool } = require('pg')

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  const tables = [
    'products',
    'stock_quants',
    'locations',
    'operations',
    'users',
    'operation_lines',
    'stock_ledger',
    'signup_verifications',
    'audit_history',
  ]

  for (const t of tables) {
    const exists = await pool.query('SELECT to_regclass($1) AS reg', [`public.${t}`])
    if (!exists.rows[0].reg) {
      console.log(`${t}: missing`)
      continue
    }

    await pool.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)

    const legacyPolicy = `${t}_authenticated_all`
    const legacyPolicyExists = await pool.query(
      `SELECT 1
       FROM pg_policies
       WHERE schemaname = $1
         AND tablename = $2
         AND policyname = $3
       LIMIT 1`,
      ['public', t, legacyPolicy],
    )

    if (legacyPolicyExists.rowCount > 0) {
      await pool.query(`DROP POLICY ${legacyPolicy} ON public.${t}`)
      console.log(`${t}: dropped legacy permissive policy`)
    }

    const selectPolicy = `${t}_authenticated_select`
    const selectPolicyExists = await pool.query(
      `SELECT 1
       FROM pg_policies
       WHERE schemaname = $1
         AND tablename = $2
         AND policyname = $3
       LIMIT 1`,
      ['public', t, selectPolicy],
    )

    if (selectPolicyExists.rowCount === 0) {
      await pool.query(
        `CREATE POLICY ${selectPolicy} ON public.${t} FOR SELECT TO authenticated USING (true)`,
      )
      console.log(`${t}: select policy created`)
    }

    const r = await pool.query(
      `SELECT c.relrowsecurity AS rls_enabled
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      ['public', t],
    )

    console.log(`${t}: rls=${r.rows[0]?.rls_enabled}`)
  }

  await pool.end()
  console.log('RLS apply complete')
}

main().catch((error) => {
  console.error('RLS apply failed:', error)
  process.exit(1)
})
