import { db, rows } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { DOC_CATEGORIES, DOC_ARTICLES, canRoleAccess, type DocCategorySeed, type DocArticleSeed } from './articles-data';

export { canRoleAccess };

/**
 * Automatically seeds initial categories and articles if the tables are empty.
 */
export async function ensureDocsSeeded(): Promise<void> {
  const catCount = await rows<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM doc_categories');
  if (catCount[0]?.cnt === 0) {
    for (const cat of DOC_CATEGORIES) {
      await db.query(
        `INSERT INTO doc_categories (slug, title, description, icon, display_order, min_role)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`,
        [cat.slug, cat.title, cat.description, cat.icon, cat.displayOrder, cat.minRole]
      );
    }
  }

  const artCount = await rows<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM doc_articles');
  if (artCount[0]?.cnt === 0) {
    const cats = await rows<{ id: number; slug: string }>('SELECT id, slug FROM doc_categories');
    const catMap = new Map<string, number>(cats.map(c => [c.slug, c.id]));

    for (const art of DOC_ARTICLES) {
      const catId = catMap.get(art.categorySlug);
      if (!catId) continue;

      await db.query(
        `INSERT INTO doc_articles (
           category_id, slug, title, summary, content_md, min_role,
           required_permission, display_order, read_time_minutes, related_slugs
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           summary = VALUES(summary),
           content_md = VALUES(content_md),
           min_role = VALUES(min_role)`,
        [
          catId,
          art.slug,
          art.title,
          art.summary,
          art.contentMd,
          art.minRole,
          art.requiredPermission ?? null,
          art.displayOrder,
          art.readTimeMinutes,
          JSON.stringify(art.relatedSlugs)
        ]
      );
    }
  }
}

export type CategoryWithArticles = {
  id: number;
  slug: string;
  title: string;
  description: string;
  icon: string;
  display_order: number;
  min_role: string;
  articles: Array<{
    id: number;
    slug: string;
    title: string;
    summary: string;
    min_role: string;
    read_time_minutes: number;
    display_order: number;
  }>;
};

/**
 * Returns categories and their articles filtered strictly by the user's role and permissions.
 */
export async function getDocsCatalog(
  userRole: string,
  userPerms: Set<string>
): Promise<CategoryWithArticles[]> {
  await ensureDocsSeeded();

  const allCats = await rows<any>(
    'SELECT * FROM doc_categories WHERE is_published = 1 ORDER BY display_order ASC, id ASC'
  );

  const allArticles = await rows<any>(
    'SELECT id, category_id, slug, title, summary, min_role, required_permission, read_time_minutes, display_order, is_published FROM doc_articles WHERE is_published = 1 ORDER BY display_order ASC, id ASC'
  );

  const result: CategoryWithArticles[] = [];

  for (const cat of allCats) {
    if (!canRoleAccess(userRole, cat.min_role)) {
      continue;
    }

    const catArticles = allArticles
      .filter((a: any) => a.category_id === cat.id)
      .filter((a: any) => canRoleAccess(userRole, a.min_role))
      .filter((a: any) => !a.required_permission || userPerms.has(a.required_permission))
      .map((a: any) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        min_role: a.min_role,
        read_time_minutes: a.read_time_minutes,
        display_order: a.display_order
      }));

    if (catArticles.length > 0) {
      result.push({
        id: cat.id,
        slug: cat.slug,
        title: cat.title,
        description: cat.description,
        icon: cat.icon,
        display_order: cat.display_order,
        min_role: cat.min_role,
        articles: catArticles
      });
    }
  }

  return result;
}

/**
 * Retrieves a single article with security enforcement.
 */
export async function getArticleBySlug(
  slug: string,
  userRole: string,
  userPerms: Set<string>
) {
  await ensureDocsSeeded();

  const articleRows = await rows<any>(
    `SELECT a.*, c.title AS category_title, c.slug AS category_slug, c.icon AS category_icon, c.min_role AS category_min_role
     FROM doc_articles a
     JOIN doc_categories c ON c.id = a.category_id
     WHERE a.slug = ? AND a.is_published = 1 AND c.is_published = 1`,
    [slug]
  );

  const art = articleRows[0];
  if (!art) {
    throw new ApiError(404, 'Documentation article not found.');
  }

  // Permission checks
  if (!canRoleAccess(userRole, art.category_min_role) || !canRoleAccess(userRole, art.min_role)) {
    throw new ApiError(403, 'You do not have permission to view this documentation article.');
  }

  if (art.required_permission && !userPerms.has(art.required_permission)) {
    throw new ApiError(403, 'You do not have the required permission to view this article.');
  }

  // Related articles
  let relatedSlugs: string[] = [];
  try {
    relatedSlugs = typeof art.related_slugs === 'string' ? JSON.parse(art.related_slugs) : (art.related_slugs || []);
  } catch {
    relatedSlugs = [];
  }

  let relatedArticles: any[] = [];
  if (relatedSlugs.length > 0) {
    const placeholders = relatedSlugs.map(() => '?').join(',');
    const relRows = await rows<any>(
      `SELECT slug, title, summary, min_role, read_time_minutes
       FROM doc_articles
       WHERE slug IN (${placeholders}) AND is_published = 1`,
      relatedSlugs
    );

    relatedArticles = relRows.filter(
      r => canRoleAccess(userRole, r.min_role) && (!r.required_permission || userPerms.has(r.required_permission))
    );
  }

  // Feedback summary
  const feedbackRows = await rows<any>(
    `SELECT
       SUM(CASE WHEN is_helpful = 1 THEN 1 ELSE 0 END) AS helpful_count,
       SUM(CASE WHEN is_helpful = 0 THEN 1 ELSE 0 END) AS unhelpful_count
     FROM doc_feedback
     WHERE article_id = ?`,
    [art.id]
  );

  const helpfulCount = Number(feedbackRows[0]?.helpful_count || 0);
  const unhelpfulCount = Number(feedbackRows[0]?.unhelpful_count || 0);

  return {
    article: {
      ...art,
      helpful_count: helpfulCount,
      unhelpful_count: unhelpfulCount
    },
    relatedArticles
  };
}

