// Interactive Walkthrough Tours definitions

export type TourStep = {
  title: string;
  description: string;
  target?: string;
  actionHint?: string;
};

export type WalkthroughTour = {
  id: string;
  name: string;
  steps: TourStep[];
};

export const TOURS: Record<string, WalkthroughTour> = {
  'overview-tour': {
    id: 'overview-tour',
    name: 'Dashboard Overview Tour',
    steps: [
      {
        title: 'Welcome to SiteWatch',
        description: 'This is your mission control dashboard displaying the real-time operational status of all websites across your projects.',
        target: '.sw-page-head'
      },
      {
        title: 'Platform KPIs',
        description: 'These summary cards track your total monitored websites, currently operational services, ongoing outages, and open downtime incidents.',
        target: '.sw-kpis'
      },
      {
        title: 'Project Switcher',
        description: 'Use the project switcher in the header to jump between client accounts and isolated workspaces.',
        target: '.sw-proj'
      },
      {
        title: 'Quick Search',
        description: 'Press or click search to quickly jump to any website or project across the platform.',
        target: '.sw-search'
      }
    ]
  },
  'websites-tour': {
    id: 'websites-tour',
    name: 'Website Management Tour',
    steps: [
      {
        title: 'Websites Overview',
        description: 'This table lists every monitored URL within the active project, its check frequency, and latest response latency.',
        target: '.sw-page-head'
      },
      {
        title: 'Add Website',
        description: 'Click "＋ Add website" to register a new URL, set probe frequencies (1 min to 24 hrs), timeouts, retries, and maintenance windows.',
        target: '.sw-actions'
      },
      {
        title: 'Status & Badges',
        description: 'The Status column displays live availability (Operational or Down). Clicking any website opens its full response latency chart and incident history.',
        target: '.sw-table'
      }
    ]
  },
  'sitemaps-tour': {
    id: 'sitemaps-tour',
    name: 'Sitemap Monitoring Tour',
    steps: [
      {
        title: 'XML Sitemap Monitoring',
        description: 'SiteWatch monitors sitemap index hierarchies and child sitemaps, alerting you whenever URLs disappear or return errors.',
        target: '.sw-page-head'
      },
      {
        title: 'Add Custom Sitemap',
        description: 'Click "+ Add Sitemap" to monitor a specific XML sitemap URL, or let SiteWatch auto-discover sitemaps from robots.txt.',
        target: '.sw-actions'
      },
      {
        title: 'Scan & Diff Engine',
        description: 'Click "▶ Scan Sitemaps Now" to trigger an immediate live probe. New additions and removals are highlighted in the KPIs and tables.',
        target: '.sw-actions'
      }
    ]
  },
  'robots-tour': {
    id: 'robots-tour',
    name: 'Robots.txt Crawlability Tour',
    steps: [
      {
        title: 'RFC 9309 Parser',
        description: 'SiteWatch parses robots.txt directives and evaluates whether Googlebot can crawl your pages under wildcard and path rules.',
        target: '.sw-page-head'
      },
      {
        title: 'Rules & URLs Tabs',
        description: 'Switch between "Rules Breakdown" to inspect extracted directives and "Evaluated URLs" to see if individual pages are allowed or blocked.',
        target: '.sw-tabs'
      },
      {
        title: 'Immediate Crawl Test',
        description: 'Use "▶ Check robots.txt now" to fetch the latest version and verify rule changes immediately.',
        target: '.sw-actions'
      }
    ]
  },
  'indexability-tour': {
    id: 'indexability-tour',
    name: 'Technical Indexability Tour',
    steps: [
      {
        title: 'Technical Indexability',
        description: 'This feature monitors on-page meta robots directives, Googlebot tags, X-Robots headers, and canonical declarations.',
        target: '.sw-page-head'
      },
      {
        title: 'Filter Directives',
        description: 'Use the Indexability Filter to isolate pages with noindex directives, canonical discrepancies, or HTTP 4xx/5xx errors.',
        target: '.sw-inline-form'
      },
      {
        title: 'Historical Snapshots',
        description: 'Click "History" on any page row to inspect a timeline of crawl snapshots showing past directives and canonical states.',
        target: '.sw-table'
      }
    ]
  }
};
