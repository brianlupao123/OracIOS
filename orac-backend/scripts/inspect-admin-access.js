// Read-only preflight for an existing PostgreSQL store. No account changes.
import pg from "pg";
import { secureConnectionString } from "../src/dbUrl.js";
import { summarizeAdminAccess } from "../src/adminAccessSummary.js";

const databaseUrl = process.env.DATABASE_URL;
const targetEmail = String(process.env.INSPECT_ADMIN_EMAIL || "").trim();
if (!databaseUrl || !targetEmail) {
  throw new Error("DATABASE_URL and INSPECT_ADMIN_EMAIL are required. This script never changes an account.");
}

const pool = new pg.Pool({
  connectionString: secureConnectionString(databaseUrl),
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 10000
});

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query("SELECT data->'users' AS users FROM store WHERE id = 'main'");
    if (result.rowCount !== 1) throw new Error("The store is not initialized.");
    const summary = summarizeAdminAccess(result.rows[0].users, targetEmail);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.query("ROLLBACK").finally(() => client.release());
  }
} finally {
  await pool.end();
}
