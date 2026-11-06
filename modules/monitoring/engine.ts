import { randomBytes } from 'node:crypto';
import { db, rows } from '@/lib/db';
import { sendMail } from '@/lib/mailer';
import { getSettingInt } from '@/lib/settings';
import { purgeOldLimits } from '@/lib/ratelimit';
import { parseStatusSpec } from '@/lib/validate';
import { probeOnce, type Probe } from './probe';
import { EFFECTIVE_COLUMNS } from './settings';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export type Summary = { due: number; checked: number; up: number; down: number; maintenance: number; released: number };

async function loadConfig() {
  return {
    maxConcurrency: await getSettingInt('monitor.max_concurrency', 5),
    maxPerRun: await getSettingInt('monitor.max_sites_per_run', 40),
    staleMinutes: await getSettingInt('monitor.stale_claim_minutes', 5),
    budgetMs: (await getSettingInt('monitor.run_budget_seconds', 85)) * 1000
  };
}

/**
 * Due-task dispatcher. Hostinger Cron calls this every minute; only sites whose next_run_at has passed are checked.
 * Each site is CLAIMED atomically (claim_token), so overlapping dispatchers can never check the same site twice,
 * and a claim older than `stale_claim_minutes` (a crashed run) is automatically recovered.
 */
export async function runMonitoring(triggeredBy = 'cron'): Promise<Summary & { skipped: boolean }> {
  const started = Date.now();
  const cfg = await loadConfig();
  const summary: Summary = { due: 0, checked: 0, up: 0, down: 0, maintenance: 0, released: 0 };
  const [ins] = await db.query<any>('INSERT INTO cron_execution_logs (triggered_by, started_at) VALUES (?, UTC_TIMESTAMP(3))', [triggeredBy]);
  const logId = ins.insertId;
  let error: string | null = null;
  const token = randomBytes(16).toString('hex');
  try {
    await db.query(
      `UPDATE monitored_sites SET claim_token = ?, claimed_at = UTC_TIMESTAMP(3), updated_at = updated_at
       WHERE deleted_at IS NULL AND is_active = 1 AND (next_run_at IS NULL OR next_run_at <= UTC_TIMESTAMP(3))
         AND (claim_token IS NULL OR claimed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))
         AND project_id IN (SELECT id FROM projects WHERE status = 'active')
       ORDER BY next_run_at ASC LIMIT ?`, [token, cfg.staleMinutes, cfg.maxPerRun]);
    const sites = await rows<any>(
      `SELECT s.id, s.project_id, s.name, s.url, s.maintenance_start, s.maintenance_end, p.name AS project_name, ps.alert_emails, ${EFFECTIVE_COLUMNS}
       FROM monitored_sites s JOIN projects p ON p.id = s.project_id LEFT JOIN project_settings ps ON ps.project_id = s.project_id
       WHERE s.claim_token = ? ORDER BY s.next_run_at ASC`, [token]);
    summary.due = sites.length;

    const queue = [...sites];
    const worker = async () => {
      for (let site = queue.shift(); site; site = queue.shift()) {
        if (Date.now() - started > cfg.budgetMs) { await releaseClaim(site.id, token); summary.released++; continue; } // picked up next minute
        try { await processSite(site, token, summary); }
        catch (e) { console.error(`[SiteWatch] Check failed for site ${site.id}:`, e); await releaseClaim(site.id, token); summary.released++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(cfg.maxConcurrency, sites.length) }, worker));
    await purgeOldLimits().catch(() => undefined);
  } catch (e: any) { error = String(e?.message || e).slice(0, 500); throw e; }
  finally {
    await db.query(
      'UPDATE cron_execution_logs SET finished_at = UTC_TIMESTAMP(3), duration_ms = ?, due_count = ?, checked = ?, up_count = ?, down_count = ?, maintenance_skipped = ?, released = ?, error = ? WHERE id = ?',
      [Date.now() - started, summary.due, summary.checked, summary.up, summary.down, summary.maintenance, summary.released, error, logId]).catch(() => undefined);
  }
  return { ...summary, skipped: false };
}

const releaseClaim = (id: number, token: string) =>
  db.query('UPDATE monitored_sites SET claim_token = NULL, claimed_at = NULL, updated_at = updated_at WHERE id = ? AND claim_token = ?', [id, token]);

async function checkWithRetries(site: any): Promise<Probe & { attempts: number }> {
  const isExpected = parseStatusSpec(site.eff_expected_status) ?? ((c: number) => c >= 200 && c < 400);
  const opts = { method: site.eff_http_method as 'GET' | 'HEAD', timeoutMs: Number(site.eff_timeout_ms), isExpected };
  const maxAttempts = 1 + Number(site.eff_retry_count);
  let result = await probeOnce(site.url, opts);
  let attempts = 1;
  const errors: string[] = [];
  while (!result.up && attempts < maxAttempts) {
    errors.push(result.error || 'probe failed');
    await sleep(Number(site.eff_retry_delay_ms));
    result = await probeOnce(site.url, opts);
    attempts++;
  }
  if (!result.up && errors.length) result = { ...result, error: `${errors.join('; ')}; final: ${result.error || 'failed'}`.slice(0, 950) };
  return { ...result, attempts };
}

