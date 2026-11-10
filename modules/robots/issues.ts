import { db } from '@/lib/db';

export type RobotsIssueParams = {
  projectId: number;
  siteId: number;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  ruleResponsible?: string | null;
  affectedUrlsCount?: number;
  details?: Record<string, unknown> | null;
};

/**
 * Creates or updates an open issue for a robots.txt condition.
 * Deduplicates automatically via the UNIQUE constraint on open_key.
 */
export async function createOrUpdateRobotsIssue(issue: RobotsIssueParams): Promise<void> {
  const detailsJson = issue.details ? JSON.stringify(issue.details) : null;

  await db.query(
    `INSERT INTO robots_issues (
       project_id, site_id, issue_type, severity, title, description, rule_responsible,
       affected_urls_count, details, first_detected_at, last_detected_at, occurrence_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)
     ON DUPLICATE KEY UPDATE
       last_detected_at = UTC_TIMESTAMP(3),
       occurrence_count = occurrence_count + 1,
       severity = VALUES(severity),
       title = VALUES(title),
       description = VALUES(description),
       rule_responsible = VALUES(rule_responsible),
       affected_urls_count = VALUES(affected_urls_count),
       details = VALUES(details)`,
    [
      issue.projectId,
      issue.siteId,
      issue.issueType,
      issue.severity,
      issue.title.slice(0, 255),
      issue.description,
      issue.ruleResponsible ?? null,
      issue.affectedUrlsCount ?? 0,
      detailsJson
    ]
  );
}

/**
 * Automatically marks open issue(s) of a given type as resolved when the condition cleared.
 */
export async function resolveRobotsIssueIfOpen(siteId: number, issueType: string): Promise<number> {
  const [res] = await db.query<any>(
    `UPDATE robots_issues
     SET resolved_at = UTC_TIMESTAMP(3)
     WHERE site_id = ? AND issue_type = ? AND resolved_at IS NULL`,
    [siteId, issueType]
  );
  return res.affectedRows || 0;
}

export type RobotsEvaluationContext = {
  projectId: number;
  siteId: number;
  siteUrl: string;
  statusCode: number | null;
  errorMessage: string | null;
  isEntireSiteBlocked: boolean;
  rootRuleResponsible: string | null;
  blockedUrlsCount: number;
  newlyBlockedUrls: { url: string; rule: string | null }[];
  criticalPathsBlocked: { path: string; rule: string | null }[];
};

/**
 * Evaluates robots.txt state and newly evaluated URLs against active issues.
 * Creates new issues and auto-resolves cleared conditions.
 */
export async function evaluateRobotsIssues(ctx: RobotsEvaluationContext): Promise<void> {
  const { projectId, siteId, siteUrl, statusCode, errorMessage, isEntireSiteBlocked, rootRuleResponsible, newlyBlockedUrls, criticalPathsBlocked } = ctx;

  // 1. Status 5xx Server Error (RFC 9309: crawler halts)
  if (statusCode && statusCode >= 500) {
    await createOrUpdateRobotsIssue({
      projectId,
      siteId,
      issueType: 'status_5xx_server_error',
      severity: 'critical',
      title: `Robots.txt returning HTTP ${statusCode}`,
      description: `Server error on /robots.txt. According to RFC 9309, search engines halt crawling when robots.txt returns 5xx to avoid overloading degraded servers.`,
      details: { statusCode, errorMessage }
    });
  } else if (statusCode && statusCode < 500) {
    await resolveRobotsIssueIfOpen(siteId, 'status_5xx_server_error');
  }

  // 2. Inaccessible (network failure / connection timeout)
  if (!statusCode && errorMessage) {
    await createOrUpdateRobotsIssue({
      projectId,
      siteId,
      issueType: 'inaccessible',
      severity: 'critical',
      title: 'Robots.txt is inaccessible',
      description: `Connection timeout or network failure reaching robots.txt: ${errorMessage}`,
      details: { errorMessage }
    });
  } else if (statusCode !== null) {
    await resolveRobotsIssueIfOpen(siteId, 'inaccessible');
  }

  // 3. Status 404 Missing
  if (statusCode === 404) {
    await createOrUpdateRobotsIssue({
      projectId,
      siteId,
      issueType: 'status_404_missing',
      severity: 'info',
      title: 'Robots.txt file not found (HTTP 404)',
      description: `No robots.txt was found at ${siteUrl}/robots.txt. Search engines assume all URLs are unrestricted for crawling.`,
      details: { statusCode: 404 }
    });
  } else if (statusCode && statusCode !== 404) {
    await resolveRobotsIssueIfOpen(siteId, 'status_404_missing');
  }

  // 4. Entire Website Blocked
  if (isEntireSiteBlocked) {
    await createOrUpdateRobotsIssue({
      projectId,
      siteId,
      issueType: 'entire_site_blocked',
      severity: 'critical',
      title: 'Entire website blocked by Disallow: /',
      description: `Search engine crawlers (Googlebot) are blocked from crawling the root of ${siteUrl}. Search engines will stop crawling all internal URLs.`,
      ruleResponsible: rootRuleResponsible || 'Disallow: /',
      details: { rule: rootRuleResponsible }
    });
  } else if (statusCode === 200) {
    await resolveRobotsIssueIfOpen(siteId, 'entire_site_blocked');
  }

  // 5. Critical Paths Blocked (e.g. /sitemap.xml or important directories)
  if (criticalPathsBlocked.length > 0) {
    const pathsStr = criticalPathsBlocked.map(p => `${p.path} (${p.rule || 'Blocked'})`).join(', ');
    await createOrUpdateRobotsIssue({
      projectId,
      siteId,
      issueType: 'critical_path_blocked',
      severity: 'critical',
      title: `${criticalPathsBlocked.length} critical path(s) blocked in robots.txt`,
      description: `Important website sections or sitemaps are blocked: ${pathsStr}.`,
      ruleResponsible: criticalPathsBlocked[0].rule || undefined,
      affectedUrlsCount: criticalPathsBlocked.length,
      details: { blocked: criticalPathsBlocked }
    });
  } else if (statusCode === 200) {
    await resolveRobotsIssueIfOpen(siteId, 'critical_path_blocked');
  }

  // 6. Tracked URLs became blocked
  if (newlyBlockedUrls.length > 0) {
    await createOrUpdateRobotsIssue({
      projectId,
      siteId,
      issueType: 'urls_became_blocked',
      severity: newlyBlockedUrls.length >= 20 ? 'critical' : 'warning',
      title: `${newlyBlockedUrls.length} tracked URLs unexpectedly became blocked`,
      description: `${newlyBlockedUrls.length} previously crawlable URLs are now blocked by robots.txt rules for Googlebot.`,
      affectedUrlsCount: newlyBlockedUrls.length,
      ruleResponsible: newlyBlockedUrls[0]?.rule || undefined,
      details: { samples: newlyBlockedUrls.slice(0, 20), count: newlyBlockedUrls.length }
    });
  } else if (ctx.blockedUrlsCount === 0 && statusCode === 200) {
    await resolveRobotsIssueIfOpen(siteId, 'urls_became_blocked');
  }
}
