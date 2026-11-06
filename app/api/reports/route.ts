import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows, parseJson } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { str } from '@/lib/validate';
import { parseSections, resolvePeriod } from '@/modules/reports/data';
import { createPdf, saveReport } from '@/modules/reports/service';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = api(async ({ req, user }) => {
  const projectId = idParam(req.nextUrl.searchParams.get('projectId') ?? undefined, 'projectId');
  await requireProject(user, projectId, 'report.view');
  const list = await rows<any>(`SELECT r.id, r.title, r.site_id, s.name AS site_name, r.period_from, r.period_to, r.sections, r.emailed_to, r.emailed_at, r.schedule_id, r.created_at, u.display_name AS created_by_name
    FROM reports r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN monitored_sites s ON s.id = r.site_id WHERE r.project_id = ? ORDER BY r.id DESC LIMIT 100`, [projectId]);
  return { reports: list.map(r => ({ ...r, sections: parseJson(r.sections, []) })) };
});

/** POST { projectId, siteId?, preset | from+to, sections?, title? } -> application/pdf download */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const projectId = idParam(String(b.projectId ?? ''), 'projectId');
  await requireProject(user, projectId, 'report.generate');
  const siteId = b.siteId ? idParam(String(b.siteId), 'siteId') : null;
  if (siteId) { const ok = (await rows<any>('SELECT id FROM monitored_sites WHERE id = ? AND project_id = ? AND deleted_at IS NULL', [siteId, projectId]))[0]; if (!ok) throw new ApiError(404, 'Website not found.'); }
  const rl = await rateLimit(`report:${user.id}`, 30, 3600);
  if (!rl.allowed) throw new ApiError(429, 'Report limit reached (30 per hour).');
  const { from, to } = resolvePeriod(b); const sections = parseSections(b.sections);
  const title = str(b.title, 'Title', { max: 200, optional: true }) || 'Website Performance Report';
  const { pdf, filename } = await createPdf({ projectId, siteId, from, to, sections, title, timezone: user.timezone });
  const id = await saveReport({ projectId, siteId, userId: user.id, title, from, to, sections, timezone: user.timezone });
  await audit({ user, action: Actions.reportGenerated, entityType: 'report', entityId: id, projectId, metadata: { siteId, from, to, sections }, ip });
  return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store', 'X-Report-Id': String(id) } });
});
