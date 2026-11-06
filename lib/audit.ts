import type { PoolConnection } from 'mysql2/promise';
import { db, parseJson, rows } from './db';

export const Actions = {
  login: 'auth.login', loginFailed: 'auth.login_failed', logout: 'auth.logout',
  projectCreated: 'project.created', projectUpdated: 'project.updated', projectArchived: 'project.archived',
  memberAdded: 'project.member_added', memberChanged: 'project.member_changed', memberRemoved: 'project.member_removed',
  siteAdded: 'site.added', siteUpdated: 'site.updated', siteDeleted: 'site.deleted',
  monitoringChanged: 'site.monitoring_changed', monitoringPaused: 'site.monitoring_paused', monitoringResumed: 'site.monitoring_resumed',
  speedTestRun: 'speedtest.run', reportGenerated: 'report.generated', reportEmailed: 'report.emailed',
  userCreated: 'user.created', userUpdated: 'user.updated', userPermissionsChanged: 'user.role_changed',
  userSuspended: 'user.suspended', userActivated: 'user.activated', userDeleted: 'user.deleted', passwordReset: 'user.password_reset',
  settingsChanged: 'settings.changed'
} as const;

export type AuditEvent = {
  user?: { id: number; displayName: string } | null; userName?: string;
  action: string; entityType?: string; entityId?: number | string | null; projectId?: number | null;
  metadata?: Record<string, unknown>; ip?: string;
};
/** Audit failures must never break the user's action unless the caller is inside a transaction (then pass `conn`). */
export async function audit(e: AuditEvent, conn?: PoolConnection) {
  const run = () => (conn ?? db).query(
    'INSERT INTO activity_logs (user_id, user_name, action, entity_type, entity_id, project_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [e.user?.id ?? null, (e.user?.displayName ?? e.userName ?? null)?.slice(0, 120) ?? null, e.action, e.entityType ?? null, e.entityId != null ? String(e.entityId) : null, e.projectId ?? null, e.metadata ? JSON.stringify(e.metadata) : null, e.ip?.slice(0, 45) ?? null]);
  if (conn) { await run(); return; }
  try { await run(); } catch (err) { console.error('[SiteWatch] audit log failed:', err); }
}
/** Compare two objects and return only fields that changed ({from,to}). */
export function diff(before: Record<string, any>, after: Record<string, any>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) if (after[k] !== undefined && String(before[k] ?? null) !== String(after[k] ?? null)) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  return out;
}
export { parseJson, rows };
