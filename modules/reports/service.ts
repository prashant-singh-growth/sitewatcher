import { randomBytes } from 'node:crypto';
import { db, rows, parseJson } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { sendMail, smtpConfigured } from '@/lib/mailer';
import { buildReportData, type Section } from './data';
import { fetchLogo, renderPdf } from './pdf';

export const fmtPeriod = (f: Date, t: Date) => `${f.toISOString().slice(0, 10)} to ${t.toISOString().slice(0, 10)}`;
const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';

export async function createPdf(p: { projectId: number; siteId: number | null; from: Date; to: Date; sections: Section[]; title: string; timezone: string }) {
  const data = await buildReportData(p.projectId, p.siteId, p.from, p.to);
  const logo = data.project.logo_url ? await fetchLogo(data.project.logo_url) : null;
  const pdf = await renderPdf(data, { title: p.title, sections: p.sections, timezone: p.timezone, logo });
  return { pdf, project: data.project, filename: `${slugName(data.project.name)}-${p.from.toISOString().slice(0, 10)}-${p.to.toISOString().slice(0, 10)}.pdf` };
}
export async function saveReport(p: { projectId: number; siteId: number | null; userId: number | null; scheduleId?: number | null; title: string; from: Date; to: Date; sections: Section[]; timezone: string }) {
  const [r] = await db.query<any>('INSERT INTO reports (project_id, site_id, created_by, schedule_id, title, period_from, period_to, sections, timezone) VALUES (?,?,?,?,?,?,?,?,?)',
    [p.projectId, p.siteId, p.userId, p.scheduleId ?? null, p.title, p.from, p.to, JSON.stringify(p.sections), p.timezone]);
  return Number(r.insertId);
}
export async function emailReport(p: { reportId: number; pdf: Buffer; filename: string; recipients: string; subject: string; message: string | null; projectName: string; period: string }) {
  if (!smtpConfigured()) throw new ApiError(503, 'Email is not configured on the server (SMTP settings are missing).');
  const text = `${p.message ? p.message + '\n\n' : ''}Report for ${p.projectName}\nPeriod: ${p.period}\n\nThe PDF report is attached.\n\nSent by SiteWatch.`;
  await sendMail({ to: p.recipients, subject: p.subject, text, attachments: [{ filename: p.filename, content: p.pdf, contentType: 'application/pdf' }] });
  await db.query('UPDATE reports SET emailed_to = ?, emailed_at = UTC_TIMESTAMP(3) WHERE id = ?', [p.recipients.slice(0, 1000), p.reportId]);
}

const DAY = 86_400_000;
export function nextRunAfter(freq: string, everyDays: number | null, from = new Date()): Date {
  const d = new Date(from);
  if (freq === 'daily') return new Date(d.getTime() + DAY);
  if (freq === 'weekly') return new Date(d.getTime() + 7 * DAY);
  if (freq === 'monthly') { d.setUTCMonth(d.getUTCMonth() + 1); return d; }
  return new Date(d.getTime() + (everyDays ?? 7) * DAY);
}

/** Cron hook: claim due report schedules, generate and email each one, then advance it. */
export async function runDueReports(cronStartedAt: number, max = 3) {
  const out = { schedules: 0, sent: 0, failed: 0 };
  if (Date.now() - cronStartedAt > 70_000) return out;
  const token = randomBytes(16).toString('hex');
  await db.query(
    `UPDATE report_schedules SET claim_token = ?, claimed_at = UTC_TIMESTAMP(3), updated_at = updated_at
     WHERE is_active = 1 AND next_run_at <= UTC_TIMESTAMP(3) AND (claim_token IS NULL OR claimed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
       AND project_id IN (SELECT id FROM projects WHERE status <> 'archived') ORDER BY next_run_at ASC LIMIT ?`, [token, max]);
  for (const s of await rows<any>('SELECT * FROM report_schedules WHERE claim_token = ?', [token])) {
    let error: string | null = null;
    try {
      const to = new Date(), from = new Date(to.getTime() - s.period_days * DAY);
      const sections = parseJson<Section[]>(s.sections, []);
      const title = s.name;
      const { pdf, project, filename } = await createPdf({ projectId: s.project_id, siteId: s.site_id, from, to, sections, title, timezone: s.timezone });
      const reportId = await saveReport({ projectId: s.project_id, siteId: s.site_id, userId: s.created_by, scheduleId: s.id, title, from, to, sections, timezone: s.timezone });
      await emailReport({ reportId, pdf, filename, recipients: s.recipients, subject: s.subject || `SiteWatch report: ${project.name} (${fmtPeriod(from, to)})`, message: s.message, projectName: project.name, period: fmtPeriod(from, to) });
      out.sent++;
    } catch (e: any) { error = String(e?.message || e).slice(0, 500); out.failed++; console.error('[SiteWatch] Scheduled report failed:', e); }
    // Always advance so one broken schedule cannot retry every minute forever; the error is shown in the UI.
    await db.query('UPDATE report_schedules SET last_run_at = UTC_TIMESTAMP(3), last_error = ?, next_run_at = ?, claim_token = NULL, claimed_at = NULL, updated_at = updated_at WHERE id = ?', [error, nextRunAfter(s.frequency, s.every_days), s.id]);
    out.schedules++;
  }
  return out;
}
