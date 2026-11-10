import { api } from '@/lib/api';
import { getDocsCatalog, searchDocs } from '@/modules/docs/service';
import { rows } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function getUserPermissions(userRole: string): Promise<Set<string>> {
  const r = await rows<{ role: string; permission_code: string }>('SELECT role, permission_code FROM role_permissions WHERE role = ?', [userRole]).catch(() => []);
  return new Set(r.map(x => x.permission_code));
}

/**
 * GET /api/docs?search=
 * Returns catalog of accessible categories & articles, or search results.
 */
export const GET = api(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const search = q.get('search')?.trim();
  const perms = await getUserPermissions(user.role);

  if (search) {
    const results = await searchDocs(search, user.role, perms);
    return { results };
  }

  const categories = await getDocsCatalog(user.role, perms);
  return { categories };
});
