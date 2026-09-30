const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS hisaflow_schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const dir = path.resolve(__dirname, '../sql');
    const files = fs.readdirSync(dir).filter(x => /^\d+.*\.sql$/.test(x)).sort();
    for (const file of files) {
      const prior = await client.query('SELECT 1 FROM hisaflow_schema_migrations WHERE filename=$1', [file]);
      if (prior.rowCount) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO hisaflow_schema_migrations(filename) VALUES($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
  } finally { client.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
