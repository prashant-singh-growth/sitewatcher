import { api, idParam, readBody } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { db, rows, parseJson } from '@/lib/db';
import { requireProject } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { emailList, int, isoDate, oneOf, str } from '@/lib/validate';
import { parseSections } from '@/modules/reports/data';
import { nextRunAfter } from '@/modules/reports/service';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ req, user }) => {
  const projectId = idParam(req.nextUrl.searchParams.get('projectId') ?? undefined, 'projectId');
  await requireProject(user, projectId, 'report.view');
  const list = await rows<any>('SELECT s.*, st.name AS site_name FROM report_schedules s LEFT JOIN monitored_sites st ON st.id = s.site_id WHERE s.project_id = ? ORDER BY s.is_active DESC, s.next_run_at', [projectId]);
  return { schedules: list.map(s => ({ ...s, sections: parseJson(s.sections, []) })) };
});
export const POST = api(async ({ req, user, ip }) => {
  const b = await readBody(req);
  const projectId = idParam(String(b.projectId ?? ''), 'projectId');
  await requireProject(user, projectId, 'report.schedule', { write: true });
  const frequency = oneOf(b.frequency, 'Frequency', ['daily', 'weekly', 'monthly', 'custom'] as const);
  const everyDays = frequency === 'custom' ? int(b.every_days, 'Repeat every (days)', { min: 1, max: 365 }) : null;
  const periodDays = b.period_days ? int(b.period_days, 'Report period (days)', { min: 1, max: 366 }) : ({ daily: 1, weekly: 7, monthly: 30, custom: everyDays ?? 7 } as const)[frequency];
  const recipients = emailList(b.recipients, 'Recipients'); if (!recipients) throw new ApiError(400, 'Enter at least one recipient email address.');
  const siteId = b.siteId ? idParam(String(b.siteId), 'siteId') : null;
  if (siteId && !(await rows<any>('SELECT id FROM monitored_sites WHERE id = ? AND project_id = ? AND deleted_at IS NULL', [siteId, projectId]))[0]) throw new ApiError(404, 'Website not found.');
  const next = b.start_at ? isoDate(b.start_at, 'First send') : nextRunAfter(frequency, everyDays);
  const name = str(b.name, 'Name', { max: 160 })!;
  const [r] = await db.query<any>('INSERT INTO report_schedules (project_id, site_id, created_by, name, frequency, every_days, period_days, sections, recipients, subject, message, timezone, next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [projectId, siteId, user.id, name, frequency, everyDays, periodDays, JSON.stringify(parseSections(b.sections)), recipients, str(b.subject, 'Subject', { max: 200, optional: true }), str(b.message, 'Message', { max: 3000, optional: true }), user.timezone, next]);
  await audit({ user, action: 'report.schedule_created', entityType: 'report_schedule', entityId: r.insertId, projectId, metadata: { name, frequency, recipients: recipients.split(', ').length }, ip });
  return Response.json({ ok: true, id: Number(r.insertId), next_run_at: next }, { status: 201 });
});
