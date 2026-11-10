import crypto from 'node:crypto';
import { db, rows } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertPublicUrlSyntax } from '@/lib/ssrf';
import { crawlUrl, type CrawlResult } from './crawler';
import { parseIndexabilitySignals, type ParsedIndexabilitySignals } from './parser';
import { evaluatePageIndexabilityIssues } from './issues';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

/**
 * Ensures an indexability_monitors record exists for a website.
 */
export async function ensureIndexabilityMonitor(siteId: number, projectId: number) {
  await db.query(
    `INSERT INTO indexability_monitors (
       project_id, site_id, is_active, check_interval_hours, next_run_at
     ) VALUES (?, ?, 1, 24, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE updated_at = updated_at`,
    [projectId, siteId]
  );

  const existing = await rows<any>('SELECT * FROM indexability_monitors WHERE site_id = ?', [siteId]);
  return existing[0];
}

/**
 * Discovers and seeds candidate URLs for indexability checks:
 * 1. Root page of the website (source = 'root')
 * 2. Discovered URLs from XML sitemaps (source = 'sitemap')
 */
export async function syncCandidateUrlsForSite(
  siteId: number,
  projectId: number,
  siteUrl: string,
  limit: number = 200
): Promise<number> {
  let seededCount = 0;

  // 1. Root URL
  try {
    const origin = new URL(siteUrl).origin;
    const rootUrl = `${origin}/`;
    const rootHash = sha256(rootUrl);

    const [res] = await db.query<any>(
      `INSERT IGNORE INTO url_indexability_pages (
         project_id, site_id, url, url_hash, source, first_checked_at, last_checked_at
       ) VALUES (?, ?, ?, ?, 'root', UTC_TIMESTAMP(3), '1970-01-01 00:00:00')`,
      [projectId, siteId, rootUrl, rootHash]
    );
    if (res.affectedRows > 0) seededCount++;
  } catch {
    // Ignore invalid root URL syntax
  }

  // 2. Discovered URLs from sitemaps
  const sitemapUrls = await rows<{ url: string }>(
    `SELECT DISTINCT loc AS url FROM sitemap_urls WHERE site_id = ? AND status = 'active' LIMIT ?`,
    [siteId, limit]
  );

  if (sitemapUrls.length > 0) {
    const CHUNK = 50;
    for (let i = 0; i < sitemapUrls.length; i += CHUNK) {
      const slice = sitemapUrls.slice(i, i + CHUNK);
      const valSql = slice.map(() => '(?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)').join(',');
      const params: any[] = [];
      for (const item of slice) {
        params.push(projectId, siteId, item.url, sha256(item.url), 'sitemap', '1970-01-01 00:00:00');
      }

      const [insertRes] = await db.query<any>(
        `INSERT IGNORE INTO url_indexability_pages (
           project_id, site_id, url, url_hash, source, first_checked_at, last_checked_at
         ) VALUES ${valSql}`,
        params
      );
      seededCount += insertRes.affectedRows || 0;
    }
  }

  return seededCount;
}

/**
 * Crawls, parses, snapshots, and updates a single page.
 */
