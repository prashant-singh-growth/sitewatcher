import { api, idParam } from '@/lib/api';
import { rows } from '@/lib/db';
import { requireSite } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/robots/urls?siteId=&status=&search=&limit=&offset=
 * Paginated and searchable evaluated URLs against robots.txt.
 */
export const GET = api(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const siteId = idParam(q.get('siteId') ?? undefined, 'siteId');
  await requireSite(user, siteId, 'site.view');

  const status = q.get('status');
  const search = q.get('search')?.trim();
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 50));
  const offset = Math.max(0, Number(q.get('offset')) || 0);

  const where = ['site_id = ?', 'user_agent = "Googlebot"'];
  const args: any[] = [siteId];

  if (status === 'allowed' || status === 'blocked') {
    where.push('status = ?');
    args.push(status);
  } else if (status === 'changed') {
    where.push('previous_status IS NOT NULL AND status <> previous_status');
  }

  if (search) {
    where.push('url LIKE ?');
    args.push(`%${search}%`);
  }

  const whereClause = where.join(' AND ');

  const countRow = (await rows<any>(`SELECT COUNT(*) AS cnt FROM robots_url_evaluations WHERE ${whereClause}`, args))[0];
  const total = Number(countRow?.cnt || 0);

  const urlRows = await rows<any>(
    `SELECT id, url, status, previous_status, matched_rule, matched_user_agent, status_changed_at, first_evaluated_at, last_evaluated_at
     FROM robots_url_evaluations
     WHERE ${whereClause}
     ORDER BY status = 'blocked' DESC, status_changed_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  return {
    urls: urlRows,
    total,
    limit,
    offset
  };
});
