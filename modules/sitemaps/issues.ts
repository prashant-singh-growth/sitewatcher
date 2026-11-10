import { db, rows } from '@/lib/db';

export type IssueParams = {
  sitemapId: number;
  siteId: number;
  projectId: number;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  details?: Record<string, unknown> | null;
};

/**
 * Creates or updates an open issue for a sitemap condition.
 * Deduplicates automatically via the UNIQUE uq_sitemap_issue_open constraint on (open_key).
 */
export async function createOrUpdateIssue(issue: IssueParams): Promise<void> {
  const detailsJson = issue.details ? JSON.stringify(issue.details) : null;

  await db.query(
    `INSERT INTO sitemap_issues (
       project_id, site_id, sitemap_id, issue_type, severity, title, description, details,
       first_detected_at, last_detected_at, occurrence_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)
     ON DUPLICATE KEY UPDATE
       last_detected_at = UTC_TIMESTAMP(3),
       occurrence_count = occurrence_count + 1,
       severity = VALUES(severity),
       title = VALUES(title),
       description = VALUES(description),
       details = VALUES(details)`,
    [
      issue.projectId,
      issue.siteId,
      issue.sitemapId,
      issue.issueType,
      issue.severity,
      issue.title.slice(0, 255),
      issue.description,
      detailsJson
    ]
  );
}

/**
 * Automatically marks open issue(s) of a given type as resolved when the condition cleared.
 */
export async function resolveIssueIfOpen(sitemapId: number, issueType: string): Promise<number> {
  const [res] = await db.query<any>(
    `UPDATE sitemap_issues
     SET resolved_at = UTC_TIMESTAMP(3)
     WHERE sitemap_id = ? AND issue_type = ? AND resolved_at IS NULL`,
    [sitemapId, issueType]
  );
  return res.affectedRows || 0;
}

export type ScanEvaluationContext = {
  sitemap: {
    id: number;
    project_id: number;
    site_id: number;
    url: string;
    type: string;
  };
  scanStatus: 'success' | 'failed' | 'incomplete';
  statusCode: number | null;
  errorMessage: string | null;
  totalUrls: number;
  addedCount: number;
  removedCount: number;
  previousCount: number;
  missingChildSitemaps?: string[];
  isXmlParseError?: boolean;
};

/**
 * Evaluates scan outcome against active/past issues.
 * Creates new issues, keeps existing open issues updated, and resolves cleared issues.
 */
