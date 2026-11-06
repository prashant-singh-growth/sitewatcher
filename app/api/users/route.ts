import { api, readBody } from '@/lib/api';
import { rows, db } from '@/lib/db';
import { requireGlobalPermission } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { hashPassword, passwordProblem } from '@/lib/password';
import { ApiError } from '@/lib/errors';
import { email, oneOf, str, timezone } from '@/lib/validate';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user }) => {
  await requireGlobalPermission(user, 'user.manage');
  return { users: await rows<any>(
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.status, u.timezone, u.last_login_at, u.created_at,
       (SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = u.id) AS project_count
     FROM users u WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC`) };
});

export const POST = api(async ({ req, user, ip }) => {
  await requireGlobalPermission(user, 'user.manage');
  const b = await readBody(req);
  const problem = passwordProblem(b.password); if (problem) throw new ApiError(400, problem);
  const username = str(b.username, 'Username', { min: 3, max: 60 })!;
  if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new ApiError(400, 'Username may contain letters, numbers, dot, dash and underscore only.');
  const role = oneOf(b.role ?? 'member', 'Role', ['super_admin', 'manager', 'member'] as const);
  const [r] = await db.query<any>('INSERT INTO users (email, username, display_name, password_hash, role, timezone, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [email(b.email), username, str(b.display_name, 'Name', { max: 120 }), await hashPassword(b.password), role, b.timezone ? timezone(b.timezone) : 'UTC', user.id]);
  await audit({ user, action: Actions.userCreated, entityType: 'user', entityId: r.insertId, metadata: { username, role }, ip });
  return Response.json({ ok: true, id: Number(r.insertId) }, { status: 201 });
});
