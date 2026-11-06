import { ApiError } from '@/lib/errors';
import { getSettingInt } from '@/lib/settings';
import { bool, int, isoDate, oneOf, statusSpec } from '@/lib/validate';

export const INTERVAL_PRESETS = [1, 2, 5, 10, 15, 30, 60] as const;
export const MAX_INTERVAL_MINUTES = 1440;
const WORST_CASE_MS = 60_000; // one site's attempts must finish well inside the 110 s cron request

/** SQL fragment: website value if set, otherwise the project default. Join `project_settings ps` (LEFT JOIN) as alias ps. */
export const EFFECTIVE_COLUMNS = `
  COALESCE(s.interval_minutes, ps.interval_minutes, 5) AS eff_interval_minutes,
  COALESCE(s.timeout_ms, ps.timeout_ms, 10000) AS eff_timeout_ms,
  COALESCE(s.retry_count, ps.retry_count, 1) AS eff_retry_count,
  COALESCE(s.retry_delay_ms, ps.retry_delay_ms, 1000) AS eff_retry_delay_ms,
  COALESCE(s.http_method, ps.http_method, 'GET') AS eff_http_method,
  COALESCE(s.expected_status, ps.expected_status, '200-399') AS eff_expected_status,
  COALESCE(s.alert_on_down, ps.alert_on_down, 1) AS eff_alert_on_down,
  COALESCE(s.alert_on_recovery, ps.alert_on_recovery, 1) AS eff_alert_on_recovery`;

type Fields = {
  interval_minutes?: number | null; timeout_ms?: number | null; retry_count?: number | null; retry_delay_ms?: number | null;
  http_method?: 'GET' | 'HEAD' | null; expected_status?: string | null; alert_on_down?: boolean | null; alert_on_recovery?: boolean | null;
  maintenance_start?: Date | null; maintenance_end?: Date | null;
};

/** Validate monitoring fields. `nullable` = website overrides (null means "inherit"); project defaults must be concrete values. */
export async function parseMonitoringFields(b: Record<string, any>, nullable: boolean): Promise<Fields> {
  const out: Fields = {};
  const take = <K extends keyof Fields>(key: K, parse: (v: any) => Fields[K]) => {
    if (!(key in b)) return;
    if (b[key] === null && nullable) { out[key] = null as any; return; }
    out[key] = parse(b[key]);
  };
  const minInterval = await getSettingInt('monitor.min_interval_minutes', 1);
  take('interval_minutes', v => int(v, 'Check interval (minutes)', { min: minInterval, max: MAX_INTERVAL_MINUTES }));
  take('timeout_ms', v => int(v, 'Request timeout (ms)', { min: 2000, max: 30000 }));
  take('retry_count', v => int(v, 'Retry count', { min: 0, max: 3 }));
  take('retry_delay_ms', v => int(v, 'Retry delay (ms)', { min: 0, max: 10000 }));
  take('http_method', v => oneOf(v, 'HTTP method', ['GET', 'HEAD'] as const));
  take('expected_status', v => statusSpec(v));
  take('alert_on_down', v => bool(v, 'Down alerts'));
  take('alert_on_recovery', v => bool(v, 'Recovery alerts'));
  if (nullable) {
    take('maintenance_start', v => isoDate(v, 'Maintenance start'));
    take('maintenance_end', v => isoDate(v, 'Maintenance end'));
    const s = out.maintenance_start, e = out.maintenance_end;
    if ((s && !e && !('maintenance_end' in b)) || (e && !s && !('maintenance_start' in b))) throw new ApiError(400, 'Provide both maintenance start and end.');
    if (s && e && e <= s) throw new ApiError(400, 'Maintenance end must be after its start.');
  }
  return out;
}

/** Reject combinations that cannot finish inside the cron request on managed hosting. */
export function assertWithinCapacity(eff: { timeout_ms: number; retry_count: number; retry_delay_ms: number }) {
  const worst = (eff.retry_count + 1) * eff.timeout_ms + eff.retry_count * eff.retry_delay_ms;
  if (worst > WORST_CASE_MS) throw new ApiError(400, `Timeout × attempts is too large (worst case ${Math.round(worst / 1000)} s, limit ${WORST_CASE_MS / 1000} s). Lower the timeout or retries.`);
}
