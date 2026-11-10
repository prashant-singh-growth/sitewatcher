import { api, idParam } from '@/lib/api';
import { rows } from '@/lib/db';
import { requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';
import { scanSitemap } from '@/modules/sitemaps/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/sitemaps/:id/scan
 * Manually trigger a sitemap scan now.
 */
export const POST = api(async ({ params, user, ip }) => {
  const id = idParam(params.id, 'sitemapId');
  const smList = await rows<any>('SELECT * FROM sitemaps WHERE id = ?', [id]);
  const sitemap = smList[0];
  if (!sitemap) throw new ApiError(404, 'Sitemap not found.');

  const { site } = await requireSite(user, Number(sitemap.site_id), 'site.configure', { write: true });

  const result = await scanSitemap(id, 'manual');

  await audit({
    user,
    action: 'sitemap.scanned',
    entityType: 'sitemap',
    entityId: id,
    projectId: Number(site.project_id),
    metadata: {
      siteId: site.id,
      url: sitemap.url,
      status: result.status,
      statusCode: result.statusCode,
      totalUrls: result.totalUrls,
      added: result.addedCount,
      removed: result.removedCount
    },
    ip
  });

  return { ok: true, result };
});
