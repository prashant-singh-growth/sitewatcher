// HTML & HTTP Directives Parser for Technical Indexability Assessment

export type CanonicalStatus =
  | 'self_referencing'
  | 'canonicalized'
  | 'cross_domain'
  | 'missing'
  | 'multiple'
  | 'invalid';

export type RobotsDirectivesStatus = 'indexable' | 'noindex' | 'conflicting';

export type ParsedIndexabilitySignals = {
  // Raw extracted values
  metaRobots: string | null;
  metaGooglebot: string | null;
  xRobotsTag: string | null;
  rawCanonicals: string[];

  // Parsed signals
  hasNoindex: boolean;
  hasNofollow: boolean;
  noindexSource: 'meta_robots' | 'meta_googlebot' | 'x_robots_tag' | 'none';
  hasConflict: boolean;
  robotsStatus: RobotsDirectivesStatus;

  // Canonical analysis
  canonicalUrl: string | null;
  canonicalStatus: CanonicalStatus;

  // Final technical indexability verdict
  isTechnicallyIndexable: boolean;
  indexabilityReasons: string[];
};

/**
 * Normalizes URL for strict equality comparisons (lowercases origin, standardizes trailing slash).
 */
export function normalizeUrlForComparison(raw: string): string {
  try {
    const u = new URL(raw);
    let p = u.pathname;
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1);
    }
    return `${u.protocol}//${u.host.toLowerCase()}${p}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Parses comma-separated directives string (e.g. "noindex, follow, noarchive").
 */
export function parseDirectiveTokens(val: string | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!val) return set;
  const parts = val.toLowerCase().split(/[,;]+/);
  for (const part of parts) {
    const cleaned = part.trim();
    if (cleaned) set.add(cleaned);
  }
  return set;
}

/**
 * Extracts meta tags from HTML head string using regex.
 */
function extractHeadChunk(html: string): string {
  // Search inside <head> (case-insensitive) or limit search to first 250KB of HTML
  const headEndIdx = html.search(/<\/head>/i);
  return headEndIdx > -1 ? html.slice(0, headEndIdx + 7) : html.slice(0, 250000);
}

function getHtmlAttr(attrs: string, attrName: string): string | null {
  const regex = new RegExp(`(?:^|[\\s"'])${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i');
  const match = regex.exec(attrs);
  if (!match) return null;
  const val = match[1] ?? match[2] ?? match[3];
  return val !== undefined ? val.trim() : null;
}

export function extractMetaRobotsFromHtml(html: string): { metaRobots: string | null; metaGooglebot: string | null } {
  let metaRobots: string | null = null;
  let metaGooglebot: string | null = null;

  const searchChunk = extractHeadChunk(html);

  // Match <meta name="..." content="..."> or unquoted/reordered attributes
  const metaRegex = /<meta\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaRegex.exec(searchChunk)) !== null) {
    const attrs = match[1];
    const nameRaw = getHtmlAttr(attrs, 'name');
    const contentRaw = getHtmlAttr(attrs, 'content');

    if (nameRaw && contentRaw !== null) {
      const name = nameRaw.toLowerCase();

      if (name === 'robots') {
        metaRobots = metaRobots ? `${metaRobots}, ${contentRaw}` : contentRaw;
      } else if (name === 'googlebot') {
        metaGooglebot = metaGooglebot ? `${metaGooglebot}, ${contentRaw}` : contentRaw;
      }
    }
  }

  return { metaRobots, metaGooglebot };
}

/**
 * Extracts canonical tags from HTML and HTTP Link headers.
 */
export function extractCanonicals(html: string, httpLinkHeader?: string | null): string[] {
  const canonicals: string[] = [];

  // 1. From HTTP Link header: Link: <https://example.com/page>; rel="canonical"
  if (httpLinkHeader) {
    const linkParts = httpLinkHeader.split(',');
    for (const part of linkParts) {
      const linkMatch = /<([^>]+)>\s*;\s*rel=["']?canonical["']?/i.exec(part);
      if (linkMatch && linkMatch[1]) {
        canonicals.push(linkMatch[1].trim());
      }
    }
  }

  // 2. From HTML <link rel="canonical" href="..."> (supports unquoted/minified attrs)
  const searchChunk = extractHeadChunk(html);

  const linkRegex = /<link\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(searchChunk)) !== null) {
    const attrs = match[1];
    const rel = getHtmlAttr(attrs, 'rel');
    if (!rel || !rel.toLowerCase().split(/\s+/).includes('canonical')) continue;

    const href = getHtmlAttr(attrs, 'href');
    if (href) {
      canonicals.push(href);
    }
  }

  return canonicals;
}

