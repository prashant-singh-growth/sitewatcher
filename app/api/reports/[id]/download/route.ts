import { api, idParam } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows, parseJson } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { createPdf } from '@/modules/reports/service';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Re-renders a saved report from its stored parameters, after re-checking the caller's project access. */
export const GET = api(async ({ user, params }) => {
  const r = (await rows<any>('SELECT * FROM reports WHERE id = ?', [idParam(params.id, 'report ID')]))[0];
  if (!r) throw new ApiError(404, 'Report not found.');
  await requireProject(user, Number(r.project_id), 'report.view').catch(() => { throw new ApiError(404, 'Report not found.'); });
  const { pdf, filename } = await createPdf({ projectId: r.project_id, siteId: r.site_id, from: new Date(r.period_from), to: new Date(r.period_to), sections: parseJson(r.sections, []), title: r.title, timezone: user.timezone });
  return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' } });
});
