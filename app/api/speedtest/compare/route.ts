import { api, idParam } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows } from '@/lib/db';
import { requireProject, requireSite } from '@/lib/rbac';
import { isoDate } from '@/lib/validate';
import { compareAudits } from '@/modules/speedtest/compare';
import { shapeAudit } from '@/modules/speedtest/service';
export const dynamic = 'force-dynamic';

async function auditById(user: any, id: number) {
  const a = (await rows<any>('SELECT * FROM pagespeed_audits WHERE id = ?', [id]))[0];
  if (!a) throw new ApiError(404, 'Audit not found.');
  await requireProject(user, Number(a.project_id), 'speedtest.view').catch(() => { throw new ApiError(404, 'Audit not found.'); });
  return a;
}
/** Latest successful audit at or before the END of that day; falls back to the earliest one after it. */
async function auditNearDate(siteId: number, device: string, d: Date) {
  const end = new Date(d); end.setUTCHours(23, 59, 59, 999);
  const before = (await rows<any>("SELECT * FROM pagespeed_audits WHERE site_id = ? AND device = ? AND status = 'success' AND audited_at <= ? ORDER BY audited_at DESC LIMIT 1", [siteId, device, end]))[0];
  if (before) return before;
  return (await rows<any>("SELECT * FROM pagespeed_audits WHERE site_id = ? AND device = ? AND status = 'success' AND audited_at > ? ORDER BY audited_at ASC LIMIT 1", [siteId, device, end]))[0];
}

/**
 * Three modes:  ?a=<auditId>&b=<auditId>            two chosen records
 *               ?siteId&device&dateA=&dateB=        audits nearest two dates (custom range or "after N days")
 *               ?siteId&device                      the last two successful audits
 */
export const GET = api(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  let x: any, y: any;
  if (q.get('a') && q.get('b')) { x = await auditById(user, idParam(q.get('a') ?? undefined, 'a')); y = await auditById(user, idParam(q.get('b') ?? undefined, 'b')); }
  else {
    const siteId = idParam(q.get('siteId') ?? undefined, 'siteId'); const device = q.get('device') === 'desktop' ? 'desktop' : 'mobile';
    await requireSite(user, siteId, 'speedtest.view');
    if (q.get('dateA') && q.get('dateB')) { x = await auditNearDate(siteId, device, isoDate(q.get('dateA'), 'dateA')); y = await auditNearDate(siteId, device, isoDate(q.get('dateB'), 'dateB')); }
    else { const last = await rows<any>("SELECT * FROM pagespeed_audits WHERE site_id = ? AND device = ? AND status = 'success' ORDER BY audited_at DESC LIMIT 2", [siteId, device]); [y, x] = last; }
  }
  if (!x || !y) throw new ApiError(404, 'Not enough successful audits to compare yet.');
  if (x.id === y.id) throw new ApiError(400, 'Those dates resolve to the same audit. Pick different dates.');
  if (x.site_id !== y.site_id || x.device !== y.device) throw new ApiError(400, 'Only audits of the same website and device can be compared.');
  if (new Date(x.audited_at) > new Date(y.audited_at)) [x, y] = [y, x];
  return { previous: shapeAudit(x), current: shapeAudit(y), deltas: compareAudits(x, y) };
});
