import { api } from '@/lib/api';
import { rows } from '@/lib/db';
import { projectIdsWithPermission } from '@/lib/rbac';
import { listProjects } from '@/modules/projects/service';
export const dynamic = 'force-dynamic';

/** Role-aware landing data: super admins get platform totals; everyone gets only their own projects' incidents and speed tests. */
export const GET = api(async ({ user }) => {
  const projects = await listProjects(user);
  const ids = projects.map(p => Number(p.id));
  const inList = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const openIncidents = await rows<any>(
    `SELECT i.id, i.project_id, p.name AS project_name, s.id AS site_id, s.name AS site_name, s.url, i.started_at, i.last_error, i.failure_count
     FROM incidents i JOIN monitored_sites s ON s.id = i.site_id JOIN projects p ON p.id = i.project_id WHERE i.resolved_at IS NULL AND i.project_id IN (${inList}) ORDER BY i.started_at DESC LIMIT 20`, ids);
  const recentSpeed = await rows<any>(
    `SELECT a.id, a.site_id, s.name AS site_name, p.name AS project_name, a.device, a.status, a.performance_score, a.audited_at
     FROM pagespeed_audits a JOIN monitored_sites s ON s.id = a.site_id JOIN projects p ON p.id = a.project_id WHERE a.project_id IN (${inList}) ORDER BY a.id DESC LIMIT 6`, ids);
  const extra: Record<string, unknown> = {};
  if (user.role === 'super_admin') {
    const c = (await rows<any>(`SELECT (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) AS users, (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status='suspended') AS suspended,
      (SELECT COUNT(*) FROM projects WHERE status <> 'archived') AS projects, (SELECT COUNT(*) FROM monitored_sites WHERE deleted_at IS NULL) AS sites,
      (SELECT COUNT(*) FROM pagespeed_audits WHERE audited_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)) AS audits7d,
      (SELECT COUNT(*) FROM check_results WHERE checked_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)) AS checks24h`))[0];
    extra.platform = c;
    extra.cron = await rows<any>('SELECT id, started_at, duration_ms, due_count, checked, up_count, down_count, error FROM cron_execution_logs ORDER BY id DESC LIMIT 5');
    extra.activity = await rows<any>('SELECT a.id, a.user_name, a.action, a.entity_type, a.project_id, p.name AS project_name, a.created_at FROM activity_logs a LEFT JOIN projects p ON p.id = a.project_id ORDER BY a.id DESC LIMIT 10');
  } else {
    const scope = await projectIdsWithPermission(user, 'activity.view');
    if (scope && scope.length) extra.activity = await rows<any>(`SELECT a.id, a.user_name, a.action, a.entity_type, a.project_id, p.name AS project_name, a.created_at FROM activity_logs a LEFT JOIN projects p ON p.id = a.project_id WHERE a.project_id IN (${scope.map(() => '?').join(',')}) ORDER BY a.id DESC LIMIT 10`, scope);
  }
  return { projects, openIncidents, recentSpeed, ...extra };
});
