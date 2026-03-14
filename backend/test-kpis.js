require('dotenv').config()
const { getDb } = require('./src/db')

async function testKPIs() {
  try {
    const db = await getDb()
    console.log('Connected to DB')
    
    // Testing the exact query that failed
    const totalRow = await db.get(
      `
        SELECT COALESCE(SUM(sq.quantity), 0) AS totalProductsInStock
        FROM Stock_Quants sq
        JOIN Products p ON p.id = sq.product_id
        JOIN Locations l ON l.id = sq.location_id
        
      `
    )
    console.log('Total Row:', totalRow)

    const lowRow = await db.get(
      `
        SELECT COUNT(*) AS lowOrOutOfStockItems
        FROM (
          SELECT p.id, p.reorder_minimum, COALESCE(SUM(sq.quantity), 0) AS total_quantity
          FROM Products p
          LEFT JOIN Stock_Quants sq ON sq.product_id = p.id
          LEFT JOIN Locations l ON l.id = sq.location_id
          
          GROUP BY p.id, p.reorder_minimum
          HAVING COALESCE(SUM(sq.quantity), 0) <= p.reorder_minimum
        ) t
      `
    )
    console.log('Low Row:', lowRow)

    const pendingReceiptRow = await db.get(
      `
        SELECT COUNT(*) AS pendingReceipts
        FROM Operations o
        LEFT JOIN Locations src ON src.id = o.source_location_id
        LEFT JOIN Locations dst ON dst.id = o.destination_location_id
        WHERE o.type = 'Receipt'
          AND o.status IN ('Draft', 'Waiting', 'Ready')
          
      `
    )
    console.log('Pending Receipt:', pendingReceiptRow)

  } catch (error) {
    console.error('Error:', error.message)
  }
}

process.env.DATABASE_URL = 'postgresql://postgres:mzlu pkvs apej xymg@db.hyozaxrnfnpuowtpzmnz.supabase.co:6543/postgres'
testKPIs()