async function processSite(site: any, token: string, summary: Summary) {
  const interval = Number(site.eff_interval_minutes);
  const now = Date.now();
  if (site.maintenance_start && site.maintenance_end && now >= new Date(site.maintenance_start).getTime() && now < new Date(site.maintenance_end).getTime()) {
    summary.maintenance++;
    await db.query('UPDATE monitored_sites SET next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), claim_token = NULL, claimed_at = NULL, updated_at = updated_at WHERE id = ? AND claim_token = ?', [interval, site.id, token]);
    return;
  }
  const result = await checkWithRetries(site);
  const incidentId = await updateIncident(site, result);
  await db.query(
    'INSERT INTO check_results (site_id, status_code, is_up, response_ms, error_message, attempts, incident_id, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))',
    [site.id, result.statusCode, result.up ? 1 : 0, result.responseMs, result.error, result.attempts, incidentId]);
  await db.query(
    `UPDATE monitored_sites SET last_is_up = ?, last_status_code = ?, last_response_ms = ?, last_checked_at = UTC_TIMESTAMP(3), last_run_at = UTC_TIMESTAMP(3),
       next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), claim_token = NULL, claimed_at = NULL, updated_at = updated_at
     WHERE id = ? AND claim_token = ?`, [result.up ? 1 : 0, result.statusCode, result.responseMs, interval, site.id, token]);
  summary.checked++; result.up ? summary.up++ : summary.down++;
}

/** Opens / updates / resolves the incident. The unique open_key index guarantees one open incident per site even under races. */
async function updateIncident(site: any, r: Probe): Promise<number | null> {
  const open = (await rows<any>('SELECT id FROM incidents WHERE site_id = ? AND resolved_at IS NULL LIMIT 1', [site.id]))[0];
  if (!r.up) {
    if (open) {
      await db.query('UPDATE incidents SET last_error = ?, last_failure_at = UTC_TIMESTAMP(3), failure_count = failure_count + 1 WHERE id = ?', [r.error, open.id]);
      return open.id;
    }
    try {
      const [ins] = await db.query<any>('INSERT INTO incidents (project_id, site_id, started_at, last_failure_at, last_error) VALUES (?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?)', [site.project_id, site.id, r.error]);
      if (Number(site.eff_alert_on_down)) await notify('down', site, ins.insertId, r);
      return ins.insertId;
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_ENTRY') throw e;
      return (await rows<any>('SELECT id FROM incidents WHERE site_id = ? AND resolved_at IS NULL LIMIT 1', [site.id]))[0]?.id ?? null;
    }
  }
  if (open) {
    await db.query('UPDATE incidents SET resolved_at = UTC_TIMESTAMP(3) WHERE id = ? AND resolved_at IS NULL', [open.id]);
    if (Number(site.eff_alert_on_recovery)) await notify('recovery', site, open.id, r);
    return open.id;
  }
  return null;
}

function recipients(site: any): string {
  const own = String(site.alert_emails || '').trim();
  return own || process.env.ALERT_TO || '';
}
async function notify(type: 'down' | 'recovery', site: any, incidentId: number, r: Probe) {
  const to = recipients(site);
  const when = new Date().toISOString();
  const subject = type === 'down' ? `🔴 Site down: ${site.name}` : `🟢 Site recovered: ${site.name}`;
  const text = type === 'down'
    ? `${site.name} appears to be DOWN.\nProject: ${site.project_name}\nURL: ${site.url}\nHTTP status: ${r.statusCode ?? 'No response'}\nError: ${r.error || 'Unknown error'}\nDetected (UTC): ${when}\nIncident ID: ${incidentId}`
    : `${site.name} is responding again.\nProject: ${site.project_name}\nURL: ${site.url}\nResponse time: ${r.responseMs} ms\nRecovered (UTC): ${when}\nIncident ID: ${incidentId}`;
  let status: 'sent' | 'failed' | 'skipped' = 'sent'; let err: string | null = null;
  try { const res = await sendMail({ to, subject, text }); if (res.skipped) status = 'skipped'; }
  catch (e: any) { status = 'failed'; err = String(e?.message || e).slice(0, 500); console.error(`[SiteWatch] ${type} email failed:`, e); }
  await db.query('INSERT INTO incident_notifications (incident_id, type, recipients, status, error) VALUES (?, ?, ?, ?, ?)', [incidentId, type, to.slice(0, 1000) || null, status, err]).catch(() => undefined);
}
