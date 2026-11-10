import { api, idParam } from '@/lib/api';
import { rows } from '@/lib/db';
import { requireSite } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sitemaps/:id/urls?status=&search=&limit=&offset=
 * Returns URL entries for this sitemap with status, lastmod, first_seen, last_seen.
 */
export const GET = api(async ({ params, req, user }) => {
  const id = idParam(params.id, 'sitemapId');
  const smList = await rows<any>('SELECT * FROM sitemaps WHERE id = ?', [id]);
  const sitemap = smList[0];
  if (!sitemap) throw new ApiError(404, 'Sitemap not found.');

  await requireSite(user, Number(sitemap.site_id), 'site.view');

  const q = req.nextUrl.searchParams;
  const status = q.get('status');
  const search = q.get('search')?.trim();
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 50));
  const offset = Math.max(0, Number(q.get('offset')) || 0);

  const where = ['sitemap_id = ?'];
  const args: any[] = [id];

  if (status === 'active' || status === 'removed') {
    where.push('status = ?');
    args.push(status);
  }

  if (search) {
    where.push('loc LIKE ?');
    args.push(`%${search}%`);
  }

  const whereClause = where.join(' AND ');

  const countRow = (await rows<any>(`SELECT COUNT(*) AS cnt FROM sitemap_urls WHERE ${whereClause}`, args))[0];
  const total = Number(countRow?.cnt || 0);

  const urlRows = await rows<any>(
    `SELECT id, loc, lastmod, changefreq, priority, status, first_seen_at, last_seen_at, removed_at
     FROM sitemap_urls
     WHERE ${whereClause}
     ORDER BY status = 'active' DESC, last_seen_at DESC, id DESC
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
