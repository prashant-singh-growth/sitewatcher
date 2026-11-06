import { api, idParam, readBody } from '@/lib/api';
import { db, rows } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { assertPublicUrl } from '@/lib/ssrf';
import { str } from '@/lib/validate';
import { assertWithinCapacity, parseMonitoringFields } from '@/modules/monitoring/settings';
import { listSites, urlHash } from '@/modules/monitoring/service';
export const dynamic = 'force-dynamic';

/** GET /api/sites?projectId=N  (a project is always required; websites never exist outside a project) */
export const GET = api(async ({ req, user }) => {
  const projectId = idParam(req.nextUrl.searchParams.get('projectId') ?? undefined, 'projectId');
  await requireProject(user, projectId, 'site.view');
  return { sites: await listSites(projectId) };
});

export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const projectId = idParam(String(b.projectId ?? ''), 'projectId');
  await requireProject(user, projectId, 'site.create', { write: true });
  const name = str(b.name, 'Display name', { max: 120 })!;
  const url = (await assertPublicUrl(String(b.url ?? '').trim())).toString();
  const fields = await parseMonitoringFields(b, true);
  if (Object.keys(fields).length) await requireProject(user, projectId, 'site.configure', { write: true });
  const eff = (await rows<any>('SELECT timeout_ms, retry_count, retry_delay_ms FROM project_settings WHERE project_id = ?', [projectId]))[0] ?? { timeout_ms: 10000, retry_count: 1, retry_delay_ms: 1000 };
  assertWithinCapacity({ timeout_ms: fields.timeout_ms ?? eff.timeout_ms, retry_count: fields.retry_count ?? eff.retry_count, retry_delay_ms: fields.retry_delay_ms ?? eff.retry_delay_ms });

  const cols = ['project_id', 'name', 'url', 'url_hash', 'next_run_at', 'created_by', 'updated_by', ...Object.keys(fields)];
  const vals: unknown[] = [projectId, name, url, urlHash(url), new Date(), user.id, user.id, ...Object.values(fields).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v)];
  let id: number;
  try {
    const [r] = await db.query<any>(`INSERT INTO monitored_sites (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    id = Number(r.insertId);
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') return Response.json({ error: 'That URL is already monitored in this project.' }, { status: 409 });
    throw e;
  }
  await audit({ user, action: Actions.siteAdded, entityType: 'site', entityId: id, projectId, metadata: { name, url }, ip });
  return Response.json({ ok: true, id }, { status: 201 });
});
