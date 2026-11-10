import { api, idParam, readBody } from '@/lib/api';
import { requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { checkSiteIndexability } from '@/modules/indexability/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/indexability/check
 * Body: { siteId: number, maxPages?: number }
 * Manually trigger indexability crawl and directives evaluation.
 */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });

  const maxPages = b.maxPages ? Math.min(100, Math.max(1, Number(b.maxPages))) : 50;
  const summary = await checkSiteIndexability(siteId, { maxPages, triggeredBy: 'manual' });

  await audit({
    user,
    action: 'indexability.checked',
    entityType: 'site',
    entityId: siteId,
    projectId: Number(site.project_id),
    metadata: {
      siteId,
      totalMonitored: summary.totalMonitored,
      checkedCount: summary.checkedCount,
      indexableCount: summary.indexableCount,
      noindexCount: summary.noindexCount,
      canonicalIssuesCount: summary.canonicalIssuesCount,
      errorsCount: summary.errorsCount
    },
    ip
  });

  return { ok: true, summary };
});
