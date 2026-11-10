import { api, idParam, readBody } from '@/lib/api';
import { db, rows } from '@/lib/db';
import { requireProject, requireSite } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { getIndexabilityStats, ensureIndexabilityMonitor } from '@/modules/indexability/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/indexability?siteId=&projectId=
 * Returns stats, KPIs, and open issues for indexability monitoring.
 */
export const GET = api(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const siteIdRaw = q.get('siteId');
  const projectIdRaw = q.get('projectId');

  let site: any = null;

  if (siteIdRaw) {
    const siteId = idParam(siteIdRaw, 'siteId');
    const auth = await requireSite(user, siteId, 'site.view');
    site = auth.site;
  } else if (projectIdRaw) {
    const projectId = idParam(projectIdRaw, 'projectId');
    await requireProject(user, projectId, 'site.view');
    const sites = await rows<any>(
      'SELECT * FROM monitored_sites WHERE project_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1',
      [projectId]
    );
    site = sites[0] || null;
  } else {
    throw new Error('Either siteId or projectId is required.');
  }

  if (!site) {
    return {
      site: null,
      monitors: [],
      summary: {
        totalMonitored: 0,
        totalIndexable: 0,
        totalNoindex: 0,
        totalCanonicalIssues: 0,
        totalErrors: 0,
        totalChanged: 0,
        openIssuesCount: 0
      },
      openIssues: []
    };
  }

  await ensureIndexabilityMonitor(site.id, Number(site.project_id));
  const data = await getIndexabilityStats(site.id);

  return { site, ...data };
});

/**
 * PATCH /api/indexability?siteId=
 * Body: { checkIntervalHours?: number, isActive?: boolean }
 */
export const PATCH = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const siteId = idParam(String(b.siteId ?? req.nextUrl.searchParams.get('siteId') ?? ''), 'siteId');
  const { site } = await requireSite(user, siteId, 'site.configure', { write: true });

  const updates: string[] = [];
  const vals: any[] = [];

  if (b.checkIntervalHours !== undefined) {
    const h = Math.max(1, Math.min(168, Number(b.checkIntervalHours)));
    updates.push('check_interval_hours = ?');
    vals.push(h);
  }
  if (b.isActive !== undefined) {
    updates.push('is_active = ?');
    vals.push(b.isActive ? 1 : 0);
  }

  if (updates.length > 0) {
    vals.push(siteId);
    await db.query(`UPDATE indexability_monitors SET ${updates.join(', ')}, updated_at = UTC_TIMESTAMP(3) WHERE site_id = ?`, vals);

    await audit({
      user,
      action: 'indexability.configured',
      entityType: 'site',
      entityId: siteId,
      projectId: Number(site.project_id),
      metadata: { checkIntervalHours: b.checkIntervalHours, isActive: b.isActive },
      ip
    });
  }

  const monitor = (await rows<any>('SELECT * FROM indexability_monitors WHERE site_id = ?', [siteId]))[0];
  return { ok: true, monitor };
});
