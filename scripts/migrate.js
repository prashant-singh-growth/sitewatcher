// Usage: node --env-file=.env scripts/migrate.js [up|down|status]
// Applies database/migrations/*.sql (not *.down.sql) in order, once each, tracked in schema_migrations.
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../database/migrations');

function statements(sql) {
  const clean = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  return clean.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}
(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing.');
  const mode = process.argv[2] || 'up';
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB');
    const [rows] = await conn.query('SELECT version FROM schema_migrations ORDER BY version');
    const applied = new Set(rows.map(r => r.version));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();
    if (mode === 'status') { files.forEach(f => console.log(`${applied.has(f.replace('.sql', '')) ? '[applied]' : '[pending]'} ${f}`)); return; }
    if (mode === 'down') {
      const last = [...applied].sort().pop();
      if (!last || last === '000_baseline') return console.log('Nothing to roll back.');
      const file = path.join(dir, `${last}.down.sql`);
      if (!fs.existsSync(file)) throw new Error(`No down migration for ${last}.`);
      for (const s of statements(fs.readFileSync(file, 'utf8'))) await conn.query(s);
      console.log(`Rolled back ${last}.`); return;
    }
    for (const f of files) {
      const version = f.replace('.sql', '');
      if (applied.has(version)) continue;
      console.log(`Applying ${version} ...`);
      for (const s of statements(fs.readFileSync(path.join(dir, f), 'utf8'))) await conn.query(s);
      await conn.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [version]);
    }
    console.log('Database is up to date.');
  } finally { await conn.end(); }
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
