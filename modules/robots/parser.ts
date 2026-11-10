// Standards-compliant RFC 9309 Robots.txt Parser and Path Evaluator

export type DirectiveType = 'allow' | 'disallow' | 'crawl_delay' | 'sitemap';

export type ParsedRule = {
  directive: 'allow' | 'disallow';
  pattern: string;
  patternLength: number;
  regex: RegExp;
};

export type UserAgentGroup = {
  userAgents: string[];
  rules: ParsedRule[];
  crawlDelay?: number;
};

export type ParsedRobotsTxt = {
  groups: UserAgentGroup[];
  sitemaps: string[];
  rawRulesCount: number;
};

export type PathEvaluationResult = {
  allowed: boolean;
  matchedRule: string | null;
  matchedDirective: 'allow' | 'disallow' | null;
  userAgentGroup: string;
  reason: string;
};

/**
 * Escapes regex characters while preserving robots.txt wildcards `*` and `$`.
 * In RFC 9309:
 * `*` designates 0 or more characters (-> `.*`)
 * `$` at the end designates the end of the URL (-> `$`)
 */
export function compileRobotsPattern(pattern: string): RegExp {
  if (!pattern) return /^.*$/;

  let hasEndAnchor = false;
  let cleanPattern = pattern;

  if (cleanPattern.endsWith('$')) {
    hasEndAnchor = true;
    cleanPattern = cleanPattern.slice(0, -1);
  }

  // Escape special regex characters except '*'
  let escaped = cleanPattern.replace(/[-[\]/{}()+?.\\^|]/g, '\\$&');

  // Replace '*' with '.*'
  escaped = escaped.replace(/\*/g, '.*');

  // Must match from the beginning of the path
  const regexStr = '^' + escaped + (hasEndAnchor ? '$' : '');
  return new RegExp(regexStr);
}

/**
 * Parses raw robots.txt text according to RFC 9309.
 */
export function parseRobotsTxt(content: string): ParsedRobotsTxt {
  const lines = content.split(/\r?\n/);
  const groups: UserAgentGroup[] = [];
  const sitemaps: string[] = [];

  let currentUserAgents: string[] = [];
  let currentRules: ParsedRule[] = [];
  let currentCrawlDelay: number | undefined;
  let inGroup = false;

  const flushGroup = () => {
    if (currentUserAgents.length > 0) {
      groups.push({
        userAgents: [...currentUserAgents],
        rules: [...currentRules],
        crawlDelay: currentCrawlDelay
      });
    }
    currentUserAgents = [];
    currentRules = [];
    currentCrawlDelay = undefined;
    inGroup = false;
  };

  for (const rawLine of lines) {
    let line = rawLine.trim();

    // Remove comments
    const commentIdx = line.indexOf('#');
    if (commentIdx > -1) {
      line = line.slice(0, commentIdx).trim();
    }
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'sitemap') {
      if (value.startsWith('http://') || value.startsWith('https://')) {
        sitemaps.push(value);
      }
      continue;
    }

    if (field === 'user-agent') {
      if (inGroup && currentRules.length > 0) {
        // Directives already appeared for the previous group, so start a new group
        flushGroup();
      }
      currentUserAgents.push(value.toLowerCase());
      inGroup = true;
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      if (!inGroup) {
        // Directive before any User-agent line is ignored per RFC 9309
        continue;
      }

      if (!value) {
        // An empty Disallow: value means "allow all"
        if (field === 'disallow') {
          currentRules.push({
            directive: 'allow',
            pattern: '',
            patternLength: 0,
            regex: /^.*$/
          });
        }
        continue;
      }

      // Ensure pattern starts with '/' if not wildcard
      const normalizedPattern = value.startsWith('/') || value.startsWith('*') ? value : '/' + value;

      currentRules.push({
        directive: field as 'allow' | 'disallow',
        pattern: normalizedPattern,
        patternLength: normalizedPattern.length,
        regex: compileRobotsPattern(normalizedPattern)
      });
      continue;
    }

    if (field === 'crawl-delay') {
      if (inGroup) {
        const delay = parseFloat(value);
        if (!isNaN(delay) && delay >= 0) {
          currentCrawlDelay = delay;
        }
      }
      continue;
    }
  }

  // Flush final group
  flushGroup();

  const rawRulesCount = groups.reduce((acc, g) => acc + g.rules.length, 0);

  return {
    groups,
    sitemaps: [...new Set(sitemaps)],
    rawRulesCount
  };
}

