import { api, idParam } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows, parseJson } from '@/lib/db';
import { projectIdsWithPermission } from '@/lib/rbac';
import { isoDate } from '@/lib/validate';
export const dynamic = 'force-dynamic';

/** Super Admin: platform-wide. Managers: only projects they manage. Members: no access. Logs are read-only through the API. */
export const GET = api(async ({ req, user }) => {
  const scope = await projectIdsWithPermission(user, 'activity.view');
  if (scope && scope.length === 0) throw new ApiError(403, 'You do not have access to activity logs.');
  const q = req.nextUrl.searchParams;
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope) { where.push(`a.project_id IN (${scope.map(() => '?').join(',')})`); args.push(...scope); }
  if (q.get('userId')) { where.push('a.user_id = ?'); args.push(idParam(q.get('userId') ?? undefined, 'userId')); }
  if (q.get('projectId')) { const pid = idParam(q.get('projectId') ?? undefined, 'projectId'); if (scope && !scope.includes(pid)) throw new ApiError(404, 'Project not found.'); where.push('a.project_id = ?'); args.push(pid); }
  if (q.get('action')) { where.push('a.action LIKE ?'); args.push(`${String(q.get('action')).replace(/[%_\\]/g, '')}%`); }
  if (q.get('from')) { where.push('a.created_at >= ?'); args.push(isoDate(q.get('from'), 'from')); }
  if (q.get('to')) { where.push('a.created_at <= ?'); args.push(isoDate(q.get('to'), 'to')); }
  if (q.get('before')) { where.push('a.id < ?'); args.push(idParam(q.get('before') ?? undefined, 'before')); }
  const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));
  const logs = await rows<any>(`SELECT a.id, a.user_id, a.user_name, a.action, a.entity_type, a.entity_id, a.project_id, p.name AS project_name, a.metadata, a.ip_address, a.created_at
    FROM activity_logs a LEFT JOIN projects p ON p.id = a.project_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`, [...args, limit]);
  // Managers do not see client IP addresses of other users.
  return { logs: logs.map(l => ({ ...l, metadata: parseJson(l.metadata, null), ip_address: user.role === 'super_admin' ? l.ip_address : null })), nextBefore: logs.length === limit ? logs[logs.length - 1].id : null };
});
