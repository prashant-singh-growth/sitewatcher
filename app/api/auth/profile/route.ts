import { api, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows } from '@/lib/db';
import { revokeUserSessions } from '@/lib/auth';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/password';
import { rateLimit } from '@/lib/ratelimit';
import { audit, Actions } from '@/lib/audit';
import { str, timezone } from '@/lib/validate';
/** Self-service: name, timezone, password (requires the current password). */
export const PATCH = api(async ({ req, user, ip }) => {
  const b = await readBody(req); const set: Record<string, any> = {};
  if ('display_name' in b) set.display_name = str(b.display_name, 'Name', { max: 120 });
  if ('timezone' in b) set.timezone = timezone(b.timezone);
  let changedPassword = false;
  if (b.new_password !== undefined) {
    const rl = await rateLimit(`pwchange:${user.id}`, 5, 900); if (!rl.allowed) throw new ApiError(429, 'Too many attempts. Try again later.');
    const cur = (await rows<any>('SELECT password_hash FROM users WHERE id = ?', [user.id]))[0];
    if (typeof b.current_password !== 'string' || !(await verifyPassword(b.current_password, cur.password_hash))) throw new ApiError(400, 'Your current password is incorrect.');
    const problem = passwordProblem(b.new_password); if (problem) throw new ApiError(400, problem);
    set.password_hash = await hashPassword(b.new_password); changedPassword = true;
  }
  if (!Object.keys(set).length) return { ok: true };
  await db.query(`UPDATE users SET ${Object.keys(set).map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(set), user.id]);
  if (changedPassword) { await revokeUserSessions(user.id, user.sessionId); await audit({ user, action: Actions.passwordReset, entityType: 'user', entityId: user.id, metadata: { self: true }, ip }); }
  return { ok: true };
});
