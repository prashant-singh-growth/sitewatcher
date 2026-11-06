import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { email, oneOf } from '@/lib/validate';

/** Add an EXISTING active user to the project by email. (Super admins create users in /api/users.) */
export const POST = api(async ({ req, user, params, ip }) => {
  const id = idParam(params.id, 'project ID');
  await requireProject(user, id, 'project.members.manage', { write: true });
  const b = await readBody(req);
  const role = oneOf(b.role ?? 'member', 'Role', ['manager', 'member'] as const);
  const target = (await rows<any>("SELECT id, display_name FROM users WHERE email = ? AND status = 'active' AND deleted_at IS NULL", [email(b.email)]))[0];
  if (!target) throw new ApiError(404, 'No active user with that email. Ask a Super Admin to create the account first.');
  const [r] = await db.query<any>('INSERT IGNORE INTO project_members (project_id, user_id, role, added_by) VALUES (?, ?, ?, ?)', [id, target.id, role, user.id]);
  if (!r.affectedRows) throw new ApiError(409, 'That user is already a member of this project.');
  await audit({ user, action: Actions.memberAdded, entityType: 'user', entityId: target.id, projectId: id, metadata: { member: target.display_name, role }, ip });
  return { ok: true };
});
