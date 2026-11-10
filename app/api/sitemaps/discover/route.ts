import { api, idParam, readBody } from '@/lib/api';
import { requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { discoverAndRegisterWebsiteSitemaps, scanSitemap } from '@/modules/sitemaps/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/sitemaps/discover
 * Body: { siteId: number }
 * Discovers sitemaps from robots.txt and /sitemap.xml, saves them, and scans them.
 */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });

  const discovered = await discoverAndRegisterWebsiteSitemaps(siteId, Number(site.project_id));

  // Run initial scans for newly discovered sitemaps
  const scanResults: any[] = [];
  for (const sm of discovered) {
    try {
      const res = await scanSitemap(sm.id, 'manual');
      scanResults.push(res);
    } catch (e: any) {
      scanResults.push({ sitemapId: sm.id, error: e.message, status: 'failed' });
    }
  }

  await audit({
    user,
    action: 'sitemap.discovered',
    entityType: 'site',
    entityId: siteId,
    projectId: Number(site.project_id),
    metadata: {
      siteId,
      discoveredCount: discovered.length,
      urls: discovered.map(d => d.url)
    },
    ip
  });

  return { ok: true, count: discovered.length, discovered, scanResults };
});
