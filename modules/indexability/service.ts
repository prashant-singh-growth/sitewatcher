import crypto from 'node:crypto';
import { db, rows } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertPublicUrlSyntax } from '@/lib/ssrf';
import { crawlUrl, type CrawlResult } from './crawler';
import { parseIndexabilitySignals, parseManualUrlInputs, type ParsedIndexabilitySignals } from './parser';
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
 * Recalculates aggregated indexability KPIs for a website without auto-seeding URLs.
 */
export async function refreshIndexabilityMonitorStats(
  siteId: number,
  advanceSchedule = false
): Promise<Omit<SiteIndexabilitySummary, 'checkedCount'>> {
  const statsRows = await rows<any>(
    `SELECT
       COUNT(*) AS total_monitored_urls,
       SUM(CASE WHEN is_indexable = 1 AND http_status IS NOT NULL THEN 1 ELSE 0 END) AS indexable_urls_count,
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

  if (advanceSchedule) {
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
      [totalMonitored, indexableCount, noindexCount, canonicalIssuesCount, errorsCount, recentlyChangedCount, siteId]
    );
  } else {
    await db.query(
      `UPDATE indexability_monitors
       SET total_monitored_urls = ?,
           indexable_urls_count = ?,
           noindex_urls_count = ?,
           canonical_issues_count = ?,
           error_urls_count = ?,
           recently_changed_count = ?,
           updated_at = updated_at
       WHERE site_id = ?`,
      [totalMonitored, indexableCount, noindexCount, canonicalIssuesCount, errorsCount, recentlyChangedCount, siteId]
    );
  }

  return {
    siteId,
    totalMonitored,
    indexableCount,
    noindexCount,
    canonicalIssuesCount,
    errorsCount,
    recentlyChangedCount
  };
}

/**
 * Crawls a batch of page rows using a bounded worker pool and request time budget.
 */
async function crawlPagesWithConcurrency(
  pages: Array<{
    id: number;
    url: string;
    http_status: number | null;
    is_indexable: number | boolean;
    has_noindex: number | boolean;
    canonical_url: string | null;
    canonical_status: string;
    last_checked_at: Date | string | null;
  }>,
  siteId: number,
  projectId: number,
  options?: { concurrency?: number; budgetMs?: number }
): Promise<number> {
  if (!pages.length) return 0;

  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 5, pages.length));
  const budgetMs = options?.budgetMs ?? 45_000;
  const startedAt = Date.now();
  const queue = [...pages];
  let checkedCount = 0;

  const worker = async () => {
    while (queue.length > 0) {
      if (Date.now() - startedAt > budgetMs) break;
      const page = queue.shift();
      if (!page) break;

      const hasCheckedBefore =
        page.http_status !== null ||
        Boolean(page.last_checked_at && new Date(page.last_checked_at).getFullYear() > 1970);
      const prev = hasCheckedBefore
        ? {
            httpStatus: page.http_status,
            isIndexable: Boolean(page.is_indexable),
            hasNoindex: Boolean(page.has_noindex),
            canonicalUrl: page.canonical_url,
            canonicalStatus: page.canonical_status
          }
        : null;

      try {
        await checkSingleUrlIndexability(page.id, siteId, projectId, page.url, prev);
        checkedCount++;
      } catch {
        // Continue next page on unexpected error
      }

      if (queue.length > 0 && Date.now() - startedAt < budgetMs) {
        await new Promise(r => setTimeout(r, 40));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return checkedCount;
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
  const isIndexabilityChanged =
    previousState != null &&
    previousState.httpStatus !== null &&
    Boolean(previousState.isIndexable) !== parsed.isTechnicallyIndexable;

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
         previous_is_indexable = IF(? = 1, ?, COALESCE(previous_is_indexable, ?)),
         is_indexable = ?,
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
      isIndexabilityChanged ? 1 : 0,
      previousState ? (previousState.isIndexable ? 1 : 0) : (parsed.isTechnicallyIndexable ? 1 : 0),
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

/**
 * Runs an indexability evaluation across tracked URLs for a website.
 * URLs are managed manually; no URLs are auto-imported from sitemaps or root pages.
 */
export async function checkSiteIndexability(
  siteId: number,
  options?: { maxPages?: number; triggeredBy?: 'cron' | 'manual'; budgetMs?: number }
): Promise<SiteIndexabilitySummary> {
  const maxPages = options?.maxPages ?? 100;

  const siteList = await rows<any>(
    'SELECT s.id, s.project_id, s.name, s.url, p.status AS project_status FROM monitored_sites s JOIN projects p ON p.id = s.project_id WHERE s.id = ?',
    [siteId]
  );
  const site = siteList[0];
  if (!site) throw new ApiError(404, 'Website not found.');

  await ensureIndexabilityMonitor(site.id, Number(site.project_id));

  const pagesToCheck =
    maxPages > 0
      ? await rows<any>(
          `SELECT id, url, http_status, is_indexable, has_noindex, canonical_url, canonical_status, last_checked_at
           FROM url_indexability_pages
           WHERE site_id = ?
           ORDER BY last_checked_at ASC
           LIMIT ?`,
          [siteId, maxPages]
        )
      : [];

  const checkedCount = await crawlPagesWithConcurrency(pagesToCheck, siteId, Number(site.project_id), {
    concurrency: 5,
    budgetMs: options?.budgetMs ?? 45_000
  });

  const stats = await refreshIndexabilityMonitorStats(siteId, true);
  return { ...stats, checkedCount };
}

export type BulkAddManualUrlsResult = {
  totalSubmitted: number;
  addedCount: number;
  existingCount: number;
  crawledCount: number;
  pendingCount: number;
  summary: Omit<SiteIndexabilitySummary, 'checkedCount'>;
  pages: any[];
};

/**
 * Manually adds one or many custom URLs (e.g. 1, 5, 40+) for indexability monitoring
 * and crawls them concurrently within a bounded request time budget.
 */
export async function addManualUrlsToIndexability(
  siteId: number,
  projectId: number,
  rawInput: string | string[],
  options?: { crawlNow?: boolean; budgetMs?: number }
): Promise<BulkAddManualUrlsResult> {
  const siteList = await rows<any>('SELECT url FROM monitored_sites WHERE id = ?', [siteId]);
  const site = siteList[0];
  if (!site) throw new ApiError(404, 'Website not found.');

  const { urls, errors } = parseManualUrlInputs(rawInput, site.url);
  if (errors.length > 0) {
    throw new ApiError(400, errors.slice(0, 3).join(' '));
  }
  if (urls.length === 0) {
    throw new ApiError(400, 'Please provide at least one valid URL.');
  }

  for (const u of urls) {
    assertPublicUrlSyntax(u);
  }

  await ensureIndexabilityMonitor(siteId, projectId);

  const hashes = urls.map(sha256);
  const placeholders = hashes.map(() => '?').join(',');
  const existingRows = await rows<{ url_hash: string }>(
    `SELECT url_hash FROM url_indexability_pages WHERE site_id = ? AND url_hash IN (${placeholders})`,
    [siteId, ...hashes]
  );
  const existingSet = new Set(existingRows.map(r => r.url_hash));
  const addedCount = hashes.filter(h => !existingSet.has(h)).length;
  const existingCount = urls.length - addedCount;

  const CHUNK = 50;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const slice = urls.slice(i, i + CHUNK);
    const valSql = slice.map(() => "(?, ?, ?, ?, 'manual', UTC_TIMESTAMP(3), '1970-01-01 00:00:00')").join(',');
    const params: any[] = [];
    for (const u of slice) {
      params.push(projectId, siteId, u, sha256(u));
    }
    await db.query(
      `INSERT INTO url_indexability_pages (
         project_id, site_id, url, url_hash, source, first_checked_at, last_checked_at
       ) VALUES ${valSql}
       ON DUPLICATE KEY UPDATE source = 'manual'`,
      params
    );
  }

  const targetPages = await rows<any>(
    `SELECT id, url, http_status, is_indexable, has_noindex, canonical_url, canonical_status, last_checked_at
     FROM url_indexability_pages
     WHERE site_id = ? AND url_hash IN (${placeholders})`,
    [siteId, ...hashes]
  );

  let crawledCount = 0;
  if (options?.crawlNow !== false && targetPages.length > 0) {
    crawledCount = await crawlPagesWithConcurrency(targetPages, siteId, projectId, {
      concurrency: 5,
      budgetMs: options?.budgetMs ?? 35_000
    });
  }

  const refreshedPages = await rows<any>(
    `SELECT * FROM url_indexability_pages WHERE site_id = ? AND url_hash IN (${placeholders})`,
    [siteId, ...hashes]
  );

  const summary = await refreshIndexabilityMonitorStats(siteId, false);

  return {
    totalSubmitted: urls.length,
    addedCount,
    existingCount,
    crawledCount,
    pendingCount: Math.max(0, targetPages.length - crawledCount),
    summary,
    pages: refreshedPages
  };
}

/**
 * Manually adds a single custom URL for indexability monitoring and checks it immediately.
 */
export async function addManualUrlToIndexability(
  siteId: number,
  projectId: number,
  rawUrl: string
) {
  const res = await addManualUrlsToIndexability(siteId, projectId, [rawUrl], { crawlNow: true });
  return res.pages[0];
}

/**
 * Deletes a single monitored URL and refreshes monitor KPIs.
 */
export async function deleteIndexabilityUrl(
  pageId: number,
  siteId: number,
  projectId: number
): Promise<{ url: string }> {
  const existing = await rows<{ id: number; url: string }>(
    'SELECT id, url FROM url_indexability_pages WHERE id = ? AND site_id = ? AND project_id = ?',
    [pageId, siteId, projectId]
  );
  if (!existing.length) {
    throw new ApiError(404, 'Monitored URL not found.');
  }

  await db.query('DELETE FROM url_indexability_pages WHERE id = ? AND site_id = ? AND project_id = ?', [
    pageId,
    siteId,
    projectId
  ]);
  await refreshIndexabilityMonitorStats(siteId, false);
  return { url: existing[0].url };
}

/**
 * Deletes legacy auto-discovered URLs (source != 'manual') while preserving manually added URLs.
 */
export async function clearNonManualIndexabilityUrls(siteId: number, projectId: number): Promise<number> {
  const [res] = await db.query<any>(
    "DELETE FROM url_indexability_pages WHERE site_id = ? AND project_id = ? AND source <> 'manual'",
    [siteId, projectId]
  );
  await refreshIndexabilityMonitorStats(siteId, false);
  return Number(res.affectedRows || 0);
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
    where += ' AND u.is_indexable = 1 AND u.http_status IS NOT NULL';
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

  const nonManualRow = await rows<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM url_indexability_pages WHERE site_id = ? AND project_id = ? AND source <> 'manual'",
    [siteId, projectId]
  );
  const nonManualCount = Number(nonManualRow[0]?.cnt || 0);

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
    nonManualCount,
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
      await checkSiteIndexability(siteId, { maxPages: 50, triggeredBy: 'cron', budgetMs: 30_000 });
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
