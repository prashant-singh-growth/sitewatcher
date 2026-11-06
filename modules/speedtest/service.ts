import { randomBytes } from 'node:crypto';
import { db, rows, parseJson } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { fetchPsi, parsePsi, psiConfigured, type Device } from './psi';

export const AUDIT_LIST_COLUMNS = `a.id, a.project_id, a.site_id, a.user_id, a.device, a.triggered_by, a.status, a.error_message, a.performance_score, a.accessibility_score,
  a.best_practices_score, a.seo_score, a.fcp_ms, a.lcp_ms, a.cls, a.tbt_ms, a.speed_index_ms, a.ttfb_ms, a.inp_ms, a.lighthouse_version, a.audited_at`;

/** Run one PageSpeed audit and store it as a NEW row (never overwrites). Failed audits are stored too, with the reason. */
export async function runAudit(site: { id: number; project_id: number; url: string }, device: Device, opts: { userId: number | null; scheduleId?: number | null }) {
  let status: 'success' | 'failed' = 'success'; let error: string | null = null; let p: ReturnType<typeof parsePsi> | null = null;
  try { p = parsePsi(await fetchPsi(site.url, device)); }
  catch (e: any) { status = 'failed'; error = String(e?.message || 'Audit failed').slice(0, 500); }
  const m = p?.metrics, s = p?.scores;
  const [r] = await db.query<any>(
    `INSERT INTO pagespeed_audits (project_id, site_id, user_id, schedule_id, device, triggered_by, status, error_message, tested_url,
       performance_score, accessibility_score, best_practices_score, seo_score, fcp_ms, lcp_ms, cls, tbt_ms, speed_index_ms, ttfb_ms, inp_ms,
       field_data, details, lighthouse_version, audited_at) VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?, ?,?,?, UTC_TIMESTAMP(3))`,
    [site.project_id, site.id, opts.userId, opts.scheduleId ?? null, device, opts.scheduleId ? 'schedule' : 'manual', status, error, p?.finalUrl || site.url,
     s?.performance ?? null, s?.accessibility ?? null, s?.best_practices ?? null, s?.seo ?? null,
     m?.fcp_ms ?? null, m?.lcp_ms ?? null, m?.cls ?? null, m?.tbt_ms ?? null, m?.speed_index_ms ?? null, m?.ttfb_ms ?? null, m?.inp_ms ?? null,
     p ? JSON.stringify(p.field) : null, p ? JSON.stringify(p.details) : null, p?.lighthouseVersion ?? null]);
  return (await rows<any>(`SELECT ${AUDIT_LIST_COLUMNS} FROM pagespeed_audits a WHERE a.id = ?`, [r.insertId]))[0];
}
export const shapeAudit = (a: any) => a && { ...a, field_data: parseJson(a.field_data, null), details: parseJson(a.details, null) };

// ---------- Schedules ----------
const DAY = 86_400_000;
export type ScheduleRow = { kind: 'once' | 'recurring' | 'custom'; start_at: Date; every_days: number | null; offsets_days: any; step_index: number };
export const offsetsOf = (s: ScheduleRow): number[] => (s.kind === 'once' ? [0] : parseJson<number[]>(s.offsets_days, []));
export function firstRun(s: Omit<ScheduleRow, 'step_index'>): Date { return new Date(new Date(s.start_at).getTime() + (offsetsOf({ ...s, step_index: 0 })[0] ?? 0) * DAY); }
/** Next run after a run just completed, or null when the schedule is finished. */
export function nextAfterRun(s: ScheduleRow, now = new Date()): { next: Date | null; stepIndex: number } {
  if (s.kind === 'recurring') return { next: new Date(now.getTime() + (s.every_days ?? 7) * DAY), stepIndex: s.step_index + 1 };
  const offs = offsetsOf(s); const idx = s.step_index + 1;
  return idx >= offs.length ? { next: null, stepIndex: idx } : { next: new Date(new Date(s.start_at).getTime() + offs[idx] * DAY), stepIndex: idx };
}

/** Called by the cron dispatcher. Claims due schedules atomically, runs their audits, then advances them. */
export async function runDueSpeedTests(cronStartedAt: number, maxSchedules = 2): Promise<{ schedules: number; audits: number }> {
  const out = { schedules: 0, audits: 0 };
  if (!psiConfigured() || Date.now() - cronStartedAt > 50_000) return out; // leave them due; a later minute picks them up
  const token = randomBytes(16).toString('hex');
  await db.query(
    `UPDATE speed_test_schedules SET claim_token = ?, claimed_at = UTC_TIMESTAMP(3), updated_at = updated_at
     WHERE is_active = 1 AND next_run_at <= UTC_TIMESTAMP(3) AND (claim_token IS NULL OR claimed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
       AND site_id IN (SELECT id FROM monitored_sites WHERE deleted_at IS NULL) AND project_id IN (SELECT id FROM projects WHERE status <> 'archived')
     ORDER BY next_run_at ASC LIMIT ?`, [token, maxSchedules]);
  const due = await rows<any>('SELECT * FROM speed_test_schedules WHERE claim_token = ?', [token]);
  await Promise.all(due.map(async sch => {
    try {
      const site = (await rows<any>('SELECT id, project_id, url FROM monitored_sites WHERE id = ?', [sch.site_id]))[0];
      const devices: Device[] = sch.device === 'both' ? ['mobile', 'desktop'] : [sch.device];
      for (const d of devices) { await runAudit(site, d, { userId: null, scheduleId: sch.id }); out.audits++; }
      const { next, stepIndex } = nextAfterRun(sch);
      await db.query('UPDATE speed_test_schedules SET step_index = ?, next_run_at = ?, is_active = ?, last_run_at = UTC_TIMESTAMP(3), claim_token = NULL, claimed_at = NULL, updated_at = updated_at WHERE id = ?', [stepIndex, next, next ? 1 : 0, sch.id]);
      out.schedules++;
    } catch (e) {
      console.error('[SiteWatch] Scheduled speed test failed:', e);
      await db.query('UPDATE speed_test_schedules SET claim_token = NULL, claimed_at = NULL, updated_at = updated_at WHERE id = ?', [sch.id]);
    }
  }));
  return out;
}
export function assertPsiReady() { if (!psiConfigured()) throw new ApiError(503, 'Speed tests are not configured: set GOOGLE_PAGESPEED_API_KEY on the server.', 'psi_not_configured'); }
