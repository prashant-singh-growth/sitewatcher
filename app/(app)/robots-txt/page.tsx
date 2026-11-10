'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '../../ui/context';
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Kpi,
  Select,
  Skeleton,
  Table,
  Tabs,
  call,
  fmtDate,
  ago,
  useAsync,
  useToast
} from '../../ui/kit';

export default function RobotsTxtMonitor() {
  const searchParams = useSearchParams();
  const initSiteId = searchParams.get('siteId') || '';
  const { project, projectId, user, canWrite } = useApp();
  const tz = user.timezone;
  const toast = useToast();

  // Load sites for project
  const sitesQ = useAsync(
    () => (projectId ? call(`/api/sites?projectId=${projectId}`) : Promise.resolve({ sites: [] })),
    [projectId]
  );
  const sites: any[] = sitesQ.data?.sites ?? [];

  const [siteId, setSiteId] = useState(initSiteId);

  useEffect(() => {
    if (sites.length > 0 && (!siteId || !sites.some(s => String(s.id) === siteId))) {
      setSiteId(String(sites[0].id));
    }
  }, [sites, siteId]);

  // Load robots stats
  const robotsQ = useAsync(
    () => (siteId ? call(`/api/robots?siteId=${siteId}`) : Promise.resolve(null)),
    [siteId]
  );

  const data = robotsQ.data;
  const monitor = data?.monitor;
  const latestSnap = data?.latestSnapshot;
  const rules: any[] = data?.rules ?? [];
  const openIssues: any[] = data?.openIssues ?? [];
  const recentSnapshots: any[] = data?.recentSnapshots ?? [];

  const [tab, setTab] = useState('rules');
  const [checking, setChecking] = useState(false);

  // URLs tab state
  const [urlStatus, setUrlStatus] = useState('');
  const [urlSearch, setUrlSearch] = useState('');
  const [urlPage, setUrlPage] = useState(0);

  const urlsQ = useAsync(
    () =>
      siteId
        ? call(
            `/api/robots/urls?siteId=${siteId}&limit=50&offset=${urlPage * 50}${
              urlStatus ? `&status=${urlStatus}` : ''
            }${urlSearch ? `&search=${encodeURIComponent(urlSearch)}` : ''}`
          )
        : Promise.resolve({ urls: [], total: 0 }),
    [siteId, urlStatus, urlSearch, urlPage]
  );

  // Trigger manual check
  const handleCheckNow = async () => {
    if (!siteId) return;
    setChecking(true);
    try {
      const res = await call('/api/robots/check', 'POST', { siteId: Number(siteId) });
      const summary = res.summary;
      toast(
        `Check complete: ${summary.crawlableCount} crawlable URLs, ${summary.blockedCount} blocked for Googlebot.`
      );
      await Promise.all([robotsQ.reload(true as any), urlsQ.reload(true as any)]);
    } catch (err: any) {
      toast(err?.message || 'Check failed', 'err');
    } finally {
      setChecking(false);
    }
  };

  const getStatusBadge = () => {
    if (!monitor) return <Badge tone="gray">Pending Check</Badge>;
    if (monitor.last_status === 'operational') return <Badge tone="green">● Operational (200)</Badge>;
    if (monitor.last_status === 'missing_404') return <Badge tone="amber">● 404 (Allowed by default)</Badge>;
    if (monitor.last_status === 'server_error_5xx') return <Badge tone="red">● Server Error 5xx (Crawl halted)</Badge>;
    return <Badge tone="red">● Connection Failed</Badge>;
  };

  return (
    <div className="sw-page">
      {/* Page Header */}
      <div className="sw-page-head">
        <div>
          <p className="eyebrow">MONITORING</p>
          <h1>Robots.txt & Crawlability</h1>
          <p className="muted">
            Continuous robots.txt rule monitoring, Googlebot crawlability validation, change detection, and blocked path tracking.
          </p>
        </div>

        <div className="sw-actions">
          <Select
            value={siteId}
            onChange={e => {
              setSiteId(e.target.value);
              setUrlPage(0);
            }}
            disabled={!sites.length}
            aria-label="Website"
          >
            {!sites.length && <option>No websites</option>}
            {sites.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          {canWrite && (
            <Btn onClick={handleCheckNow} busy={checking} disabled={!siteId}>
              ▶ Check now
            </Btn>
          )}
        </div>
      </div>

      {/* SEO Clarity Callout */}
      <div className="notice" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong>Technical SEO Notice:</strong> <code>robots.txt</code> governs crawler <strong>access</strong> (whether Googlebot may request the URL). It does <em>not</em> guarantee de-indexing. If links point to a disallowed URL, Google may still index the URL without snippet content. Blocking a page via robots.txt also prevents search engines from seeing a <code>noindex</code> meta tag.
        </div>
      </div>

      <ErrorBox error={sitesQ.error} retry={sitesQ.reload} />
      <ErrorBox error={robotsQ.error} retry={robotsQ.reload} />

      {!sites.length ? (
        <Card>
          {sitesQ.loading ? (
            <Skeleton />
          ) : (
            <Empty
              title="No websites in this project"
              text={project ? 'Add a website first to monitor its robots.txt.' : 'Select a project.'}
              action={
                <Link className="sw-btn primary" href="/websites">
                  Go to Websites
                </Link>
              }
            />
          )}
        </Card>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="sw-kpis">
            <div className="sw-kpi">
              <p>ROBOTS.TXT AVAILABILITY</p>
              <div style={{ marginTop: 8 }}>{getStatusBadge()}</div>
              <span>{monitor?.last_checked_at ? ago(monitor.last_checked_at) : 'Never checked'}</span>
            </div>
            <Kpi label="MONITORED URLS" value={monitor?.total_monitored_urls ?? '0'} note="Includes root, sitemaps & pages" />
            <Kpi label="CRAWLABLE (GOOGLEBOT)" value={monitor?.crawlable_urls_count ?? '0'} tone="green" />
            <Kpi
              label="BLOCKED (GOOGLEBOT)"
              value={monitor?.blocked_urls_count ?? '0'}
              tone={Number(monitor?.blocked_urls_count) > 0 ? 'red' : undefined}
            />
            <Kpi
              label="NEWLY BLOCKED (24H)"
              value={data?.newlyBlocked ?? '0'}
              tone={Number(data?.newlyBlocked) > 0 ? 'red' : undefined}
            />
            <Kpi label="NEWLY ALLOWED (24H)" value={data?.newlyAllowed ?? '0'} tone="green" />
          </div>

          {/* Active Issue Alert Box */}
          {openIssues.length > 0 && (
            <div className="sw-error" style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>⚠️ {openIssues.length} Crawlability Issue(s) Detected</strong>
                <button className="text-btn" onClick={() => setTab('issues')}>
                  View all in Issue Log →
                </button>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {openIssues.slice(0, 3).map((issue: any) => (
                  <li key={issue.id}>
                    <b>{issue.title}:</b> {issue.description}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tabs */}
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              ['rules', `Rules Breakdown (${rules.length})`],
              ['urls', `Evaluated URLs (${monitor?.total_monitored_urls ?? 0})`],
              ['content', 'Raw Robots.txt & History'],
              ['issues', `Issue Log (${openIssues.length})`]
            ]}
          />

          {/* TAB 1: Rules Breakdown */}
          {tab === 'rules' && (
            <Card
              title="Active Robots.txt Directives"
              subtitle={`Extracted from ${monitor?.url || '/robots.txt'} according to RFC 9309 rules.`}
              flush
            >
              {robotsQ.loading && !data ? (
                <Skeleton rows={4} />
              ) : !rules.length ? (
                <Empty
                  title="No directives extracted"
                  text={
                    monitor?.last_status === 'missing_404'
                      ? 'The server returned 404 Not Found for robots.txt. All URLs are allowed by default.'
                      : 'Run a check to parse and inspect the active directives.'
                  }
                  action={
                    canWrite ? (
                      <Btn onClick={handleCheckNow} busy={checking}>
                        ▶ Check robots.txt now
                      </Btn>
                    ) : undefined
                  }
                />
              ) : (
                <Table head={['User-Agent', 'Directive', 'Path / Target', 'Affected URLs', 'Status']}>
                  {rules.map(r => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.user_agent}</strong>
                      </td>
                      <td>
                        {r.directive === 'disallow' ? (
                          <Badge tone="red">DISALLOW</Badge>
                        ) : r.directive === 'allow' ? (
                          <Badge tone="green">ALLOW</Badge>
                        ) : r.directive === 'sitemap' ? (
                          <Badge tone="blue">SITEMAP</Badge>
                        ) : (
                          <Badge tone="gray">CRAWL-DELAY</Badge>
                        )}
                      </td>
                      <td>
                        <code style={{ wordBreak: 'break-all' }}>{r.value || '/ (Allow all)'}</code>
                      </td>
                      <td>
                        {r.affected_urls_count > 0 ? (
                          <span className={r.directive === 'disallow' ? 'declined' : 'improved'}>
                            {r.affected_urls_count} URL{r.affected_urls_count > 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td>
                        <Badge tone="green">Active</Badge>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          )}

          {/* TAB 2: Evaluated URLs & Blockers */}
          {tab === 'urls' && (
            <Card
              title="Evaluated Website URLs"
              subtitle="Inspect whether individual URLs and sections are allowed or blocked for Googlebot under current rules."
              flush
            >
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
                <div className="sw-inline-form" style={{ marginBottom: 0 }}>
                  <label className="sw-field" style={{ minWidth: 200 }}>
                    <span>Crawlability Status</span>
                    <Select
                      value={urlStatus}
                      onChange={e => {
                        setUrlStatus(e.target.value);
                        setUrlPage(0);
                      }}
                    >
                      <option value="">All URLs</option>
                      <option value="blocked">Blocked only</option>
                      <option value="allowed">Allowed only</option>
                      <option value="changed">Recently transitioned</option>
                    </Select>
                  </label>

                  <label className="sw-field" style={{ flex: 1, minWidth: 220 }}>
                    <span>Search URL</span>
                    <Input
                      placeholder="Filter by URL or directory (e.g. /blog/, /admin/)..."
                      value={urlSearch}
                      onChange={e => {
                        setUrlSearch(e.target.value);
                        setUrlPage(0);
                      }}
                    />
                  </label>
                </div>
              </div>

              {urlsQ.loading && !urlsQ.data ? (
                <Skeleton rows={5} />
              ) : !urlsQ.data?.urls?.length ? (
                <Empty
                  title="No URLs match this filter"
                  text="Run a check or clear the search criteria to inspect tracked URLs."
                />
              ) : (
                <>
                  <Table head={['URL', 'Googlebot Status', 'Matching Rule', 'Group', 'Changed', 'Last Checked']}>
                    {urlsQ.data.urls.map((u: any) => (
                      <tr key={u.id}>
                        <td>
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="sw-link"
                            style={{ wordBreak: 'break-all' }}
                          >
                            {u.url}
                          </a>
                        </td>
                        <td>
                          {u.status === 'blocked' ? (
                            <Badge tone="red">● Blocked</Badge>
                          ) : (
                            <Badge tone="green">● Allowed</Badge>
                          )}
                        </td>
                        <td>
                          {u.matched_rule ? (
                            <code>{u.matched_rule}</code>
                          ) : (
                            <span className="muted small">Default allow</span>
                          )}
                        </td>
                        <td>
                          <span className="muted small">{u.matched_user_agent || '*'}</span>
                        </td>
                        <td>
                          {u.previous_status && u.status !== u.previous_status ? (
                            <Badge tone={u.status === 'blocked' ? 'red' : 'green'}>
                              {u.previous_status} → {u.status} {ago(u.status_changed_at)}
                            </Badge>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="muted">{ago(u.last_evaluated_at)}</td>
                      </tr>
                    ))}
                  </Table>

                  <div
                    style={{
                      padding: '12px 20px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: '1px solid var(--line)'
                    }}
                  >
                    <span className="muted small">
                      Showing {urlPage * 50 + 1}–{Math.min(urlsQ.data.total, (urlPage + 1) * 50)} of {urlsQ.data.total} URLs
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Btn
                        kind="ghost"
                        disabled={urlPage === 0}
                        onClick={() => setUrlPage(p => Math.max(0, p - 1))}
                        style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                      >
                        Previous
                      </Btn>
                      <Btn
                        kind="ghost"
                        disabled={(urlPage + 1) * 50 >= urlsQ.data.total}
                        onClick={() => setUrlPage(p => p + 1)}
                        style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                      >
                        Next
                      </Btn>
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}

          {/* TAB 3: Raw Robots.txt & History */}
          {tab === 'content' && (
            <div className="sw-grid-2">
              <Card title="Latest Robots.txt Content" subtitle={`SHA-256: ${latestSnap?.content_hash || '—'}`}>
                {!latestSnap?.content ? (
                  <p className="muted">No content recorded (file returned 404 or check pending).</p>
                ) : (
                  <pre
                    className="sw-code"
                    style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                  >
                    {latestSnap.content}
                  </pre>
                )}
              </Card>

              <Card title="Fetch History & Snapshots" subtitle="Historical revisions detected by SiteWatch." flush>
                {!recentSnapshots.length ? (
                  <Empty title="No snapshots yet" text="Snapshots are created on every check." />
                ) : (
                  <Table head={['Fetched At', 'HTTP', 'Rules', 'Sitemaps', 'Status']}>
                    {recentSnapshots.map((snap: any) => (
                      <tr key={snap.id}>
                        <td>{fmtDate(snap.fetched_at, tz)}</td>
                        <td>{snap.status_code ?? 'Err'}</td>
                        <td>{snap.rules_count}</td>
                        <td>{snap.sitemaps_declared_count}</td>
                        <td>
                          {snap.is_changed ? (
                            <Badge tone="blue">Changed</Badge>
                          ) : (
                            <span className="muted small">Unchanged</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>
          )}

          {/* TAB 4: Issue Log */}
          {tab === 'issues' && (
            <Card
              title="Crawlability Issue Log"
              subtitle="Issues detected when websites, sections, or tracked URLs become blocked unexpectedly."
              flush
            >
              {openIssues.length === 0 ? (
                <Empty
                  title="No active issues detected"
                  text="Robots.txt is accessible and no unexpected crawl blockers were detected for Googlebot."
                />
              ) : (
                <Table head={['Severity', 'Issue', 'Responsible Rule', 'Affected URLs', 'First Seen', 'Last Detected']}>
                  {openIssues.map((issue: any) => (
                    <tr key={issue.id}>
                      <td>
                        <Badge tone={issue.severity === 'critical' ? 'red' : 'amber'}>
                          {issue.severity.toUpperCase()}
                        </Badge>
                      </td>
                      <td>
                        <strong>{issue.title}</strong>
                        <div className="muted small">{issue.description}</div>
                      </td>
                      <td>
                        {issue.rule_responsible ? <code>{issue.rule_responsible}</code> : <span className="muted">—</span>}
                      </td>
                      <td>{issue.affected_urls_count || 0}</td>
                      <td className="muted">{fmtDate(issue.first_detected_at, tz)}</td>
                      <td className="muted">{ago(issue.last_detected_at)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
