import crypto from 'node:crypto';
import { db, rows } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertPublicUrl } from '@/lib/ssrf';
import { fetchSitemap } from './fetcher';
import { parseSitemapXml, XmlParseError, type ParsedSitemap, type SitemapUrlEntry } from './parser';
import { evaluateSitemapIssues } from './issues';
import { discoverSitemapsForWebsite } from './discovery';

export function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

export type ScanResult = {
  scanId: number;
  sitemapId: number;
  status: 'success' | 'failed' | 'incomplete';
  statusCode: number | null;
  totalUrls: number;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  durationMs: number;
  error: string | null;
  type: 'index' | 'urlset' | 'unknown';
};

/**
 * Scans a single XML sitemap or sitemap index.
 * Detects URL additions and removals compared ONLY to previous successful scans.
 * Preserves URLs and never marks removals on failure.
 */
export async function scanSitemap(
  sitemapId: number,
  triggeredBy: 'cron' | 'manual' | 'retry' = 'cron',
  opts: { timeoutMs?: number } = {}
): Promise<ScanResult> {
  const smList = await rows<any>(
    'SELECT s.*, p.status AS project_status FROM sitemaps s JOIN projects p ON p.id = s.project_id WHERE s.id = ?',
    [sitemapId]
  );
  const sitemap = smList[0];
  if (!sitemap) throw new ApiError(404, 'Sitemap not found.');

  const started = performance.now();
  const fetchRes = await fetchSitemap(sitemap.url, { timeoutMs: opts.timeoutMs ?? 25000 });
  const durationMs = Math.max(1, Math.round(performance.now() - started));

  // Handle network failure or non-200 HTTP status
  if (!fetchRes.body || (fetchRes.statusCode && (fetchRes.statusCode < 200 || fetchRes.statusCode >= 300))) {
    const errorMsg = fetchRes.error || `HTTP ${fetchRes.statusCode}`;

    // Record failed scan snapshot
    const [scanIns] = await db.query<any>(
      `INSERT INTO sitemap_scans (
         project_id, site_id, sitemap_id, triggered_by, status, status_code,
         error_message, sitemap_type, total_urls, added_urls_count, removed_urls_count,
         unchanged_urls_count, duration_ms, scanned_at
       ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, ?, 0, 0, ?, ?, UTC_TIMESTAMP(3))`,
      [
        sitemap.project_id,
        sitemap.site_id,
        sitemap.id,
        triggeredBy,
        fetchRes.statusCode,
        errorMsg.slice(0, 500),
        sitemap.type,
        sitemap.last_url_count,
        sitemap.last_url_count,
        durationMs
      ]
    );

    // Update sitemap row (preserve last_url_count, do NOT mark removals)
    await db.query(
      `UPDATE sitemaps
       SET last_status = 'failed',
           last_status_code = ?,
           last_error = ?,
           last_duration_ms = ?,
           last_scanned_at = UTC_TIMESTAMP(3),
           next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL check_interval_hours HOUR),
           claim_token = NULL,
           claimed_at = NULL,
           updated_at = updated_at
       WHERE id = ?`,
      [fetchRes.statusCode, errorMsg.slice(0, 500), durationMs, sitemap.id]
    );

    await evaluateSitemapIssues({
      sitemap,
      scanStatus: 'failed',
      statusCode: fetchRes.statusCode,
      errorMessage: errorMsg,
      totalUrls: sitemap.last_url_count,
      addedCount: 0,
      removedCount: 0,
      previousCount: sitemap.last_url_count
    });

    return {
      scanId: scanIns.insertId,
      sitemapId: sitemap.id,
      status: 'failed',
      statusCode: fetchRes.statusCode,
      totalUrls: sitemap.last_url_count,
      addedCount: 0,
      removedCount: 0,
      unchangedCount: sitemap.last_url_count,
      durationMs,
      error: errorMsg,
      type: sitemap.type
    };
  }

  // Parse XML
  let parsed: ParsedSitemap;
  try {
    parsed = parseSitemapXml(fetchRes.body);
  } catch (err: any) {
    const parseErrorMsg = err instanceof XmlParseError ? err.message : `XML Parse Error: ${err.message}`;

    const [scanIns] = await db.query<any>(
      `INSERT INTO sitemap_scans (
         project_id, site_id, sitemap_id, triggered_by, status, status_code,
         error_message, sitemap_type, total_urls, added_urls_count, removed_urls_count,
         unchanged_urls_count, duration_ms, scanned_at
       ) VALUES (?, ?, ?, ?, 'failed', 200, ?, ?, ?, 0, 0, ?, ?, UTC_TIMESTAMP(3))`,
      [
        sitemap.project_id,
        sitemap.site_id,
        sitemap.id,
        triggeredBy,
        parseErrorMsg.slice(0, 500),
        sitemap.type,
        sitemap.last_url_count,
        sitemap.last_url_count,
        durationMs
      ]
    );

    await db.query(
      `UPDATE sitemaps
       SET last_status = 'failed',
           last_status_code = 200,
           last_error = ?,
           last_duration_ms = ?,
           last_scanned_at = UTC_TIMESTAMP(3),
           next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL check_interval_hours HOUR),
           claim_token = NULL,
           claimed_at = NULL,
           updated_at = updated_at
       WHERE id = ?`,
      [parseErrorMsg.slice(0, 500), durationMs, sitemap.id]
    );

    await evaluateSitemapIssues({
      sitemap,
      scanStatus: 'failed',
      statusCode: 200,
      errorMessage: parseErrorMsg,
      totalUrls: sitemap.last_url_count,
      addedCount: 0,
      removedCount: 0,
      previousCount: sitemap.last_url_count,
      isXmlParseError: true
    });

    return {
      scanId: scanIns.insertId,
      sitemapId: sitemap.id,
      status: 'failed',
      statusCode: 200,
      totalUrls: sitemap.last_url_count,
      addedCount: 0,
      removedCount: 0,
      unchangedCount: sitemap.last_url_count,
      durationMs,
      error: parseErrorMsg,
      type: sitemap.type
    };
  }

  // --- XML Parsed Successfully ---
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;
  let totalUrls = 0;
  let childCount = 0;
  let missingChildSitemaps: string[] = [];

  // Create scan record initially
  const [scanIns] = await db.query<any>(
    `INSERT INTO sitemap_scans (
       project_id, site_id, sitemap_id, triggered_by, status, status_code,
       error_message, sitemap_type, total_urls, added_urls_count, removed_urls_count,
       unchanged_urls_count, duration_ms, scanned_at
     ) VALUES (?, ?, ?, ?, 'success', 200, NULL, ?, 0, 0, 0, 0, ?, UTC_TIMESTAMP(3))`,
    [sitemap.project_id, sitemap.site_id, sitemap.id, triggeredBy, parsed.type, durationMs]
  );
  const scanId = scanIns.insertId;

  if (parsed.type === 'index') {
    childCount = parsed.childSitemaps.length;
    totalUrls = childCount;

    // Load existing child sitemaps known for this index
    const existingChildren = await rows<{ id: number; url: string; url_hash: string }>(
      'SELECT id, url, url_hash FROM sitemaps WHERE parent_sitemap_id = ?',
      [sitemap.id]
    );
    const existingMap = new Map(existingChildren.map(c => [c.url, c]));
    const currentLocSet = new Set(parsed.childSitemaps.map(c => c.loc));

    // Register / discover new child sitemaps
    for (const child of parsed.childSitemaps) {
      if (!existingMap.has(child.loc)) {
        const uHash = sha256(child.loc);
        try {
          await db.query(
            `INSERT INTO sitemaps (
               project_id, site_id, url, url_hash, type, discovery_source,
               parent_sitemap_id, parent_url, check_interval_hours, next_run_at
             ) VALUES (?, ?, ?, ?, 'unknown', 'sitemap_index', ?, ?, ?, UTC_TIMESTAMP(3))
             ON DUPLICATE KEY UPDATE parent_sitemap_id = VALUES(parent_sitemap_id), parent_url = VALUES(parent_url)`,
            [
              sitemap.project_id,
              sitemap.site_id,
              child.loc,
              uHash,
              sitemap.id,
              sitemap.url,
              sitemap.check_interval_hours
            ]
          );
          addedCount++;
        } catch {
          /* ignore duplicate */
        }
      } else {
        unchangedCount++;
      }
    }

    // Detect child sitemaps that disappeared from this index
    for (const [url] of existingMap) {
      if (!currentLocSet.has(url)) {
        missingChildSitemaps.push(url);
        removedCount++;
      }
    }
  } else {
    // Regular urlset
    totalUrls = parsed.urls.length;

    // Load active URLs from previous successful scans
    const existingUrls = await rows<{ loc: string; loc_hash: string; lastmod: string | null }>(
      'SELECT loc, loc_hash, lastmod FROM sitemap_urls WHERE sitemap_id = ? AND status = "active"',
      [sitemap.id]
    );
    const existingMap = new Map(existingUrls.map(u => [u.loc, u]));
    const currentUrlMap = new Map(parsed.urls.map(u => [u.loc, u]));

    // Batch insert new/updated URLs in chunks of 500
    const newOrUpdated: SitemapUrlEntry[] = [];
    const changeRecords: { type: 'added' | 'removed'; loc: string; lastmod: string | null }[] = [];

    for (const [loc, entry] of currentUrlMap) {
      if (!existingMap.has(loc)) {
        addedCount++;
        changeRecords.push({ type: 'added', loc, lastmod: entry.lastmod });
      } else {
        unchangedCount++;
      }
      newOrUpdated.push(entry);
    }

    // Identify removed URLs
    const removedHashes: string[] = [];
    for (const [loc, u] of existingMap) {
      if (!currentUrlMap.has(loc)) {
        removedCount++;
        removedHashes.push(u.loc_hash);
        changeRecords.push({ type: 'removed', loc, lastmod: u.lastmod });
      }
    }

    // 1. Mark removed URLs in DB
    if (removedHashes.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < removedHashes.length; i += CHUNK) {
        const slice = removedHashes.slice(i, i + CHUNK);
        const placeholders = slice.map(() => '?').join(',');
        await db.query(
          `UPDATE sitemap_urls
           SET status = 'removed', removed_at = UTC_TIMESTAMP(3), last_scan_id = ?
           WHERE sitemap_id = ? AND loc_hash IN (${placeholders})`,
          [scanId, sitemap.id, ...slice]
        );
      }
    }

    // 2. Insert or update active URLs in DB (chunked)
    const CHUNK = 250;
    for (let i = 0; i < newOrUpdated.length; i += CHUNK) {
      const slice = newOrUpdated.slice(i, i + CHUNK);
      const valuesSql = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, "active", UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, ?)').join(',');
      const params: any[] = [];
      for (const item of slice) {
        const lHash = sha256(item.loc);
        params.push(
          sitemap.project_id,
          sitemap.site_id,
          sitemap.id,
          item.loc,
          lHash,
          item.lastmod ? new Date(item.lastmod) : null,
          item.changefreq,
          item.priority,
          scanId,
          scanId
        );
      }

      await db.query(
        `INSERT INTO sitemap_urls (
           project_id, site_id, sitemap_id, loc, loc_hash, lastmod, changefreq, priority,
           status, first_seen_at, last_seen_at, first_scan_id, last_scan_id
         ) VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE
           status = 'active',
           removed_at = NULL,
           lastmod = COALESCE(VALUES(lastmod), lastmod),
           changefreq = COALESCE(VALUES(changefreq), changefreq),
           priority = COALESCE(VALUES(priority), priority),
           last_seen_at = UTC_TIMESTAMP(3),
           last_scan_id = VALUES(last_scan_id)`,
        params
      );
    }

    // 3. Record scan changes (limit to 1000 per scan to avoid excessive size if entire site changed)
    const maxChangesToRecord = Math.min(changeRecords.length, 1000);
    if (maxChangesToRecord > 0) {
      const recordSlice = changeRecords.slice(0, maxChangesToRecord);
      const chgPlaceholders = recordSlice.map(() => '(?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))').join(',');
      const chgParams: any[] = [];
      for (const chg of recordSlice) {
        chgParams.push(scanId, sitemap.id, sitemap.site_id, chg.type, chg.loc, chg.lastmod ? new Date(chg.lastmod) : null);
      }
      await db.query(
        `INSERT INTO sitemap_scan_changes (
           scan_id, sitemap_id, site_id, change_type, loc, lastmod, detected_at
         ) VALUES ${chgPlaceholders}`,
        chgParams
      );
    }
  }

  // Update the scan record with actual counts
  await db.query(
    `UPDATE sitemap_scans
     SET total_urls = ?,
         added_urls_count = ?,
         removed_urls_count = ?,
         unchanged_urls_count = ?,
         child_sitemaps_count = ?
     WHERE id = ?`,
    [totalUrls, addedCount, removedCount, unchangedCount, childCount, scanId]
  );

  // Update sitemap row
  await db.query(
    `UPDATE sitemaps
     SET type = ?,
         last_status = 'success',
         last_status_code = 200,
         last_error = NULL,
         last_url_count = ?,
         last_added_count = ?,
         last_removed_count = ?,
         last_duration_ms = ?,
         last_scanned_at = UTC_TIMESTAMP(3),
         last_successful_scan_at = UTC_TIMESTAMP(3),
         next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL check_interval_hours HOUR),
         claim_token = NULL,
         claimed_at = NULL,
         updated_at = updated_at
     WHERE id = ?`,
    [parsed.type, totalUrls, addedCount, removedCount, durationMs, sitemap.id]
  );

  // Evaluate issues (and auto-resolve any previous errors)
  await evaluateSitemapIssues({
    sitemap: { ...sitemap, type: parsed.type },
    scanStatus: 'success',
    statusCode: 200,
    errorMessage: null,
    totalUrls,
    addedCount,
    removedCount,
    previousCount: sitemap.last_url_count,
    missingChildSitemaps: missingChildSitemaps.length > 0 ? missingChildSitemaps : undefined
  });

  return {
    scanId,
    sitemapId: sitemap.id,
    status: 'success',
    statusCode: 200,
    totalUrls,
    addedCount,
    removedCount,
    unchangedCount,
    durationMs,
    error: null,
    type: parsed.type
  };
}