export async function checkSingleUrlIndexability(
  pageId: number,
  siteId: number,
  projectId: number,
  url: string,
  previousState?: {
    httpStatus: number | null;
    isIndexable: boolean;
    hasNoindex: boolean;
    canonicalUrl: string | null;
    canonicalStatus: string;
  } | null
): Promise<{ crawlResult: CrawlResult; parsed: ParsedIndexabilitySignals }> {
  const crawlResult = await crawlUrl(url, { timeoutMs: 15000 });
  const parsed = parseIndexabilitySignals({
    url,
    html: crawlResult.html,
    xRobotsHeader: crawlResult.xRobotsHeader,
    httpLinkHeader: crawlResult.httpLinkHeader,
    httpStatus: crawlResult.statusCode
  });

  // Check if status changed
  const isStatusChanged = previousState != null && (
    Boolean(previousState.isIndexable) !== parsed.isTechnicallyIndexable ||
    Boolean(previousState.hasNoindex) !== parsed.hasNoindex ||
    previousState.httpStatus !== crawlResult.statusCode ||
    previousState.canonicalStatus !== parsed.canonicalStatus
  );

  // Record historical snapshot
  await db.query(
    `INSERT INTO url_indexability_snapshots (
       page_id, site_id, project_id, url, http_status, is_indexable, has_noindex,
       meta_robots, meta_googlebot, x_robots_tag, canonical_url, canonical_status,
       redirect_destination, error_message, checked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      pageId,
      siteId,
      projectId,
      url,
      crawlResult.statusCode,
      parsed.isTechnicallyIndexable ? 1 : 0,
      parsed.hasNoindex ? 1 : 0,
      parsed.metaRobots,
      parsed.metaGooglebot,
      parsed.xRobotsTag,
      parsed.canonicalUrl,
      parsed.canonicalStatus,
      crawlResult.finalUrl !== url ? crawlResult.finalUrl : null,
      crawlResult.error ? crawlResult.error.slice(0, 500) : null
    ]
  );

  // Update page record
  await db.query(
    `UPDATE url_indexability_pages
     SET http_status = ?,
         is_indexable = ?,
         previous_is_indexable = IF(previous_is_indexable IS NULL, ?, previous_is_indexable),
         has_noindex = ?,
         noindex_source = ?,
         meta_robots = ?,
         meta_googlebot = ?,
         x_robots_tag = ?,
         canonical_url = ?,
         canonical_status = ?,
         redirect_destination = ?,
         redirect_hops = ?,
         status_changed_at = IF(? = 1, UTC_TIMESTAMP(3), status_changed_at),
         last_checked_at = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [
      crawlResult.statusCode,
      parsed.isTechnicallyIndexable ? 1 : 0,
      parsed.isTechnicallyIndexable ? 1 : 0,
      parsed.hasNoindex ? 1 : 0,
      parsed.noindexSource !== 'none' ? parsed.noindexSource : null,
      parsed.metaRobots,
      parsed.metaGooglebot,
      parsed.xRobotsTag,
      parsed.canonicalUrl,
      parsed.canonicalStatus,
      crawlResult.finalUrl !== url ? crawlResult.finalUrl : null,
      crawlResult.redirectHops,
      isStatusChanged ? 1 : 0,
      pageId
    ]
  );

  // Evaluate issues & auto-resolutions
  await evaluatePageIndexabilityIssues({
    projectId,
    siteId,
    pageId,
    url,
    previousState,
    crawlResult,
    parsed
  });

  return { crawlResult, parsed };
}

export type SiteIndexabilitySummary = {
  siteId: number;
  totalMonitored: number;
  checkedCount: number;
  indexableCount: number;
  noindexCount: number;
  canonicalIssuesCount: number;
  errorsCount: number;
  recentlyChangedCount: number;
};

/**
 * Runs an indexability evaluation across candidate URLs for a website.
 */
