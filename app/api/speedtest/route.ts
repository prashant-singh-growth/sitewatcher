import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows } from '@/lib/db';
import { requireSite } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { assertPublicUrl } from '@/lib/ssrf';
import { isoDate } from '@/lib/validate';
import { AUDIT_LIST_COLUMNS, assertPsiReady, runAudit } from '@/modules/speedtest/service';
import type { Device } from '@/modules/speedtest/psi';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET ?siteId=&device=&from=&to=&limit= : audit history (no heavy JSON), newest first. */
export const GET = api(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const siteId = idParam(q.get('siteId') ?? undefined, 'siteId');
  await requireSite(user, siteId, 'speedtest.view');
  const where = ['a.site_id = ?']; const args: unknown[] = [siteId];
  const device = q.get('device'); if (device === 'mobile' || device === 'desktop') { where.push('a.device = ?'); args.push(device); }
  if (q.get('from')) { where.push('a.audited_at >= ?'); args.push(isoDate(q.get('from'), 'from')); }
  if (q.get('to')) { where.push('a.audited_at <= ?'); args.push(isoDate(q.get('to'), 'to')); }
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
  return { audits: await rows<any>(`SELECT ${AUDIT_LIST_COLUMNS} FROM pagespeed_audits a WHERE ${where.join(' AND ')} ORDER BY a.audited_at DESC LIMIT ?`, [...args, limit]) };
});

/** POST { siteId, devices: ['mobile','desktop'] } : run now and save each result as a new record. */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const { site } = await requireSite(user, siteId, 'speedtest.run', { write: true });
  const devices = [...new Set((Array.isArray(b.devices) ? b.devices : [b.device ?? 'mobile']) as string[])];
  if (!devices.length || devices.some(d => d !== 'mobile' && d !== 'desktop')) throw new ApiError(400, 'devices must be mobile and/or desktop.');
  assertPsiReady();
  await assertPublicUrl(site.url);
  const rl = await rateLimit(`speed:${user.id}`, 20, 3600);
  if (!rl.allowed) throw new ApiError(429, `Speed test limit reached (20 per hour). Try again in ${Math.ceil(rl.retryAfter / 60)} minute(s).`);
  const audits = await Promise.all((devices as Device[]).map(d => runAudit(site, d, { userId: user.id })));
  await audit({ user, action: Actions.speedTestRun, entityType: 'site', entityId: siteId, projectId: Number(site.project_id), metadata: { name: site.name, devices, results: audits.map(a => ({ device: a.device, status: a.status, performance: a.performance_score })) }, ip });
  return { audits };
});