/**
 * Analyzes canonical signals relative to current page URL.
 */
export function evaluateCanonical(currentUrl: string, rawCanonicals: string[]): { canonicalUrl: string | null; status: CanonicalStatus } {
  if (rawCanonicals.length === 0) {
    return { canonicalUrl: null, status: 'missing' };
  }

  if (rawCanonicals.length > 1) {
    // Multiple conflicting canonicals cause search engines to ignore canonicals
    return { canonicalUrl: null, status: 'multiple' };
  }

  const raw = rawCanonicals[0];
  let resolvedUrl: string;

  try {
    resolvedUrl = new URL(raw, currentUrl).toString();
  } catch {
    return { canonicalUrl: raw, status: 'invalid' };
  }

  const normCurrent = normalizeUrlForComparison(currentUrl);
  const normCanonical = normalizeUrlForComparison(resolvedUrl);

  if (normCurrent === normCanonical) {
    return { canonicalUrl: resolvedUrl, status: 'self_referencing' };
  }

  try {
    const currHost = new URL(currentUrl).hostname.toLowerCase();
    const canoHost = new URL(resolvedUrl).hostname.toLowerCase();

    if (currHost !== canoHost) {
      return { canonicalUrl: resolvedUrl, status: 'cross_domain' };
    }
  } catch {
    // fallback
  }

  return { canonicalUrl: resolvedUrl, status: 'canonicalized' };
}

/**
 * Parses all indexability signals and produces an overall technical indexability verdict.
 */
export function evaluateTechnicalIndexability(params: {
  url: string;
  httpStatus: number | null;
  html: string;
  xRobotsHeader?: string | null;
  httpLinkHeader?: string | null;
}): ParsedIndexabilitySignals {
  const { url, httpStatus, html, xRobotsHeader, httpLinkHeader } = params;

  // Extract meta tags
  const { metaRobots, metaGooglebot } = extractMetaRobotsFromHtml(html);
  const xRobotsTag = xRobotsHeader ? xRobotsHeader.trim() : null;

  // Directives tokens
  const robotsTokens = parseDirectiveTokens(metaRobots);
  const googlebotTokens = parseDirectiveTokens(metaGooglebot);
  const xRobotsTokens = parseDirectiveTokens(xRobotsTag);

  // Check noindex across all sources
  const noindexInRobots = robotsTokens.has('noindex') || robotsTokens.has('none');
  const noindexInGooglebot = googlebotTokens.has('noindex') || googlebotTokens.has('none');
  const noindexInHeader = xRobotsTokens.has('noindex') || xRobotsTokens.has('none');

  const hasNoindex = noindexInRobots || noindexInGooglebot || noindexInHeader;

  let noindexSource: 'meta_robots' | 'meta_googlebot' | 'x_robots_tag' | 'none' = 'none';
  if (noindexInHeader) noindexSource = 'x_robots_tag';
  else if (noindexInGooglebot) noindexSource = 'meta_googlebot';
  else if (noindexInRobots) noindexSource = 'meta_robots';

  // Check nofollow (clarified that nofollow alone != noindex)
  const hasNofollow = robotsTokens.has('nofollow') || googlebotTokens.has('nofollow') || xRobotsTokens.has('nofollow') || robotsTokens.has('none');

  // Conflict detection: e.g. "index" declared alongside "noindex"
  const hasConflict = (robotsTokens.has('index') && robotsTokens.has('noindex')) ||
                      (googlebotTokens.has('index') && googlebotTokens.has('noindex')) ||
                      (xRobotsTokens.has('index') && xRobotsTokens.has('noindex'));

  const robotsStatus: RobotsDirectivesStatus = hasNoindex ? 'noindex' : hasConflict ? 'conflicting' : 'indexable';

  // Canonical tag analysis
  const rawCanonicals = extractCanonicals(html, httpLinkHeader);
  const { canonicalUrl, status: canonicalStatus } = evaluateCanonical(url, rawCanonicals);

  // Evaluation reasons
  const indexabilityReasons: string[] = [];

  if (httpStatus !== 200) {
    indexabilityReasons.push(`HTTP status is ${httpStatus ?? 'unreachable'} (expected 200 OK)`);
  }

  if (hasNoindex) {
    indexabilityReasons.push(`Blocked by noindex directive via ${noindexSource.replace('_', ' ')}`);
  }

  if (canonicalStatus === 'canonicalized') {
    indexabilityReasons.push(`Canonical points to another URL (${canonicalUrl})`);
  } else if (canonicalStatus === 'multiple') {
    indexabilityReasons.push(`Multiple conflicting canonical tags detected in HTML`);
  } else if (canonicalStatus === 'invalid') {
    indexabilityReasons.push(`Invalid or unparseable canonical URL (${canonicalUrl})`);
  }

  // A page is technically indexable IF:
  // 1. HTTP 200 OK
  // 2. No noindex directive
  // 3. Not canonicalized away to another URL
  const isTechnicallyIndexable =
    httpStatus === 200 &&
    !hasNoindex &&
    (canonicalStatus === 'self_referencing' || canonicalStatus === 'missing');

  if (isTechnicallyIndexable) {
    indexabilityReasons.push('HTTP 200 OK, no noindex directives, canonical is self-referencing or clean');
  }

  return {
    metaRobots,
    metaGooglebot,
    xRobotsTag,
    rawCanonicals,
    hasNoindex,
    hasNofollow,
    noindexSource,
    hasConflict,
    robotsStatus,
    canonicalUrl,
    canonicalStatus,
    isTechnicallyIndexable,
    indexabilityReasons
  };
}

