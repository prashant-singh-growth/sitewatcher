import { rows, parseJson } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { isoDate } from '@/lib/validate';
import { compareAudits } from '@/modules/speedtest/compare';

export const SECTIONS = ['summary', 'uptime', 'response', 'incidents', 'speed', 'comparison', 'recommendations'] as const;
export type Section = typeof SECTIONS[number];
const PRESETS: Record<string, number> = { '24h': 1, '7d': 7, '15d': 15, '30d': 30, '90d': 90 };

export function resolvePeriod(b: Record<string, any>): { from: Date; to: Date } {
  if (b.preset) {
    const days = PRESETS[String(b.preset)];
    if (!days) throw new ApiError(400, 'preset must be one of 24h, 7d, 15d, 30d, 90d.');
    const to = new Date(); return { from: new Date(to.getTime() - days * 86_400_000), to };
  }
  const from = isoDate(b.from, 'Start date'), to = isoDate(b.to, 'End date');
  if (to <= from) throw new ApiError(400, 'End date must be after the start date.');
  if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new ApiError(400, 'A report can cover at most 366 days.');
  return { from, to: to.getTime() > Date.now() ? new Date() : to };
}
export function parseSections(v: unknown): Section[] {
  if (v === undefined || v === null) return [...SECTIONS];
  if (!Array.isArray(v) || !v.length) throw new ApiError(400, 'Select at least one report section.');
  const bad = v.find(s => !SECTIONS.includes(s as Section));
  if (bad) throw new ApiError(400, `Unknown section "${bad}".`);
  return [...new Set(v)] as Section[];
}

const overlap = (aS: Date, aE: Date, bS: Date, bE: Date) => Math.max(0, Math.min(aE.getTime(), bE.getTime()) - Math.max(aS.getTime(), bS.getTime())) / 1000;

export type SiteReport = {
  id: number; name: string; url: string;
  checks: number; upChecks: number; uptimePct: number | null; downtimeSeconds: number; incidentCount: number;
  avgMs: number | null; minMs: number | null; maxMs: number | null;
  trend: { label: string; avgMs: number | null; uptimePct: number | null }[];
  incidents: { id: number; start: Date; end: Date | null; seconds: number; error: string | null; failures: number }[];
  speed: Record<'mobile' | 'desktop', null | { first: any; last: any; count: number; deltas: ReturnType<typeof compareAudits>; opportunities: any[] }>;
};
export type ReportData = { project: any; from: Date; to: Date; sites: SiteReport[]; totals: { sites: number; checks: number; uptimePct: number | null; incidents: number; downtimeSeconds: number; avgMs: number | null } };

export async function buildReportData(projectId: number, siteId: number | null, from: Date, to: Date): Promise<ReportData> {
  const project = (await rows<any>('SELECT id, name, client_name, logo_url, primary_domain, description FROM projects WHERE id = ?', [projectId]))[0];
  if (!project) throw new ApiError(404, 'Project not found.');
  const sites = await rows<any>(`SELECT id, name, url FROM monitored_sites WHERE project_id = ? AND deleted_at IS NULL ${siteId ? 'AND id = ?' : ''} ORDER BY name`, siteId ? [projectId, siteId] : [projectId]);
  if (siteId && !sites.length) throw new ApiError(404, 'Website not found.');
  const hourly = to.getTime() - from.getTime() <= 3 * 86_400_000;
  const bucket = hourly ? "DATE_FORMAT(checked_at, '%Y-%m-%d %H:00')" : "DATE_FORMAT(checked_at, '%Y-%m-%d')";
  const out: SiteReport[] = [];
  for (const s of sites) {
    const st = (await rows<any>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(is_up),0) AS up, ROUND(AVG(CASE WHEN is_up=1 THEN response_ms END)) AS avg_ms,
              MIN(CASE WHEN is_up=1 THEN response_ms END) AS min_ms, MAX(CASE WHEN is_up=1 THEN response_ms END) AS max_ms
       FROM check_results WHERE site_id = ? AND checked_at >= ? AND checked_at < ?`, [s.id, from, to]))[0];
    const trendRows = await rows<any>(`SELECT ${bucket} AS b, ROUND(AVG(CASE WHEN is_up=1 THEN response_ms END)) AS avg_ms, COUNT(*) AS n, SUM(is_up) AS up
       FROM check_results WHERE site_id = ? AND checked_at >= ? AND checked_at < ? GROUP BY b ORDER BY b`, [s.id, from, to]);
    const inc = await rows<any>(`SELECT id, started_at, resolved_at, last_error, failure_count FROM incidents WHERE site_id = ? AND started_at < ? AND COALESCE(resolved_at, UTC_TIMESTAMP(3)) > ? ORDER BY started_at`, [s.id, to, from]);
    const incidents = inc.map(i => {
      const end = i.resolved_at ? new Date(i.resolved_at) : null;
      return { id: Number(i.id), start: new Date(i.started_at), end, seconds: overlap(new Date(i.started_at), end ?? to, from, to), error: i.last_error, failures: Number(i.failure_count) };
    });
    const speed: SiteReport['speed'] = { mobile: null, desktop: null };
    for (const device of ['mobile', 'desktop'] as const) {
      const a = await rows<any>("SELECT * FROM pagespeed_audits WHERE site_id = ? AND device = ? AND status = 'success' AND audited_at >= ? AND audited_at <= ? ORDER BY audited_at", [s.id, device, from, to]);
      if (a.length) {
        const last = a[a.length - 1];
        speed[device] = { first: a[0], last, count: a.length, deltas: a.length > 1 ? compareAudits(a[0], last) : [], opportunities: parseJson<any>(last.details, {}).opportunities ?? [] };
      }
    }
    const n = Number(st.n);
    out.push({
      id: Number(s.id), name: s.name, url: s.url, checks: n, upChecks: Number(st.up), uptimePct: n ? Math.round((Number(st.up) / n) * 10000) / 100 : null,
      downtimeSeconds: Math.round(incidents.reduce((t, i) => t + i.seconds, 0)), incidentCount: incidents.length,
      avgMs: st.avg_ms == null ? null : Number(st.avg_ms), minMs: st.min_ms == null ? null : Number(st.min_ms), maxMs: st.max_ms == null ? null : Number(st.max_ms),
      trend: trendRows.map(r => ({ label: String(r.b), avgMs: r.avg_ms == null ? null : Number(r.avg_ms), uptimePct: Number(r.n) ? Math.round((Number(r.up) / Number(r.n)) * 1000) / 10 : null })),
      incidents, speed
    });
  }
  const checks = out.reduce((t, s) => t + s.checks, 0), up = out.reduce((t, s) => t + s.upChecks, 0);
  const weighted = out.filter(s => s.avgMs != null && s.checks);
  return { project, from, to, sites: out, totals: {
    sites: out.length, checks, uptimePct: checks ? Math.round((up / checks) * 10000) / 100 : null, incidents: out.reduce((t, s) => t + s.incidentCount, 0),
    downtimeSeconds: out.reduce((t, s) => t + s.downtimeSeconds, 0),
    avgMs: weighted.length ? Math.round(weighted.reduce((t, s) => t + (s.avgMs as number) * s.upChecks, 0) / Math.max(1, weighted.reduce((t, s) => t + s.upChecks, 0))) : null } };
}