export async function checkSiteIndexability(
  siteId: number,
  options?: { maxPages?: number; triggeredBy?: 'cron' | 'manual' }
): Promise<SiteIndexabilitySummary> {
  const maxPages = options?.maxPages ?? 50;

  const siteList = await rows<any>(
    'SELECT s.id, s.project_id, s.name, s.url, p.status AS project_status FROM monitored_sites s JOIN projects p ON p.id = s.project_id WHERE s.id = ?',
    [siteId]
  );
  const site = siteList[0];
  if (!site) throw new ApiError(404, 'Website not found.');

  await ensureIndexabilityMonitor(site.id, Number(site.project_id));
  await syncCandidateUrlsForSite(site.id, Number(site.project_id), site.url, 200);

  // Select pages to check ordered by oldest checked first
  const pagesToCheck = await rows<any>(
    `SELECT id, url, http_status, is_indexable, has_noindex, canonical_url, canonical_status, last_checked_at
     FROM url_indexability_pages
     WHERE site_id = ?
     ORDER BY last_checked_at ASC
     LIMIT ?`,
    [siteId, maxPages]
  );

  let checkedCount = 0;
  for (const page of pagesToCheck) {
    const prev = page.last_checked_at && new Date(page.last_checked_at).getFullYear() > 1970
      ? {
          httpStatus: page.http_status,
          isIndexable: Boolean(page.is_indexable),
          hasNoindex: Boolean(page.has_noindex),
          canonicalUrl: page.canonical_url,
          canonicalStatus: page.canonical_status
        }
      : null;

    try {
      await checkSingleUrlIndexability(page.id, siteId, Number(site.project_id), page.url, prev);
      checkedCount++;
    } catch {
      // Continue next page on unexpected error
    }

    // Polite crawl throttle
    if (pagesToCheck.length > 1) {
      await new Promise(r => setTimeout(r, 60));
    }
  }

  // Recalculate site-level aggregated metrics
  const statsRows = await rows<any>(
    `SELECT
       COUNT(*) AS total_monitored_urls,
       SUM(CASE WHEN is_indexable = 1 THEN 1 ELSE 0 END) AS indexable_urls_count,
       SUM(CASE WHEN has_noindex = 1 THEN 1 ELSE 0 END) AS noindex_urls_count,
       SUM(CASE WHEN canonical_status IN ('multiple', 'invalid', 'canonicalized', 'cross_domain') THEN 1 ELSE 0 END) AS canonical_issues_count,
       SUM(CASE WHEN (http_status >= 400 OR http_status IS NULL) AND last_checked_at > '1970-01-01' THEN 1 ELSE 0 END) AS error_urls_count,
       SUM(CASE WHEN status_changed_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS recently_changed_count
     FROM url_indexability_pages
     WHERE site_id = ?`,
    [siteId]
  );

  const stats = statsRows[0] || {};
  const totalMonitored = Number(stats.total_monitored_urls || 0);
  const indexableCount = Number(stats.indexable_urls_count || 0);
  const noindexCount = Number(stats.noindex_urls_count || 0);
  const canonicalIssuesCount = Number(stats.canonical_issues_count || 0);
  const errorsCount = Number(stats.error_urls_count || 0);
  const recentlyChangedCount = Number(stats.recently_changed_count || 0);

  await db.query(
    `UPDATE indexability_monitors
     SET total_monitored_urls = ?,
         indexable_urls_count = ?,
         noindex_urls_count = ?,
         canonical_issues_count = ?,
         error_urls_count = ?,
         recently_changed_count = ?,
         last_checked_at = UTC_TIMESTAMP(3),
         claim_token = NULL,
         claimed_at = NULL,
         next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL check_interval_hours HOUR),
         updated_at = updated_at
     WHERE site_id = ?`,
    [
      totalMonitored,
      indexableCount,
      noindexCount,
      canonicalIssuesCount,
      errorsCount,
      recentlyChangedCount,
      siteId
    ]
  );

  return {
    siteId,
    totalMonitored,
    checkedCount,
    indexableCount,
    noindexCount,
    canonicalIssuesCount,
    errorsCount,
    recentlyChangedCount
  };
}

/**
 * Manually adds a custom URL for indexability monitoring and checks it immediately.
 */
