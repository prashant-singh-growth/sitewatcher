import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows, tx } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit, diff, Actions } from '@/lib/audit';
import { emailList, httpUrlOrNull, oneOf, str, timezone } from '@/lib/validate';
import { assertWithinCapacity, parseMonitoringFields } from '@/modules/monitoring/settings';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, params }) => {
  const id = idParam(params.id, 'project ID');
  const access = await requireProject(user, id, 'project.view');
  const project = (await rows<any>('SELECT * FROM projects WHERE id = ?', [id]))[0];
  const settings = (await rows<any>('SELECT * FROM project_settings WHERE project_id = ?', [id]))[0] ?? null;
  const members = await rows<any>(
    `SELECT u.id, u.display_name, u.email, u.status, pm.role, pm.created_at FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND u.deleted_at IS NULL ORDER BY pm.role, u.display_name`, [id]);
  return { project, settings, members, myRole: access.role, permissions: [...access.perms] };
});

export const PATCH = api(async ({ req, user, params, ip }) => {
  const id = idParam(params.id, 'project ID');
  const b = await readBody(req);
  const access = await requireProject(user, id, 'project.update', { write: b.status !== undefined });
  const before = (await rows<any>('SELECT * FROM projects WHERE id = ?', [id]))[0];
  const set: Record<string, any> = {};
  if ('name' in b) set.name = str(b.name, 'Project name', { max: 160 });
  if ('description' in b) set.description = str(b.description, 'Description', { max: 5000, optional: true });
  if ('client_name' in b) set.client_name = str(b.client_name, 'Client name', { max: 160, optional: true });
  if ('logo_url' in b) set.logo_url = httpUrlOrNull(b.logo_url, 'Logo URL');
  if ('primary_domain' in b) set.primary_domain = str(b.primary_domain, 'Primary domain', { max: 253, optional: true });
  if ('status' in b) {
    set.status = oneOf(b.status, 'Status', ['active', 'paused', 'archived'] as const);
    if (set.status === 'archived' && !access.perms.has('project.archive')) throw new ApiError(403, 'You cannot archive this project.');
  }
  const defaults = b.settings && typeof b.settings === 'object' ? b.settings as Record<string, any> : null;
  await tx(async conn => {
    if (Object.keys(set).length) {
      await conn.query(`UPDATE projects SET ${Object.keys(set).map(k => `${k} = ?`).join(', ')}, updated_by = ? WHERE id = ?`, [...Object.values(set), user.id, id]);
      const changes = diff(before, set);
      const action = changes.status ? (set.status === 'archived' ? Actions.projectArchived : Actions.projectUpdated) : Actions.projectUpdated;
      await audit({ user, action, entityType: 'project', entityId: id, projectId: id, metadata: { changes }, ip }, conn);
    }
    if (defaults) {
      const f = await parseMonitoringFields(defaults, false);
      const extra: Record<string, any> = {};
      if ('alert_emails' in defaults) extra.alert_emails = emailList(defaults.alert_emails, 'Alert emails');
      if ('timezone' in defaults) extra.timezone = timezone(defaults.timezone);
      const all: Record<string, any> = { ...f, ...extra };
      delete all.maintenance_start; delete all.maintenance_end;
      const cur = (await rows<any>('SELECT * FROM project_settings WHERE project_id = ? FOR UPDATE', [id], conn))[0];
      assertWithinCapacity({ timeout_ms: all.timeout_ms ?? cur.timeout_ms, retry_count: all.retry_count ?? cur.retry_count, retry_delay_ms: all.retry_delay_ms ?? cur.retry_delay_ms });
      for (const k of ['alert_on_down', 'alert_on_recovery']) if (k in all) all[k] = all[k] ? 1 : 0;
      if (Object.keys(all).length) {
        await conn.query(`UPDATE project_settings SET ${Object.keys(all).map(k => `${k} = ?`).join(', ')} WHERE project_id = ?`, [...Object.values(all), id]);
        await audit({ user, action: Actions.monitoringChanged, entityType: 'project_settings', entityId: id, projectId: id, metadata: { changes: diff(cur, all) }, ip }, conn);
      }
    }
  });
  return { ok: true };
});
