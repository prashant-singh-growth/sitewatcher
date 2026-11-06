import { api, idParam } from '@/lib/api';
import { rows } from '@/lib/db';
import { requireSite } from '@/lib/rbac';
import { isoDate } from '@/lib/validate';
export const dynamic = 'force-dynamic';
/** GET ?from=&to= : bucketed response-time / uptime series for charts (hourly up to 3 days, otherwise daily). */
export const GET = api(async ({ req, user, params }) => {
  const id = idParam(params.id, 'website ID'); await requireSite(user, id, 'site.view');
  const q = req.nextUrl.searchParams;
  const to = q.get('to') ? isoDate(q.get('to'), 'to') : new Date();
  const from = q.get('from') ? isoDate(q.get('from'), 'from') : new Date(to.getTime() - 7 * 86_400_000);
  const hourly = to.getTime() - from.getTime() <= 3 * 86_400_000;
  const b = hourly ? "DATE_FORMAT(checked_at, '%Y-%m-%dT%H:00:00Z')" : "DATE_FORMAT(checked_at, '%Y-%m-%dT00:00:00Z')";
  const series = await rows<any>(`SELECT ${b} AS t, ROUND(AVG(CASE WHEN is_up=1 THEN response_ms END)) AS avg_ms, MAX(CASE WHEN is_up=1 THEN response_ms END) AS max_ms, COUNT(*) AS checks, SUM(is_up) AS up
    FROM check_results WHERE site_id = ? AND checked_at >= ? AND checked_at <= ? GROUP BY t ORDER BY t`, [id, from, to]);
  return { series: series.map(s => ({ t: s.t, avg_ms: s.avg_ms == null ? null : Number(s.avg_ms), max_ms: s.max_ms == null ? null : Number(s.max_ms), checks: Number(s.checks), uptime_pct: Number(s.checks) ? Math.round((Number(s.up) / Number(s.checks)) * 1000) / 10 : null })) };
});
