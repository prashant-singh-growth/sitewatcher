import { api, idParam, readBody } from '@/lib/api';
import { requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { getEvaluatedUrls, addManualUrlToIndexability } from '@/modules/indexability/service';

export const dynamic = 'force-dynamic';

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
 * Body: { siteId: number, url: string }
 * Manually adds a single page URL for indexability monitoring and checks it immediately.
 */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const url = String(b.url ?? '').trim();
  if (!url) throw new Error('URL is required.');

  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });
  const page = await addManualUrlToIndexability(siteId, Number(site.project_id), url);

  await audit({
    user,
    action: 'indexability.url_added',
    entityType: 'site',
    entityId: siteId,
    projectId: Number(site.project_id),
    metadata: { siteId, url, pageId: page.id },
    ip
  });

  return { ok: true, page };
});
