import { api, idParam } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { shapeAudit } from '@/modules/speedtest/service';
export const dynamic = 'force-dynamic';
export const GET = api(async ({ user, params }) => {
  const a = (await rows<any>('SELECT a.*, s.name AS site_name FROM pagespeed_audits a JOIN monitored_sites s ON s.id = a.site_id WHERE a.id = ?', [idParam(params.id, 'audit ID')]))[0];
  if (!a) throw new ApiError(404, 'Audit not found.');
  await requireProject(user, Number(a.project_id), 'speedtest.view').catch(() => { throw new ApiError(404, 'Audit not found.'); });
  return { audit: shapeAudit(a) };
});
