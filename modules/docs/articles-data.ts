// Production Documentation Seed Data for SiteWatch Help Center
// Strictly documents actual features, real UI controls, and exact permissions.

export type DocCategorySeed = {
  slug: string;
  title: string;
  description: string;
  icon: string;
  displayOrder: number;
  minRole: 'member' | 'manager' | 'super_admin';
};

export type DocArticleSeed = {
  slug: string;
  categorySlug: string;
  title: string;
  summary: string;
  minRole: 'member' | 'manager' | 'super_admin';
  requiredPermission?: string;
  displayOrder: number;
  readTimeMinutes: number;
  relatedSlugs: string[];
  contentMd: string;
};

export const ROLE_LEVEL: Record<string, number> = {
  member: 1,
  manager: 2,
  super_admin: 3
};

export function canRoleAccess(userRole: string, minRole: 'member' | 'manager' | 'super_admin'): boolean {
  const userLevel = ROLE_LEVEL[userRole] ?? 1;
  const reqLevel = ROLE_LEVEL[minRole] ?? 1;
  return userLevel >= reqLevel;
}

export const DOC_CATEGORIES: DocCategorySeed[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    description: 'Core concepts, platform architecture, and onboarding steps to start monitoring with SiteWatch.',
    icon: 'grid',
    displayOrder: 1,
    minRole: 'member'
  },
  {
    slug: 'dashboard',
    title: 'Dashboard & Incidents',
    description: 'Understanding platform health KPIs, open incidents, and alert statuses.',
    icon: 'pulse',
    displayOrder: 2,
    minRole: 'member'
  },
  {
    slug: 'websites',
    title: 'Website Management',
    description: 'Adding URLs, configuring check intervals, HTTP status codes, and maintenance windows.',
    icon: 'globe',
    displayOrder: 3,
    minRole: 'member'
  },
  {
    slug: 'sitemaps',
    title: 'XML Sitemap Monitoring',
    description: 'Continuous monitoring of sitemap indexes, child sitemaps, URL additions, and unexpected drops.',
    icon: 'file',
    displayOrder: 4,
    minRole: 'member'
  },
  {
    slug: 'robots',
    title: 'Robots.txt & Crawlability',
    description: 'RFC 9309 directives parser, Googlebot rule evaluation, and blocked URL alerts.',
    icon: 'shield',
    displayOrder: 5,
    minRole: 'member'
  },
  {
    slug: 'indexability',
    title: 'Technical Indexability',
    description: 'Meta robots, Googlebot tags, X-Robots headers, canonical tags, and HTTP redirect chains.',
    icon: 'search',
    displayOrder: 6,
    minRole: 'member'
  },
  {
    slug: 'speed-test',
    title: 'Performance & Speed Tests',
    description: 'Google PageSpeed Insights, Lighthouse audits, Core Web Vitals, CrUX field data, and comparisons.',
    icon: 'zap',
    displayOrder: 7,
    minRole: 'member'
  },
  {
    slug: 'reports',
    title: 'PDF Reports & Email Delivery',
    description: 'Generating branded client PDFs, selecting metrics, and setting up automated recurring schedules.',
    icon: 'file',
    displayOrder: 8,
    minRole: 'member'
  },
  {
    slug: 'administration',
    title: 'Platform Administration',
    description: 'User management, project memberships, dispatcher engine tuning, and activity audit logs.',
    icon: 'sliders',
    displayOrder: 9,
    minRole: 'manager'
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting & Glossary',
    description: 'Diagnosing common monitoring errors, false positive handling, and SEO technical terms.',
    icon: 'clock',
    displayOrder: 10,
    minRole: 'member'
  }
];

