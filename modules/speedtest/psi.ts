import { ApiError } from '@/lib/errors';

const BASE = process.env.PAGESPEED_API_BASE || 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
export type Device = 'mobile' | 'desktop';
export type Parsed = {
  scores: { performance: number | null; accessibility: number | null; best_practices: number | null; seo: number | null };
  metrics: { fcp_ms: number | null; lcp_ms: number | null; cls: number | null; tbt_ms: number | null; speed_index_ms: number | null; ttfb_ms: number | null; inp_ms: number | null };
  field: any | null; details: any; lighthouseVersion: string | null; finalUrl: string | null;
};

export const psiConfigured = () => Boolean(process.env.GOOGLE_PAGESPEED_API_KEY);

/** Calls Google PageSpeed Insights. The API key stays server-side and is never included in errors or logs. */
export async function fetchPsi(url: string, device: Device): Promise<any> {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key) throw new ApiError(503, 'Speed tests are not configured: set GOOGLE_PAGESPEED_API_KEY on the server.', 'psi_not_configured');
  const q = new URLSearchParams({ url, strategy: device, key });
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) q.append('category', c);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${BASE}?${q}`, { signal: controller.signal, cache: 'no-store' });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(body?.error?.message || `HTTP ${res.status}`).replace(key, '***').slice(0, 300);
      if (res.status === 429) throw new Error('Google PageSpeed quota or rate limit reached. Try again later.');
      if (res.status === 400 || res.status === 500) throw new Error(`Google could not test this URL: ${msg}`);
      throw new Error(`Google PageSpeed API error (${res.status}): ${msg}`);
    }
    return body;
  } catch (e: any) {
    if (controller.signal.aborted) throw new Error('Google PageSpeed did not answer within 90 seconds.');
    throw new Error(String(e?.message || 'PageSpeed request failed').replace(key, '***').slice(0, 400));
  } finally { clearTimeout(timer); }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (v: unknown) => (num(v) === null ? null : Math.round(v as number));
const score = (v: unknown) => (num(v) === null ? null : Math.round((v as number) * 100));

/** Extract only what Google actually returned. Anything absent stays null (never estimated). */
export function parsePsi(json: any): Parsed {
  const lh = json?.lighthouseResult;
  if (!lh) throw new Error('Google returned no Lighthouse result for this URL.');
  const a = lh.audits ?? {}; const c = lh.categories ?? {};
  const opportunities = Object.values<any>(a)
    .filter(x => x?.details?.type === 'opportunity' && (x.details.overallSavingsMs ?? 0) > 0)
    .sort((x, y) => (y.details.overallSavingsMs ?? 0) - (x.details.overallSavingsMs ?? 0)).slice(0, 10)
    .map(x => ({ id: x.id, title: x.title, displayValue: x.displayValue ?? null, savingsMs: Math.round(x.details.overallSavingsMs), savingsBytes: x.details.overallSavingsBytes ?? null }));
  const failing = Object.values<any>(a)
    .filter(x => x && x.score !== null && x.score !== undefined && x.score < 0.9 && ['binary', 'numeric'].includes(x.scoreDisplayMode) && x.details?.type !== 'opportunity')
    .sort((x, y) => x.score - y.score).slice(0, 15)
    .map(x => ({ id: x.id, title: x.title, score: x.score, displayValue: x.displayValue ?? null }));
  const le = json.loadingExperience, ole = json.originLoadingExperience;
  const fieldOf = (x: any) => x?.metrics ? {
    overall: x.overall_category ?? null, id: x.id ?? null,
    metrics: Object.fromEntries(Object.entries<any>(x.metrics).map(([k, v]) => [k, { percentile: v.percentile ?? null, category: v.category ?? null }]))
  } : null;
  return {
    scores: { performance: score(c.performance?.score), accessibility: score(c.accessibility?.score), best_practices: score(c['best-practices']?.score), seo: score(c.seo?.score) },
    metrics: {
      fcp_ms: ms(a['first-contentful-paint']?.numericValue), lcp_ms: ms(a['largest-contentful-paint']?.numericValue),
      cls: num(a['cumulative-layout-shift']?.numericValue) === null ? null : Math.round(a['cumulative-layout-shift'].numericValue * 10000) / 10000,
      tbt_ms: ms(a['total-blocking-time']?.numericValue), speed_index_ms: ms(a['speed-index']?.numericValue),
      ttfb_ms: ms(a['server-response-time']?.numericValue), inp_ms: ms(a['interaction-to-next-paint']?.numericValue)
    },
    field: { page: fieldOf(le), origin: fieldOf(ole) },
    details: { opportunities, failing },
    lighthouseVersion: lh.lighthouseVersion ?? null, finalUrl: lh.finalDisplayedUrl ?? lh.finalUrl ?? null
  };
}
