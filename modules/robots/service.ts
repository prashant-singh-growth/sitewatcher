import crypto from 'node:crypto';
import { db, rows } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { fetchSitemap } from '@/modules/sitemaps/fetcher';
import { parseRobotsTxt, isPathAllowed, type ParsedRobotsTxt } from './parser';
import { evaluateRobotsIssues } from './issues';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

export type RobotsEvaluationSummary = {
  siteId: number;
  url: string;
  statusCode: number | null;
  totalMonitoredUrls: number;
  crawlableCount: number;
  blockedCount: number;
  newlyBlockedCount: number;
  newlyAllowedCount: number;
  rulesCount: number;
  isEntireSiteBlocked: boolean;
  status: 'operational' | 'failed' | 'missing_404' | 'server_error_5xx';
};

/**
 * Ensures a robots_monitors record exists for a website.
 */
export async function ensureRobotsMonitor(siteId: number, projectId: number, siteUrl: string) {
  const origin = new URL(siteUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;
  const urlH = sha256(robotsUrl);

  await db.query(
    `INSERT INTO robots_monitors (
       project_id, site_id, url, url_hash, check_interval_hours, next_run_at
     ) VALUES (?, ?, ?, ?, 24, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE updated_at = updated_at`,
    [projectId, siteId, robotsUrl, urlH]
  );

  return (await rows<any>('SELECT * FROM robots_monitors WHERE site_id = ?', [siteId]))[0];
}

/**
 * Fetches robots.txt, parses RFC 9309 rules, and evaluates crawlability against tracked URLs.
 */
export async function fetchAndEvaluateRobots(
  siteId: number,
  triggeredBy: 'cron' | 'manual' = 'cron'
): Promise<RobotsEvaluationSummary> {
  const siteList = await rows<any>(
    'SELECT s.id, s.project_id, s.name, s.url, p.status AS project_status FROM monitored_sites s JOIN projects p ON p.id = s.project_id WHERE s.id = ?',
    [siteId]
  );
  const site = siteList[0];
  if (!site) throw new ApiError(404, 'Website not found.');

  const origin = new URL(site.url).origin;
  const robotsUrl = `${origin}/robots.txt`;

  await ensureRobotsMonitor(site.id, Number(site.project_id), site.url);

  const fetchRes = await fetchSitemap(robotsUrl, { timeoutMs: 15000 });
  const statusCode = fetchRes.statusCode;
  const body = fetchRes.body || '';
  const contentHash = sha256(body);

  // Get previous snapshot hash
  const prevSnap = (await rows<any>(
    'SELECT * FROM robots_snapshots WHERE site_id = ? ORDER BY fetched_at DESC LIMIT 1',
    [siteId]
  ))[0];
  const isChanged = prevSnap ? prevSnap.content_hash !== contentHash : true;

  // Handle network failure / timeout
  if (statusCode === null || !fetchRes) {
    const errorMsg = fetchRes.error || 'Network connection failed';
    await db.query(
      `INSERT INTO robots_snapshots (
         project_id, site_id, status_code, content, content_hash, is_changed, error_message, fetched_at
       ) VALUES (?, ?, NULL, NULL, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [site.project_id, siteId, contentHash, isChanged ? 1 : 0, errorMsg.slice(0, 500)]
    );

    await db.query(
      `UPDATE robots_monitors
       SET last_status = 'failed',
           last_status_code = NULL,
           last_error = ?,
           last_checked_at = UTC_TIMESTAMP(3),
           next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL check_interval_hours HOUR),
           claim_token = NULL,
           claimed_at = NULL,
           updated_at = updated_at
       WHERE site_id = ?`,
      [errorMsg.slice(0, 500), siteId]
    );

    await evaluateRobotsIssues({
      projectId: Number(site.project_id),
      siteId,
      siteUrl: site.url,
      statusCode: null,
      errorMessage: errorMsg,
      isEntireSiteBlocked: false,
      rootRuleResponsible: null,
      blockedUrlsCount: 0,
      newlyBlockedUrls: [],
      criticalPathsBlocked: []
    });

    return {
      siteId,
      url: robotsUrl,
      statusCode: null,
      totalMonitoredUrls: 0,
      crawlableCount: 0,
      blockedCount: 0,
      newlyBlockedCount: 0,
      newlyAllowedCount: 0,
      rulesCount: 0,
      isEntireSiteBlocked: false,
      status: 'failed'
    };
  }

  // Handle 5xx Server Error (RFC 9309: halt crawling)
  if (statusCode >= 500) {
    await db.query(
      `INSERT INTO robots_snapshots (
         project_id, site_id, status_code, content, content_hash, is_changed, error_message, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [site.project_id, siteId, statusCode, body, contentHash, isChanged ? 1 : 0, `HTTP ${statusCode}`]
    );

    await db.query(
      `UPDATE robots_monitors
       SET last_status = 'server_error_5xx',
           last_status_code = ?,
           last_error = ?,
           last_checked_at = UTC_TIMESTAMP(3),
           next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL check_interval_hours HOUR),
           claim_token = NULL,
           claimed_at = NULL,
           updated_at = updated_at
       WHERE site_id = ?`,
      [statusCode, `HTTP ${statusCode}`, siteId]
    );

    await evaluateRobotsIssues({
      projectId: Number(site.project_id),
      siteId,
      siteUrl: site.url,
      statusCode,
      errorMessage: `HTTP ${statusCode} Server Error`,
      isEntireSiteBlocked: true,
      rootRuleResponsible: 'HTTP 5xx Server Error (RFC 9309 crawler halt)',
      blockedUrlsCount: 0,
      newlyBlockedUrls: [],
      criticalPathsBlocked: []
    });

    return {
      siteId,
      url: robotsUrl,
      statusCode,
      totalMonitoredUrls: 0,
      crawlableCount: 0,
      blockedCount: 0,
      newlyBlockedCount: 0,
      newlyAllowedCount: 0,
      rulesCount: 0,
      isEntireSiteBlocked: true,
      status: 'server_error_5xx'
    };
  }

  // Parse Rules (RFC 9309)
  const parsed: ParsedRobotsTxt = statusCode === 200 ? parseRobotsTxt(body) : { groups: [], sitemaps: [], rawRulesCount: 0 };

  // Save snapshot
  const [snapIns] = await db.query<any>(
    `INSERT INTO robots_snapshots (
       project_id, site_id, status_code, content, content_hash, is_changed, rules_count, sitemaps_declared_count, fetched_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      site.project_id,
      siteId,
      statusCode,
      body,
      contentHash,
      isChanged ? 1 : 0,
      parsed.rawRulesCount,
      parsed.sitemaps.length
    ]
  );
  const snapshotId = snapIns.insertId;

  // Replace active rules in robots_rules table
  await db.query('DELETE FROM robots_rules WHERE site_id = ?', [siteId]);

  const ruleInserts: any[] = [];
  for (const group of parsed.groups) {
    for (const ua of group.userAgents) {
      for (const rule of group.rules) {
        ruleInserts.push([siteId, snapshotId, ua, rule.directive, rule.pattern, 0]);
      }
      if (group.crawlDelay !== undefined) {
        ruleInserts.push([siteId, snapshotId, ua, 'crawl_delay', String(group.crawlDelay), 0]);
      }
    }
  }
  for (const sm of parsed.sitemaps) {
    ruleInserts.push([siteId, snapshotId, '*', 'sitemap', sm, 0]);
  }

  if (ruleInserts.length > 0) {
    const placeholders = ruleInserts.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
    await db.query(
      `INSERT INTO robots_rules (site_id, snapshot_id, user_agent, directive, value, affected_urls_count) VALUES ${placeholders}`,
      ruleInserts.flat()
    );
  }

  // Load tracked URLs for crawlability evaluation:
  // 1. Root '/'
  // 2. Default sitemap path '/sitemap.xml'
  // 3. Tracked URLs from sitemap_urls table
  const candidateUrls = new Set<string>();
  candidateUrls.add(`${origin}/`);
  candidateUrls.add(`${origin}/sitemap.xml`);

  const sitemapUrlRows = await rows<{ loc: string }>(
    'SELECT loc FROM sitemap_urls WHERE site_id = ? AND status = "active" LIMIT 1000',
    [siteId]
  );
  for (const row of sitemapUrlRows) {
    candidateUrls.add(row.loc);
  }

  // Load previous evaluations for transition tracking
  const prevEvaluations = await rows<{ url: string; url_hash: string; status: 'allowed' | 'blocked' }>(
    'SELECT url, url_hash, status FROM robots_url_evaluations WHERE site_id = ? AND user_agent = "Googlebot"',
    [siteId]
  );
  const prevEvalMap = new Map(prevEvaluations.map(e => [e.url, e.status]));

  // Evaluate crawlability for each URL against Googlebot
  let crawlableCount = 0;
  let blockedCount = 0;
  let newlyBlockedCount = 0;
  let newlyAllowedCount = 0;
  const newlyBlockedList: { url: string; rule: string | null }[] = [];
  const criticalPathsBlocked: { path: string; rule: string | null }[] = [];
  const ruleHitCounts = new Map<string, number>();

  const evalRows: any[] = [];

  for (const testUrl of candidateUrls) {
    let evalRes = {
      allowed: true,
      matchedRule: null as string | null,
      matchedDirective: null as 'allow' | 'disallow' | null,
      userAgentGroup: 'Googlebot',
      reason: 'HTTP 404: No restrictions'
    };

    if (statusCode === 200) {
      evalRes = isPathAllowed(parsed, testUrl, 'Googlebot');
    }

    const isAllowed = evalRes.allowed;
    const currentStatus: 'allowed' | 'blocked' = isAllowed ? 'allowed' : 'blocked';
    const prevStatus = prevEvalMap.get(testUrl);

    if (isAllowed) {
      crawlableCount++;
      if (prevStatus === 'blocked') newlyAllowedCount++;
    } else {
      blockedCount++;
      if (prevStatus === 'allowed') {
        newlyBlockedCount++;
        newlyBlockedList.push({ url: testUrl, rule: evalRes.matchedRule });
      }

      // Check critical paths
      const pathOnly = new URL(testUrl).pathname;
      if (pathOnly === '/' || pathOnly === '/sitemap.xml' || pathOnly.startsWith('/blog') || pathOnly.startsWith('/products')) {
        criticalPathsBlocked.push({ path: pathOnly, rule: evalRes.matchedRule });
      }
    }

    if (evalRes.matchedRule) {
      ruleHitCounts.set(evalRes.matchedRule, (ruleHitCounts.get(evalRes.matchedRule) || 0) + 1);
    }

    const uHash = sha256(testUrl);
    const statusChanged = prevStatus && prevStatus !== currentStatus;

    evalRows.push([
      site.project_id,
      siteId,
      testUrl,
      uHash,
      'Googlebot',
      currentStatus,
      prevStatus || null,
      evalRes.matchedRule,
      evalRes.userAgentGroup,
      statusChanged ? new Date() : null
    ]);
  }

  // Batch insert/update evaluations
  if (evalRows.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < evalRows.length; i += CHUNK) {
      const slice = evalRows.slice(i, i + CHUNK);
      const valSql = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))').join(',');
      await db.query(
        `INSERT INTO robots_url_evaluations (
           project_id, site_id, url, url_hash, user_agent, status, previous_status,
           matched_rule, matched_user_agent, status_changed_at, first_evaluated_at, last_evaluated_at
         ) VALUES ${valSql}
         ON DUPLICATE KEY UPDATE
           previous_status = status,
           status = VALUES(status),
           matched_rule = VALUES(matched_rule),
           matched_user_agent = VALUES(matched_user_agent),
           status_changed_at = IF(status <> VALUES(status), UTC_TIMESTAMP(3), status_changed_at),
           last_evaluated_at = UTC_TIMESTAMP(3)`,
        slice.flat()
      );
    }
  }

  // Update affected_urls_count in robots_rules
  for (const [ruleStr, hits] of ruleHitCounts) {
    const [directive, pattern] = ruleStr.split(': ').map(s => s.trim().toLowerCase());
    if (directive && pattern !== undefined) {
      await db.query(
        'UPDATE robots_rules SET affected_urls_count = ? WHERE site_id = ? AND directive = ? AND value = ?',
        [hits, siteId, directive, pattern]
      );
    }
  }

  // Check if entire site is blocked from root '/'
  const rootEval = isPathAllowed(parsed, `${origin}/`, 'Googlebot');
  const isEntireSiteBlocked = !rootEval.allowed;

  // Determine monitor status
  const monitorStatus = statusCode === 404 ? 'missing_404' : 'operational';

  // Update robots_monitors
  await db.query(
    `UPDATE robots_monitors
     SET last_status = ?,
         last_status_code = ?,
         last_error = NULL,
         content_hash = ?,
         total_rules_count = ?,
         total_monitored_urls = ?,
         crawlable_urls_count = ?,
         blocked_urls_count = ?,
         last_checked_at = UTC_TIMESTAMP(3),
         last_changed_at = IF(? = 1, UTC_TIMESTAMP(3), last_changed_at),
         next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL check_interval_hours HOUR),
         claim_token = NULL,
         claimed_at = NULL,
         updated_at = updated_at
     WHERE site_id = ?`,
    [
      monitorStatus,
      statusCode,
      contentHash,
      parsed.rawRulesCount,
      candidateUrls.size,
      crawlableCount,
      blockedCount,
      isChanged ? 1 : 0,
      siteId
    ]
  );

  // Evaluate issues and resolve cleared conditions
  await evaluateRobotsIssues({
    projectId: Number(site.project_id),
    siteId,
    siteUrl: site.url,
    statusCode,
    errorMessage: null,
    isEntireSiteBlocked,
    rootRuleResponsible: isEntireSiteBlocked ? rootEval.matchedRule : null,
    blockedUrlsCount: blockedCount,
    newlyBlockedUrls: newlyBlockedList,
    criticalPathsBlocked
  });

  return {
    siteId,
    url: robotsUrl,
    statusCode,
    totalMonitoredUrls: candidateUrls.size,
    crawlableCount,
    blockedCount,
    newlyBlockedCount,
    newlyAllowedCount,
    rulesCount: parsed.rawRulesCount,
    isEntireSiteBlocked,
    status: monitorStatus
  };
}

/**
 * Scheduled background robots.txt runner.
 * Claims due sites atomically using random claim_token.
 */
export async function runDueRobotsChecks(
  cronStartedAt: number,
  maxSites = 4,
  budgetMs = 35000
): Promise<{ due: number; checked: number; blockedUrlsFound: number }> {
  const out = { due: 0, checked: 0, blockedUrlsFound: 0 };
  if (Date.now() - cronStartedAt > budgetMs) return out;

  const token = crypto.randomBytes(16).toString('hex');

  await db.query(
    `UPDATE robots_monitors
     SET claim_token = ?, claimed_at = UTC_TIMESTAMP(3), updated_at = updated_at
     WHERE is_active = 1
       AND (next_run_at IS NULL OR next_run_at <= UTC_TIMESTAMP(3))
       AND (claim_token IS NULL OR claimed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
       AND site_id IN (SELECT id FROM monitored_sites WHERE deleted_at IS NULL)
       AND project_id IN (SELECT id FROM projects WHERE status <> 'archived')
     ORDER BY next_run_at ASC LIMIT ?`,
    [token, maxSites]
  );

  const claimed = await rows<any>('SELECT * FROM robots_monitors WHERE claim_token = ?', [token]);
  out.due = claimed.length;

  for (const m of claimed) {
    if (Date.now() - cronStartedAt > budgetMs) {
      await db.query(
        'UPDATE robots_monitors SET claim_token = NULL, claimed_at = NULL, updated_at = updated_at WHERE id = ?',
        [m.id]
      );
      continue;
    }

    try {
      const res = await fetchAndEvaluateRobots(Number(m.site_id), 'cron');
      out.checked++;
      out.blockedUrlsFound += res.blockedCount;
    } catch (e) {
      console.error(`[SiteWatch] Scheduled robots.txt check failed for site #${m.site_id}:`, e);
      await db.query(
        `UPDATE robots_monitors
         SET claim_token = NULL, claimed_at = NULL,
             last_status = 'failed',
             last_error = ?,
             next_run_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR),
             updated_at = updated_at
         WHERE id = ?`,
        [String((e as any)?.message || e).slice(0, 500), m.id]
      );
    }
  }

  return out;
}

