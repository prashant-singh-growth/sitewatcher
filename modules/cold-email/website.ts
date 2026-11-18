import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { assertPublicUrlSyntax, safeLookup } from '@/lib/ssrf';
import { extractPageSummary } from './sanitizer';

export { extractPageSummary };

const MAX_BYTES = 512 * 1024; // 512KB
const MAX_REDIRECTS = 3;

/**
 * Fetches a single hop with SSRF protection, timeout, and size limits.
 */
function fetchHop(
  url: URL,
  signal: AbortSignal
): Promise<{ status: number; location?: string; buffer: Buffer; encoding?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'GET',
        signal,
        lookup: safeLookup as any, // Protects against DNS rebinding and internal IP access
        headers: {
          'User-Agent': 'SiteWatch-Bot/2.0 (+https://sitewatch.io; Cold Email Research)',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      },
      res => {
        const chunks: Buffer[] = [];
        let total = 0;

        res.on('data', chunk => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            location: res.headers.location,
            buffer: Buffer.concat(chunks),
            encoding: res.headers['content-encoding']
          });
        });

        res.on('close', () => {
          resolve({
            status: res.statusCode || 0,
            location: res.headers.location,
            buffer: Buffer.concat(chunks),
            encoding: res.headers['content-encoding']
          });
        });

        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.end();
  });
}

/**
 * Server-side website context fetcher with SSRF protection.
 * Returns visible text summary or null on failure (never crashes).
 */
export async function fetchWebsiteContext(
  rawUrl: string,
  timeoutMs = 8000
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = assertPublicUrlSyntax(rawUrl);

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const hop = await fetchHop(url, controller.signal);

      // Handle redirects
      if (hop.status >= 300 && hop.status < 400 && hop.location) {
        if (i >= MAX_REDIRECTS) break;
        url = assertPublicUrlSyntax(new URL(hop.location, url).toString());
        continue;
      }

      if (hop.status < 200 || hop.status >= 400) {
        return null;
      }

      // Decompress if needed
      let buf = hop.buffer;
      const enc = (hop.encoding || '').toLowerCase();
      try {
        if (enc.includes('gzip') || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)) {
          buf = zlib.gunzipSync(buf);
        } else if (enc.includes('deflate')) {
          buf = zlib.inflateSync(buf);
        } else if (enc.includes('br')) {
          buf = zlib.brotliDecompressSync(buf);
        }
      } catch {
        // Fallback to raw buffer
      }

      const html = buf.toString('utf8');
      if (!html.trim()) return null;

      const summary = extractPageSummary(html);
      return summary || null;
    }

    return null;
  } catch {
    // Continue without website context on any failure (timeout, network, SSRF rejection)
    return null;
  } finally {
    clearTimeout(timer);
  }
}
