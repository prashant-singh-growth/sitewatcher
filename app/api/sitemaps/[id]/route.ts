import { api, idParam, readBody } from '@/lib/api';
import { db, rows } from '@/lib/db';
import { requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

async function getSitemapWithAuth(user: any, sitemapId: number, perm: 'site.view' | 'site.configure', opts: { write?: boolean } = {}) {
  const smList = await rows<any>('SELECT * FROM sitemaps WHERE id = ?', [sitemapId]);
  const sitemap = smList[0];
  if (!sitemap) throw new ApiError(404, 'Sitemap not found.');
  const { site, access } = await requireSite(user, Number(sitemap.site_id), perm, opts);
  return { sitemap, site, access };
}

/**
 * GET /api/sitemaps/:id
 * Details, child sitemaps, recent scan history, open and resolved issues.
 */
export const GET = api(async ({ params, user }) => {
  const id = idParam(params.id, 'sitemapId');
  const { sitemap, site } = await getSitemapWithAuth(user, id, 'site.view');

  // Child sitemaps if this is an index
  const children = await rows<any>(
    'SELECT * FROM sitemaps WHERE parent_sitemap_id = ? ORDER BY id ASC',
    [id]
  );

  // Scan history (last 50 scans)
  const scans = await rows<any>(
    'SELECT * FROM sitemap_scans WHERE sitemap_id = ? ORDER BY scanned_at DESC LIMIT 50',
    [id]
  );

  // Issues (both active and resolved)
  const issues = await rows<any>(
    'SELECT * FROM sitemap_issues WHERE sitemap_id = ? ORDER BY resolved_at IS NULL DESC, last_detected_at DESC LIMIT 50',
    [id]
  );

  // Recent URL changes (last 100 added/removed)
  const recentChanges = await rows<any>(
    'SELECT * FROM sitemap_scan_changes WHERE sitemap_id = ? ORDER BY detected_at DESC LIMIT 100',
    [id]
  );

  return {
    sitemap,
    site,
    children,
    scans,
    issues,
    recentChanges
  };
});

/**
 * PATCH /api/sitemaps/:id
 * Update interval or toggle active state
 */
export const PATCH = api(async ({ params, req, user, ip }) => {
  const id = idParam(params.id, 'sitemapId');
  const { sitemap, site } = await getSitemapWithAuth(user, id, 'site.configure', { write: true });
  const b = await readBody(req);

  const updates: string[] = [];
  const vals: any[] = [];

  if (b.action === 'toggle') {
    const nextActive = sitemap.is_active ? 0 : 1;
    updates.push('is_active = ?');
    vals.push(nextActive);
  } else {
    if (b.checkIntervalHours !== undefined) {
      const h = Math.max(1, Math.min(168, Number(b.checkIntervalHours)));
      updates.push('check_interval_hours = ?');
      vals.push(h);
    }
    if (b.isActive !== undefined) {
      updates.push('is_active = ?');
      vals.push(b.isActive ? 1 : 0);
    }
  }

  if (updates.length > 0) {
    vals.push(id);
    await db.query(`UPDATE sitemaps SET ${updates.join(', ')}, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, vals);
  }

  const updated = (await rows<any>('SELECT * FROM sitemaps WHERE id = ?', [id]))[0];

  await audit({
    user,
    action: 'sitemap.updated',
    entityType: 'sitemap',
    entityId: id,
    projectId: Number(site.project_id),
    metadata: { siteId: site.id, changes: b },
    ip
  });

  return { ok: true, sitemap: updated };
});

/**
 * DELETE /api/sitemaps/:id
 * Removes sitemap and all associated scans/urls/issues (via CASCADE).
 */
export const DELETE = api(async ({ params, user, ip }) => {
  const id = idParam(params.id, 'sitemapId');
  const { sitemap, site } = await getSitemapWithAuth(user, id, 'site.configure', { write: true });

  await db.query('DELETE FROM sitemaps WHERE id = ?', [id]);

  await audit({
    user,
    action: 'sitemap.deleted',
    entityType: 'sitemap',
    entityId: id,
    projectId: Number(site.project_id),
    metadata: { siteId: site.id, url: sitemap.url },
    ip
  });

  return { ok: true };
});
