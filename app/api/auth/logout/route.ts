import { api } from '@/lib/api';
import { destroySession } from '@/lib/auth';
import { audit, Actions } from '@/lib/audit';
export const POST = api(async ({ user, ip }) => {
  await destroySession();
  await audit({ user, action: Actions.logout, entityType: 'user', entityId: user.id, ip });
  return { ok: true };
});
