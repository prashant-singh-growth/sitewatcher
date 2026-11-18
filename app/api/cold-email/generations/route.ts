import { api } from '@/lib/api';
import { requireGlobalPermission } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { listColdEmailGenerations, clearAllColdEmailGenerations } from '@/modules/cold-email/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cold-email/generations?page=1&limit=10
 * Returns the authenticated user's recent non-expired generations.
 */
export const GET = api(async ({ req, user }) => {
  await requireGlobalPermission(user, 'cold_email.use');
  const q = req.nextUrl.searchParams;
  const page = Number(q.get('page')) || 1;
  const limit = Number(q.get('limit')) || 10;

  const data = await listColdEmailGenerations(user.id, page, limit);
  return data;
});

/**
 * DELETE /api/cold-email/generations
 * Clears all cold email history for the authenticated user.
 */
export const DELETE = api(async ({ user, ip }) => {
  await requireGlobalPermission(user, 'cold_email.use');
  const clearedCount = await clearAllColdEmailGenerations(user.id);

  await audit({
    user,
    action: 'cold_email.cleared_all',
    entityType: 'user',
    entityId: user.id,
    metadata: { clearedCount },
    ip
  });

  return { ok: true, clearedCount };
});