/**
 * Scheduled background sitemap scan runner.
 * Atomically claims due sitemaps using a random claim_token.
 * Runs with bounded concurrency within a bounded time budget.
 */
export async function runDueSitemaps(
  cronStartedAt: number,
  maxSitemaps = 4,
  budgetMs = 40000
): Promise<{ due: number; scanned: number; urlsFound: number }> {
  const out = { due: 0, scanned: 0, urlsFound: 0 };
  if (Date.now() - cronStartedAt > budgetMs) return out;

  const token = crypto.randomBytes(16).toString('hex');

  // Claim due sitemaps atomically
  await db.query(
    `UPDATE sitemaps
     SET claim_token = ?, claimed_at = UTC_TIMESTAMP(3), updated_at = updated_at
     WHERE is_active = 1
       AND (next_run_at IS NULL OR next_run_at <= UTC_TIMESTAMP(3))
       AND (claim_token IS NULL OR claimed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
       AND site_id IN (SELECT id FROM monitored_sites WHERE deleted_at IS NULL)
       AND project_id IN (SELECT id FROM projects WHERE status <> 'archived')
     ORDER BY next_run_at ASC LIMIT ?`,
    [token, maxSitemaps]
  );

  const claimed = await rows<any>('SELECT * FROM sitemaps WHERE claim_token = ?', [token]);
  out.due = claimed.length;

  for (const sm of claimed) {
    if (Date.now() - cronStartedAt > budgetMs) {
      // Release remaining sitemaps for the next minute
      await db.query(
        'UPDATE sitemaps SET claim_token = NULL, claimed_at = NULL, updated_at = updated_at WHERE id = ?',
        [sm.id]
      );
      continue;
    }

    try {
      const res = await scanSitemap(sm.id, 'cron');
      out.scanned++;
      out.urlsFound += res.totalUrls;
    } catch (e) {
      console.error(`[SiteWatch] Scheduled sitemap scan failed for sitemap #${sm.id}:`, e);
      await db.query(
        `UPDATE sitemaps
         SET claim_token = NULL, claimed_at = NULL,
             last_status = 'failed',
             last_error = ?,
             next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR),
             updated_at = updated_at
         WHERE id = ?`,
        [String((e as any)?.message || e).slice(0, 500), sm.id]
      );
    }
  }

  return out;
}

