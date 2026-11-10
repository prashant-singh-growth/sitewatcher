import { assertPublicUrlSyntax } from '@/lib/ssrf';
import { fetchSitemap } from './fetcher';
import { parseSitemapXml } from './parser';

export type DiscoveredSitemap = {
  url: string;
  source: 'auto_default' | 'robots_txt' | 'sitemap_index' | 'manual';
  parentUrl?: string;
  type?: 'index' | 'urlset' | 'unknown';
};

/**
 * Extracts all "Sitemap: <url>" declarations from a robots.txt body.
 */
export function parseRobotsTxtSitemaps(robotsContent: string, baseUrl: string): string[] {
  const sitemaps: string[] = [];
  const lines = robotsContent.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^sitemap:\s*(.+)$/i);
    if (match && match[1]) {
      let rawUrl = match[1].trim();
      // Handle comments on the same line
      const commentIdx = rawUrl.indexOf('#');
      if (commentIdx > -1) rawUrl = rawUrl.slice(0, commentIdx).trim();

      try {
        const parsed = new URL(rawUrl, baseUrl);
        assertPublicUrlSyntax(parsed.toString());
        sitemaps.push(parsed.toString());
      } catch {
        /* skip invalid url */
      }
    }
  }

  return [...new Set(sitemaps)];
}

/**
 * Discovers sitemaps for a website by probing:
 * 1. /robots.txt
 * 2. /sitemap.xml
 */
export async function discoverSitemapsForWebsite(baseUrlString: string): Promise<DiscoveredSitemap[]> {
  const base = new URL(baseUrlString);
  const origin = base.origin;
  const discovered: DiscoveredSitemap[] = [];
  const seenUrls = new Set<string>();

  // 1. Probe /robots.txt
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const robotsRes = await fetchSitemap(robotsUrl, { timeoutMs: 10000 });
    if (robotsRes.statusCode === 200 && robotsRes.body) {
      const declared = parseRobotsTxtSitemaps(robotsRes.body, origin);
      for (const smUrl of declared) {
        if (!seenUrls.has(smUrl)) {
          seenUrls.add(smUrl);
          discovered.push({
            url: smUrl,
            source: 'robots_txt',
            type: 'unknown'
          });
        }
      }
    }
  } catch {
    /* ignore robots.txt fetch error */
  }

  // 2. Probe default /sitemap.xml
  const defaultSitemap = `${origin}/sitemap.xml`;
  if (!seenUrls.has(defaultSitemap)) {
    try {
      const probeRes = await fetchSitemap(defaultSitemap, { timeoutMs: 10000 });
      if (probeRes.statusCode === 200 && probeRes.body) {
        let type: 'index' | 'urlset' | 'unknown' = 'unknown';
        try {
          const parsed = parseSitemapXml(probeRes.body);
          type = parsed.type;
        } catch {
          // Keep as unknown if parse fails
        }

        seenUrls.add(defaultSitemap);
        discovered.push({
          url: defaultSitemap,
          source: 'auto_default',
          type
        });
      }
    } catch {
      /* ignore */
    }
  }

  // If none discovered so far, still include default /sitemap.xml so monitoring can track it (or show 404 issue)
  if (discovered.length === 0) {
    discovered.push({
      url: defaultSitemap,
      source: 'auto_default',
      type: 'unknown'
    });
  }

  return discovered;
}
