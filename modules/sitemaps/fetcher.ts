import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { safeLookup, assertPublicUrlSyntax } from '@/lib/ssrf';

export type FetchResult = {
  statusCode: number | null;
  body: string | null;
  durationMs: number;
  finalUrl: string;
  error: string | null;
  headers: Record<string, string>;
};

const MAX_REDIRECTS = 5;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB max limit

function requestOnce(
  url: URL,
  signal: AbortSignal,
  timeoutMs: number
): Promise<{ statusCode: number; statusMessage: string; headers: http.IncomingHttpHeaders; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'GET',
        signal,
        lookup: safeLookup as any, // Anti-DNS rebinding SSRF protection
        headers: {
          'User-Agent': 'SiteWatch-SitemapBot/2.0 (+https://sitewatch.io; XML Sitemap Health Monitor)',
          'Accept': 'application/xml, text/xml, application/x-gzip, */*;q=0.8',
          'Accept-Encoding': 'gzip, deflate'
        }
      },
      res => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BYTES) {
            res.destroy(new Error(`Sitemap size exceeded ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit.`));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode || 0,
            statusMessage: res.statusMessage || '',
            headers: res.headers,
            buffer
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

/**
 * Safely fetches a sitemap with SSRF protection, redirect following, decompression, and timeouts.
 */
export async function fetchSitemap(
  rawUrl: string,
  options: { timeoutMs?: number } = {}
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  let currentUrl = rawUrl;
  const headersOut: Record<string, string> = {};

  try {
    let url = assertPublicUrlSyntax(currentUrl);

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const res = await requestOnce(url, controller.signal, timeoutMs);
      const code = res.statusCode;

      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === 'string') headersOut[k.toLowerCase()] = v;
      }

      // Handle redirects
      if (code >= 300 && code < 400 && res.headers.location) {
        if (i >= MAX_REDIRECTS) {
          throw new Error('Too many redirects (maximum 5 followed).');
        }
        const resolved = new URL(res.headers.location, url.toString()).toString();
        url = assertPublicUrlSyntax(resolved);
        currentUrl = url.toString();
        continue;
      }

      const durationMs = Math.max(0, Math.round(performance.now() - started));

      if (code < 200 || code >= 300) {
        return {
          statusCode: code,
          body: null,
          durationMs,
          finalUrl: currentUrl,
          error: `HTTP ${code} ${res.statusMessage || 'Error'}`.trim(),
          headers: headersOut
        };
      }

      // Decompress if gzip / deflate
      let rawBuf = res.buffer;
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      if (encoding.includes('gzip') || (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b)) {
        try {
          rawBuf = zlib.gunzipSync(rawBuf);
        } catch (e: any) {
          return {
            statusCode: code,
            body: null,
            durationMs,
            finalUrl: currentUrl,
            error: `Failed to decompress gzipped sitemap: ${e.message}`,
            headers: headersOut
          };
        }
      } else if (encoding.includes('deflate')) {
        try {
          rawBuf = zlib.inflateSync(rawBuf);
        } catch {
          try {
            rawBuf = zlib.inflateRawSync(rawBuf);
          } catch (e: any) {
            return {
              statusCode: code,
              body: null,
              durationMs,
              finalUrl: currentUrl,
              error: `Failed to decompress deflate sitemap: ${e.message}`,
              headers: headersOut
            };
          }
        }
      }

      const bodyText = rawBuf.toString('utf8');
      return {
        statusCode: code,
        body: bodyText,
        durationMs,
        finalUrl: currentUrl,
        error: null,
        headers: headersOut
      };
    }

    throw new Error('Maximum redirects exceeded');
  } catch (err: any) {
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const timedOut = controller.signal.aborted;
    const msg = timedOut ? `Request timed out after ${timeoutMs}ms` : err?.message || 'Network request failed';
    return {
      statusCode: null,
      body: null,
      durationMs,
      finalUrl: currentUrl,
      error: String(msg).slice(0, 500),
      headers: headersOut
    };
  } finally {
    clearTimeout(timer);
  }
}
