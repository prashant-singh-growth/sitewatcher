import { api } from '@/lib/api';
import { hasGlobalPermission, projectIdsWithPermission } from '@/lib/rbac';
import { psiConfigured } from '@/modules/speedtest/psi';
import { smtpConfigured } from '@/lib/mailer';
export const dynamic = 'force-dynamic';
export const GET = api(async ({ user }) => {
  const act = await projectIdsWithPermission(user, 'activity.view');
  return {
    user: { id: user.id, name: user.displayName, email: user.email, role: user.role, timezone: user.timezone },
    can: { createProject: await hasGlobalPermission(user, 'project.create'), manageUsers: await hasGlobalPermission(user, 'user.manage'), manageSettings: await hasGlobalPermission(user, 'settings.manage'), viewActivity: act === null || act.length > 0 },
    features: { speedTest: psiConfigured(), email: smtpConfigured() }
  };
});