/**
 * Manually register a new sitemap URL for a site.
 */
export async function addSitemap(
  projectId: number,
  siteId: number,
  rawUrl: string,
  opts: {
    discoverySource?: 'auto_default' | 'robots_txt' | 'sitemap_index' | 'manual';
    checkIntervalHours?: number;
    parentSitemapId?: number;
    parentUrl?: string;
  } = {}
) {
  const urlObj = await assertPublicUrl(rawUrl);
  const normalizedUrl = urlObj.toString();
  const urlHash = sha256(normalizedUrl);
  const intervalHours = Math.max(1, Math.min(168, opts.checkIntervalHours ?? 24)); // 1h to 7 days, default 24h

  const [ins] = await db.query<any>(
    `INSERT INTO sitemaps (
       project_id, site_id, url, url_hash, type, discovery_source,
       parent_sitemap_id, parent_url, check_interval_hours, next_run_at
     ) VALUES (?, ?, ?, ?, 'unknown', ?, ?, ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       check_interval_hours = VALUES(check_interval_hours),
       is_active = 1`,
    [
      projectId,
      siteId,
      normalizedUrl,
      urlHash,
      opts.discoverySource ?? 'manual',
      opts.parentSitemapId ?? null,
      opts.parentUrl ?? null,
      intervalHours
    ]
  );

  const id = ins.insertId || (await rows<any>('SELECT id FROM sitemaps WHERE site_id = ? AND url_hash = ?', [siteId, urlHash]))[0]?.id;
  return (await rows<any>('SELECT * FROM sitemaps WHERE id = ?', [id]))[0];
}

