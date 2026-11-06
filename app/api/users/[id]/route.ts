import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows, tx } from '@/lib/db';
import { requireGlobalPermission } from '@/lib/rbac';
import { audit, diff, Actions } from '@/lib/audit';
import { revokeUserSessions } from '@/lib/auth';
import { hashPassword, passwordProblem } from '@/lib/password';
import { email, oneOf, str, timezone } from '@/lib/validate';

async function otherActiveSuperAdmins(excludeId: number) {
  return Number((await rows<any>("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin' AND status = 'active' AND deleted_at IS NULL AND id <> ?", [excludeId]))[0].c);
}
export const GET = api(async ({ user, params }) => {
  await requireGlobalPermission(user, 'user.manage');
  const id = idParam(params.id, 'user ID');
  const u = (await rows<any>('SELECT id, email, username, display_name, role, status, timezone, last_login_at, created_at FROM users WHERE id = ? AND deleted_at IS NULL', [id]))[0];
  if (!u) throw new ApiError(404, 'User not found.');
  const projects = await rows<any>('SELECT p.id, p.name, pm.role FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? ORDER BY p.name', [id]);
  return { user: u, projects };
});

export const PATCH = api(async ({ req, user, params, ip }) => {
  await requireGlobalPermission(user, 'user.manage');
  const id = idParam(params.id, 'user ID');
  const b = await readBody(req);
  const before = (await rows<any>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]))[0];
  if (!before) throw new ApiError(404, 'User not found.');
  const set: Record<string, any> = {};
  if ('display_name' in b) set.display_name = str(b.display_name, 'Name', { max: 120 });
  if ('email' in b) set.email = email(b.email);
  if ('timezone' in b) set.timezone = timezone(b.timezone);
  if ('role' in b) set.role = oneOf(b.role, 'Role', ['super_admin', 'manager', 'member'] as const);
  if ('status' in b) set.status = oneOf(b.status, 'Status', ['active', 'suspended'] as const);
  if ((set.role && set.role !== 'super_admin' || set.status === 'suspended') && before.role === 'super_admin') {
    if (id === user.id) throw new ApiError(409, 'You cannot demote or suspend your own account.');
    if (!(await otherActiveSuperAdmins(id))) throw new ApiError(409, 'There must always be at least one active Super Admin.');
  }
  let passwordReset = false;
  if (b.password !== undefined) { const p = passwordProblem(b.password); if (p) throw new ApiError(400, p); set.password_hash = await hashPassword(b.password); passwordReset = true; }
  if (!Object.keys(set).length) return { ok: true };
  await tx(async conn => {
    await conn.query(`UPDATE users SET ${Object.keys(set).map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(set), id]);
    const changes = diff(before, { ...set, password_hash: undefined });
    if (passwordReset) await audit({ user, action: Actions.passwordReset, entityType: 'user', entityId: id, metadata: { target: before.display_name }, ip }, conn);
    if (changes.status) await audit({ user, action: set.status === 'suspended' ? Actions.userSuspended : Actions.userActivated, entityType: 'user', entityId: id, metadata: { target: before.display_name }, ip }, conn);
    if (changes.role) await audit({ user, action: Actions.userPermissionsChanged, entityType: 'user', entityId: id, metadata: { target: before.display_name, ...changes.role }, ip }, conn);
    const rest = { ...changes }; delete rest.status; delete rest.role;
    if (Object.keys(rest).length) await audit({ user, action: Actions.userUpdated, entityType: 'user', entityId: id, metadata: { target: before.display_name, changes: rest }, ip }, conn);
  });
  if (set.status === 'suspended' || passwordReset || set.role) await revokeUserSessions(id, id === user.id ? user.sessionId : undefined);
  return { ok: true };
});

/** Safe delete: the row is kept (anonymised) so audit history and created-by links stay intact; access is removed. */
export const DELETE = api(async ({ user, params, ip }) => {
  await requireGlobalPermission(user, 'user.manage');
  const id = idParam(params.id, 'user ID');
  if (id === user.id) throw new ApiError(409, 'You cannot delete your own account.');
  const target = (await rows<any>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]))[0];
  if (!target) throw new ApiError(404, 'User not found.');
  if (target.role === 'super_admin' && !(await otherActiveSuperAdmins(id))) throw new ApiError(409, 'There must always be at least one active Super Admin.');
  await tx(async conn => {
    await conn.query('DELETE FROM project_members WHERE user_id = ?', [id]);
    await conn.query("UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL", [id]);
    await conn.query("UPDATE users SET deleted_at = UTC_TIMESTAMP(3), status = 'suspended', email = CONCAT('deleted-', id, '@deleted.invalid'), username = CONCAT('deleted-', id), password_hash = '!' WHERE id = ?", [id]);
    await audit({ user, action: Actions.userDeleted, entityType: 'user', entityId: id, metadata: { name: target.display_name, email: target.email, username: target.username }, ip }, conn);
  });
  return { ok: true };
});
