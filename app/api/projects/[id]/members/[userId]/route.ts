import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { oneOf } from '@/lib/validate';

async function ensureLastManagerKept(projectId: number, userId: number) {
  const m = (await rows<any>("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, userId]))[0];
  if (!m) throw new ApiError(404, 'Member not found.');
  if (m.role === 'manager') {
    const c = Number((await rows<any>("SELECT COUNT(*) AS c FROM project_members WHERE project_id = ? AND role = 'manager'", [projectId]))[0].c);
    if (c <= 1) throw new ApiError(409, 'A project needs at least one manager. Promote another member first (or ask a Super Admin).');
  }
}
export const PATCH = api(async ({ req, user, params, ip }) => {
  const projectId = idParam(params.id, 'project ID'), userId = idParam(params.userId, 'user ID');
  const access = await requireProject(user, projectId, 'project.members.manage', { write: true });
  const role = oneOf((await readBody(req)).role, 'Role', ['manager', 'member'] as const);
  if (role === 'member' && access.role !== 'super_admin') await ensureLastManagerKept(projectId, userId);
  const [r] = await db.query<any>('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?', [role, projectId, userId]);
  if (!r.affectedRows) throw new ApiError(404, 'Member not found.');
  await audit({ user, action: Actions.memberChanged, entityType: 'user', entityId: userId, projectId, metadata: { role }, ip });
  return { ok: true };
});
export const DELETE = api(async ({ user, params, ip }) => {
  const projectId = idParam(params.id, 'project ID'), userId = idParam(params.userId, 'user ID');
  const access = await requireProject(user, projectId, 'project.members.manage', { write: true });
  if (access.role !== 'super_admin') await ensureLastManagerKept(projectId, userId);
  await db.query('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  await audit({ user, action: Actions.memberRemoved, entityType: 'user', entityId: userId, projectId, ip });
  return { ok: true };
});
