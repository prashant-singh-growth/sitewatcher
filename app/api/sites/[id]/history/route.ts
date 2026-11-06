import { api, idParam } from '@/lib/api';
import { rows } from '@/lib/db';
import { requireSite } from '@/lib/rbac';
import { isoDate, oneOf } from '@/lib/validate';
export const dynamic = 'force-dynamic';

/** GET ?status=up|down&from=ISO&to=ISO&limit=100&before=<checkId> — filtered, cursor-paginated check history + incidents. */
export const GET = api(async ({ req, user, params }) => {
  const id = idParam(params.id, 'website ID');
  await requireSite(user, id, 'site.view');
  const q = req.nextUrl.searchParams;
  const where = ['r.site_id = ?']; const args: unknown[] = [id];
  const status = q.get('status'); if (status) { oneOf(status, 'status', ['up', 'down'] as const); where.push('r.is_up = ?'); args.push(status === 'up' ? 1 : 0); }
  if (q.get('from')) { where.push('r.checked_at >= ?'); args.push(isoDate(q.get('from'), 'from')); }
  if (q.get('to')) { where.push('r.checked_at <= ?'); args.push(isoDate(q.get('to'), 'to')); }
  if (q.get('before')) { where.push('r.id < ?'); args.push(idParam(q.get('before') ?? undefined, 'before')); }
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
  const checks = await rows<any>(`SELECT r.id, r.status_code, r.is_up, r.response_ms, r.error_message, r.attempts, r.incident_id, r.checked_at FROM check_results r WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ?`, [...args, limit]);
  const incidents = await rows<any>(
    `SELECT i.id, i.started_at, i.resolved_at, i.last_failure_at, i.failure_count, i.last_error,
       TIMESTAMPDIFF(SECOND, i.started_at, COALESCE(i.resolved_at, UTC_TIMESTAMP(3))) AS duration_seconds,
       (SELECT JSON_ARRAYAGG(JSON_OBJECT('type', n.type, 'status', n.status, 'at', n.created_at)) FROM incident_notifications n WHERE n.incident_id = i.id) AS notifications
     FROM incidents i WHERE i.site_id = ? ORDER BY i.started_at DESC LIMIT 30`, [id]);
  return { checks, incidents: incidents.map(i => ({ ...i, notifications: typeof i.notifications === 'string' ? JSON.parse(i.notifications) : i.notifications ?? [] })), nextBefore: checks.length === limit ? checks[checks.length - 1].id : null };
});
