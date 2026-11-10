import { api, idParam } from '@/lib/api';
import { requireSite } from '@/lib/rbac';
import { getUrlHistory } from '@/modules/indexability/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/indexability/urls/[id]?siteId=
 * Fetches page details, historical snapshots, and issues for a single monitored URL.
 */
export const GET = api(async ({ req, user, params }) => {
  const pageId = idParam((await params)?.id, 'pageId');
  const siteId = idParam(req.nextUrl.searchParams.get('siteId') ?? undefined, 'siteId');
  const { site } = await requireSite(user, siteId, 'site.view');

  const history = await getUrlHistory(pageId, siteId, Number(site.project_id));
  return history;
});
