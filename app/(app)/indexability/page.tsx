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
  Modal,
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

export default function IndexabilityMonitor() {
  const searchParams = useSearchParams();
  const initSiteId = searchParams.get('siteId') || '';
  const { projectId, user, canWrite } = useApp();
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

  // Load indexability stats
  const indexQ = useAsync(
    () => (siteId ? call(`/api/indexability?siteId=${siteId}`) : Promise.resolve(null)),
    [siteId]
  );

  const data = indexQ.data;
  const site = data?.site;
  const summary = data?.summary;
  const openIssues: any[] = data?.openIssues ?? [];

  const [tab, setTab] = useState<'urls' | 'issues'>('urls');
  const [checking, setChecking] = useState(false);

  // URLs tab state
  const [urlStatus, setUrlStatus] = useState<string>('');
  const [urlSearch, setUrlSearch] = useState<string>('');
  const [urlPage, setUrlPage] = useState<number>(1);

  // Add URL modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUrlInput, setAddUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);

  // History modal state
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const historyQ = useAsync(
    () =>
      selectedPageId && siteId
        ? call(`/api/indexability/urls/${selectedPageId}?siteId=${siteId}`)
        : Promise.resolve(null),
    [selectedPageId, siteId]
  );

  const urlsQ = useAsync(
    () =>
      siteId
        ? call(
            `/api/indexability/urls?siteId=${siteId}&page=${urlPage}&limit=25${
              urlStatus ? `&status=${urlStatus}` : ''
            }${urlSearch ? `&search=${encodeURIComponent(urlSearch)}` : ''}`
          )
        : Promise.resolve({ items: [], pagination: { total: 0, totalPages: 1 } }),
    [siteId, urlStatus, urlSearch, urlPage]
  );

  const evaluatedUrls: any[] = urlsQ.data?.items ?? [];
  const totalPages = urlsQ.data?.pagination?.totalPages || 1;
  const totalEvaluated = urlsQ.data?.pagination?.total || 0;

  // Trigger manual site check
  const handleCheckNow = async () => {
    if (!siteId) return;
    setChecking(true);
    try {
      const res = await call('/api/indexability/check', 'POST', { siteId: Number(siteId), maxPages: 50 });
      const sm = res.summary;
      toast(
        `Crawled ${sm.checkedCount} URLs: ${sm.indexableCount} technically indexable, ${sm.noindexCount} noindex, ${sm.canonicalIssuesCount} canonical issues.`
      );
      await Promise.all([indexQ.reload(true as any), urlsQ.reload(true as any)]);
    } catch (err: any) {
      toast(err?.message || 'Check failed', 'err');
    } finally {
      setChecking(false);
    }
  };

  // Add single URL
  const handleAddManualUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUrlInput.trim() || !siteId) return;
    setAddingUrl(true);
    try {
      await call('/api/indexability/urls', 'POST', { siteId: Number(siteId), url: addUrlInput.trim() });
      toast('URL added and evaluated successfully.');
      setAddUrlInput('');
      setShowAddModal(false);
      await Promise.all([indexQ.reload(true as any), urlsQ.reload(true as any)]);
    } catch (err: any) {
      toast(err?.message || 'Failed to add URL', 'err');
    } finally {
      setAddingUrl(false);
    }
  };

  const currentSite = sites.find(s => String(s.id) === siteId);

  return (
    <div className="sw-page">
      {/* Page Header */}
      <div className="sw-page-head">
        <div>
          <p className="eyebrow">
            <Link href="/websites" className="sw-link">
              MONITORING
            </Link>
          </p>
          <h1>Indexability & Noindex Directives</h1>
          <p className="muted">
            Continuous verification of meta robots tags, X-Robots-Tag headers, canonical declarations, and HTTP redirects.
          </p>
        </div>
        <div className="sw-actions">
          {sites.length > 0 && (
            <Select
              value={siteId}
              onChange={e => {
                setSiteId(e.target.value);
                setUrlPage(1);
              }}
              aria-label="Select Website"
              style={{ minWidth: 180 }}
            >
              {sites.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}

          {canWrite && (
            <>
              <Btn kind="ghost" onClick={() => setShowAddModal(true)} disabled={!siteId}>
                + Add URL
              </Btn>
              <Btn onClick={handleCheckNow} busy={checking} disabled={!siteId}>
                ▶ Check URLs Now
              </Btn>
            </>
          )}
        </div>
      </div>

      {/* SEO Scope Clarification Alert */}
      <div
        style={{
          background: 'rgba(79, 101, 232, 0.08)',
          border: '1px solid rgba(79, 101, 232, 0.25)',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 20,
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--fg)'
        }}
      >
        <strong>Technical SEO Notice:</strong> This feature evaluates <em>technical indexability signals</em> (HTTP 200 responses, meta robots directives, X-Robots-Tag headers, and canonical syntax). It confirms whether search engines can technically index each page. It does not determine whether Google has chosen to index or rank the URL, which requires Google Search Console data.
      </div>

      {indexQ.loading && !data ? (
        <Skeleton rows={6} />
      ) : indexQ.error ? (
        <ErrorBox error={indexQ.error} retry={indexQ.reload} />
      ) : !site ? (
        <Card>
          <Empty
            title="No website selected"
            text="Add or select a monitored website to begin tracking indexability and canonical status."
          />
        </Card>
      ) : (
        <>
          {/* 6 Key Performance Indicators */}
          <div className="sw-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Kpi
              label="MONITORED URLS"
              value={summary?.totalMonitored ?? 0}
              note={data.monitors?.[0]?.last_checked_at ? `Checked ${ago(data.monitors[0].last_checked_at)}` : 'Pending scan'}
            />
            <Kpi
              label="INDEXABLE"
              value={summary?.totalIndexable ?? 0}
              tone="green"
              note="200 OK & allowed"
            />
            <Kpi
              label="NOINDEX URLS"
              value={summary?.totalNoindex ?? 0}
              tone={summary?.totalNoindex > 0 ? 'red' : undefined}
              note="Meta or header blocked"
            />
            <Kpi
              label="CANONICAL ISSUES"
              value={summary?.totalCanonicalIssues ?? 0}
              tone={summary?.totalCanonicalIssues > 0 ? 'amber' : undefined}
              note="Non-self or invalid"
            />
            <Kpi
              label="HTTP ERRORS"
              value={summary?.totalErrors ?? 0}
              tone={summary?.totalErrors > 0 ? 'red' : undefined}
              note="4xx, 5xx, or timeouts"
            />
            <Kpi
              label="CHANGED (24H)"
              value={summary?.totalChanged ?? 0}
              note="Recent transitions"
            />
          </div>

          {/* Open Issues Alert Banner */}
          {openIssues.length > 0 && (
            <div
              style={{
                background: 'rgba(216, 76, 85, 0.08)',
                border: '1px solid rgba(216, 76, 85, 0.3)',
                borderRadius: 8,
                padding: '14px 18px',
                marginBottom: 20
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge tone="red">● {openIssues.length} Active Issue{openIssues.length > 1 ? 's' : ''}</Badge>
                  <strong style={{ fontSize: 14 }}>Attention required for {currentSite?.name || 'website'}</strong>
                </div>
                <button className="text-btn" onClick={() => setTab('issues')}>
                  View full Issue Log →
                </button>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                {openIssues.slice(0, 3).map((issue: any) => (
                  <li key={issue.id}>
                    <b>{issue.title}:</b> <span className="muted">{issue.url}</span> — {issue.description}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Navigation Tabs */}
          <Tabs
            value={tab}
            onChange={v => setTab(v as any)}
            tabs={[
              ['urls', `Evaluated URLs (${summary?.totalMonitored ?? 0})`],
              ['issues', `Active & Historical Issues (${openIssues.length})`]
            ]}
          />

          {/* TAB 1: Evaluated URLs */}
          {tab === 'urls' && (
            <Card
              title="Monitored URLs Indexability Assessment"
              subtitle="Detailed breakdown of HTTP status, robots directives, and canonical alignment for every discovered page."
              flush
            >
              {/* Filter & Search Bar */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
                <div className="sw-inline-form" style={{ marginBottom: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label className="sw-field" style={{ minWidth: 200, margin: 0 }}>
                    <span>Indexability Filter</span>
                    <Select
                      value={urlStatus}
                      onChange={e => {
                        setUrlStatus(e.target.value);
                        setUrlPage(1);
                      }}
                    >
                      <option value="">All Monitored URLs</option>
                      <option value="indexable">Technically Indexable Only</option>
                      <option value="noindex">Noindex Directives Only</option>
                      <option value="canonical_issue">Canonical Discrepancies</option>
                      <option value="errors">HTTP 4xx / 5xx Errors</option>
                      <option value="changed">Changed in Last 24 Hours</option>
                    </Select>
                  </label>

                  <label className="sw-field" style={{ flex: 1, minWidth: 260, margin: 0 }}>
                    <span>Search URL</span>
                    <Input
                      placeholder="Filter by page path or keyword (e.g. /pricing, /blog/)..."
                      value={urlSearch}
                      onChange={e => {
                        setUrlSearch(e.target.value);
                        setUrlPage(1);
                      }}
                    />
                  </label>
                </div>
              </div>

              {urlsQ.loading && !urlsQ.data ? (
                <Skeleton rows={5} />
              ) : evaluatedUrls.length === 0 ? (
                <Empty
                  title="No URLs found"
                  text={
                    urlSearch || urlStatus
                      ? 'No evaluated URLs match the selected filter criteria.'
                      : 'No candidate URLs have been evaluated yet. Run a check to seed and inspect pages.'
                  }
                  action={
                    canWrite && !urlSearch && !urlStatus ? (
                      <Btn onClick={handleCheckNow} busy={checking}>
                        ▶ Run Indexability Check
                      </Btn>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <Table head={['URL', 'Indexable', 'Directives (Robots / Headers)', 'Canonical Status', 'HTTP', 'Last Checked', 'Actions']}>
                    {evaluatedUrls.map(item => {
                      const isIndexable = Boolean(item.is_indexable);
                      const hasNoindex = Boolean(item.has_noindex);

                      return (
                        <tr key={item.id}>
                          {/* URL Column */}
                          <td style={{ maxWidth: 320 }}>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              style={{
                                wordBreak: 'break-all',
                                color: 'var(--primary)',
                                textDecoration: 'none',
                                fontWeight: 500
                              }}
                            >
                              {item.url}
                            </a>
                            <div className="muted small" style={{ marginTop: 2 }}>
                              Source: {item.source}
                              {item.redirect_destination && (
                                <span style={{ color: 'var(--amber)' }}>
                                  {' '}→ {item.redirect_hops} hop(s) to {item.redirect_destination}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Indexable Verdict */}
                          <td>
                            {item.http_status == null ? (
                              <Badge tone="gray">Pending</Badge>
                            ) : isIndexable ? (
                              <Badge tone="green">Indexable</Badge>
                            ) : (
                              <Badge tone="red">Non-Indexable</Badge>
                            )}
                          </td>

                          {/* Directives */}
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {hasNoindex && (
                                <div>
                                  <Badge tone="red">NOINDEX ({item.noindex_source || 'meta'})</Badge>
                                </div>
                              )}
                              {item.meta_robots && (
                                <div className="small">
                                  <code>meta: {item.meta_robots}</code>
                                </div>
                              )}
                              {item.meta_googlebot && (
                                <div className="small">
                                  <code>googlebot: {item.meta_googlebot}</code>
                                </div>
                              )}
                              {item.x_robots_tag && (
                                <div className="small">
                                  <code>X-Robots: {item.x_robots_tag}</code>
                                </div>
                              )}
                              {!hasNoindex && !item.meta_robots && !item.x_robots_tag && (
                                <span className="muted small">Default (Index, Follow)</span>
                              )}
                            </div>
                          </td>

                          {/* Canonical */}
                          <td>
                            <div>
                              {item.canonical_status === 'self_referencing' ? (
                                <Badge tone="green">Self-referencing</Badge>
                              ) : item.canonical_status === 'canonicalized' ? (
                                <Badge tone="amber">Canonicalized</Badge>
                              ) : item.canonical_status === 'cross_domain' ? (
                                <Badge tone="amber">Cross-domain</Badge>
                              ) : item.canonical_status === 'multiple' ? (
                                <Badge tone="red">Multiple tags</Badge>
                              ) : item.canonical_status === 'invalid' ? (
                                <Badge tone="red">Invalid URL</Badge>
                              ) : (
                                <Badge tone="gray">Missing canonical</Badge>
                              )}
                            </div>
                            {item.canonical_url && item.canonical_status !== 'self_referencing' && (
                              <div className="small muted" style={{ marginTop: 3, wordBreak: 'break-all' }}>
                                → {item.canonical_url}
                              </div>
                            )}
                          </td>

                          {/* HTTP Status */}
                          <td>
                            {item.http_status ? (
                              <Badge
                                tone={
                                  item.http_status === 200
                                    ? 'green'
                                    : item.http_status >= 400
                                    ? 'red'
                                    : 'amber'
                                }
                              >
                                {item.http_status}
                              </Badge>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>

                          {/* Last Checked */}
                          <td className="small muted">
                            {new Date(item.last_checked_at).getFullYear() > 1970
                              ? ago(item.last_checked_at)
                              : 'Never'}
                          </td>

                          {/* Actions */}
                          <td>
                            <Btn
                              kind="ghost"
                              style={{ padding: '4px 10px', fontSize: 12 }}
                              onClick={() => setSelectedPageId(item.id)}
                            >
                              History
                            </Btn>
                          </td>
                        </tr>
                      );
                    })}
                  </Table>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div
                      style={{
                        padding: '14px 20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderTop: '1px solid var(--line)'
                      }}
                    >
                      <span className="small muted">
                        Showing page {urlPage} of {totalPages} ({totalEvaluated} URLs total)
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Btn
                          kind="ghost"
                          disabled={urlPage <= 1}
                          onClick={() => setUrlPage(p => Math.max(1, p - 1))}
                        >
                          Previous
                        </Btn>
                        <Btn
                          kind="ghost"
                          disabled={urlPage >= totalPages}
                          onClick={() => setUrlPage(p => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Btn>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>
          )}

          {/* TAB 2: Issues Log */}
          {tab === 'issues' && (
            <Card
              title="Indexability Issues Log"
              subtitle="Active alerts and resolved incidents for noindex directives, canonical tag errors, and redirect anomalies."
              flush
            >
              {openIssues.length === 0 ? (
                <Empty
                  title="No active issues detected"
                  text="All scanned URLs meet technical indexability criteria without blocking directives or canonical contradictions."
                />
              ) : (
                <Table head={['Severity', 'Issue Type', 'URL', 'Description', 'Directives / Value', 'Detected At', 'Occurrences']}>
                  {openIssues.map(issue => (
                    <tr key={issue.id}>
                      <td>
                        <Badge tone={issue.severity === 'critical' ? 'red' : issue.severity === 'warning' ? 'amber' : 'blue'}>
                          {issue.severity.toUpperCase()}
                        </Badge>
                      </td>
                      <td>
                        <strong>{issue.title}</strong>
                        <div className="small muted"><code>{issue.issue_type}</code></div>
                      </td>
                      <td style={{ maxWidth: 260, wordBreak: 'break-all' }}>
                        <a href={issue.url} target="_blank" rel="noreferrer noopener" className="sw-link">
                          {issue.url}
                        </a>
                      </td>
                      <td style={{ maxWidth: 300 }}>
                        <div className="small">{issue.description}</div>
                        {issue.previous_value && (
                          <div className="small muted" style={{ marginTop: 2 }}>
                            Previous: <code>{issue.previous_value}</code>
                          </div>
                        )}
                      </td>
                      <td>
                        {issue.current_value ? (
                          <code className="small" style={{ wordBreak: 'break-all' }}>
                            {issue.current_value}
                          </code>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="small muted">
                        {fmtDate(issue.first_detected_at, tz)}
                        <div className="small">Last: {ago(issue.last_detected_at)}</div>
                      </td>
                      <td>
                        <Badge tone="gray">{issue.occurrence_count}×</Badge>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          )}
        </>
      )}

      {/* URL History & Snapshots Modal */}
      {selectedPageId && (
        <Modal
          title="URL Technical Indexability Snapshot History"
          onClose={() => setSelectedPageId(null)}
          wide
        >
          {historyQ.loading && !historyQ.data ? (
            <Skeleton rows={5} />
          ) : !historyQ.data?.page ? (
            <Empty title="History not found" text="Unable to load historical crawl snapshots." />
          ) : (
            <div>
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 16 }}>{historyQ.data.page.url}</strong>
                <div className="muted small" style={{ marginTop: 4 }}>
                  Discovered from: {historyQ.data.page.source} · First evaluated: {fmtDate(historyQ.data.page.first_checked_at, tz)}
                </div>
              </div>

              <div className="sw-kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
                <Kpi
                  label="CURRENT STATUS"
                  value={historyQ.data.page.is_indexable ? 'INDEXABLE' : 'NON-INDEXABLE'}
                  tone={historyQ.data.page.is_indexable ? 'green' : 'red'}
                />
                <Kpi
                  label="HTTP RESPONSE"
                  value={historyQ.data.page.http_status ? `HTTP ${historyQ.data.page.http_status}` : '—'}
                  tone={historyQ.data.page.http_status === 200 ? 'green' : 'red'}
                />
                <Kpi
                  label="NOINDEX DIRECTIVE"
                  value={historyQ.data.page.has_noindex ? 'YES' : 'NONE'}
                  tone={historyQ.data.page.has_noindex ? 'red' : 'green'}
                />
                <Kpi
                  label="CANONICAL STATE"
                  value={historyQ.data.page.canonical_status}
                  tone={historyQ.data.page.canonical_status === 'self_referencing' ? 'green' : 'amber'}
                />
              </div>

              <h4>Historical Crawl Snapshots</h4>
              {!historyQ.data.snapshots?.length ? (
                <Empty title="No historical snapshots yet" text="Snapshots are created on each crawl." />
              ) : (
                <Table head={['Checked At', 'HTTP', 'Indexable', 'Directives', 'Canonical Target', 'Error / Notes']}>
                  {historyQ.data.snapshots.map((snap: any) => (
                    <tr key={snap.id}>
                      <td className="small">{fmtDate(snap.checked_at, tz)}</td>
                      <td>
                        <Badge tone={snap.http_status === 200 ? 'green' : snap.http_status >= 400 ? 'red' : 'amber'}>
                          {snap.http_status ?? 'Error'}
                        </Badge>
                      </td>
                      <td>
                        {snap.is_indexable ? (
                          <Badge tone="green">Indexable</Badge>
                        ) : (
                          <Badge tone="red">Noindex</Badge>
                        )}
                      </td>
                      <td className="small">
                        {snap.has_noindex && <Badge tone="red">noindex</Badge>}
                        {snap.meta_robots && <div><code>{snap.meta_robots}</code></div>}
                        {snap.x_robots_tag && <div><code>X-Robots: {snap.x_robots_tag}</code></div>}
                      </td>
                      <td className="small" style={{ wordBreak: 'break-all', maxWidth: 200 }}>
                        {snap.canonical_url || <span className="muted">None</span>}
                      </td>
                      <td className="small muted">
                        {snap.error_message || (snap.redirect_destination ? `Redirected to ${snap.redirect_destination}` : 'OK')}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* Add Manual URL Modal */}
      {showAddModal && (
        <Modal
          title="Add Custom URL for Indexability Tracking"
          onClose={() => setShowAddModal(false)}
        >
          <form onSubmit={handleAddManualUrl}>
            <Field
              label="Page URL"
              hint={`Enter the full URL matching website domain (${currentSite?.url || 'https://example.com'}).`}
            >
              <Input
                type="url"
                required
                placeholder="https://example.com/important-page"
                value={addUrlInput}
                onChange={e => setAddUrlInput(e.target.value)}
              />
            </Field>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Btn kind="ghost" type="button" onClick={() => setShowAddModal(false)}>
                Cancel
              </Btn>
              <Btn type="submit" busy={addingUrl}>
                Add & Crawl Immediately
              </Btn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