export async function addManualUrlToIndexability(
  siteId: number,
  projectId: number,
  rawUrl: string
) {
  assertPublicUrlSyntax(rawUrl);

  const siteList = await rows<any>('SELECT url FROM monitored_sites WHERE id = ?', [siteId]);
  const site = siteList[0];
  if (!site) throw new ApiError(404, 'Website not found.');

  // Ensure same origin or valid protocol
  const targetUrl = new URL(rawUrl);
  const siteOrigin = new URL(site.url).origin;
  if (targetUrl.origin.toLowerCase() !== siteOrigin.toLowerCase()) {
    throw new ApiError(400, `URL must belong to website origin (${siteOrigin}).`);
  }

  const urlHash = sha256(rawUrl);

  await db.query(
    `INSERT INTO url_indexability_pages (
       project_id, site_id, url, url_hash, source, first_checked_at, last_checked_at
     ) VALUES (?, ?, ?, ?, 'manual', UTC_TIMESTAMP(3), '1970-01-01 00:00:00')
     ON DUPLICATE KEY UPDATE source = VALUES(source)`,
    [projectId, siteId, rawUrl, urlHash]
  );

  const page = (await rows<any>(
    'SELECT * FROM url_indexability_pages WHERE site_id = ? AND url_hash = ?',
    [siteId, urlHash]
  ))[0];

  if (page) {
    await checkSingleUrlIndexability(page.id, siteId, projectId, rawUrl, null);
  }

  // Refresh monitor counts
  await checkSiteIndexability(siteId, { maxPages: 0 });

  return (await rows<any>('SELECT * FROM url_indexability_pages WHERE id = ?', [page.id]))[0];
}

/**
 * Returns overall indexability stats for a website or project.
 */
export async function getIndexabilityStats(siteId?: number, projectId?: number) {
  const params: any[] = [];
  let filter = 'WHERE 1=1';
  if (siteId) {
    filter += ' AND im.site_id = ?';
    params.push(siteId);
  } else if (projectId) {
    filter += ' AND im.project_id = ?';
    params.push(projectId);
  }

  const monitors = await rows<any>(
    `SELECT im.*, ms.name AS site_name, ms.url AS site_url
     FROM indexability_monitors im
     JOIN monitored_sites ms ON ms.id = im.site_id
     ${filter}
     ORDER BY ms.name ASC`,
    params
  );

  const totalMonitored = monitors.reduce((sum, m) => sum + Number(m.total_monitored_urls || 0), 0);
  const totalIndexable = monitors.reduce((sum, m) => sum + Number(m.indexable_urls_count || 0), 0);
  const totalNoindex = monitors.reduce((sum, m) => sum + Number(m.noindex_urls_count || 0), 0);
  const totalCanonicalIssues = monitors.reduce((sum, m) => sum + Number(m.canonical_issues_count || 0), 0);
  const totalErrors = monitors.reduce((sum, m) => sum + Number(m.error_urls_count || 0), 0);
  const totalChanged = monitors.reduce((sum, m) => sum + Number(m.recently_changed_count || 0), 0);

  // Issues
  const issueFilter = siteId ? 'WHERE i.site_id = ?' : projectId ? 'WHERE i.project_id = ?' : 'WHERE 1=1';
  const issueParams = siteId ? [siteId] : projectId ? [projectId] : [];

  const openIssues = await rows<any>(
    `SELECT i.*, ms.name AS site_name, ms.url AS site_url
     FROM indexability_issues i
     JOIN monitored_sites ms ON ms.id = i.site_id
     ${issueFilter} AND i.resolved_at IS NULL
     ORDER BY i.severity = 'critical' DESC, i.last_detected_at DESC`,
    issueParams
  );

  return {
    monitors,
    summary: {
      totalMonitored,
      totalIndexable,
      totalNoindex,
      totalCanonicalIssues,
      totalErrors,
      totalChanged,
      openIssuesCount: openIssues.length
    },
    openIssues
  };
}

/**
 * Returns paginated, searchable, status-filtered evaluated URLs for a site.
 */
