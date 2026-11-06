import { rows } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';

/** Projects visible to the user, with live health aggregates taken from the denormalised last_* columns (no per-row subqueries on check_results). */
export async function listProjects(user: SessionUser) {
  const scope = user.role === 'super_admin'
    ? { join: '', where: '1=1', params: [] as unknown[], role: "'super_admin'" }
    : { join: 'JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?', where: '1=1', params: [user.id], role: 'pm.role' };
  return rows<any>(
    `SELECT p.id, p.name, p.slug, p.description, p.client_name, p.logo_url, p.primary_domain, p.status, p.created_at, p.updated_at, ${scope.role} AS my_role,
       (SELECT COUNT(*) FROM monitored_sites s WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS site_count,
       (SELECT COUNT(*) FROM monitored_sites s WHERE s.project_id = p.id AND s.deleted_at IS NULL AND s.is_active = 1 AND s.last_is_up = 1) AS up_count,
       (SELECT COUNT(*) FROM monitored_sites s WHERE s.project_id = p.id AND s.deleted_at IS NULL AND s.is_active = 1 AND s.last_is_up = 0) AS down_count,
       (SELECT COUNT(*) FROM incidents i WHERE i.project_id = p.id AND i.resolved_at IS NULL) AS open_incidents,
       (SELECT ROUND(AVG(s.last_response_ms)) FROM monitored_sites s WHERE s.project_id = p.id AND s.deleted_at IS NULL AND s.last_is_up = 1) AS avg_response_ms,
       (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count
     FROM projects p ${scope.join} WHERE ${scope.where} ORDER BY p.status = 'archived', p.name ASC`, scope.params);
}
