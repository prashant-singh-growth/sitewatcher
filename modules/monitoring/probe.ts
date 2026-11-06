import http from 'node:http';
import https from 'node:https';
import { safeLookup, assertPublicUrlSyntax } from '@/lib/ssrf';

export type Probe = { up: boolean; statusCode: number | null; responseMs: number | null; error: string | null };
const MAX_REDIRECTS = 5;

function hop(url: URL, method: string, signal: AbortSignal): Promise<{ status: number; statusText: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined, path: url.pathname + url.search,
      method, signal, lookup: safeLookup as any, // DNS result is validated at connect time (anti-rebinding)
      headers: { 'User-Agent': 'SiteWatch-Monitor/2.0 (+availability check)', Accept: '*/*' }
    }, res => {
      res.destroy(); // headers are enough; never download the body
      resolve({ status: res.statusCode || 0, statusText: res.statusMessage || '', location: res.headers.location });
    });
    req.on('error', reject);
    req.end();
  });
}

/** One availability probe. Follows redirects manually so EVERY hop is validated; judges the final status code. */
export async function probeOnce(rawUrl: string, o: { method: 'GET' | 'HEAD'; timeoutMs: number; isExpected: (code: number) => boolean }): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs);
  const started = performance.now();
  try {
    let url = assertPublicUrlSyntax(rawUrl);
    for (let i = 0; ; i++) {
      const r = await hop(url, o.method, controller.signal);
      if (r.status >= 300 && r.status < 400 && r.location) {
        if (i >= MAX_REDIRECTS) throw new Error('Too many redirects');
        url = assertPublicUrlSyntax(new URL(r.location, url).toString()); // redirect targets get the same SSRF checks
        continue;
      }
      const responseMs = Math.max(0, Math.round(performance.now() - started));
      const up = o.isExpected(r.status);
      return { up, statusCode: r.status, responseMs, error: up ? null : `HTTP ${r.status} ${r.statusText}`.trim() };
    }
  } catch (e: any) {
    const timedOut = controller.signal.aborted;
    const msg = timedOut ? `Timed out after ${o.timeoutMs} ms` : (e?.message || e?.code || 'Request failed');
    return { up: false, statusCode: null, responseMs: null, error: String(msg).slice(0, 950) };
  } finally { clearTimeout(timer); }
}
