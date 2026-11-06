export type MetricDef = { key: string; label: string; unit: 'score' | 'ms' | 'cls'; higherBetter: boolean };
export const METRICS: MetricDef[] = [
  { key: 'performance_score', label: 'Performance', unit: 'score', higherBetter: true },
  { key: 'accessibility_score', label: 'Accessibility', unit: 'score', higherBetter: true },
  { key: 'best_practices_score', label: 'Best Practices', unit: 'score', higherBetter: true },
  { key: 'seo_score', label: 'SEO', unit: 'score', higherBetter: true },
  { key: 'fcp_ms', label: 'First Contentful Paint', unit: 'ms', higherBetter: false },
  { key: 'lcp_ms', label: 'Largest Contentful Paint', unit: 'ms', higherBetter: false },
  { key: 'cls', label: 'Cumulative Layout Shift', unit: 'cls', higherBetter: false },
  { key: 'tbt_ms', label: 'Total Blocking Time', unit: 'ms', higherBetter: false },
  { key: 'speed_index_ms', label: 'Speed Index', unit: 'ms', higherBetter: false },
  { key: 'ttfb_ms', label: 'Server response time (TTFB)', unit: 'ms', higherBetter: false },
  { key: 'inp_ms', label: 'Interaction to Next Paint', unit: 'ms', higherBetter: false }
];
export type Delta = { key: string; label: string; unit: string; previous: number | null; current: number | null; change: number | null; changePct: number | null; direction: 'improved' | 'declined' | 'same' | 'unavailable' };

/** `previous` and `current` are audit rows. Direction accounts for metric polarity (lower is better for timings and CLS). */
export function compareAudits(previous: any, current: any): Delta[] {
  return METRICS.map(m => {
    const p = previous?.[m.key] == null ? null : Number(previous[m.key]);
    const c = current?.[m.key] == null ? null : Number(current[m.key]);
    if (p === null || c === null) return { key: m.key, label: m.label, unit: m.unit, previous: p, current: c, change: null, changePct: null, direction: 'unavailable' as const };
    const change = Math.round((c - p) * 10000) / 10000;
    const better = m.higherBetter ? change > 0 : change < 0;
    return { key: m.key, label: m.label, unit: m.unit, previous: p, current: c, change, changePct: p !== 0 ? Math.round((change / p) * 1000) / 10 : null, direction: change === 0 ? 'same' as const : better ? 'improved' as const : 'declined' as const };
  });
}
