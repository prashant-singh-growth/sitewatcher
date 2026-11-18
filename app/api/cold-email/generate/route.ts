import { api, readBody } from '@/lib/api';
import { requireGlobalPermission } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { generateColdEmail } from '@/modules/cold-email/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * POST /api/cold-email/generate
 * Body: ColdEmailInputs
 * Generates personalized cold emails, subject lines, and follow-ups.
 */
export const POST = api(async ({ req, user, ip }) => {
  await requireGlobalPermission(user, 'cold_email.use');
  const body = await readBody(req);

  const generation = await generateColdEmail(user.id, body);

  await audit({
    user,
    action: 'cold_email.generated',
    entityType: 'user',
    entityId: user.id,
    metadata: {
      generationId: generation.id,
      companyName: generation.inputs.companyName || null,
      modelUsed: generation.modelUsed
    },
    ip
  });

  return { ok: true, generation };
});