export async function evaluateSitemapIssues(ctx: ScanEvaluationContext): Promise<void> {
  const { sitemap, scanStatus, statusCode, errorMessage, totalUrls, removedCount, previousCount } = ctx;
  const sitemapId = sitemap.id;
  const siteId = sitemap.site_id;
  const projectId = sitemap.project_id;

  // 1. HTTP 4xx or 5xx error
  if (statusCode && (statusCode >= 400 || statusCode < 200)) {
    await createOrUpdateIssue({
      sitemapId,
      siteId,
      projectId,
      issueType: 'http_error',
      severity: statusCode === 404 ? 'critical' : 'warning',
      title: `Sitemap returning HTTP ${statusCode}`,
      description: `Sitemap at ${sitemap.url} returned HTTP ${statusCode}. Search engines cannot access this sitemap.`,
      details: { statusCode, error: errorMessage }
    });
  } else if (statusCode && statusCode >= 200 && statusCode < 400) {
    await resolveIssueIfOpen(sitemapId, 'http_error');
  }

  // 2. Inaccessible (network connection failure, timeout, DNS resolution failure)
  if (!statusCode && scanStatus === 'failed') {
    await createOrUpdateIssue({
      sitemapId,
      siteId,
      projectId,
      issueType: 'inaccessible',
      severity: 'critical',
      title: 'Sitemap is inaccessible',
      description: `SiteWatch could not reach sitemap at ${sitemap.url}: ${errorMessage || 'Connection failure'}.`,
      details: { error: errorMessage }
    });
  } else if (statusCode !== null) {
    await resolveIssueIfOpen(sitemapId, 'inaccessible');
  }

  // 3. XML parsing failure / Invalid XML
  if (ctx.isXmlParseError || (errorMessage && /XML|malformed|doctype|unclosed/i.test(errorMessage))) {
    await createOrUpdateIssue({
      sitemapId,
      siteId,
      projectId,
      issueType: 'invalid_xml',
      severity: 'critical',
      title: 'Sitemap XML parsing failed',
      description: `The sitemap XML at ${sitemap.url} is invalid: ${errorMessage || 'Invalid XML syntax'}.`,
      details: { error: errorMessage }
    });
  } else if (scanStatus === 'success') {
    await resolveIssueIfOpen(sitemapId, 'invalid_xml');
  }

  // 4. Empty sitemap (0 URLs found)
  if (scanStatus === 'success' && totalUrls === 0) {
    await createOrUpdateIssue({
      sitemapId,
      siteId,
      projectId,
      issueType: 'empty_sitemap',
      severity: 'warning',
      title: 'Empty sitemap detected',
      description: `Sitemap at ${sitemap.url} was loaded and parsed successfully, but contains 0 URL entries.`,
      details: { totalUrls: 0 }
    });
  } else if (scanStatus === 'success' && totalUrls > 0) {
    await resolveIssueIfOpen(sitemapId, 'empty_sitemap');
  }

  // 5. Missing child sitemaps in sitemap index
  if (ctx.missingChildSitemaps && ctx.missingChildSitemaps.length > 0) {
    await createOrUpdateIssue({
      sitemapId,
      siteId,
      projectId,
      issueType: 'child_sitemap_missing',
      severity: 'warning',
      title: `${ctx.missingChildSitemaps.length} child sitemap(s) missing from index`,
      description: `Child sitemap(s) previously indexed in ${sitemap.url} were not found in the latest scan: ${ctx.missingChildSitemaps.slice(0, 5).join(', ')}${ctx.missingChildSitemaps.length > 5 ? '...' : ''}.`,
      details: { missing: ctx.missingChildSitemaps }
    });
  } else if (scanStatus === 'success' && sitemap.type === 'index') {
    await resolveIssueIfOpen(sitemapId, 'child_sitemap_missing');
  }

  // 6. Significant unexpected URL count reduction
  // Only compare when scan is SUCCESSFUL and COMPLETE
  if (scanStatus === 'success' && previousCount > 0) {
    const drop = previousCount - totalUrls;
    const dropPct = (drop / previousCount) * 100;

    // Check for >= 80% reduction or >= 100 URLs removed unexpectedly
    if (previousCount >= 10 && dropPct >= 80) {
      await createOrUpdateIssue({
        sitemapId,
        siteId,
        projectId,
        issueType: 'significant_url_reduction',
        severity: 'critical',
        title: `Unexpected ${Math.round(dropPct)}% reduction in sitemap URLs`,
        description: `Sitemap URLs dropped from ${previousCount} to ${totalUrls} (${drop} URLs lost). Verify this deletion was intentional.`,
        details: { previousCount, currentCount: totalUrls, drop, dropPct: Math.round(dropPct) }
      });
    } else if ((previousCount >= 20 && dropPct >= 25 && drop >= 10) || removedCount >= 100) {
      await createOrUpdateIssue({
        sitemapId,
        siteId,
        projectId,
        issueType: 'significant_url_reduction',
        severity: 'warning',
        title: `${removedCount} URLs unexpectedly removed from sitemap`,
        description: `${removedCount} URLs were removed in the latest scan (${Math.round(dropPct)}% drop from ${previousCount}).`,
        details: { previousCount, currentCount: totalUrls, removedCount, dropPct: Math.round(dropPct) }
      });
    } else if (totalUrls >= previousCount * 0.9) {
      // Recovered back to >= 90% of baseline
      await resolveIssueIfOpen(sitemapId, 'significant_url_reduction');
    }
  }
}
