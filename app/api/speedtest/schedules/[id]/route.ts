import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit } from '@/lib/audit';
async function load(user: any, id: number) {
  const s = (await rows<any>('SELECT * FROM speed_test_schedules WHERE id = ?', [id]))[0];
  if (!s) throw new ApiError(404, 'Schedule not found.');
  await requireProject(user, Number(s.project_id), 'speedtest.schedule', { write: true }).catch(e => { throw e.status === 404 ? new ApiError(404, 'Schedule not found.') : e; });
  return s;
}
export const PATCH = api(async ({ req, user, params, ip }) => {
  const id = idParam(params.id, 'schedule ID'); const s = await load(user, id);
  const b = await readBody(req);
  const active = b.is_active === undefined ? !s.is_active : Boolean(b.is_active);
  await db.query('UPDATE speed_test_schedules SET is_active = ?, next_run_at = IF(? AND next_run_at IS NULL, UTC_TIMESTAMP(3), next_run_at) WHERE id = ?', [active ? 1 : 0, active ? 1 : 0, id]);
  await audit({ user, action: 'speedtest.schedule_updated', entityType: 'speed_schedule', entityId: id, projectId: Number(s.project_id), metadata: { is_active: active }, ip });
  return { ok: true };
});
export const DELETE = api(async ({ user, params, ip }) => {
  const id = idParam(params.id, 'schedule ID'); const s = await load(user, id);
  await db.query('DELETE FROM speed_test_schedules WHERE id = ?', [id]);
  await audit({ user, action: 'speedtest.schedule_deleted', entityType: 'speed_schedule', entityId: id, projectId: Number(s.project_id), ip });
  return { ok: true };
});