export async function getEvaluatedUrls(
  siteId: number,
  projectId: number,
  opts?: {
    page?: number;
    limit?: number;
    status?: 'all' | 'indexable' | 'noindex' | 'canonical_issue' | 'errors' | 'changed';
    search?: string;
  }
) {
  const page = Math.max(1, opts?.page || 1);
  const limit = Math.min(100, Math.max(1, opts?.limit || 25));
  const offset = (page - 1) * limit;

  let where = 'WHERE u.site_id = ? AND u.project_id = ?';
  const params: any[] = [siteId, projectId];

  if (opts?.status === 'indexable') {
    where += ' AND u.is_indexable = 1';
  } else if (opts?.status === 'noindex') {
    where += ' AND u.has_noindex = 1';
  } else if (opts?.status === 'canonical_issue') {
    where += " AND u.canonical_status IN ('multiple', 'invalid', 'canonicalized', 'cross_domain')";
  } else if (opts?.status === 'errors') {
    where += " AND (u.http_status >= 400 OR u.http_status IS NULL) AND u.last_checked_at > '1970-01-01'";
  } else if (opts?.status === 'changed') {
    where += ' AND u.status_changed_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)';
  }

  if (opts?.search && opts.search.trim()) {
    where += ' AND u.url LIKE ?';
    params.push(`%${opts.search.trim()}%`);
  }

  const countRow = await rows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM url_indexability_pages u ${where}`,
    params
  );
  const total = countRow[0]?.total || 0;

  const items = await rows<any>(
    `SELECT u.*
     FROM url_indexability_pages u
     ${where}
     ORDER BY u.has_noindex DESC, (u.http_status >= 400) DESC, u.last_checked_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Returns historical crawl snapshots and current status for a single URL.
 */
export async function getUrlHistory(pageId: number, siteId: number, projectId: number) {
  const pageList = await rows<any>(
    'SELECT * FROM url_indexability_pages WHERE id = ? AND site_id = ? AND project_id = ?',
    [pageId, siteId, projectId]
  );
  const page = pageList[0];
  if (!page) throw new ApiError(404, 'Monitored URL not found.');

  const snapshots = await rows<any>(
    `SELECT * FROM url_indexability_snapshots
     WHERE page_id = ?
     ORDER BY checked_at DESC
     LIMIT 30`,
    [pageId]
  );

  const issues = await rows<any>(
    `SELECT * FROM indexability_issues
     WHERE url = ? AND site_id = ?
     ORDER BY resolved_at IS NULL DESC, last_detected_at DESC`,
    [page.url, siteId]
  );

  return {
    page,
    snapshots,
    issues
  };
}

/**
 * Cron runner: claims and processes due indexability monitoring checks.
 */
export async function runDueIndexabilityChecks(
  startedAt: Date,
  maxSites: number = 2,
  budgetMs: number = 40_000
): Promise<number> {
  let processed = 0;

  for (let i = 0; i < maxSites; i++) {
    if (Date.now() - startedAt.getTime() > budgetMs) {
      break;
    }

    const claimToken = crypto.randomBytes(16).toString('hex');
    const [claimRes] = await db.query<any>(
      `UPDATE indexability_monitors
       SET claim_token = ?, claimed_at = UTC_TIMESTAMP(3)
       WHERE is_active = 1
         AND (next_run_at IS NULL OR next_run_at <= UTC_TIMESTAMP(3))
         AND (claim_token IS NULL OR claimed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
       ORDER BY next_run_at ASC
       LIMIT 1`,
      [claimToken]
    );

    if (claimRes.affectedRows === 0) break;

    const claimedSites = await rows<{ site_id: number }>(
      'SELECT site_id FROM indexability_monitors WHERE claim_token = ?',
      [claimToken]
    );
    if (!claimedSites.length) break;

    const siteId = claimedSites[0].site_id;
    try {
      await checkSiteIndexability(siteId, { maxPages: 25, triggeredBy: 'cron' });
      processed++;
    } catch {
      // Clear claim on error
      await db.query(
        `UPDATE indexability_monitors
         SET claim_token = NULL, claimed_at = NULL, next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR)
         WHERE site_id = ?`,
        [siteId]
      );
    }
  }

  return processed;
}
