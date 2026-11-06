import { db } from './db';
/** Fixed-window limiter stored in MySQL (shared across restarts; no in-memory state required). */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSec;
  const k = key.slice(0, 190);
  await db.query(
    `INSERT INTO rate_limits (bucket_key, window_start, hits) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE hits = IF(window_start < ?, 1, hits + 1), window_start = IF(window_start < ?, ?, window_start)`,
    [k, now, cutoff, cutoff, now]);
  const [r] = await db.query<any[]>('SELECT hits, window_start FROM rate_limits WHERE bucket_key = ?', [k]);
  const hits = Number(r[0]?.hits ?? 1);
  const retryAfter = Math.max(1, Number(r[0]?.window_start ?? now) + windowSec - now);
  return { allowed: hits <= limit, retryAfter };
}
export async function resetRateLimit(key: string) { await db.query('DELETE FROM rate_limits WHERE bucket_key = ?', [key.slice(0, 190)]); }
/** Housekeeping, called from the cron dispatcher. */
export async function purgeOldLimits() { await db.query('DELETE FROM rate_limits WHERE window_start < ?', [Math.floor(Date.now() / 1000) - 86400]); }
