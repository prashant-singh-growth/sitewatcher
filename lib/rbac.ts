import { rows } from './db';
import { ApiError } from './errors';
import type { GlobalRole, SessionUser } from './auth';

export type ProjectRole = 'manager' | 'member';
export type EffectiveRole = 'super_admin' | ProjectRole;

/** Permission codes. Seeded into role_permissions by migration 001; defaults here are the fallback if the table is empty. */
export const ALL_PERMISSIONS = [
  'project.create', 'project.view', 'project.update', 'project.archive', 'project.members.manage',
  'site.view', 'site.create', 'site.update', 'site.delete', 'site.configure',
  'speedtest.view', 'speedtest.run', 'speedtest.schedule',
  'sitemap.view', 'sitemap.manage',
  'robots.view', 'robots.manage',
  'indexability.view', 'indexability.manage',
  'report.view', 'report.generate', 'report.email', 'report.schedule',
  'activity.view', 'user.manage', 'settings.manage', 'platform.view_all'
] as const;
export type Permission = typeof ALL_PERMISSIONS[number];

const MEMBER: Permission[] = ['project.view', 'site.view', 'speedtest.view', 'speedtest.run', 'sitemap.view', 'robots.view', 'indexability.view', 'report.view', 'report.generate'];
const DEFAULTS: Record<EffectiveRole, Set<string>> = {
  super_admin: new Set(ALL_PERMISSIONS),
  manager: new Set(ALL_PERMISSIONS.filter(p => !['user.manage', 'settings.manage', 'platform.view_all'].includes(p))),
  member: new Set(MEMBER)
};

let cache: { at: number; map: Map<string, Set<string>> } | null = null;
async function rolePerms(role: EffectiveRole): Promise<Set<string>> {
  if (!cache || Date.now() - cache.at > 60_000) {
    const r = await rows<{ role: string; permission_code: string }>('SELECT role, permission_code FROM role_permissions').catch(() => []);
    const map = new Map<string, Set<string>>();
    for (const x of r) { if (!map.has(x.role)) map.set(x.role, new Set()); map.get(x.role)!.add(x.permission_code); }
    cache = { at: Date.now(), map };
  }
  return cache.map.get(role) ?? DEFAULTS[role];
}

/** Platform-wide permission, decided by the user's global role (e.g. project.create, user.manage). */
export async function hasGlobalPermission(user: Pick<SessionUser, 'role'>, perm: Permission) {
  return (await rolePerms(user.role as GlobalRole)).has(perm);
}
export async function requireGlobalPermission(user: SessionUser, perm: Permission) {
  if (!(await hasGlobalPermission(user, perm))) throw new ApiError(403, 'You do not have permission to do that.');
}

export type ProjectAccess = { projectId: number; role: EffectiveRole; status: 'active' | 'paused' | 'archived'; perms: Set<string> };

/** Returns null when the project does not exist OR the user is not a member (callers answer 404 either way, so IDs cannot be probed). */
export async function getProjectAccess(user: SessionUser, projectId: number): Promise<ProjectAccess | null> {
  if (user.role === 'super_admin') {
    const r = await rows<any>('SELECT id, status FROM projects WHERE id = ?', [projectId]);
    return r[0] ? { projectId, role: 'super_admin', status: r[0].status, perms: await rolePerms('super_admin') } : null;
  }
  const r = await rows<any>('SELECT p.status, pm.role FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.project_id = ? AND pm.user_id = ?', [projectId, user.id]);
  return r[0] ? { projectId, role: r[0].role, status: r[0].status, perms: await rolePerms(r[0].role) } : null;
}

/** Asserts membership + a permission. `write: true` additionally blocks changes to archived projects (except for super admins). */
export async function requireProject(user: SessionUser, projectId: number, perm: Permission, opts: { write?: boolean } = {}) {
  const access = await getProjectAccess(user, projectId);
  if (!access) throw new ApiError(404, 'Project not found.');
  if (!access.perms.has(perm)) throw new ApiError(403, 'You do not have permission to do that in this project.');
  if (opts.write && access.status === 'archived' && access.role !== 'super_admin') throw new ApiError(409, 'This project is archived and read-only.');
  return access;
}

/** Project ids where the user holds `perm` (used to scope list endpoints such as activity logs). null = every project. */
export async function projectIdsWithPermission(user: SessionUser, perm: Permission): Promise<number[] | null> {
  if (user.role === 'super_admin') return null;
  const r = await rows<{ project_id: number; role: ProjectRole }>('SELECT project_id, role FROM project_members WHERE user_id = ?', [user.id]);
  const ids: number[] = [];
  for (const m of r) if ((await rolePerms(m.role)).has(perm)) ids.push(Number(m.project_id));
  return ids;
}

/** Load a website and verify the caller may act on it. Cross-project IDs are indistinguishable from missing ones. */
export async function requireSite(user: SessionUser, siteId: number, perm: Permission, opts: { write?: boolean } = {}) {
  const r = await rows<any>('SELECT * FROM monitored_sites WHERE id = ? AND deleted_at IS NULL', [siteId]);
  const site = r[0];
  if (!site) throw new ApiError(404, 'Website not found.');
  const access = await requireProject(user, Number(site.project_id), perm, opts).catch(e => { if (e instanceof ApiError && e.status === 404) throw new ApiError(404, 'Website not found.'); throw e; });
  return { site, access };
}
