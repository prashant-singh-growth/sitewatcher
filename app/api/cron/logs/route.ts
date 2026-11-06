import { api } from '@/lib/api';
import { rows } from '@/lib/db';
import { requireGlobalPermission } from '@/lib/rbac';
export const dynamic = 'force-dynamic';
export const GET = api(async ({ user }) => {
  await requireGlobalPermission(user, 'platform.view_all');
  const logs = await rows<any>('SELECT * FROM cron_execution_logs ORDER BY id DESC LIMIT 50');
  const due = (await rows<any>("SELECT COUNT(*) AS c FROM monitored_sites WHERE deleted_at IS NULL AND is_active = 1 AND next_run_at <= UTC_TIMESTAMP(3)"))[0].c;
  return { logs, dueNow: Number(due), lastRunAt: logs[0]?.started_at ?? null };
});
