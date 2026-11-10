import { api, idParam, readBody } from '@/lib/api';
import { requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { fetchAndEvaluateRobots } from '@/modules/robots/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/robots/check
 * Body: { siteId: number }
 * Manually trigger robots.txt fetch and crawlability evaluation.
 */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });

  const summary = await fetchAndEvaluateRobots(siteId, 'manual');

  await audit({
    user,
    action: 'robots.checked',
    entityType: 'site',
    entityId: siteId,
    projectId: Number(site.project_id),
    metadata: {
      siteId,
      status: summary.status,
      statusCode: summary.statusCode,
      totalUrls: summary.totalMonitoredUrls,
      crawlable: summary.crawlableCount,
      blocked: summary.blockedCount
    },
    ip
  });

  return { ok: true, summary };
});
