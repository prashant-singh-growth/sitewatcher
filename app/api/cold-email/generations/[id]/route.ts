import { api, idParam } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { requireGlobalPermission } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { getColdEmailGeneration, deleteColdEmailGeneration } from '@/modules/cold-email/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cold-email/generations/[id]
 * Retrieves a single cold email generation for the user.
 */
export const GET = api(async ({ user, params }) => {
  await requireGlobalPermission(user, 'cold_email.use');
  const id = idParam((await params)?.id, 'generationId');

  const generation = await getColdEmailGeneration(user.id, id);
  if (!generation) {
    throw new ApiError(404, 'Cold email generation not found or expired.');
  }

  return { ok: true, generation };
});

/**
 * DELETE /api/cold-email/generations/[id]
 * Deletes a single cold email generation.
 */
export const DELETE = api(async ({ user, params, ip }) => {
  await requireGlobalPermission(user, 'cold_email.use');
  const id = idParam((await params)?.id, 'generationId');

  const success = await deleteColdEmailGeneration(user.id, id);
  if (!success) {
    throw new ApiError(404, 'Cold email generation not found or already deleted.');
  }

  await audit({
    user,
    action: 'cold_email.deleted',
    entityType: 'user',
    entityId: user.id,
    metadata: { generationId: id },
    ip
  });

  return { ok: true, id };
});
