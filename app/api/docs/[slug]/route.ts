import { api, readBody } from '@/lib/api';
import { requireGlobalPermission } from '@/lib/rbac';
import { getArticleBySlug, updateDocArticle } from '@/modules/docs/service';
import { rows } from '@/lib/db';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function getUserPermissions(userRole: string): Promise<Set<string>> {
  const r = await rows<{ role: string; permission_code: string }>('SELECT role, permission_code FROM role_permissions WHERE role = ?', [userRole]).catch(() => []);
  return new Set(r.map(x => x.permission_code));
}

/**
 * GET /api/docs/[slug]
 * Retrieves article details with role gating and permission checks.
 */
export const GET = api(async ({ user, params }) => {
  const slug = (await params)?.slug;
  if (!slug) throw new Error('Article slug is required.');

  const perms = await getUserPermissions(user.role);
  const data = await getArticleBySlug(slug, user.role, perms);

  return data;
});

/**
 * PATCH /api/docs/[slug]
 * Master Admin: Edit article content, title, or visibility.
 */
export const PATCH = api(async ({ req, user, params, ip }) => {
  await requireGlobalPermission(user, 'docs.manage');
  const slug = (await params)?.slug;
  if (!slug) throw new Error('Article slug is required.');

  const b = await readBody(req);
  const existingRows = await rows<any>('SELECT id FROM doc_articles WHERE slug = ?', [slug]);
  const art = existingRows[0];
  if (!art) throw new Error('Article not found.');

  const updated = await updateDocArticle(art.id, {
    title: b.title,
    summary: b.summary,
    contentMd: b.contentMd,
    minRole: b.minRole,
    isPublished: b.isPublished,
    displayOrder: b.displayOrder
  });

  await audit({
    user,
    action: 'docs.article_updated',
    entityType: 'doc_article',
    entityId: art.id,
    metadata: { slug, title: b.title, minRole: b.minRole },
    ip
  });

  return { ok: true, article: updated };
});
