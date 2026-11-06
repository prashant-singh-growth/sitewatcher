import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { rows } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit, Actions } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { emailList, str } from '@/lib/validate';
import { parseSections, resolvePeriod } from '@/modules/reports/data';
import { createPdf, emailReport, fmtPeriod, saveReport } from '@/modules/reports/service';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST { projectId, siteId?, preset | from+to, sections?, title?, recipients, subject?, message? } */
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const projectId = idParam(String(b.projectId ?? ''), 'projectId');
  await requireProject(user, projectId, 'report.email');
  const recipients = emailList(b.recipients, 'Recipients');
  if (!recipients) throw new ApiError(400, 'Enter at least one recipient email address.');
  const siteId = b.siteId ? idParam(String(b.siteId), 'siteId') : null;
  if (siteId) { const ok = (await rows<any>('SELECT id FROM monitored_sites WHERE id = ? AND project_id = ? AND deleted_at IS NULL', [siteId, projectId]))[0]; if (!ok) throw new ApiError(404, 'Website not found.'); }
  const rl = await rateLimit(`reportmail:${user.id}`, 15, 3600);
  if (!rl.allowed) throw new ApiError(429, 'Email limit reached (15 per hour).');
  const { from, to } = resolvePeriod(b); const sections = parseSections(b.sections);
  const title = str(b.title, 'Title', { max: 200, optional: true }) || 'Website Performance Report';
  const { pdf, project, filename } = await createPdf({ projectId, siteId, from, to, sections, title, timezone: user.timezone });
  const id = await saveReport({ projectId, siteId, userId: user.id, title, from, to, sections, timezone: user.timezone });
  await emailReport({ reportId: id, pdf, filename, recipients, subject: str(b.subject, 'Subject', { max: 200, optional: true }) || `SiteWatch report: ${project.name} (${fmtPeriod(from, to)})`, message: str(b.message, 'Message', { max: 3000, optional: true }), projectName: project.name, period: fmtPeriod(from, to) });
  await audit({ user, action: Actions.reportEmailed, entityType: 'report', entityId: id, projectId, metadata: { recipients: recipients.split(', ').length, from, to }, ip });
  return { ok: true, id };
});
