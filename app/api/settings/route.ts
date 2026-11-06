import { api, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { requireGlobalPermission } from '@/lib/rbac';
import { getAllSettings, setSetting } from '@/lib/settings';
import { audit, Actions } from '@/lib/audit';
import { int } from '@/lib/validate';
import { psiConfigured } from '@/modules/speedtest/psi';
import { smtpConfigured } from '@/lib/mailer';
export const dynamic = 'force-dynamic';
const LIMITS: Record<string, { min: number; max: number; label: string }> = {
  'monitor.max_concurrency': { min: 1, max: 20, label: 'Concurrent checks per run' },
  'monitor.max_sites_per_run': { min: 1, max: 200, label: 'Maximum sites per run' },
  'monitor.min_interval_minutes': { min: 1, max: 60, label: 'Minimum allowed interval (minutes)' },
  'monitor.stale_claim_minutes': { min: 2, max: 60, label: 'Recover stuck checks after (minutes)' },
  'monitor.run_budget_seconds': { min: 20, max: 100, label: 'Time budget per cron run (seconds)' },
  'session.days': { min: 1, max: 30, label: 'Session length (days)' }
};
export const GET = api(async ({ user }) => {
  await requireGlobalPermission(user, 'settings.manage');
  const all = await getAllSettings();
  return { settings: Object.entries(LIMITS).map(([key, l]) => ({ key, ...l, value: Number(all[key]) })), integrations: { pagespeedKey: psiConfigured(), smtp: smtpConfigured(), cronSecret: Boolean(process.env.CRON_SECRET) } };
});
export const PATCH = api(async ({ req, user, ip }) => {
  await requireGlobalPermission(user, 'settings.manage');
  const b = await readBody(req); const changed: Record<string, number> = {};
  for (const [k, v] of Object.entries(b)) {
    const l = LIMITS[k]; if (!l) throw new ApiError(400, `Unknown setting "${k}".`);
    changed[k] = int(v, l.label, { min: l.min, max: l.max }); await setSetting(k, String(changed[k]), user.id);
  }
  if (Object.keys(changed).length) await audit({ user, action: Actions.settingsChanged, entityType: 'settings', metadata: changed, ip });
  return { ok: true };
});
