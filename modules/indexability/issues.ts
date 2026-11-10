import { db } from '@/lib/db';
import type { CrawlResult } from './crawler';
import type { ParsedIndexabilitySignals } from './parser';

export type IndexabilityIssueParams = {
  projectId: number;
  siteId: number;
  pageId?: number | null;
  url: string;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  previousValue?: string | null;
  currentValue?: string | null;
};

/**
 * Creates or updates an open issue for an indexability condition.
 * Deduplicates automatically via the UNIQUE constraint on open_key (site_id:md5(url):issue_type).
 */
export async function createOrUpdateIndexabilityIssue(issue: IndexabilityIssueParams): Promise<void> {
  await db.query(
    `INSERT INTO indexability_issues (
       project_id, site_id, page_id, url, issue_type, severity, title, description,
       previous_value, current_value, first_detected_at, last_detected_at, occurrence_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)
     ON DUPLICATE KEY UPDATE
       last_detected_at = UTC_TIMESTAMP(3),
       occurrence_count = occurrence_count + 1,
       severity = VALUES(severity),
       title = VALUES(title),
       description = VALUES(description),
       previous_value = VALUES(previous_value),
       current_value = VALUES(current_value),
       page_id = VALUES(page_id)`,
    [
      issue.projectId,
      issue.siteId,
      issue.pageId ?? null,
      issue.url,
      issue.issueType,
      issue.severity,
      issue.title.slice(0, 255),
      issue.description,
      issue.previousValue ?? null,
      issue.currentValue ?? null
    ]
  );
}

/**
 * Automatically marks an open issue of a given type on a URL as resolved when the condition clears.
 */
export async function resolveIndexabilityIssueIfOpen(
  siteId: number,
  url: string,
  issueType: string
): Promise<number> {
  const [res] = await db.query<any>(
    `UPDATE indexability_issues
     SET resolved_at = UTC_TIMESTAMP(3)
     WHERE site_id = ? AND url = ? AND issue_type = ? AND resolved_at IS NULL`,
    [siteId, url, issueType]
  );
  return res.affectedRows || 0;
}

export type PageIssueEvaluationContext = {
  projectId: number;
  siteId: number;
  pageId?: number | null;
  url: string;
  previousState?: {
    httpStatus: number | null;
    isIndexable: boolean;
    hasNoindex: boolean;
    canonicalUrl: string | null;
    canonicalStatus: string;
  } | null;
  crawlResult: CrawlResult;
  parsed: ParsedIndexabilitySignals;
};

/**
 * Evaluates crawled and parsed page indexability signals.
 * Creates appropriate deduplicated issues and automatically resolves conditions that cleared.
 */
