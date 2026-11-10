import { api, readBody, idParam } from '@/lib/api';
import { submitArticleFeedback, getDocsFeedbackOverview } from '@/modules/docs/service';
import { requireGlobalPermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/docs/feedback
 * Master Admin: Review feedback stats and user comments.
 */
export const GET = api(async ({ user }) => {
  await requireGlobalPermission(user, 'docs.manage');
  const data = await getDocsFeedbackOverview();
  return data;
});

/**
 * POST /api/docs/feedback
 * Submit anonymous or authenticated feedback on an article.
 */
export const POST = api(async ({ req, user }) => {
  const b = await readBody(req);
  const articleId = idParam(String(b.articleId ?? ''), 'articleId');
  const isHelpful = Boolean(b.isHelpful);
  const comment = b.comment ? String(b.comment).trim() : null;

  await submitArticleFeedback(articleId, user.id, isHelpful, comment, user.role);

  return { ok: true };
});
