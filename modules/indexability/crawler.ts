import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { safeLookup, assertPublicUrlSyntax } from '@/lib/ssrf';

export type CrawlResult = {
  initialUrl: string;
  finalUrl: string;
  statusCode: number | null;
  redirectHops: number;
  isRedirectLoop: boolean;
  xRobotsHeader: string | null;
  httpLinkHeader: string | null;
  html: string;
  durationMs: number;
  error: string | null;
};

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB max HTML download

function fetchSingleHop(
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
        lookup: safeLookup as any,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html; SiteWatch-Indexability/2.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate'
        }
      },
      res => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_HTML_BYTES) {
            // Cut off after 2MB - head is always in the first few KB
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });

        res.on('close', () => {
          resolve({
            statusCode: res.statusCode || 0,
            statusMessage: res.statusMessage || '',
            headers: res.headers,
            buffer: Buffer.concat(chunks)
          });
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            statusMessage: res.statusMessage || '',
            headers: res.headers,
            buffer: Buffer.concat(chunks)
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

/**
 * Crawls a target URL with redirect tracking, loop detection, and header inspection.
 */
export async function crawlUrlForIndexability(
  rawUrl: string,
  options: { timeoutMs?: number } = {}
): Promise<CrawlResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  let currentUrl = rawUrl;
  const visitedUrls = new Set<string>();
  let redirectHops = 0;
  let isRedirectLoop = false;

  let xRobotsHeader: string | null = null;
  let httpLinkHeader: string | null = null;

  try {
    let url = assertPublicUrlSyntax(currentUrl);

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      visitedUrls.add(url.toString());

      const res = await fetchSingleHop(url, controller.signal, timeoutMs);
      const code = res.statusCode;

      // Extract headers from response
      const xRobots = res.headers['x-robots-tag'];
      if (xRobots) {
        xRobotsHeader = Array.isArray(xRobots) ? xRobots.join(', ') : xRobots;
      }

      const linkHdr = res.headers['link'];
      if (linkHdr) {
        httpLinkHeader = Array.isArray(linkHdr) ? linkHdr.join(', ') : linkHdr;
      }

      // Check redirects
      if (code >= 300 && code < 400 && res.headers.location) {
        redirectHops++;
        const resolved = new URL(res.headers.location, url.toString()).toString();

        if (visitedUrls.has(resolved)) {
          isRedirectLoop = true;
          return {
            initialUrl: rawUrl,
            finalUrl: resolved,
            statusCode: code,
            redirectHops,
            isRedirectLoop: true,
            xRobotsHeader,
            httpLinkHeader,
            html: '',
            durationMs: Math.round(performance.now() - started),
            error: `Redirect loop detected: redirected back to ${resolved}`
          };
        }

        if (i >= MAX_REDIRECTS) {
          return {
            initialUrl: rawUrl,
            finalUrl: resolved,
            statusCode: code,
            redirectHops,
            isRedirectLoop: false,
            xRobotsHeader,
            httpLinkHeader,
            html: '',
            durationMs: Math.round(performance.now() - started),
            error: `Too many redirects (exceeded ${MAX_REDIRECTS} hops)`
          };
        }

        url = assertPublicUrlSyntax(resolved);
        currentUrl = url.toString();
        continue;
      }

      // Decompress if gzip/deflate
      let rawBuf = res.buffer;
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      if (encoding.includes('gzip') || (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b)) {
        try {
          rawBuf = zlib.gunzipSync(rawBuf);
        } catch {
          /* fallback */
        }
      } else if (encoding.includes('deflate')) {
        try {
          rawBuf = zlib.inflateSync(rawBuf);
        } catch {
          /* fallback */
        }
      }

      const html = rawBuf.toString('utf8');
      const durationMs = Math.round(performance.now() - started);

      return {
        initialUrl: rawUrl,
        finalUrl: currentUrl,
        statusCode: code,
        redirectHops,
        isRedirectLoop: false,
        xRobotsHeader,
        httpLinkHeader,
        html,
        durationMs,
        error: null
      };
    }

    return {
      initialUrl: rawUrl,
      finalUrl: currentUrl,
      statusCode: null,
      redirectHops,
      isRedirectLoop: false,
      xRobotsHeader,
      httpLinkHeader,
      html: '',
      durationMs: Math.round(performance.now() - started),
      error: 'Max redirects exceeded'
    };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - started);
    const timedOut = controller.signal.aborted;
    const msg = timedOut ? `Request timed out after ${timeoutMs}ms` : err?.message || 'Crawl failed';

    return {
      initialUrl: rawUrl,
      finalUrl: currentUrl,
      statusCode: null,
      redirectHops,
      isRedirectLoop,
      xRobotsHeader,
      httpLinkHeader,
      html: '',
      durationMs,
      error: String(msg).slice(0, 500)
    };
  } finally {
    clearTimeout(timer);
  }
}

export const crawlUrl = crawlUrlForIndexability;