/**
 * Searches documentation content, filtering results by user permissions.
 */
export async function searchDocs(
  query: string,
  userRole: string,
  userPerms: Set<string>
) {
  if (!query || query.trim().length < 2) {
    return [];
  }

  await ensureDocsSeeded();
  const q = `%${query.trim()}%`;

  const articles = await rows<any>(
    `SELECT a.id, a.slug, a.title, a.summary, a.min_role, a.required_permission, a.read_time_minutes,
            c.title AS category_title, c.slug AS category_slug, c.min_role AS category_min_role
     FROM doc_articles a
     JOIN doc_categories c ON c.id = a.category_id
     WHERE a.is_published = 1 AND c.is_published = 1
       AND (a.title LIKE ? OR a.summary LIKE ? OR a.content_md LIKE ?)
     ORDER BY (a.title LIKE ?) DESC, a.display_order ASC
     LIMIT 20`,
    [q, q, q, q]
  );

  return articles.filter(
    a =>
      canRoleAccess(userRole, a.category_min_role) &&
      canRoleAccess(userRole, a.min_role) &&
      (!a.required_permission || userPerms.has(a.required_permission))
  );
}

/**
 * Saves user feedback on an article.
 */
export async function submitArticleFeedback(
  articleId: number,
  userId: number | null,
  isHelpful: boolean,
  comment?: string | null,
  userRole?: string
): Promise<void> {
  await db.query(
    `INSERT INTO doc_feedback (article_id, user_id, is_helpful, comment, user_role, created_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [articleId, userId, isHelpful ? 1 : 0, comment ? comment.slice(0, 1000) : null, userRole || 'member']
  );
}

/**
 * Master Admin: Updates article metadata or markdown content.
 */
export async function updateDocArticle(
  articleId: number,
  data: {
    title?: string;
    summary?: string;
    contentMd?: string;
    minRole?: 'member' | 'manager' | 'super_admin';
    isPublished?: boolean;
    displayOrder?: number;
  }
) {
  const updates: string[] = [];
  const vals: any[] = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    vals.push(data.title.slice(0, 160));
  }
  if (data.summary !== undefined) {
    updates.push('summary = ?');
    vals.push(data.summary.slice(0, 300));
  }
  if (data.contentMd !== undefined) {
    updates.push('content_md = ?');
    vals.push(data.contentMd);
  }
  if (data.minRole !== undefined) {
    updates.push('min_role = ?');
    vals.push(data.minRole);
  }
  if (data.isPublished !== undefined) {
    updates.push('is_published = ?');
    vals.push(data.isPublished ? 1 : 0);
  }
  if (data.displayOrder !== undefined) {
    updates.push('display_order = ?');
    vals.push(Number(data.displayOrder));
  }

  if (updates.length > 0) {
    vals.push(articleId);
    await db.query(
      `UPDATE doc_articles SET ${updates.join(', ')}, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      vals
    );
  }

  return (await rows<any>('SELECT * FROM doc_articles WHERE id = ?', [articleId]))[0];
}

/**
 * Master Admin: Fetches feedback statistics and comments.
 */
export async function getDocsFeedbackOverview() {
  const summary = (
    await rows<any>(
      `SELECT
         COUNT(*) AS total_feedbacks,
         SUM(CASE WHEN is_helpful = 1 THEN 1 ELSE 0 END) AS helpful_total,
         SUM(CASE WHEN is_helpful = 0 THEN 1 ELSE 0 END) AS unhelpful_total
       FROM doc_feedback`
    )
  )[0];

  const recentComments = await rows<any>(
    `SELECT f.*, a.title AS article_title, a.slug AS article_slug, u.display_name AS user_name, u.email AS user_email
     FROM doc_feedback f
     JOIN doc_articles a ON a.id = f.article_id
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.comment IS NOT NULL AND f.comment <> ''
     ORDER BY f.created_at DESC
     LIMIT 30`
  );

  return {
    summary: {
      total: Number(summary?.total_feedbacks || 0),
      helpful: Number(summary?.helpful_total || 0),
      unhelpful: Number(summary?.unhelpful_total || 0),
      satisfactionPct:
        summary?.total_feedbacks > 0
          ? Math.round((Number(summary.helpful_total) / Number(summary.total_feedbacks)) * 100)
          : 100
    },
    recentComments
  };
}
