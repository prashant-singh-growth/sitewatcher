import mysql, { Pool, PoolConnection } from 'mysql2/promise';

function poolOptions() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not configured.');
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    waitForConnections: true,
    connectionLimit: 8,
    maxIdle: 4,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    timezone: 'Z' as const, // all DATETIME values are stored and read as UTC
    dateStrings: false
  };
}
const globalForDb = globalThis as unknown as { mysqlPool?: Pool };
function getPool(): Pool {
  if (!globalForDb.mysqlPool) globalForDb.mysqlPool = mysql.createPool(poolOptions());
  return globalForDb.mysqlPool;
}
/** Created on first use, so `next build` works without database credentials. */
export const db: Pool = new Proxy({} as Pool, { get: (_t, prop) => { const pool = getPool() as any; const v = pool[prop]; return typeof v === 'function' ? v.bind(pool) : v; } });

/** Run `fn` inside a transaction; rolls back on any error. */
export async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally { conn.release(); }
}

/** SELECT helper returning typed rows. */
export async function rows<T = any>(sql: string, params: unknown[] = [], conn?: PoolConnection): Promise<T[]> {
  const [r] = await (conn ?? db).query<any[]>(sql, params);
  return r as T[];
}
/** MySQL returns JSON columns parsed, MariaDB returns them as strings. Accept both. */
export function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}
