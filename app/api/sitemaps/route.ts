import { api, idParam, readBody } from '@/lib/api';
import { requireProject, requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { getSitemapStats, addSitemap, scanSitemap } from '@/modules/sitemaps/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sitemaps?siteId=&projectId=
 * Returns sitemap stats, list of sitemaps, and open issues.
 */
export const GET = api(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const siteIdRaw = q.get('siteId');
  const projectIdRaw = q.get('projectId');

  let siteId: number | undefined;
  let projectId: number | undefined;

  if (siteIdRaw) {
    siteId = idParam(siteIdRaw, 'siteId');
    await requireSite(user, siteId, 'site.view');
  } else if (projectIdRaw) {
    projectId = idParam(projectIdRaw, 'projectId');
    await requireProject(user, projectId, 'site.view');
  } else {
    // If neither is provided, check if user has access to a project or site
    throw new Error('Either siteId or projectId is required.');
  }

  const data = await getSitemapStats(siteId, projectId);
  return data;
});

/**
 * POST /api/sitemaps
 * Body: { siteId: number, url: string, checkIntervalHours?: number }
 * Adds a new sitemap to monitor and immediately triggers an initial scan.
 */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? ''), 'siteId');
  const url = String(b.url ?? '').trim();
  const checkIntervalHours = b.checkIntervalHours ? Number(b.checkIntervalHours) : 24;

  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });

  const sitemap = await addSitemap(Number(site.project_id), siteId, url, {
    discoverySource: 'manual',
    checkIntervalHours
  });

  // Trigger initial scan in background or wait for it
  let initialScan = null;
  try {
    initialScan = await scanSitemap(sitemap.id, 'manual');
  } catch (e) {
    console.error(`[SiteWatch] Initial sitemap scan failed for #${sitemap.id}:`, e);
  }

  await audit({
    user,
    action: 'sitemap.added',
    entityType: 'sitemap',
    entityId: sitemap.id,
    projectId: Number(site.project_id),
    metadata: { siteId, url: sitemap.url, initialScanStatus: initialScan?.status },
    ip
  });

  return Response.json({ ok: true, sitemap, initialScan }, { status: 201 });
});
