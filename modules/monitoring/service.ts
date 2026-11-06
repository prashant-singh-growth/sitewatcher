import { createHash } from 'node:crypto';
import { rows } from '@/lib/db';
import { EFFECTIVE_COLUMNS } from './settings';

export const urlHash = (url: string) => createHash('sha256').update(url).digest('hex');
export const SITE_LIST_SQL = `
  SELECT s.id, s.project_id, s.name, s.url, s.is_active, s.created_at, s.next_run_at,
    s.last_is_up AS is_up, s.last_response_ms AS response_ms, s.last_status_code, s.last_checked_at AS last_checked,
    s.interval_minutes AS o_interval_minutes, s.timeout_ms AS o_timeout_ms, s.retry_count AS o_retry_count, s.retry_delay_ms AS o_retry_delay_ms,
    s.http_method AS o_http_method, s.expected_status AS o_expected_status, s.alert_on_down AS o_alert_on_down, s.alert_on_recovery AS o_alert_on_recovery,
    s.maintenance_start, s.maintenance_end, ${EFFECTIVE_COLUMNS},
    (SELECT COUNT(*) FROM incidents i WHERE i.site_id = s.id AND i.resolved_at IS NULL) AS open_incidents,
    (SELECT a.performance_score FROM pagespeed_audits a WHERE a.site_id = s.id AND a.device = 'mobile' AND a.status = 'success' ORDER BY a.audited_at DESC LIMIT 1) AS mobile_perf,
    (SELECT a.audited_at FROM pagespeed_audits a WHERE a.site_id = s.id AND a.device = 'mobile' AND a.status = 'success' ORDER BY a.audited_at DESC LIMIT 1) AS mobile_perf_at,
    (SELECT a.performance_score FROM pagespeed_audits a WHERE a.site_id = s.id AND a.device = 'desktop' AND a.status = 'success' ORDER BY a.audited_at DESC LIMIT 1) AS desktop_perf,
    (SELECT a.audited_at FROM pagespeed_audits a WHERE a.site_id = s.id AND a.device = 'desktop' AND a.status = 'success' ORDER BY a.audited_at DESC LIMIT 1) AS desktop_perf_at
  FROM monitored_sites s LEFT JOIN project_settings ps ON ps.project_id = s.project_id`;
export const listSites = (projectId: number) => rows<any>(`${SITE_LIST_SQL} WHERE s.project_id = ? AND s.deleted_at IS NULL ORDER BY s.name ASC`, [projectId]);
