import { api, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows, tx } from '@/lib/db';
import { requireGlobalPermission } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { httpUrlOrNull, oneOf, slugify, str } from '@/lib/validate';
import { listProjects } from '@/modules/projects/service';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user }) => ({ projects: await listProjects(user) }));

export const POST = api(async ({ req, user, ip }) => {
  await requireGlobalPermission(user, 'project.create');
  const b = await readBody(req);
  const name = str(b.name, 'Project name', { max: 160 })!;
  let slug = slugify(str(b.slug, 'Slug', { max: 70, optional: true }) || name);
  const taken = new Set((await rows<any>('SELECT slug FROM projects WHERE slug = ? OR slug LIKE ?', [slug, `${slug}-%`])).map(r => r.slug));
  if (b.slug && taken.has(slug)) throw new ApiError(409, 'That project slug is already in use.');
  for (let i = 2; taken.has(slug); i++) slug = `${slugify(name)}-${i}`;
  const status = b.status ? oneOf(b.status, 'Status', ['active', 'paused'] as const) : 'active';
  const id = await tx(async conn => {
    const [r] = await conn.query<any>(
      'INSERT INTO projects (name, slug, description, client_name, logo_url, primary_domain, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, slug, str(b.description, 'Description', { max: 5000, optional: true }), str(b.client_name, 'Client name', { max: 160, optional: true }),
       httpUrlOrNull(b.logo_url, 'Logo URL'), str(b.primary_domain, 'Primary domain', { max: 253, optional: true }), status, user.id, user.id]);
    await conn.query('INSERT INTO project_settings (project_id) VALUES (?)', [r.insertId]);
    if (user.role !== 'super_admin') await conn.query("INSERT INTO project_members (project_id, user_id, role, added_by) VALUES (?, ?, 'manager', ?)", [r.insertId, user.id, user.id]);
    await audit({ user, action: Actions.projectCreated, entityType: 'project', entityId: r.insertId, projectId: r.insertId, metadata: { name, slug }, ip }, conn);
    return Number(r.insertId);
  });
  return Response.json({ ok: true, id, slug }, { status: 201 });
});
