import { timingSafeEqual } from 'node:crypto';
import { publicApi, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { hashPassword, verifyPassword, DUMMY_HASH } from '@/lib/password';
import { rateLimit, resetRateLimit } from '@/lib/ratelimit';
import { audit, Actions } from '@/lib/audit';

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** First-run bootstrap: while the users table is empty, the legacy ADMIN_USERNAME / ADMIN_PASSWORD env pair creates the Super Admin. */
async function bootstrapSuperAdmin(login: string, password: string) {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !same(login, ADMIN_USERNAME) || !same(password, ADMIN_PASSWORD)) return null;
  const hash = await hashPassword(password);
  console.log(hash)
  const email = (ADMIN_EMAIL || `${ADMIN_USERNAME.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@sitewatch.invalid`).toLowerCase();
  try {
    // The WHERE NOT EXISTS makes this safe if two first logins race.
    const [r] = await db.query<any>(`INSERT INTO users (email, username, display_name, password_hash, role)
      SELECT ?, ?, ?, ?, 'super_admin' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users)`, [email, ADMIN_USERNAME, 'Master Admin', hash]);
    return r.affectedRows ? Number(r.insertId) : null;
  } catch { return null; }
}

export const POST = publicApi(async ({ req, ip }) => {
  // bootstrapSuperAdmin("test","N8v#Kp4!Zx9@Lm2$Qw7&Rt5","prashant@growth.cx")
  // return
  const b = await readBody(req);
  const login = typeof b.username === 'string' ? b.username.trim().slice(0, 190) : '';
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  if (!login || !password) throw new ApiError(400, 'Enter your username and password.');

  const byIp = await rateLimit(`login:ip:${ip}`, 30, 900);
  const byUser = await rateLimit(`login:user:${login.toLowerCase()}`, 8, 900);
  if (!byIp.allowed || !byUser.allowed) throw new ApiError(429, `Too many sign-in attempts. Try again in ${Math.ceil(Math.max(byIp.retryAfter, byUser.retryAfter) / 60)} minute(s).`);

  const found = (await rows<any>('SELECT id, display_name, password_hash, status FROM users WHERE (username = ? OR email = ?) AND deleted_at IS NULL LIMIT 1', [login, login]))[0];
  let userId: number | null = null;
 
  let displayName = login;
  if (found) {
    const ok = await verifyPassword(password, found.password_hash);
     console.log(ok)
    if (ok) {
      if (found.status !== 'active') throw new ApiError(403, 'This account is suspended. Contact your administrator.');
      userId = Number(found.id); displayName = found.display_name;
    }
  } else {
    await verifyPassword(password, DUMMY_HASH); // equalise timing for unknown users
    if (Number((await rows<any>('SELECT COUNT(*) AS c FROM users'))[0].c) === 0) { userId = await bootstrapSuperAdmin(login, password); if (userId) displayName = 'Master Admin'; }
  }
  if (!userId) {
    await audit({ action: Actions.loginFailed, userName: login, entityType: 'user', ip });
    throw new ApiError(401, 'Incorrect username or password.');
  }
  await resetRateLimit(`login:user:${login.toLowerCase()}`);
  await createSession(userId, { ip, userAgent: req.headers.get('user-agent') });
  await audit({ user: { id: userId, displayName }, action: Actions.login, entityType: 'user', entityId: userId, ip });
  return { ok: true };
});