export const parseIndexabilitySignals = evaluateTechnicalIndexability;

export const MAX_MANUAL_INDEXABILITY_URLS = 200;

/**
 * Parses and validates single or bulk manual URL input (newline- or comma-separated, full URLs or /paths)
 * against the monitored website's origin.
 */
export function parseManualUrlInputs(
  rawInput: string | string[],
  siteOriginUrl: string
): { urls: string[]; errors: string[] } {
  let siteOrigin: string;
  try {
    siteOrigin = new URL(siteOriginUrl).origin;
  } catch {
    return { urls: [], errors: ['Invalid website origin URL.'] };
  }

  const rawItems = Array.isArray(rawInput)
    ? rawInput.flatMap(item => String(item ?? '').split(/\r?\n/))
    : String(rawInput ?? '').split(/\r?\n/);

  const tokens: string[] = [];
  for (const line of rawItems) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/,\s*(?=https?:\/\/|\/)/i);
    for (const part of parts) {
      const token = part.trim();
      if (token) tokens.push(token);
    }
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  const errors: string[] = [];

  for (const raw of tokens) {
    let candidate = raw;
    if (raw.startsWith('/') && !raw.startsWith('//')) {
      candidate = `${siteOrigin}${raw}`;
    } else if (!/^https?:\/\//i.test(raw)) {
      errors.push(`"${raw}": URL must start with http(s):// or /path.`);
      continue;
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.username || parsed.password) {
        errors.push(`"${raw}": Credentials in URL are not allowed.`);
        continue;
      }
      if (parsed.origin.toLowerCase() !== siteOrigin.toLowerCase()) {
        errors.push(`"${raw}": URL must belong to website origin (${siteOrigin}).`);
        continue;
      }
      const normalized = parsed.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } catch {
      errors.push(`"${raw}": Invalid URL format.`);
    }
  }

  if (urls.length > MAX_MANUAL_INDEXABILITY_URLS) {
    errors.push(`Too many unique URLs (${urls.length}). Maximum ${MAX_MANUAL_INDEXABILITY_URLS} URLs per batch.`);
  }

  return { urls, errors };
}

