import zlib from 'node:zlib';

export type SitemapUrlEntry = {
  loc: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: number | null;
};

export type ChildSitemapEntry = {
  loc: string;
  lastmod: string | null;
};

export type ParsedSitemap = {
  type: 'index' | 'urlset';
  urls: SitemapUrlEntry[];
  childSitemaps: ChildSitemapEntry[];
  rawCount: number;
};

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlParseError';
  }
}

/** Decode XML entities and CDATA wrappers */
export function decodeXmlText(text: string): string {
  let cleaned = text.trim();
  // Strip CDATA wrapper if present
  const cdataMatch = cleaned.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  if (cdataMatch) cleaned = cdataMatch[1];

  return cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/** Parse an optional lastmod value into an ISO string, or null if invalid/missing */
export function parseLastmod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const decoded = decodeXmlText(raw);
  if (!decoded) return null;
  const d = new Date(decoded);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Decompresses gzip if buffer or string is gzipped */
export function maybeDecompress(input: Buffer | string): string {
  if (typeof input === 'string') {
    // If it's already a string, check if it starts with gzip magic header bytes 0x1f, 0x8b
    const buf = Buffer.from(input, 'binary');
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      try {
        return zlib.gunzipSync(buf).toString('utf8');
      } catch {
        /* fallback to raw input */
      }
    }
    return input;
  }
  if (Buffer.isBuffer(input)) {
    if (input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b) {
      try {
        return zlib.gunzipSync(input).toString('utf8');
      } catch {
        /* fallback */
      }
    }
    return input.toString('utf8');
  }
  return String(input);
}

/**
 * Validates XML structure and parses sitemap XML (urlset or sitemapindex).
 * Throws XmlParseError when the content is malformed XML, HTML, or unparseable.
 */
export function parseSitemapXml(rawInput: Buffer | string): ParsedSitemap {
  const content = maybeDecompress(rawInput).trim();

  if (!content) {
    throw new XmlParseError('Sitemap is empty.');
  }

  // Check if server returned HTML error page (common misconfiguration where 404 or 500 returns 200 HTML)
  const lower = content.toLowerCase();
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html') || (lower.includes('<body') && !lower.includes('<urlset') && !lower.includes('<sitemapindex'))) {
    throw new XmlParseError('Received HTML instead of XML document.');
  }

  const isIndex = /<sitemapindex[\s>]/i.test(content);
  const isUrlset = /<urlset[\s>]/i.test(content);

  if (!isIndex && !isUrlset) {
    throw new XmlParseError('XML root is neither <urlset> nor <sitemapindex>.');
  }

  // Check for closing root tag to ensure XML is not truncated or incomplete
  if (isIndex && !/<\/sitemapindex\s*>/i.test(content)) {
    throw new XmlParseError('Malformed XML: missing closing </sitemapindex> tag.');
  }
  if (isUrlset && !/<\/urlset\s*>/i.test(content)) {
    throw new XmlParseError('Malformed XML: missing closing </urlset> tag.');
  }

  if (isIndex) {
    return parseSitemapIndex(content);
  } else {
    return parseUrlset(content);
  }
}

function parseSitemapIndex(content: string): ParsedSitemap {
  const childSitemaps: ChildSitemapEntry[] = [];
  const sitemapBlockRegex = /<sitemap(?:\s+[^>]*)?>([\s\S]*?)<\/sitemap>/gi;
  let match: RegExpExecArray | null;

  while ((match = sitemapBlockRegex.exec(content)) !== null) {
    const block = match[1];
    const locMatch = /<loc(?:\s+[^>]*)?>([\s\S]*?)<\/loc>/i.exec(block);
    if (!locMatch) continue;

    const loc = decodeXmlText(locMatch[1]);
    if (!loc || !loc.startsWith('http')) continue;

    const lastmodMatch = /<lastmod(?:\s+[^>]*)?>([\s\S]*?)<\/lastmod>/i.exec(block);
    const lastmod = parseLastmod(lastmodMatch ? lastmodMatch[1] : null);

    childSitemaps.push({ loc, lastmod });
  }

  return {
    type: 'index',
    urls: [],
    childSitemaps,
    rawCount: childSitemaps.length
  };
}

function parseUrlset(content: string): ParsedSitemap {
  const urls: SitemapUrlEntry[] = [];
  const seenLocs = new Set<string>();
  const urlBlockRegex = /<url(?:\s+[^>]*)?>([\s\S]*?)<\/url>/gi;
  let match: RegExpExecArray | null;

  while ((match = urlBlockRegex.exec(content)) !== null) {
    const block = match[1];
    const locMatch = /<loc(?:\s+[^>]*)?>([\s\S]*?)<\/loc>/i.exec(block);
    if (!locMatch) continue;

    const loc = decodeXmlText(locMatch[1]);
    if (!loc || !loc.startsWith('http')) continue;

    // Deduplicate within the same sitemap if duplicate <loc> tags exist
    if (seenLocs.has(loc)) continue;
    seenLocs.add(loc);

    const lastmodMatch = /<lastmod(?:\s+[^>]*)?>([\s\S]*?)<\/lastmod>/i.exec(block);
    const lastmod = parseLastmod(lastmodMatch ? lastmodMatch[1] : null);

    const freqMatch = /<changefreq(?:\s+[^>]*)?>([\s\S]*?)<\/changefreq>/i.exec(block);
    const changefreq = freqMatch ? decodeXmlText(freqMatch[1]).toLowerCase().slice(0, 20) : null;

    const prioMatch = /<priority(?:\s+[^>]*)?>([\s\S]*?)<\/priority>/i.exec(block);
    let priority: number | null = null;
    if (prioMatch) {
      const p = parseFloat(decodeXmlText(prioMatch[1]));
      if (!isNaN(p) && p >= 0 && p <= 1.0) priority = Math.round(p * 100) / 100;
    }

    urls.push({ loc, lastmod, changefreq, priority });
  }

  return {
    type: 'urlset',
    urls,
    childSitemaps: [],
    rawCount: urls.length
  };
}
