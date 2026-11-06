import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows, parseJson } from '@/lib/db';
import { requireSite, projectIdsWithPermission } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { int, isoDate, oneOf } from '@/lib/validate';
import { firstRun } from '@/modules/speedtest/service';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ req, user }) => {
  const siteId = req.nextUrl.searchParams.get('siteId');
  if (siteId) await requireSite(user, idParam(siteId, 'siteId'), 'speedtest.view');
  const scope = siteId ? null : await projectIdsWithPermission(user, 'speedtest.view');
  const where = siteId ? 'c.site_id = ?' : scope ? `c.project_id IN (${scope.length ? scope.map(() => '?').join(',') : 'NULL'})` : '1=1';
  const list = await rows<any>(`SELECT c.*, s.name AS site_name, s.url AS site_url FROM speed_test_schedules c JOIN monitored_sites s ON s.id = c.site_id WHERE ${where} AND s.deleted_at IS NULL ORDER BY c.is_active DESC, c.next_run_at ASC`, siteId ? [siteId] : scope ?? []);
  return { schedules: list.map(s => ({ ...s, offsets_days: parseJson(s.offsets_days, null) })) };
});

/** { siteId, device, kind: once|recurring|custom, start_at?, every_days?, offsets_days?: [0,2,5,7] } */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const { site } = await requireSite(user, siteId, 'speedtest.schedule', { write: true });
  const kind = oneOf(b.kind, 'Schedule type', ['once', 'recurring', 'custom'] as const);
  const device = oneOf(b.device ?? 'mobile', 'Device', ['mobile', 'desktop', 'both'] as const);
  const startAt = b.start_at ? isoDate(b.start_at, 'Start') : new Date();
  let everyDays: number | null = null; let offsets: number[] | null = null;
  if (kind === 'recurring') everyDays = int(b.every_days, 'Repeat every (days)', { min: 1, max: 365 });
  if (kind === 'custom') {
    if (!Array.isArray(b.offsets_days) || !b.offsets_days.length || b.offsets_days.length > 20) throw new ApiError(400, 'Provide 1 to 20 day offsets, e.g. [0, 2, 5, 7].');
    offsets = b.offsets_days.map((v: unknown) => int(v, 'Day offset', { min: 0, max: 365 }));
    if (offsets!.some((v, i) => i > 0 && v <= offsets![i - 1])) throw new ApiError(400, 'Day offsets must be strictly increasing.');
  }
  const next = firstRun({ kind, start_at: startAt, every_days: everyDays, offsets_days: offsets });
  const [r] = await db.query<any>('INSERT INTO speed_test_schedules (project_id, site_id, created_by, device, kind, start_at, every_days, offsets_days, next_run_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [site.project_id, siteId, user.id, device, kind, startAt, everyDays, offsets ? JSON.stringify(offsets) : null, next]);
  await audit({ user, action: 'speedtest.schedule_created', entityType: 'speed_schedule', entityId: r.insertId, projectId: Number(site.project_id), metadata: { site: site.name, kind, device, everyDays, offsets }, ip });
  return Response.json({ ok: true, id: Number(r.insertId), next_run_at: next }, { status: 201 });
});