/**
 * Finds the applicable UserAgentGroup for a target crawler (e.g. 'Googlebot').
 * Follows RFC 9309 § 2.2.1:
 * Specific user-agent match takes absolute precedence. If none, falls back to wildcard `*`.
 */
export function findMatchingGroup(groups: UserAgentGroup[], userAgent: string): { group: UserAgentGroup | null; matchedAgent: string } {
  const target = userAgent.toLowerCase();

  // 1. Look for specific user-agent match
  for (const g of groups) {
    for (const ua of g.userAgents) {
      if (ua === target || target.includes(ua) || (ua !== '*' && target.startsWith(ua))) {
        return { group: g, matchedAgent: ua };
      }
    }
  }

  // 2. Fallback to wildcard '*'
  for (const g of groups) {
    if (g.userAgents.includes('*')) {
      return { group: g, matchedAgent: '*' };
    }
  }

  return { group: null, matchedAgent: 'none' };
}

/**
 * Evaluates whether a given URL or path is allowed according to RFC 9309 rule precedence:
 * 1. Filter rules that match the path.
 * 2. The rule with the longest matching pattern length takes precedence.
 * 3. If longest pattern lengths are equal and one is Allow and one is Disallow: Allow wins!
 * 4. If no rules match: Allowed by default.
 */
export function isPathAllowed(
  parsed: ParsedRobotsTxt,
  pathOrUrl: string,
  targetUserAgent = 'Googlebot'
): PathEvaluationResult {
  // Extract path and query from full URL or relative path
  let path = pathOrUrl;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      const u = new URL(path);
      path = u.pathname + u.search;
    } catch {
      // fallback
    }
  }
  if (!path.startsWith('/')) path = '/' + path;

  const { group, matchedAgent } = findMatchingGroup(parsed.groups, targetUserAgent);

  if (!group || group.rules.length === 0) {
    return {
      allowed: true,
      matchedRule: null,
      matchedDirective: null,
      userAgentGroup: matchedAgent,
      reason: 'No matching rules for user-agent; allowed by default'
    };
  }

  // Find all matching rules
  const matchingRules = group.rules.filter(r => r.regex.test(path));

  if (matchingRules.length === 0) {
    return {
      allowed: true,
      matchedRule: null,
      matchedDirective: null,
      userAgentGroup: matchedAgent,
      reason: 'No rule matched path; allowed by default'
    };
  }

  // Sort matching rules by pattern length descending
  matchingRules.sort((a, b) => {
    if (b.patternLength !== a.patternLength) {
      return b.patternLength - a.patternLength; // Longer pattern length wins
    }
    // If equal length, 'allow' takes precedence over 'disallow' (RFC 9309 § 2.2.2)
    if (a.directive === 'allow' && b.directive === 'disallow') return -1;
    if (a.directive === 'disallow' && b.directive === 'allow') return 1;
    return 0;
  });

  const winningRule = matchingRules[0];
  const isAllowed = winningRule.directive === 'allow';

  return {
    allowed: isAllowed,
    matchedRule: `${winningRule.directive.toUpperCase()}: ${winningRule.pattern}`,
    matchedDirective: winningRule.directive,
    userAgentGroup: matchedAgent,
    reason: `Matched ${winningRule.directive.toUpperCase()} rule with longest specificity (${winningRule.patternLength} chars)`
  };
}