export const DOC_ARTICLES: DocArticleSeed[] = [
  // 1. GETTING STARTED
  {
    slug: 'welcome-to-sitewatcher',
    categorySlug: 'getting-started',
    title: 'Welcome to SiteWatch & Platform Architecture',
    summary: 'An architectural overview of SiteWatch v2, explaining how multi-project monitoring, cron scheduling, and technical SEO features operate.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 4,
    relatedSlugs: ['quick-start-adding-website', 'roles-and-permissions', 'overview-dashboard-kpis'],
    contentMd: `# Welcome to SiteWatch & Platform Architecture

SiteWatch is an agency-grade website uptime, performance, and technical SEO monitoring platform. It is engineered natively with Next.js 15 (App Router), React 19, TypeScript, and a relational MySQL/MariaDB database.

---

### Core Platform Capabilities

1. **Website Uptime Monitoring**: Probes public endpoints at configurable frequencies (1 to 1440 minutes), tracking HTTP response codes, response latency, and incident downtime lifecycles.
2. **Google PageSpeed & Core Web Vitals**: Runs automated mobile and desktop Lighthouse lab audits and ingests real-user Chrome UX Report (CrUX) field data.
3. **XML Sitemap Monitoring**: Tracks sitemap index trees, child sitemaps, URL additions, and unexpected drops with snapshot diffing.
4. **Robots.txt & Crawlability**: Standards-compliant RFC 9309 parser evaluating Googlebot access, wildcard directives, and crawlability transitions.
5. **Technical Indexability & Directives**: Analyzes HTML meta robots, Googlebot tags, X-Robots headers, canonical tags, and HTTP redirect chains.
6. **Automated Client Reporting**: Generates branded, server-side PDF reports with selectable sections and schedules automated email dispatches via SMTP.

---

### Architecture & Engine Design

- **Unified Cron Dispatcher**: SiteWatch uses a single minute cron trigger (\`/api/cron/check\`) configured in your hosting panel (e.g. Hostinger Cron \`* * * * *\`). The dispatcher processes only websites and tasks that are strictly due, using atomic database claim tokens (\`claim_token\`) to prevent overlapping workers.
- **SSRF Safety (Server-Side Request Forgery)**: Every target URL undergoes strict scheme verification (only \`http:\` and \`https:\`) and DNS pre-resolution against private/loopback IP address ranges (RFC 1918, RFC 4193, CGNAT, link-local, AWS/GCP metadata endpoints). Connect-time IP locking prevents DNS rebinding attacks.
- **Role-Based Access Control**: Platform permissions are strictly divided between **Master Admin** (\`super_admin\`), **Project Manager** (\`manager\`), and **Member** (\`member\`).
`
  },
  {
    slug: 'quick-start-adding-website',
    categorySlug: 'getting-started',
    title: 'Quick Start: Adding Your First Monitored Website',
    summary: 'A step-by-step walkthrough on creating your first project and adding a website for automated uptime and SEO checks.',
    minRole: 'member',
    displayOrder: 2,
    readTimeMinutes: 3,
    relatedSlugs: ['welcome-to-sitewatcher', 'website-monitoring-configuration', 'overview-dashboard-kpis'],
    contentMd: `# Quick Start: Adding Your First Monitored Website

Follow this guide to configure your first website in SiteWatch within minutes.

---

### Prerequisites
- You must belong to an active Project as a **Manager** or **Master Admin** to add or modify websites.
- Ensure the target URL is publicly accessible over HTTP or HTTPS.

---

### Step-by-Step Instructions

1. **Select or Create a Project**:
   - In the top header navigation, use the Project dropdown to pick your active workspace.
   - If no project exists, open **Projects** from the sidebar and click **＋ New project**. Enter a project name (e.g., *GrowthCX*) and save.
2. **Open the Websites Section**:
   - Click **Websites** in the sidebar navigation under the *Main* group.
3. **Click Add Website**:
   - Click the primary **＋ Add website** button in the top right.
4. **Enter Website Details**:
   - **Display name**: A recognizable name for the site (e.g., *Production Store* or *Agency Homepage*).
   - **URL**: The full canonical URL (e.g., \`https://example.com/\`).
5. **Set Monitoring Overrides (Optional)**:
   - By default, the website inherits your project's monitoring defaults.
   - You can customize the **Check interval** (1 min to 24 hours), **Timeout** (2,000 to 30,000 ms), **Expected status codes** (e.g., \`200-399\`), and toggle **Down / Recovery alerts**.
6. **Save**:
   - Click **Add website**. The website is immediately saved into the database and scheduled for its first automated check on the next cron cycle.

---

### Verifying the Initial Check
- Once added, open the website detail page by clicking its name in the table.
- When the first check completes, you will see real-time response times (ms), status code (\`200 OK\`), and live uptime statistics.
`
  },
  {
    slug: 'roles-and-permissions',
    categorySlug: 'getting-started',
    title: 'Understanding Roles, Permissions & Workspace Access',
    summary: 'A detailed breakdown of global and project-level roles, permission codes, and access boundaries across SiteWatch.',
    minRole: 'member',
    displayOrder: 3,
    readTimeMinutes: 4,
    relatedSlugs: ['welcome-to-sitewatcher', 'user-management-guide', 'projects-and-clients'],
    contentMd: `# Understanding Roles, Permissions & Workspace Access

SiteWatch features a granular, two-tier permission architecture: **Global Roles** (platform-wide) and **Project Roles** (workspace-scoped).

---

### 1. Global Roles

| Role | Scope | Description |
|---|---|---|
| **Master Admin** (\`super_admin\`) | Platform-wide | Unrestricted control. Manages users, global dispatcher limits, platform settings, all projects, and reads server audit logs with client IP addresses. |
| **Manager** (\`manager\`) | Multi-project | Authorized to create new client projects, manage project team membership, configure websites, run audits, and create report schedules. |
| **Member** (\`member\`) | Project-scoped | Standard team member or client viewer. Has read-only access to assigned projects, website monitoring dashboards, and can run manual tests. |

---

### 2. Permission Codes Reference

All API endpoints enforce specific permission codes:
- \`project.create\`, \`project.view\`, \`project.update\`, \`project.archive\`, \`project.members.manage\`
- \`site.view\`, \`site.create\`, \`site.update\`, \`site.delete\`, \`site.configure\`
- \`speedtest.view\`, \`speedtest.run\`, \`speedtest.schedule\`
- \`sitemap.view\`, \`sitemap.manage\`
- \`robots.view\`, \`robots.manage\`
- \`indexability.view\`, \`indexability.manage\`
- \`report.view\`, \`report.generate\`, \`report.email\`, \`report.schedule\`
- \`activity.view\`, \`user.manage\`, \`settings.manage\`, \`platform.view_all\`
- \`docs.view\`, \`docs.manage\`

---

### 3. Permission Enforcement Rules
1. Non-members cannot view or query projects they are not assigned to; the API returns \`404 Not Found\` to prevent ID enumeration.
2. Archived projects are read-only for managers and members; only Master Admins can modify archived entities.
`
  },

  // 2. DASHBOARD & INCIDENTS
  {
    slug: 'overview-dashboard-kpis',
    categorySlug: 'dashboard',
    title: 'Navigating the Master & Project Dashboard',
    summary: 'How to interpret the high-level KPI cards, project health table, open incidents summary, and dispatcher health.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 4,
    relatedSlugs: ['incidents-and-alerts', 'overview-dashboard-kpis', 'cron-dispatcher-and-settings'],
    contentMd: `# Navigating the Master & Project Dashboard

The SiteWatch Overview dashboard (\`/\`) serves as mission control for all websites and services under your care.

---

### KPI Metrics Explained

- **WEBSITES**: Total count of active monitored URLs in your accessible projects.
- **OPERATIONAL**: Number of websites whose latest check returned an expected HTTP status code.
- **DOWN**: Websites currently failing checks (e.g. 5xx server errors, connection timeouts, or DNS failures).
- **OPEN INCIDENTS**: Active downtime incidents awaiting recovery.
- **PLATFORM STATS (Master Admin only)**: Displays total active users, projects, 24-hour check volume, and recent speed tests.

---

### Dashboard Cards

1. **Projects Aggregated Health**:
   - Shows site counts, up/down ratios, average response latency, and incident indicators for each project.
   - Clicking any project name opens its detailed project view.
2. **Open Incidents**:
   - Highlights ongoing service interruptions, timestamp since failure, and the exact error message (e.g. \`HTTP 502 Bad Gateway\` or \`Connection timed out after 10000ms\`).
3. **Recent Speed Tests**:
   - Displays the latest Lighthouse performance scores, tested device (Mobile or Desktop), and execution age.
4. **Platform Activity Log**:
   - Real-time audit log of recent team actions (e.g. site edits, report generations, user logins).
`
  },
  {
    slug: 'incidents-and-alerts',
    categorySlug: 'dashboard',
    title: 'Managing Down Incidents & Alert Notifications',
    summary: 'Learn how SiteWatch detects outages, tracks incident lifecycles, suppresses false alarms, and resolves incidents.',
    minRole: 'member',
    displayOrder: 2,
    readTimeMinutes: 4,
    relatedSlugs: ['overview-dashboard-kpis', 'website-monitoring-configuration'],
    contentMd: `# Managing Down Incidents & Alert Notifications

SiteWatch handles downtime with high precision, avoiding alert spam while ensuring critical outages are surfaced immediately.

---

### Incident Detection Lifecycle

1. **Initial Failure**:
   - When a scheduled check encounters an unexpected HTTP status code or timeout, the engine retries the probe according to the site's \`retry_count\` (default: 1 retry after 1,000ms delay).
2. **Incident Creation**:
   - If all retries fail, an **Incident** record is opened.
   - The site status changes to **DOWN** (red indicator).
   - If \`alert_on_down\` is enabled and SMTP is configured, an email notification is dispatched to the project's alert recipients.
3. **Ongoing Incident Tracking**:
   - Subsequent failed checks update the incident's \`failure_count\` and record the latest error message without sending duplicate down emails.
4. **Automatic Recovery**:
   - The moment a scheduled check succeeds with an expected status code, SiteWatch marks the incident as **Resolved**.
   - Calculates the exact total duration (e.g. \`4 min 23 s\`).
   - If \`alert_on_recovery\` is enabled, a recovery notification email is sent detailing the duration and time of resolution.

---

### Maintenance Window Suppression
If an outage occurs during an active **Maintenance Window**, alerts are automatically suppressed and the check is marked with a maintenance badge.
`
  },

  // 3. WEBSITES
  {
    slug: 'website-monitoring-configuration',
    categorySlug: 'websites',
    title: 'Website Settings, Monitoring Overrides & Intervals',
    summary: 'A complete reference for configuring website check frequencies, HTTP methods, timeouts, retries, and status codes.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 5,
    relatedSlugs: ['quick-start-adding-website', 'maintenance-windows', 'incidents-and-alerts'],
    contentMd: `# Website Settings, Monitoring Overrides & Intervals

Every website in SiteWatch can inherit its project's default monitoring settings or define fine-grained overrides.

---

### Configuration Fields Reference

- **Display Name**: Friendly name for UI lists, headers, and PDF reports (max 120 characters).
- **URL**: Full target address including protocol (\`https://\`). Private IPs and loopback hosts are rejected by SSRF protection.
- **Check Interval**:
  - Options: *1, 2, 5, 10, 15, 30, 60 minutes*, or *Custom (1 to 1440 minutes)*.
  - Controls how frequently the Hostinger cron evaluates this URL.
- **Timeout (ms)**:
  - Allowed range: \`2000\` to \`30000\` ms (default: \`10000\` ms).
  - Maximum time allowed for headers to be received before timing out.
- **Retries**:
  - Allowed range: \`0\` to \`3\` attempts.
  - Number of rapid retries before confirming a down incident.
- **Retry Delay (ms)**:
  - Pause duration between retry attempts (0 to 10,000 ms).
- **HTTP Method**:
  - \`GET\`: Downloads full response headers and content body. Recommended for comprehensive checks.
  - \`HEAD\`: Requests headers only, reducing server bandwidth.
- **Expected Status Codes**:
  - Comma-separated list or ranges (e.g., \`200-399,401\`). Any status outside this range is marked as down.
- **Down & Recovery Alerts**:
  - Toggle email notifications for failure and recovery events.

---

### Worst-Case Safety Cap
To ensure one slow website does not exhaust the cron runner's time budget, configurations where:
$$\\text{attempts} \\times \\text{timeout} + \\text{delays} > 60\\text{ seconds}$$
are rejected with a validation error.
`
  },
  {
    slug: 'maintenance-windows',
    categorySlug: 'websites',
    title: 'Setting Scheduled Maintenance Windows',
    summary: 'How to schedule maintenance windows to suppress checks and prevent false alarm alerts during deployments.',
    minRole: 'manager',
    displayOrder: 2,
    readTimeMinutes: 3,
    relatedSlugs: ['website-monitoring-configuration', 'incidents-and-alerts'],
    contentMd: `# Setting Scheduled Maintenance Windows

When deploying software updates or performing database migrations, servers may temporarily return 503 Service Unavailable or restart. Maintenance windows allow you to schedule downtime without impacting your uptime metrics or triggering false alerts.

---

### How to Configure Maintenance Windows

1. Navigate to **Websites** in the sidebar.
2. Click the edit icon (✎) on the target website.
3. Scroll to **Maintenance window start** and **Maintenance window end**.
4. Set the planned start and completion timestamps in your local timezone.
5. Click **Save changes**.

---

### Engine Behavior During Maintenance
- The website displays an amber **maintenance** badge.
- Checks that encounter errors during this window do not create open incidents.
- No failure emails are sent to clients or managers.
- Once the end timestamp passes, normal monitoring resumes automatically.
`
  },
  {
    slug: 'projects-and-clients',
    categorySlug: 'websites',
    title: 'Organizing Workspaces with Multi-Project Management',
    summary: 'How to manage multi-tenant agency workspaces, assign clients, upload custom logos, and configure team members.',
    minRole: 'manager',
    displayOrder: 3,
    readTimeMinutes: 4,
    relatedSlugs: ['quick-start-adding-website', 'roles-and-permissions', 'user-management-guide'],
    contentMd: `# Organizing Workspaces with Multi-Project Management

In SiteWatch, websites, team members, speed tests, and PDF reports are partitioned into **Projects**. This enables agencies to manage different clients in complete isolation.

---

### Project Attributes

- **Project Name**: Internal name (e.g. *Acme Corp* or *E-Commerce Staging*).
- **Client / Company**: Client company name displayed on generated PDF reports.
- **Primary Domain**: Primary domain used for default email and branding context.
- **Logo URL**: Public image URL (PNG or JPEG) rendered in the header of client-facing PDF performance reports.
- **Status**:
  - **Active**: Normal monitoring, checks, and notifications.
  - **Paused**: Monitoring paused for all websites in the project.
  - **Archived**: Read-only historical archive. Cannot be edited except by Master Admins.

---

### Managing Project Members
Managers can assign team members to a project via **Team Management** (\`/team\`) or the project detail page. Members can be given **Manager** or **Member** roles for that specific project.
`
  },

  // 4. SITEMAPS
  {
    slug: 'sitemap-monitoring-guide',
    categorySlug: 'sitemaps',
    title: 'XML Sitemap Discovery, Indexes & Monitoring',
    summary: 'Comprehensive guide to XML sitemap tracking, parent-child index structures, URL additions, removals, and 4xx/5xx alerts.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 5,
    relatedSlugs: ['sitemap-issue-resolution', 'robots-txt-monitoring-guide', 'indexability-and-noindex-guide'],
    contentMd: `# XML Sitemap Discovery, Indexes & Monitoring

XML sitemaps provide search engines with an authoritative roadmap of canonical URLs. SiteWatch continuously crawls and parses your sitemaps to verify availability and detect changes.

---

### Discovery Capabilities
SiteWatch discovers sitemaps through multiple channels:
1. Standard root path: \`https://example.com/sitemap.xml\`.
2. Directives declared in \`robots.txt\` (e.g. \`Sitemap: https://example.com/sitemap-posts.xml\`).
3. Sitemap index hierarchies (\`<sitemapindex>\` containing multiple child \`<sitemap>\` entries).
4. Custom / manual sitemap URLs added directly through the UI.

---

### What SiteWatch Detects

- **URL Additions**: Tracks newly published URLs and records first-discovered timestamps.
- **URL Removals**: Alerts when URLs disappear from sitemaps, preventing accidental de-indexing.
- **Inaccessible Sitemaps**: Flags HTTP 404 Not Found, 403 Forbidden, and 500 Server Errors.
- **Empty or Broken Sitemaps**: Catches zero-URL sitemaps or invalid XML syntax.
- **Drop Safeguard**: If a sitemap scan fails, times out, or receives incomplete data, SiteWatch **never** marks URLs as removed. Historical snapshots are strictly preserved.

---

### Using the Sitemap Dashboard (\`/sitemaps\`)
- **KPIs**: Discovered Sitemaps, Total Discovered URLs, Added (Latest Scan), Removed (Latest Scan), Active Issues.
- **Sitemap Hierarchy Table**: Shows sitemap type (\`Index\` vs \`URL Set\`), parent relationship, HTTP response code, and total URL counts.
- **URL Inspection Drawer**: Search and filter individual URLs belonging to any child sitemap.
`
  },
  {
    slug: 'sitemap-issue-resolution',
    categorySlug: 'sitemaps',
    title: 'Investigating Disappeared URLs & Sitemap 404 Errors',
    summary: 'How to troubleshoot missing sitemaps, mass URL drop-offs, XML parser failures, and automatic issue resolution.',
    minRole: 'member',
    displayOrder: 2,
    readTimeMinutes: 4,
    relatedSlugs: ['sitemap-monitoring-guide', 'robots-txt-monitoring-guide'],
    contentMd: `# Investigating Disappeared URLs & Sitemap 404 Errors

When SiteWatch detects an anomaly in an XML sitemap, it creates a deduplicated issue in the **Sitemap Issues Log**.

---

### Common Sitemap Issues & Resolutions

#### 1. Sitemap Returning HTTP 404 or 5xx
- **Cause**: CMS sitemap plugin crashed, URL rewritten, or caching plugin deleted static XML.
- **Investigation**: Click the sitemap URL directly from the dashboard to verify the HTTP response code.
- **Resolution**: Restore the sitemap file or update rewrite rules. When SiteWatch scans the sitemap again and receives a 200 OK with valid XML, the issue is **automatically marked as Resolved**.

#### 2. Significant URL Count Reduction (> 20% Drop)
- **Cause**: Category or taxonomy unassigned, plugin misconfiguration, or canonical filter excluding pages.
- **Investigation**: Open the Sitemap URLs table and filter by *Removed*. Check whether the removed URLs are intended to be live.
- **Resolution**: If URLs were intentionally removed, no action is required. If unintended, restore the CMS category.

#### 3. XML Parsing Failed (Malformed XML)
- **Cause**: CMS outputted PHP error text or HTML tags inside the XML document.
- **Resolution**: Check the raw response in your browser for unencoded ampersands (\`&\`) or syntax errors.
`
  },

  // 5. ROBOTS.TXT
  {
    slug: 'robots-txt-monitoring-guide',
    categorySlug: 'robots',
    title: 'RFC 9309 Rules, Directives & Googlebot Matching',
    summary: 'How SiteWatch parses robots.txt according to RFC 9309, evaluates user-agent priority, and monitors URL crawlability.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 5,
    relatedSlugs: ['robots-blocked-urls-troubleshooting', 'sitemap-monitoring-guide', 'indexability-and-noindex-guide'],
    contentMd: `# RFC 9309 Rules, Directives & Googlebot Matching

Robots.txt defines which paths search engine crawlers may access. SiteWatch implements an RFC 9309-compliant parser to protect your website from unintended crawling blocks.

---

### Key Parser Specifications

1. **User-Agent Specificity**:
   - Googlebot rules (\`User-agent: Googlebot\`) take strict precedence over generic wildcard groups (\`User-agent: *\`).
2. **Longest Match Tie-Breaking**:
   - When conflicting \`Allow\` and \`Disallow\` rules match the same URL path, the more specific (longer) path pattern wins. If patterns are identical in length, \`Allow\` takes precedence.
3. **Wildcard & Anchor Support**:
   - Supports \`*\` (matches zero or more characters) and \`$\` (end-of-path anchor, e.g. \`Disallow: /*.pdf$\`).
4. **Content Change Detection**:
   - Calculates cryptographic SHA-256 hashes of the file content on every scan to detect directive modifications.

---

### Dashboard Breakdown (\`/robots-txt\`)
- **Rules Breakdown Tab**: Lists all parsed user-agents, directives (\`DISALLOW\`, \`ALLOW\`, \`SITEMAP\`, \`CRAWL-DELAY\`), path values, and count of affected URLs.
- **Evaluated URLs Tab**: Evaluates every website URL against Googlebot rules. Filter by *Allowed*, *Blocked*, or *Recently Transitioned*.
- **Raw Robots.txt & History**: View current raw text and historical version snapshots.
`
  },
  {
    slug: 'robots-blocked-urls-troubleshooting',
    categorySlug: 'robots',
    title: 'Diagnosing Unexpected URL Blocking in Robots.txt',
    summary: 'Step-by-step guidance on identifying rogue disallow rules, staging leakages, and resolving crawlability alerts.',
    minRole: 'member',
    displayOrder: 2,
    readTimeMinutes: 4,
    relatedSlugs: ['robots-txt-monitoring-guide', 'indexability-and-noindex-guide'],
    contentMd: `# Diagnosing Unexpected URL Blocking in Robots.txt

Accidental \`Disallow: /\` rules can wipe out organic search visibility within days. SiteWatch monitors robots.txt to ensure critical pages remain accessible.

---

### High-Priority Alerts Explained

- **Entire Website Blocked (\`Disallow: /\`)**: A critical alert triggered when all search engines are forbidden from crawling your entire origin.
- **Critical Paths Blocked**: Triggered when important sections such as \`/blog/\`, \`/products/\`, or \`/services/\` become blocked.
- **HTTP 5xx Server Error on robots.txt**: According to RFC 9309 § 2.3.1.3, search engine crawlers halt crawling entirely when robots.txt returns 5xx to prevent overloading degraded servers.

---

### Step-by-Step Resolution

1. Open **Robots.txt** in the SiteWatch sidebar.
2. In the **Evaluated URLs** tab, select **Blocked only** to see all affected pages.
3. Check the **Matched Rule** column to identify the exact line in robots.txt causing the block (e.g., \`Disallow: /checkout*\` accidentally matching \`https://example.com/checkout-guide\`).
4. Edit your robots.txt file on your web server to correct the directive.
5. In SiteWatch, click **▶ Check robots.txt now** to re-evaluate immediately. The issue will automatically mark as **Resolved**.
`
  },

  // 6. INDEXABILITY
  {
    slug: 'indexability-and-noindex-guide',
    categorySlug: 'indexability',
    title: 'Meta Robots, Googlebot Tags & X-Robots-Tag Headers',
    summary: 'Detecting noindex directives in HTML headers, bot-specific directives, and distinguishing noindex from nofollow.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 5,
    relatedSlugs: ['canonical-tags-monitoring', 'technical-indexability-vs-gsc', 'robots-txt-monitoring-guide'],
    contentMd: `# Meta Robots, Googlebot Tags & X-Robots-Tag Headers

A page may be crawlable by robots.txt, yet completely excluded from search results due to an on-page \`noindex\` directive.

---

### Monitored Directive Sources

SiteWatch crawls candidate URLs and parses head elements across three distinct layers:
1. **HTML Meta Robots**: \`<meta name="robots" content="noindex, follow">\`
2. **Bot-Specific Meta Tags**: \`<meta name="googlebot" content="noindex">\`
3. **HTTP Response Headers**: \`X-Robots-Tag: noindex, nofollow\`

---

### Parsing Logic & Standards

- **Directive Tokenization**: Properly parses combinations including \`index, follow\`, \`noindex, follow\`, and \`noindex, nofollow\`.
- **Nofollow Is Not Noindex**: An isolated \`nofollow\` directive instructs search engines not to follow outbound links; it does **not** de-index the page. SiteWatch correctly preserves technical indexability when \`nofollow\` is present alone.
- **RFC \`none\` Equivalent**: The keyword \`none\` is evaluated as equivalent to \`noindex, nofollow\`.
- **Conflicting Directives**: When both \`index\` and \`noindex\` are declared on the same page, search engines honor the more restrictive directive (\`noindex\`). SiteWatch flags this as a *Conflicting Directives* warning.

---

### Using the Indexability Dashboard (\`/indexability\`)
- Review total **Indexable** vs **Noindex URLs**.
- Use the **Directives** column to inspect exact tag contents and sources.
- Click **History** on any URL to open the snapshot timeline showing previous crawl results.
`
  },
  {
    slug: 'canonical-tags-monitoring',
    categorySlug: 'indexability',
    title: 'Canonical Tag Rules, Cross-Domain Directives & Conflicts',
    summary: 'How SiteWatch tracks canonical tag alignment, self-referencing URLs, multiple conflicting tags, and cross-domain targets.',
    minRole: 'member',
    displayOrder: 2,
    readTimeMinutes: 4,
    relatedSlugs: ['indexability-and-noindex-guide', 'technical-indexability-vs-gsc'],
    contentMd: `# Canonical Tag Rules, Cross-Domain Directives & Conflicts

Canonical declarations instruct search engines which URL represents the master version of duplicate or syndicated content.

---

### Monitored Canonical States

1. **Self-Referencing** (\`self_referencing\`):
   - The canonical URL matches the page's own URL (accounting for trailing slashes and casing). This is the optimal state for primary pages.
2. **Canonicalized** (\`canonicalized\`):
   - The canonical points to another internal URL (e.g. parameter filter pointing to clean category). Normal for variants, but flags an alert if applied to primary pages.
3. **Cross-Domain** (\`cross_domain\`):
   - Canonical points to a completely different external domain. Useful for syndicated articles, but flagged for verification.
4. **Multiple Conflicting Tags** (\`multiple\`):
   - Two or more conflicting canonical declarations exist in HTML or HTTP Link headers. Search engines ignore all tags when duplicates conflict. Flagged as **Critical**.
5. **Invalid Canonical Syntax** (\`invalid\`):
   - Malformed URL, missing protocol, or unparseable target.
6. **Missing Canonical** (\`missing\`):
   - No canonical tag declared. While still indexable, adding self-referencing canonicals is recommended.
`
  },
  {
    slug: 'technical-indexability-vs-gsc',
    categorySlug: 'indexability',
    title: 'Technical Indexability vs Google Search Console Indexation',
    summary: 'Understanding the critical distinction between technical indexability signals and Google Search Console index status.',
    minRole: 'member',
    displayOrder: 3,
    readTimeMinutes: 3,
    relatedSlugs: ['indexability-and-noindex-guide', 'canonical-tags-monitoring'],
    contentMd: `# Technical Indexability vs Google Search Console Indexation

A fundamental concept in Technical SEO is distinguishing between **Technical Indexability** and **Actual Search Engine Indexation**.

---

### Technical Indexability (What SiteWatch Measures)

Technical indexability is a deterministic engineering evaluation:
$$\\text{Indexable} = (\\text{HTTP } 200) \\land (\\neg \\text{hasNoindex}) \\land (\\text{Canonical is Self-Referencing or Clean})$$

If a page returns HTTP 200 OK, has no \`noindex\` directives in HTML or HTTP headers, and is not canonicalized away to another URL, it is **Technically Indexable**. Search engine crawlers have full technical permission to index the content.

---

### Actual Google Indexation (Requires Google Search Console)

Actual indexation is an algorithmic choice made by Google:
- Google may decide not to index a technically indexable page due to **thin content**, **low quality**, **duplicate content**, **crawl budget limits**, or lack of inbound links (reported in Search Console as *"Discovered - currently not indexed"* or *"Crawled - currently not indexed"*).
- Confirming whether Google has *actually* placed a URL in its public search index requires Google Search Console URL Inspection or search queries.

SiteWatch guarantees your technical foundation is 100% sound so search engines are never blocked from indexing your pages.
`
  },

  // 7. SPEED TEST
  {
    slug: 'pagespeed-insights-audits',
    categorySlug: 'speed-test',
    title: 'Running Google PageSpeed Audits (Mobile & Desktop)',
    summary: 'How to trigger Lighthouse audits, understand Performance, Accessibility, Best Practices, and SEO score rings.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 4,
    relatedSlugs: ['core-web-vitals-guide', 'speed-test-schedules-compare'],
    contentMd: `# Running Google PageSpeed Audits (Mobile & Desktop)

SiteWatch integrates directly with the Google PageSpeed Insights API to deliver official Lighthouse performance audits.

---

### How to Run an Audit

1. In the sidebar, select **Speed Test** under the *Monitoring* section.
2. Select the target website from the top dropdown.
3. In the **Run test** tab, check **Mobile**, **Desktop**, or both.
4. Click **Start audit**.
5. Google will analyze the page in real-time (takes 20–60 seconds per device).

---

### Score Categories Explained

- **Performance (0–100)**: Composite lab score evaluating loading speed, responsiveness, and layout stability.
- **Accessibility (0–100)**: Assesses color contrast, ARIA labels, semantic HTML, and screen reader compatibility.
- **Best Practices (0–100)**: Checks HTTPS enforcement, modern image formats, console errors, and security headers.
- **SEO (0–100)**: Validates title tags, meta descriptions, mobile viewport configuration, and structured data basics.

---

### Opportunities & Savings
Audits highlight specific diagnostic recommendations with estimated millisecond savings (e.g. *Properly size images ≈ 850 ms* or *Eliminate render-blocking resources ≈ 420 ms*).
`
  },
  {
    slug: 'core-web-vitals-guide',
    categorySlug: 'speed-test',
    title: 'Core Web Vitals & Lab Simulation vs CrUX Field Data',
    summary: 'Detailed guide to FCP, LCP, CLS, TBT, TTFB, INP, and understanding lab simulations versus real user Chrome UX data.',
    minRole: 'member',
    displayOrder: 2,
    readTimeMinutes: 5,
    relatedSlugs: ['pagespeed-insights-audits', 'speed-test-schedules-compare'],
    contentMd: `# Core Web Vitals & Lab Simulation vs CrUX Field Data

Core Web Vitals represent Google's user experience benchmarks for loading performance, interactivity, and visual stability.

---

### Core Web Vitals Metrics Reference

1. **LCP (Largest Contentful Paint)**:
   - Measures perceived loading speed. Marks when the main content block rendered.
   - *Good*: $\\le 2.5\\text{ s}$ | *Poor*: $> 4.0\\text{ s}$.
2. **CLS (Cumulative Layout Shift)**:
   - Measures visual stability. Quantifies unexpected layout shifts during load.
   - *Good*: $\\le 0.1$ | *Poor*: $> 0.25$.
3. **INP (Interaction to Next Paint)**:
   - Measures overall responsiveness to user interactions (clicks, taps, keypresses).
   - *Good*: $\\le 200\\text{ ms}$ | *Poor*: $> 500\\text{ ms}$.
4. **FCP (First Contentful Paint)**:
   - Time until the first DOM element (text or image) is painted to screen.
5. **TTFB (Time to First Byte)**:
   - Latency of the server response to headers. Reflects backend and hosting speed.

---

### Lab Data vs Field Data (CrUX)

- **Lab Data (Lighthouse Simulation)**: Synthesized in a controlled testing environment with simulated network throttling (4G) and standard mobile CPU. Ideal for debugging and detecting regressions.
- **Field Data (Chrome UX Report / CrUX)**: Aggregated 75th percentile measurements from real Chrome users over the previous 28 days.
- *Note*: If a URL has low traffic, Google will report origin-level field data or state that insufficient data exists.
`
  },
  {
    slug: 'speed-test-schedules-compare',
    categorySlug: 'speed-test',
    title: 'Comparing Performance Over Time & Automated Schedules',
    summary: 'How to compare audits across dates, track speed regressions, and set recurring Lighthouse schedules.',
    minRole: 'member',
    displayOrder: 3,
    readTimeMinutes: 4,
    relatedSlugs: ['pagespeed-insights-audits', 'core-web-vitals-guide', 'generating-pdf-reports'],
    contentMd: `# Comparing Performance Over Time & Automated Schedules

SiteWatch saves every audit record into your database, enabling long-term performance trend tracking and automated regression alerts.

---

### Performance Comparison Tool

Under **Speed Test** → **Compare**, you can compare any two historical audits:
1. **Compare Last Two Audits**: Instantly diff the two most recent runs for a device.
2. **Compare Across Specific Dates**: Choose two calendar dates (e.g. before and after a major redesign) to evaluate improvements.
3. **Compare by Audit IDs**: Inspect two specific test records side-by-side.

The diff table highlights metric changes with color-coded badges (green for speed improvements, red for regressions).

---

### Automated Audit Schedules
Managers can configure automated background speed tests:
- **Recurring Schedule**: Runs every $N$ days (e.g. every 7 days).
- **Custom Sequence**: Runs on specific interval offsets (e.g. Day 0, 2, 5, 7 after a website launch).
- Automated runs are dispatched by the minute cron and saved directly into audit history.
`
  },

  // 8. REPORTS
  {
    slug: 'generating-pdf-reports',
    categorySlug: 'reports',
    title: 'Generating Branded PDF Client Reports',
    summary: 'How to build customized client performance reports with logos, uptime statistics, incident summaries, and Lighthouse data.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 4,
    relatedSlugs: ['scheduling-email-reports', 'pagespeed-insights-audits'],
    contentMd: `# Generating Branded PDF Client Reports

Deliver professional, agency-branded PDF performance reports to clients with one click.

---

### Customizing Report Scope & Content

1. Navigate to **Reports** in the sidebar.
2. Under the **Generate** tab:
   - **Scope**: Choose either **Entire Project** (summarizes all websites) or a **Single Website**.
   - **Period**: Pick presets (*Last 24 hours, 7 days, 15 days, 30 days, 90 days*) or enter a **Custom range**.
   - **Report Title**: Customize the header title (e.g., *Monthly Website Performance & SEO Report*).
3. **Select Sections**:
   - \`Summary\`: High-level executive overview.
   - \`Uptime\`: Uptime percentage and total monitored hours.
   - \`Response time\`: Average and peak response latency.
   - \`Incidents\`: List of downtime incidents with timestamps and durations.
   - \`Lighthouse scores\`: Mobile and desktop score rings and Core Web Vitals.
   - \`Historical changes\`: Performance trends compared to previous periods.
   - \`Recommendations\`: Actionable opportunities to improve speed and SEO.
4. Click **Download PDF**. The report is dynamically compiled and downloaded to your device.
`
  },
  {
    slug: 'scheduling-email-reports',
    categorySlug: 'reports',
    title: 'Automating Weekly & Monthly Email Report Delivery',
    summary: 'How to configure recurring email schedules that deliver PDF reports directly to clients and stakeholders.',
    minRole: 'manager',
    displayOrder: 2,
    readTimeMinutes: 3,
    relatedSlugs: ['generating-pdf-reports', 'cron-dispatcher-and-settings'],
    contentMd: `# Automating Weekly & Monthly Email Report Delivery

Automate your client reporting workflow by scheduling recurring email dispatches.

---

### Creating an Automated Schedule

1. Open **Reports** → **Scheduled emails** tab.
2. Configure schedule settings:
   - **Name**: e.g. *Weekly Client Digest*.
   - **Frequency**: *Daily*, *Weekly*, *Monthly*, or *Custom interval (every N days)*.
   - **Recipients**: Comma-separated email addresses (up to 10 recipients).
   - **Subject & Message**: Custom cover message delivered in the email body.
3. Click **Create schedule**.

---

### Engine Execution
- The Hostinger cron dispatcher checks for due schedules every minute.
- When due, the server generates the PDF, attaches it to a branded email template, and dispatches it through your configured SMTP server.
- The schedule automatically advances to the next period.
`
  },

  // 9. ADMINISTRATION
  {
    slug: 'user-management-guide',
    categorySlug: 'administration',
    title: 'User Administration, Password Resets & Session Security',
    summary: 'Master Admin guide to creating accounts, assigning roles, suspending access, resetting passwords, and session management.',
    minRole: 'super_admin',
    requiredPermission: 'user.manage',
    displayOrder: 1,
    readTimeMinutes: 4,
    relatedSlugs: ['roles-and-permissions', 'activity-audit-logs', 'cron-dispatcher-and-settings'],
    contentMd: `# User Administration, Password Resets & Session Security

The **User Management** panel (\`/users\`) is restricted exclusively to **Master Admins** holding the \`user.manage\` permission.

---

### Creating a New User

1. Click **＋ New user** in the top right.
2. Provide:
   - **Full name** & **Email**.
   - **Username**: Unique identifier (alphanumeric, dots, dashes).
   - **Role**: *Member*, *Manager*, or *Master Admin*.
   - **Timezone**: Sets the display timezone for dates and charts.
   - **Password**: Minimum 12 characters (hashed using scrypt).
3. Click **Create user**.

---

### Managing Access & Security

- **Suspending Access**: Change a user's status to **Suspended**. Suspended users are immediately blocked from logging in.
- **Password Resets**: Updating a user's password immediately revokes all active database sessions, signing them out across all browsers.
- **Project Assignments**: Assign users to specific client projects as *Manager* or *Member* directly from the user modal.
- **Account Deletion**: Deleting an account revokes access immediately while safely preserving audit trail history.
`
  },
  {
    slug: 'cron-dispatcher-and-settings',
    categorySlug: 'administration',
    title: 'Hostinger Cron Dispatcher & Platform Settings',
    summary: 'Configuring the 1-minute Hostinger cron command, setting dispatcher concurrency limits, and verifying integrations.',
    minRole: 'super_admin',
    requiredPermission: 'settings.manage',
    displayOrder: 2,
    readTimeMinutes: 4,
    relatedSlugs: ['overview-dashboard-kpis', 'activity-audit-logs'],
    contentMd: `# Hostinger Cron Dispatcher & Platform Settings

SiteWatch is designed to operate on managed hosting environments such as Hostinger Business Node.js hosting.

---

### Hostinger Cron Job Setup

In your hosting control panel (hPanel):
1. Navigate to **Advanced** → **Cron Jobs**.
2. Set the schedule to every minute: \`* * * * *\`.
3. Set the command to:
\`\`\`bash
curl -fsS -H "x-cron-secret: YOUR_CRON_SECRET" "https://your-domain.com/api/cron/check"
\`\`\`
Replace \`YOUR_CRON_SECRET\` with the secret configured in your \`.env\` file.

---

### Cron Request Execution Order
Each minute, the single cron runner executes in strict priority order:
1. **Uptime checks** (Highest priority).
2. **Speed tests** (Skipped if request duration exceeds 50s).
3. **Sitemap checks** (Skipped if request duration exceeds 40s).
4. **Robots.txt checks** (Skipped if request duration exceeds 35s).
5. **Indexability checks** (Skipped if request duration exceeds 40s).
6. **Report email schedules** (Skipped if request duration exceeds 70s).

---

### Platform Settings & Dispatcher Limits
Under **Settings** (\`/settings\`), Master Admins can tune server limits:
- Maximum concurrency for outbound probes.
- Maximum sites processed per minute.
- Probing time budgets.
`
  },
  {
    slug: 'activity-audit-logs',
    categorySlug: 'administration',
    title: 'Inspecting Read-Only Platform Activity & Change Logs',
    summary: 'How to monitor team actions, review metadata change diffs, and inspect security access logs.',
    minRole: 'manager',
    requiredPermission: 'activity.view',
    displayOrder: 3,
    readTimeMinutes: 3,
    relatedSlugs: ['user-management-guide', 'cron-dispatcher-and-settings'],
    contentMd: `# Inspecting Read-Only Platform Activity & Change Logs

The **Activity Logs** section (\`/activity\`) provides an immutable, append-only audit trail of every administrative and monitoring action in SiteWatch.

---

### Monitored Action Categories

- \`auth.*\`: User logins, failed authentication attempts, logouts, password changes.
- \`project.*\`: Project creations, name changes, archives, member additions.
- \`site.*\`: Website creations, interval updates, maintenance window changes, deletions.
- \`speedtest.*\`: Manual and scheduled audit runs.
- \`sitemap.*\`: Sitemap additions, scan triggers.
- \`robots.*\`: Directives re-checks.
- \`indexability.*\`: Directives checks, manual URL additions.
- \`report.*\`: Generated PDFs, emailed reports.
- \`user.*\`: User creations, role modifications, suspensions.
- \`settings.*\`: Changes to platform dispatcher settings.

---

### Security & Privacy Rules
- Managers only see activity within their assigned projects.
- Master Admins can view platform-wide activity and client IP addresses.
- The audit table cannot be edited or cleared through the application interface.
`
  },

  // 10. TROUBLESHOOTING & GLOSSARY
  {
    slug: 'troubleshooting-common-errors',
    categorySlug: 'troubleshooting',
    title: 'Common Errors, False Positives & Diagnostic Steps',
    summary: 'A comprehensive troubleshooting guide for connection timeouts, SSL certificate errors, WAF blocks, and DNS issues.',
    minRole: 'member',
    displayOrder: 1,
    readTimeMinutes: 5,
    relatedSlugs: ['technical-seo-glossary', 'website-monitoring-configuration'],
    contentMd: `# Common Errors, False Positives & Diagnostic Steps

This guide covers common errors encountered during website monitoring and how to resolve them.

---

### Diagnostic Guide

#### 1. \`Connection timed out after 10000ms\`
- **Explanation**: The server did not respond with HTTP headers within the configured timeout window.
- **Remedy**:
  - Test the URL in your browser.
  - If the server is slow under load, increase the site's **Timeout (ms)** setting to \`15000\` or \`20000\` ms.
  - Check whether hosting firewalls are throttling frequent requests.

#### 2. \`HTTP 403 Forbidden\` on Cron Checks
- **Explanation**: Cloudflare, Wordfence, or an agency Web Application Firewall (WAF) blocked the SiteWatch User-Agent.
- **Remedy**:
  - Whitelist the server IP of your SiteWatch hosting instance in your Cloudflare / WAF security settings.
  - Set expected status codes to include \`403\` temporarily if testing restricted staging environments.

#### 3. \`Private or internal addresses are blocked\`
- **Explanation**: SiteWatch SSRF protection blocked an attempt to monitor an internal or non-routable IP (e.g. \`192.168.x.x\`, \`10.x.x.x\`, \`127.0.0.1\`, or \`localhost\`).
- **Remedy**:
  - SiteWatch only monitors publicly accessible hostnames. Ensure public DNS A/AAAA records point to a public IP.

#### 4. \`Failed to fetch robots.txt / sitemap.xml\`
- **Explanation**: Web server redirected the sitemap to a login page or returned invalid XML syntax.
- **Remedy**:
  - Verify that \`/robots.txt\` and \`/sitemap.xml\` are publicly accessible without authentication.
`
  },
  {
    slug: 'technical-seo-glossary',
    categorySlug: 'troubleshooting',
    title: 'Technical SEO & Website Monitoring Glossary',
    summary: 'Definitions and practical explanations of all technical SEO, crawlability, indexability, and uptime terminology.',
    minRole: 'member',
    displayOrder: 2,
    readTimeMinutes: 6,
    relatedSlugs: ['indexability-and-noindex-guide', 'robots-txt-monitoring-guide', 'core-web-vitals-guide'],
    contentMd: `# Technical SEO & Website Monitoring Glossary

Quick reference for technical terms used throughout the SiteWatch platform.

---

### Glossary

- **Canonical URL**: The authoritative URL designated as the master version of duplicate or similar web pages.
- **CLS (Cumulative Layout Shift)**: A Core Web Vital measuring unexpected movement of visible elements during page load.
- **Crawl Budget**: The volume of URLs search engines (such as Googlebot) are willing and able to crawl on a website within a given time frame.
- **CrUX (Chrome UX Report)**: An open dataset of real-user experience metrics collected from millions of Chrome browser users.
- **Disallow**: A directive in \`robots.txt\` commanding web robots not to crawl a specific URL path.
- **FCP (First Contentful Paint)**: The time it takes for a browser to render the first piece of DOM content after navigation.
- **INP (Interaction to Next Paint)**: Core Web Vital evaluating overall responsiveness across all click, tap, and keyboard interactions during a user's visit.
- **LCP (Largest Contentful Paint)**: Core Web Vital measuring perceived loading speed by marking when the largest content element was rendered.
- **Noindex**: A directive (in HTML \`<meta name="robots">\` or HTTP header \`X-Robots-Tag\`) commanding search engines not to display the URL in search results.
- **Nofollow**: An instruction to crawlers not to follow outbound hyperlinks from the current page. Does **not** de-index the page itself.
- **RFC 9309**: The official IETF internet standard specification for the Robots Exclusion Protocol (robots.txt).
- **Sitemap Index**: An XML sitemap file containing references to multiple child sitemap files.
- **SSRF (Server-Side Request Forgery)**: A security vulnerability where an attacker exploits server requests to probe internal networks. SiteWatch protects against this via connect-time IP validation.
- **Technical Indexability**: Confirmation that a page returns HTTP 200, lacks noindex directives, and has clean canonical tags so crawlers are technically capable of indexing it.
- **TTFB (Time to First Byte)**: Duration from the initial HTTP request until the first byte of response data is received from the server.
- **X-Robots-Tag**: An HTTP response header used to deliver robots directives (e.g. \`noindex\`, \`noarchive\`) for non-HTML files such as PDFs or programmatic endpoints.
`
  }
];