/**
 * Automatically discovers sitemaps from robots.txt and /sitemap.xml and registers them.
 */
export async function discoverAndRegisterWebsiteSitemaps(siteId: number, projectId: number) {
  const site = (await rows<any>('SELECT id, url FROM monitored_sites WHERE id = ?', [siteId]))[0];
  if (!site) throw new ApiError(404, 'Website not found.');

  const discovered = await discoverSitemapsForWebsite(site.url);
  const created: any[] = [];

  for (const item of discovered) {
    try {
      const row = await addSitemap(projectId, siteId, item.url, {
        discoverySource: item.source,
        parentUrl: item.parentUrl
      });
      created.push(row);
    } catch {
      /* ignore duplicate or invalid */
    }
  }

  return created;
}

/**
 * Returns overall sitemap monitoring statistics for a website or project.
 */
export async function getSitemapStats(siteId?: number, projectId?: number) {
  const params: any[] = [];
  let filter = 'WHERE 1=1';
  if (siteId) {
    filter += ' AND s.site_id = ?';
    params.push(siteId);
  } else if (projectId) {
    filter += ' AND s.project_id = ?';
    params.push(projectId);
  }

  const sitemaps = await rows<any>(
    `SELECT s.*, ms.name AS site_name, ms.url AS site_url
     FROM sitemaps s
     JOIN monitored_sites ms ON ms.id = s.site_id
     ${filter}
     ORDER BY s.parent_sitemap_id ASC, s.id ASC`,
    params
  );

  const totalSitemaps = sitemaps.length;
  const totalUrls = sitemaps.reduce((acc, s) => acc + (s.type !== 'index' ? Number(s.last_url_count || 0) : 0), 0);
  const addedUrls = sitemaps.reduce((acc, s) => acc + Number(s.last_added_count || 0), 0);
  const removedUrls = sitemaps.reduce((acc, s) => acc + Number(s.last_removed_count || 0), 0);
  const failedCount = sitemaps.filter(s => s.last_status === 'failed').length;

  const lastSuccessfulScan = sitemaps.reduce<string | null>((latest, s) => {
    if (!s.last_successful_scan_at) return latest;
    if (!latest || new Date(s.last_successful_scan_at) > new Date(latest)) {
      return s.last_successful_scan_at;
    }
    return latest;
  }, null);

  // Get active issues count
  const issueFilter = siteId ? 'WHERE i.site_id = ?' : projectId ? 'WHERE i.project_id = ?' : 'WHERE 1=1';
  const issueParams = siteId ? [siteId] : projectId ? [projectId] : [];
  const openIssues = await rows<any>(
    `SELECT i.*, s.url AS sitemap_url
     FROM sitemap_issues i
     JOIN sitemaps s ON s.id = i.sitemap_id
     ${issueFilter} AND i.resolved_at IS NULL
     ORDER BY i.severity = 'critical' DESC, i.last_detected_at DESC`,
    issueParams
  );

  return {
    totalSitemaps,
    totalUrls,
    addedUrls,
    removedUrls,
    failedCount,
    lastSuccessfulScan,
    sitemaps,
    openIssues
  };
}
