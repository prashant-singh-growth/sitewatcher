import { api, idParam, readBody } from '@/lib/api';
import { requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import {
  getEvaluatedUrls,
  addManualUrlsToIndexability,
  clearNonManualIndexabilityUrls
} from '@/modules/indexability/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/indexability/urls?siteId=&status=&search=&page=&limit=
 * Paginated and searchable evaluated URLs.
 */
export const GET = api(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const siteId = idParam(q.get('siteId') ?? undefined, 'siteId');
  const { site } = await requireSite(user, siteId, 'site.view');

  const status = q.get('status') as any;
  const search = q.get('search') || undefined;
  const page = Number(q.get('page')) || 1;
  const limit = Number(q.get('limit')) || 25;

  const data = await getEvaluatedUrls(siteId, Number(site.project_id), {
    status,
    search,
    page,
    limit
  });

  return data;
});

/**
 * POST /api/indexability/urls
 * Body: { siteId: number, url?: string, urls?: string[] | string, crawlNow?: boolean }
 * Manually adds one or many URLs (e.g. 1, 5, 40+) for indexability monitoring.
 */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const rawInput = b.urls !== undefined ? (Array.isArray(b.urls) ? b.urls : String(b.urls)) : String(b.url ?? '').trim();
  const crawlNow = b.crawlNow !== false;

  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });
  const result = await addManualUrlsToIndexability(siteId, Number(site.project_id), rawInput, { crawlNow });

  await audit({
    user,
    action: 'indexability.url_added',
    entityType: 'site',
    entityId: siteId,
    projectId: Number(site.project_id),
    metadata: {
      siteId,
      totalSubmitted: result.totalSubmitted,
      addedCount: result.addedCount,
      existingCount: result.existingCount,
      crawledCount: result.crawledCount,
      pendingCount: result.pendingCount
    },
    ip
  });

  return { ok: true, ...result, page: result.pages[0] ?? null };
});

/**
 * DELETE /api/indexability/urls?siteId=&scope=non_manual
 * Removes legacy auto-seeded URLs (sitemap/root) while preserving manually added URLs.
 */
export const DELETE = api(async ({ req, user, ip }) => {
  const q = req.nextUrl.searchParams;
  const siteId = idParam(q.get('siteId') ?? undefined, 'siteId');
  const scope = q.get('scope') || 'non_manual';
  if (scope !== 'non_manual') {
    throw new Error('Invalid delete scope.');
  }

  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });
  const removedCount = await clearNonManualIndexabilityUrls(siteId, Number(site.project_id));

  await audit({
    user,
    action: 'indexability.urls_cleared',
    entityType: 'site',
    entityId: siteId,
    projectId: Number(site.project_id),
    metadata: { siteId, scope, removedCount },
    ip
  });

  return { ok: true, removedCount };
});
