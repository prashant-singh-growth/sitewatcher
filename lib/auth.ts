import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { db, rows } from './db';
import { getSettingInt } from './settings';

export const COOKIE_NAME = 'sitewatch_session';
export type GlobalRole = 'super_admin' | 'manager' | 'member';
export type SessionUser = { id: number; email: string; username: string; displayName: string; role: GlobalRole; timezone: string; sessionId: number };

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Opaque random token in an HTTP-only cookie; only its hash is stored, so sessions can be revoked server-side. */
export async function createSession(userId: number, meta: { ip?: string; userAgent?: string | null }) {
  const token = randomBytes(32).toString('base64url');
  const days = await getSettingInt('session.days', 7);
  await db.query(
    'INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))',
    [userId, sha256(token), meta.ip?.slice(0, 45) ?? null, meta.userAgent?.slice(0, 255) ?? null, days]
  );
  await db.query('UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?', [userId]);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * days });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await db.query('UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE token_hash = ? AND revoked_at IS NULL', [sha256(token)]);
  jar.delete(COOKIE_NAME);
}
export async function revokeUserSessions(userId: number, exceptSessionId?: number) {
  await db.query('UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL AND id <> ?', [userId, exceptSessionId ?? 0]);
}

/** Validates the cookie against the database on every request (suspension and revocation take effect immediately). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token || token.length < 32 || token.length > 100) return null;
  const r = await rows<any>(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.username, u.display_name, u.role, u.timezone
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
       AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1`, [sha256(token)]);
  const u = r[0];
  if (!u) return null;
  if (Date.now() - new Date(u.last_seen_at).getTime() > 5 * 60_000)
    db.query('UPDATE user_sessions SET last_seen_at = UTC_TIMESTAMP(3) WHERE id = ?', [u.session_id]).catch(() => undefined);
  return { id: Number(u.id), email: u.email, username: u.username, displayName: u.display_name, role: u.role, timezone: u.timezone, sessionId: Number(u.session_id) };
});
