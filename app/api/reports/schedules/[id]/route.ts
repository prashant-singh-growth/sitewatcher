import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit } from '@/lib/audit';
async function load(user: any, id: number) {
  const s = (await rows<any>('SELECT * FROM report_schedules WHERE id = ?', [id]))[0];
  if (!s) throw new ApiError(404, 'Schedule not found.');
  await requireProject(user, Number(s.project_id), 'report.schedule', { write: true }).catch(e => { throw e.status === 404 ? new ApiError(404, 'Schedule not found.') : e; });
  return s;
}
export const PATCH = api(async ({ req, user, params, ip }) => {
  const id = idParam(params.id, 'schedule ID'); const s = await load(user, id); const b = await readBody(req);
  const active = b.is_active === undefined ? !s.is_active : Boolean(b.is_active);
  await db.query('UPDATE report_schedules SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
  await audit({ user, action: 'report.schedule_updated', entityType: 'report_schedule', entityId: id, projectId: Number(s.project_id), metadata: { is_active: active }, ip });
  return { ok: true };
});
export const DELETE = api(async ({ user, params, ip }) => {
  const id = idParam(params.id, 'schedule ID'); const s = await load(user, id);
  await db.query('DELETE FROM report_schedules WHERE id = ?', [id]);
  await audit({ user, action: 'report.schedule_deleted', entityType: 'report_schedule', entityId: id, projectId: Number(s.project_id), ip });
  return { ok: true };
});
