import mysql, { Pool, PoolConnection } from 'mysql2/promise';

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ER_CLIENT_INTERACTION_TIMEOUT'
]);

function isTransientSocketError(err: any): boolean {
  return Boolean(err && (TRANSIENT_CODES.has(err.code) || (err.fatal && err.errno === -4077)));
}

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
    maxIdle: 2,
    idleTimeout: 15000,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: 'Z' as const, // all DATETIME values are stored and read as UTC
    dateStrings: false
  };
}
const globalForDb = globalThis as unknown as { mysqlPool?: Pool; mysqlPoolVer?: number };
const POOL_VER = 2;
function getPool(): Pool {
  if (!globalForDb.mysqlPool || globalForDb.mysqlPoolVer !== POOL_VER) {
    globalForDb.mysqlPool?.end().catch(() => undefined);
    globalForDb.mysqlPool = mysql.createPool(poolOptions());
    globalForDb.mysqlPoolVer = POOL_VER;
  }
  return globalForDb.mysqlPool;
}

function isReadSql(arg: unknown): boolean {
  const sql = typeof arg === 'string' ? arg : (arg as any)?.sql;
  return typeof sql === 'string' && /^\s*(SELECT|SHOW|WITH)\b/i.test(sql);
}

/** Created on first use, so `next build` works without database credentials. */
export const db: Pool = new Proxy({} as Pool, {
  get: (_t, prop) => {
    const pool = getPool() as any;
    const v = pool[prop];
    if (typeof v !== 'function') return v;
    if (prop === 'query' || prop === 'execute') {
      return async (...args: any[]) => {
        try {
          return await v.apply(pool, args);
        } catch (err) {
          if (isReadSql(args[0]) && isTransientSocketError(err)) {
            return await v.apply(getPool(), args);
          }
          throw err;
        }
      };
    }
    return v.bind(pool);
  }
});

/** Run `fn` inside a transaction; rolls back on any error. */
export async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  let conn = await db.getConnection();
  try {
    try {
      await conn.beginTransaction();
    } catch (e) {
      if (!isTransientSocketError(e)) throw e;
      (conn as any).destroy?.();
      conn = await db.getConnection();
      await conn.beginTransaction();
    }
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally { conn.release(); }
}

/** SELECT helper returning typed rows. Retries once when reusing a stale pooled socket fails. */
export async function rows<T = any>(sql: string, params: unknown[] = [], conn?: PoolConnection): Promise<T[]> {
  if (conn) {
    const [r] = await conn.query<any[]>(sql, params);
    return r as T[];
  }
  try {
    const [r] = await getPool().query<any[]>(sql, params);
    return r as T[];
  } catch (err) {
    if (isTransientSocketError(err)) {
      const [r] = await getPool().query<any[]>(sql, params);
      return r as T[];
    }
    throw err;
  }
}
/** MySQL returns JSON columns parsed, MariaDB returns them as strings. Accept both. */
export function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}
