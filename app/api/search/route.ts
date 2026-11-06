import { api } from '@/lib/api';
import { rows } from '@/lib/db';
import { listProjects } from '@/modules/projects/service';
export const dynamic = 'force-dynamic';
export const GET = api(async ({ req, user }) => {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  if (q.length < 2) return { projects: [], sites: [] };
  const projects = (await listProjects(user)).filter(p => `${p.name} ${p.client_name ?? ''}`.toLowerCase().includes(q)).slice(0, 6).map(p => ({ id: p.id, name: p.name, client_name: p.client_name }));
  const ids = (await listProjects(user)).map(p => Number(p.id));
  if (!ids.length) return { projects, sites: [] };
  const like = `%${q.replace(/[%_\\]/g, '')}%`;
  const sites = await rows<any>(`SELECT s.id, s.name, s.url, s.project_id, p.name AS project_name FROM monitored_sites s JOIN projects p ON p.id = s.project_id
    WHERE s.deleted_at IS NULL AND s.project_id IN (${ids.map(() => '?').join(',')}) AND (LOWER(s.name) LIKE ? OR LOWER(s.url) LIKE ?) ORDER BY s.name LIMIT 8`, [...ids, like, like]);
  return { projects, sites };
});