/**
 * Returns overall robots.txt and crawlability statistics for a website.
 */
export async function getRobotsStats(siteId: number) {
  const monitor = (await rows<any>('SELECT * FROM robots_monitors WHERE site_id = ?', [siteId]))[0];

  const latestSnapshot = (await rows<any>(
    'SELECT * FROM robots_snapshots WHERE site_id = ? ORDER BY fetched_at DESC LIMIT 1',
    [siteId]
  ))[0];

  const rules = await rows<any>(
    'SELECT * FROM robots_rules WHERE site_id = ? ORDER BY directive = "disallow" DESC, user_agent ASC, id ASC',
    [siteId]
  );

  const openIssues = await rows<any>(
    `SELECT i.* FROM robots_issues i
     WHERE i.site_id = ? AND i.resolved_at IS NULL
     ORDER BY i.severity = 'critical' DESC, i.last_detected_at DESC`,
    [siteId]
  );

  const recentSnapshots = await rows<any>(
    'SELECT id, status_code, content_hash, is_changed, rules_count, sitemaps_declared_count, error_message, fetched_at FROM robots_snapshots WHERE site_id = ? ORDER BY fetched_at DESC LIMIT 20',
    [siteId]
  );

  // Compute newly blocked / newly allowed in the last 24h
  const changesSummary = (await rows<any>(
    `SELECT
       SUM(IF(status = 'blocked' AND previous_status = 'allowed', 1, 0)) AS newly_blocked,
       SUM(IF(status = 'allowed' AND previous_status = 'blocked', 1, 0)) AS newly_allowed
     FROM robots_url_evaluations
     WHERE site_id = ? AND user_agent = 'Googlebot'`,
    [siteId]
  ))[0];

  return {
    monitor: monitor || null,
    latestSnapshot: latestSnapshot || null,
    rules,
    openIssues,
    recentSnapshots,
    newlyBlocked: Number(changesSummary?.newly_blocked || 0),
    newlyAllowed: Number(changesSummary?.newly_allowed || 0)
  };
}