export async function evaluatePageIndexabilityIssues(ctx: PageIssueEvaluationContext): Promise<void> {
  const { projectId, siteId, pageId, url, previousState, crawlResult, parsed } = ctx;

  // 1. Network / Connection Error
  if (!crawlResult.statusCode && crawlResult.error) {
    await createOrUpdateIndexabilityIssue({
      projectId,
      siteId,
      pageId,
      url,
      issueType: 'network_error',
      severity: 'warning',
      title: 'Page connection error or timeout',
      description: `Failed to crawl page: ${crawlResult.error}`,
      currentValue: crawlResult.error
    });
  } else if (crawlResult.statusCode) {
    await resolveIndexabilityIssueIfOpen(siteId, url, 'network_error');
  }

  // 2. HTTP Status 404 / 410
  if (crawlResult.statusCode === 404 || crawlResult.statusCode === 410) {
    const statusLabel = crawlResult.statusCode === 404 ? 'Not Found' : 'Gone';
    await createOrUpdateIndexabilityIssue({
      projectId,
      siteId,
      pageId,
      url,
      issueType: 'status_404_or_410',
      severity: 'critical',
      title: `Page returning HTTP ${crawlResult.statusCode} (${statusLabel})`,
      description: `The page returned HTTP ${crawlResult.statusCode}. Search engine crawlers will deindex this URL once the error is confirmed.`,
      previousValue: previousState?.httpStatus ? `HTTP ${previousState.httpStatus}` : null,
      currentValue: `HTTP ${crawlResult.statusCode}`
    });
  } else if (crawlResult.statusCode === 200) {
    await resolveIndexabilityIssueIfOpen(siteId, url, 'status_404_or_410');
  }

  // 3. HTTP Status 403 Forbidden
  if (crawlResult.statusCode === 403) {
    await createOrUpdateIndexabilityIssue({
      projectId,
      siteId,
      pageId,
      url,
      issueType: 'status_403_forbidden',
      severity: 'warning',
      title: 'Page returning HTTP 403 Forbidden',
      description: 'Access to this URL is forbidden. Search engine crawlers cannot inspect or index this content.',
      previousValue: previousState?.httpStatus ? `HTTP ${previousState.httpStatus}` : null,
      currentValue: 'HTTP 403'
    });
  } else if (crawlResult.statusCode === 200) {
    await resolveIndexabilityIssueIfOpen(siteId, url, 'status_403_forbidden');
  }

  // 4. HTTP Status 5xx Server Error
  if (crawlResult.statusCode && crawlResult.statusCode >= 500) {
    await createOrUpdateIndexabilityIssue({
      projectId,
      siteId,
      pageId,
      url,
      issueType: 'status_5xx_server_error',
      severity: 'critical',
      title: `Server error HTTP ${crawlResult.statusCode}`,
      description: `Internal server error encountered while crawling. Persistent 5xx errors prompt search engines to drop pages from indexation to avoid showing broken links.`,
      previousValue: previousState?.httpStatus ? `HTTP ${previousState.httpStatus}` : null,
      currentValue: `HTTP ${crawlResult.statusCode}`
    });
  } else if (crawlResult.statusCode && crawlResult.statusCode < 500) {
    await resolveIndexabilityIssueIfOpen(siteId, url, 'status_5xx_server_error');
  }

  // 5. Redirect Loop
  if (crawlResult.isRedirectLoop) {
    await createOrUpdateIndexabilityIssue({
      projectId,
      siteId,
      pageId,
      url,
      issueType: 'redirect_loop',
      severity: 'critical',
      title: 'Redirect loop detected',
      description: `Crawler detected a circular redirection loop while requesting this URL. Search bots stop following after encountering a loop.`,
      currentValue: `Loop after ${crawlResult.redirectHops} hops`
    });
  } else if (crawlResult.statusCode === 200) {
    await resolveIndexabilityIssueIfOpen(siteId, url, 'redirect_loop');
  }

  // 6. Excessive Redirect Hops (> 3)
  if (crawlResult.redirectHops > 3 && !crawlResult.isRedirectLoop) {
    await createOrUpdateIndexabilityIssue({
      projectId,
      siteId,
      pageId,
      url,
      issueType: 'excessive_redirect_hops',
      severity: 'warning',
      title: `Excessive redirect chain (${crawlResult.redirectHops} hops)`,
      description: `URL requires ${crawlResult.redirectHops} redirects to reach ${crawlResult.finalUrl}. Long chains waste crawl budget and search engines may drop out before the target.`,
      currentValue: `${crawlResult.redirectHops} hops`
    });
  } else if (crawlResult.redirectHops <= 3) {
    await resolveIndexabilityIssueIfOpen(siteId, url, 'excessive_redirect_hops');
  }

  // Only evaluate HTML / Robots directives if we received a response
  if (crawlResult.statusCode) {
    // 7. Unexpected Noindex Directive
    if (parsed.hasNoindex) {
      const directiveVal =
        parsed.noindexSource === 'x_robots_tag'
          ? parsed.xRobotsTag
          : parsed.noindexSource === 'meta_googlebot'
          ? parsed.metaGooglebot
          : parsed.metaRobots;

      await createOrUpdateIndexabilityIssue({
        projectId,
        siteId,
        pageId,
        url,
        issueType: 'unexpected_noindex',
        severity: 'critical',
        title: `Page contains noindex directive (${parsed.noindexSource})`,
        description: `Crawler discovered a noindex directive from ${parsed.noindexSource}. Search engines will exclude or remove this URL from search indexation.`,
        previousValue: previousState?.hasNoindex ? 'noindex' : 'indexable',
        currentValue: `${parsed.noindexSource}: ${directiveVal}`
      });
    } else {
      await resolveIndexabilityIssueIfOpen(siteId, url, 'unexpected_noindex');
    }

    // 8. Conflicting Directives (index and noindex in the same or combined declarations)
    if (parsed.hasConflict) {
      await createOrUpdateIndexabilityIssue({
        projectId,
        siteId,
        pageId,
        url,
        issueType: 'conflicting_robots_directives',
        severity: 'warning',
        title: 'Conflicting robots directives (both index and noindex declared)',
        description: 'Both index and noindex directives were declared. Search engines generally prioritize the more restrictive noindex directive.',
        currentValue: `meta: "${parsed.metaRobots || 'none'}", X-Robots: "${parsed.xRobotsTag || 'none'}"`
      });
    } else {
      await resolveIndexabilityIssueIfOpen(siteId, url, 'conflicting_robots_directives');
    }

    // 9. Multiple Conflicting Canonical Tags
    if (parsed.canonicalStatus === 'multiple') {
      await createOrUpdateIndexabilityIssue({
        projectId,
        siteId,
        pageId,
        url,
        issueType: 'multiple_canonicals',
        severity: 'critical',
        title: 'Multiple canonical tags declared',
        description: `Page declared ${parsed.rawCanonicals.length} conflicting canonical tags. Search engines typically ignore all canonical tags when duplicates conflict, potentially causing indexation confusion.`,
        currentValue: parsed.rawCanonicals.join(' | ')
      });
    } else {
      await resolveIndexabilityIssueIfOpen(siteId, url, 'multiple_canonicals');
    }

    // 10. Invalid Canonical URL Syntax
    if (parsed.canonicalStatus === 'invalid') {
      await createOrUpdateIndexabilityIssue({
        projectId,
        siteId,
        pageId,
        url,
        issueType: 'invalid_canonical',
        severity: 'warning',
        title: 'Invalid canonical URL target',
        description: `Canonical tag specifies an unparseable or non-HTTP URL: ${parsed.rawCanonicals[0] || 'unknown'}`,
        currentValue: parsed.rawCanonicals[0] || 'invalid'
      });
    } else {
      await resolveIndexabilityIssueIfOpen(siteId, url, 'invalid_canonical');
    }

    // 11. Canonical Tag Removed
    if (previousState?.canonicalUrl && !parsed.canonicalUrl && crawlResult.statusCode === 200) {
      await createOrUpdateIndexabilityIssue({
        projectId,
        siteId,
        pageId,
        url,
        issueType: 'canonical_removed',
        severity: 'warning',
        title: 'Canonical tag was removed',
        description: `Page previously had canonical tag pointing to ${previousState.canonicalUrl}, but no canonical tag was found on the latest scan.`,
        previousValue: previousState.canonicalUrl,
        currentValue: null
      });
    } else if (parsed.canonicalUrl) {
      await resolveIndexabilityIssueIfOpen(siteId, url, 'canonical_removed');
    }

    // 12. Canonical Target Changed
    if (
      previousState?.canonicalUrl &&
      parsed.canonicalUrl &&
      previousState.canonicalUrl !== parsed.canonicalUrl &&
      crawlResult.statusCode === 200
    ) {
      await createOrUpdateIndexabilityIssue({
        projectId,
        siteId,
        pageId,
        url,
        issueType: 'canonical_changed',
        severity: 'warning',
        title: 'Canonical destination URL changed',
        description: `Canonical target changed from ${previousState.canonicalUrl} to ${parsed.canonicalUrl}.`,
        previousValue: previousState.canonicalUrl,
        currentValue: parsed.canonicalUrl
      });
    }
  }
}
