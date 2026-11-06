import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows, tx } from '@/lib/db';
import { requireSite } from '@/lib/rbac';
import { audit, diff, Actions } from '@/lib/audit';
import { assertPublicUrl } from '@/lib/ssrf';
import { str } from '@/lib/validate';
import { assertWithinCapacity, parseMonitoringFields } from '@/modules/monitoring/settings';
import { SITE_LIST_SQL, urlHash } from '@/modules/monitoring/service';

export const GET = api(async ({ user, params }) => {
  const id = idParam(params.id, 'website ID');
  await requireSite(user, id, 'site.view');
  return { site: (await rows<any>(`${SITE_LIST_SQL} WHERE s.id = ?`, [id]))[0] };
});

export const PATCH = api(async ({ req, user, params, ip }) => {
  const id = idParam(params.id, 'website ID');
  const b = await readBody(req);
  // Pause/resume: needs configure permission. Rename/URL edits: needs update permission.
  if (b.action === 'toggle') {
    const { site } = await requireSite(user, id, 'site.configure', { write: true });
    const next = site.is_active ? 0 : 1;
    await db.query('UPDATE monitored_sites SET is_active = ?, next_run_at = IF(?, UTC_TIMESTAMP(3), next_run_at), claim_token = NULL, claimed_at = NULL, updated_by = ? WHERE id = ?', [next, next, user.id, id]);
    await audit({ user, action: next ? Actions.monitoringResumed : Actions.monitoringPaused, entityType: 'site', entityId: id, projectId: Number(site.project_id), metadata: { name: site.name }, ip });
    return { ok: true, is_active: next };
  }
  const { site } = await requireSite(user, id, 'site.update', { write: true });
  const set: Record<string, any> = {};
  if ('name' in b) set.name = str(b.name, 'Display name', { max: 120 });
  if ('url' in b) {
    const url = (await assertPublicUrl(String(b.url ?? '').trim())).toString();
    if (url !== site.url) { set.url = url; set.url_hash = urlHash(url); }
  }
  const fields = await parseMonitoringFields(b, true);
  if (Object.keys(fields).length) {
    await requireSite(user, id, 'site.configure', { write: true });
    const proj = (await rows<any>('SELECT timeout_ms, retry_count, retry_delay_ms FROM project_settings WHERE project_id = ?', [site.project_id]))[0] ?? { timeout_ms: 10000, retry_count: 1, retry_delay_ms: 1000 };
    const pick = (k: 'timeout_ms' | 'retry_count' | 'retry_delay_ms') => (k in fields ? (fields as any)[k] : site[k]) ?? proj[k];
    assertWithinCapacity({ timeout_ms: pick('timeout_ms'), retry_count: pick('retry_count'), retry_delay_ms: pick('retry_delay_ms') });
    for (const [k, v] of Object.entries(fields)) set[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  if (!Object.keys(set).length) return { ok: true };
  try {
    await tx(async conn => {
      const touchesSchedule = 'interval_minutes' in set || 'url' in set;
      await conn.query(`UPDATE monitored_sites SET ${Object.keys(set).map(k => `${k} = ?`).join(', ')}, ${touchesSchedule ? 'next_run_at = UTC_TIMESTAMP(3), ' : ''}updated_by = ? WHERE id = ?`, [...Object.values(set), user.id, id]);
      const changes = diff(site, set);
      delete (changes as any).url_hash;
      const monitoringKeys = Object.keys(changes).filter(k => !['name', 'url'].includes(k));
      await audit({ user, action: monitoringKeys.length && monitoringKeys.length === Object.keys(changes).length ? Actions.monitoringChanged : Actions.siteUpdated, entityType: 'site', entityId: id, projectId: Number(site.project_id), metadata: { name: site.name, changes }, ip }, conn);
    });
  } catch (e: any) { if (e?.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'That URL is already monitored in this project.'); throw e; }
  return { ok: true };
});

/** Soft delete: history, incidents and reports are retained; the URL becomes available to add again. */
export const DELETE = api(async ({ user, params, ip }) => {
  const id = idParam(params.id, 'website ID');
  const { site } = await requireSite(user, id, 'site.delete', { write: true });
  await tx(async conn => {
    await conn.query("UPDATE monitored_sites SET deleted_at = UTC_TIMESTAMP(3), is_active = 0, claim_token = NULL, claimed_at = NULL, url_hash = SHA2(CONCAT(url_hash, ':deleted:', id), 256), updated_by = ? WHERE id = ?", [user.id, id]);
    await conn.query('UPDATE incidents SET resolved_at = UTC_TIMESTAMP(3) WHERE site_id = ? AND resolved_at IS NULL', [id]);
    await audit({ user, action: Actions.siteDeleted, entityType: 'site', entityId: id, projectId: Number(site.project_id), metadata: { name: site.name, url: site.url }, ip }, conn);
  });
  return { ok: true };
});
