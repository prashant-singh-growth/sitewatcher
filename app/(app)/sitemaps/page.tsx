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
import { WalkthroughTrigger } from '../../ui/walkthrough';

export default function SitemapMonitor() {
  const searchParams = useSearchParams();
  const initSiteId = searchParams.get('siteId') || '';
  const { project, projectId, user, canWrite } = useApp();
  const tz = user.timezone;
  const toast = useToast();

  // Load website list for project
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

  // Load sitemaps data for selected site
  const sitemapsQ = useAsync(
    () => (siteId ? call(`/api/sitemaps?siteId=${siteId}`) : Promise.resolve({ sitemaps: [], openIssues: [] })),
    [siteId]
  );

  const data = sitemapsQ.data;
  const sitemaps: any[] = data?.sitemaps ?? [];
  const openIssues: any[] = data?.openIssues ?? [];

  const [tab, setTab] = useState('sitemaps');
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newInterval, setNewInterval] = useState('24');
  const [addingBusy, setAddingBusy] = useState(false);

  const [detailSitemapId, setDetailSitemapId] = useState<number | null>(null);
  const detailQ = useAsync(
    () => (detailSitemapId ? call(`/api/sitemaps/${detailSitemapId}`) : Promise.resolve(null)),
    [detailSitemapId]
  );

  // URL Explorer state
  const [urlFilter, setUrlFilter] = useState('');
  const [urlStatus, setUrlStatus] = useState('');
  const [urlPage, setUrlPage] = useState(0);
  const selectedSitemapForUrls = sitemaps.length > 0 ? (sitemaps.find(s => s.type !== 'index') || sitemaps[0]) : null;
  const [explorerSitemapId, setExplorerSitemapId] = useState<string>('');

  useEffect(() => {
    if (!explorerSitemapId && selectedSitemapForUrls) {
      setExplorerSitemapId(String(selectedSitemapForUrls.id));
    }
  }, [explorerSitemapId, selectedSitemapForUrls]);

  const urlsQ = useAsync(
    () =>
      explorerSitemapId
        ? call(
            `/api/sitemaps/${explorerSitemapId}/urls?limit=50&offset=${urlPage * 50}${
              urlStatus ? `&status=${urlStatus}` : ''
            }${urlFilter ? `&search=${encodeURIComponent(urlFilter)}` : ''}`
          )
        : Promise.resolve({ urls: [], total: 0 }),
    [explorerSitemapId, urlStatus, urlFilter, urlPage]
  );

  // Trigger manual scan
  const handleScan = async (id: number) => {
    setScanningId(id);
    try {
      const res = await call(`/api/sitemaps/${id}/scan`, 'POST');
      if (res.result?.status === 'success') {
        toast(`Scan complete: ${res.result.totalUrls} URLs discovered (${res.result.addedCount} new, ${res.result.removedCount} removed).`);
      } else {
        toast(`Scan failed: ${res.result?.error || 'Check error details'}`, 'err');
      }
      await sitemapsQ.reload(true as any);
      if (detailSitemapId === id) await detailQ.reload(true as any);
      if (explorerSitemapId === String(id)) await urlsQ.reload(true as any);
    } catch (err: any) {
      toast(err?.message || 'Scan failed', 'err');
    } finally {
      setScanningId(null);
    }
  };

  // Auto-discover sitemaps
  const handleDiscover = async () => {
    if (!siteId) return;
    setDiscovering(true);
    try {
      const res = await call('/api/sitemaps/discover', 'POST', { siteId: Number(siteId) });
      toast(`Discovered ${res.count} sitemap(s) from robots.txt and sitemap.xml.`);
      await sitemapsQ.reload(true as any);
    } catch (err: any) {
      toast(err?.message || 'Discovery failed', 'err');
    } finally {
      setDiscovering(false);
    }
  };

  // Add sitemap
  const handleAddSitemap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl) return;
    setAddingBusy(true);
    try {
      await call('/api/sitemaps', 'POST', {
        siteId: Number(siteId),
        url: newUrl,
        checkIntervalHours: Number(newInterval)
      });
      toast('Sitemap added and initial scan queued.');
      setShowAddModal(false);
      setNewUrl('');
      await sitemapsQ.reload(true as any);
    } catch (err: any) {
      toast(err?.message || 'Failed to add sitemap', 'err');
    } finally {
      setAddingBusy(false);
    }
  };

  // Toggle active / Delete sitemap
  const handleAction = async (s: any, action: 'toggle' | 'delete') => {
    if (action === 'delete' && !confirm(`Stop monitoring sitemap ${s.url}?`)) return;
    try {
      if (action === 'delete') {
        await call(`/api/sitemaps/${s.id}`, 'DELETE');
        toast('Sitemap removed.');
      } else {
        await call(`/api/sitemaps/${s.id}`, 'PATCH', { action: 'toggle' });
        toast(s.is_active ? 'Monitoring paused.' : 'Monitoring resumed.');
      }
      await sitemapsQ.reload(true as any);
    } catch (err: any) {
      toast(err?.message || 'Action failed', 'err');
    }
  };

  return (
    <div className="sw-page">
      {/* Page Header */}
      <div className="sw-page-head">
        <div>
          <p className="eyebrow">MONITORING</p>
          <h1>XML Sitemap Monitor</h1>
          <p className="muted">
            Continuous XML sitemap health checks, URL additions & removals, structural monitoring, and discovery tracking.{' '}
            <Link href="/docs?article=sitemap-monitoring-guide" className="sw-link" style={{ fontSize: 13 }}>
              Learn how sitemap monitoring works →
            </Link>
          </p>
        </div>

        <div className="sw-actions">
          <WalkthroughTrigger tourId="sitemaps-tour" />
          <Select
            value={siteId}
            onChange={e => setSiteId(e.target.value)}
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
            <>
              <Btn kind="ghost" onClick={handleDiscover} busy={discovering} disabled={!siteId}>
                🔍 Auto-discover
              </Btn>
              <Btn onClick={() => setShowAddModal(true)} disabled={!siteId}>
                ＋ Add sitemap
              </Btn>
            </>
          )}
        </div>
      </div>

      {/* SEO Clarity Callout */}
      <div className="notice" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong>Technical SEO Notice:</strong> XML Sitemap Monitoring tracks the availability, structural integrity,
          and URL declarations that your website submits to search engines. <em>Sitemap membership indicates discovery eligibility; it is distinct from actual Google Search indexation status, which depends on Google crawl budgets, quality signals, and Google Search Console data.</em>
        </div>
      </div>

      <ErrorBox error={sitesQ.error} retry={sitesQ.reload} />
      <ErrorBox error={sitemapsQ.error} retry={sitemapsQ.reload} />

      {!sites.length ? (
        <Card>
          {sitesQ.loading ? (
            <Skeleton />
          ) : (
            <Empty
              title="No websites in this project"
              text={project ? 'Add a website first to start monitoring sitemaps.' : 'Select a project.'}
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
            <Kpi label="SITEMAP FILES" value={data?.totalSitemaps ?? '0'} />
            <Kpi label="DISCOVERED URLS" value={data?.totalUrls ?? '0'} />
            <Kpi label="NEW URLS" value={data?.addedUrls ?? '0'} tone="green" />
            <Kpi label="REMOVED URLS" value={data?.removedUrls ?? '0'} tone={data?.removedUrls > 0 ? 'red' : undefined} />
            <Kpi
              label="FAILED CHECKS"
              value={data?.failedCount ?? '0'}
              tone={data?.failedCount > 0 ? 'red' : 'green'}
            />
            <Kpi
              label="LAST SUCCESSFUL SCAN"
              value={data?.lastSuccessfulScan ? ago(data.lastSuccessfulScan) : 'Never'}
            />
          </div>

          {/* Active Issues Alert Box if issues exist */}
          {openIssues.length > 0 && (
            <div className="sw-error" style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>⚠️ {openIssues.length} Sitemap Issue(s) Detected</strong>
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
              ['sitemaps', `Sitemaps (${sitemaps.length})`],
              ['urls', 'URL Explorer & History'],
              ['issues', `Issue Log (${openIssues.length})`]
            ]}
          />

          {/* TAB 1: Sitemaps Table */}
          {tab === 'sitemaps' && (
            <Card flush>
              {sitemapsQ.loading && !data ? (
                <Skeleton rows={4} />
              ) : !sitemaps.length ? (
                <Empty
                  title="No sitemaps monitored yet"
                  text="Discover sitemaps automatically from robots.txt or add a custom sitemap URL."
                  action={
                    canWrite ? (
                      <div className="sw-actions" style={{ justifyContent: 'center' }}>
                        <Btn kind="ghost" onClick={handleDiscover} busy={discovering}>
                          🔍 Auto-discover from robots.txt
                        </Btn>
                        <Btn onClick={() => setShowAddModal(true)}>＋ Add custom sitemap</Btn>
                      </div>
                    ) : undefined
                  }
                />
              ) : (
                <Table
                  head={[
                    'Sitemap URL',
                    'Type',
                    'Discovered URLs',
                    'Added',
                    'Removed',
                    'Status',
                    'Last Checked',
                    'Actions'
                  ]}
                >
                  {sitemaps.map(s => {
                    const isScanning = scanningId === s.id;
                    return (
                      <tr key={s.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {s.parent_sitemap_id && (
                              <span title="Child sitemap discovered from index" style={{ color: 'var(--muted)' }}>
                                ↳
                              </span>
                            )}
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="sw-link"
                              style={{ wordBreak: 'break-all' }}
                            >
                              {s.url}
                            </a>
                          </div>
                          {s.last_error && (
                            <div className="red small" style={{ marginTop: 3 }}>
                              {s.last_error}
                            </div>
                          )}
                        </td>
                        <td>
                          {s.type === 'index' ? (
                            <Badge tone="blue">Sitemap Index</Badge>
                          ) : s.type === 'urlset' ? (
                            <Badge tone="gray">URL Set</Badge>
                          ) : (
                            <Badge tone="gray">Pending Scan</Badge>
                          )}
                        </td>
                        <td>
                          <b>{s.type === 'index' ? `${s.last_url_count} sitemaps` : s.last_url_count}</b>
                        </td>
                        <td>
                          {s.last_added_count > 0 ? (
                            <span className="improved">+{s.last_added_count}</span>
                          ) : (
                            <span className="muted">0</span>
                          )}
                        </td>
                        <td>
                          {s.last_removed_count > 0 ? (
                            <span className="declined">-{s.last_removed_count}</span>
                          ) : (
                            <span className="muted">0</span>
                          )}
                        </td>
                        <td>
                          {!s.is_active ? (
                            <Badge tone="gray">Paused</Badge>
                          ) : s.last_status === 'success' ? (
                            <Badge tone="green">● Operational</Badge>
                          ) : s.last_status === 'failed' ? (
                            <Badge tone="red">● Error</Badge>
                          ) : (
                            <Badge tone="amber">Pending</Badge>
                          )}
                        </td>
                        <td className="muted">{ago(s.last_scanned_at)}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              title="Scan now"
                              onClick={() => handleScan(s.id)}
                              disabled={isScanning}
                              style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}
                            >
                              {isScanning ? 'Scanning…' : '▶ Scan'}
                            </button>
                            <button
                              title="View details & history"
                              onClick={() => setDetailSitemapId(s.id)}
                              style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}
                            >
                              Details
                            </button>
                            {canWrite && (
                              <>
                                <button
                                  title={s.is_active ? 'Pause checks' : 'Resume checks'}
                                  onClick={() => handleAction(s, 'toggle')}
                                >
                                  {s.is_active ? 'Ⅱ' : '▶'}
                                </button>
                                <button title="Remove" onClick={() => handleAction(s, 'delete')}>
                                  ×
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Card>
          )}

          {/* TAB 2: URL Explorer & History */}
          {tab === 'urls' && (
            <Card
              title="Sitemap URL Explorer"
              subtitle="Inspect URLs discovered inside your sitemaps, track lastmod dates, and review additions/removals."
              flush
            >
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
                <div className="sw-inline-form" style={{ marginBottom: 0 }}>
                  <label className="sw-field" style={{ minWidth: 240 }}>
                    <span>Target Sitemap</span>
                    <Select
                      value={explorerSitemapId}
                      onChange={e => {
                        setExplorerSitemapId(e.target.value);
                        setUrlPage(0);
                      }}
                    >
                      {sitemaps.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.url.split('/').pop() || s.url} ({s.type === 'index' ? 'Index' : `${s.last_url_count} URLs`})
                        </option>
                      ))}
                    </Select>
                  </label>

                  <label className="sw-field" style={{ minWidth: 160 }}>
                    <span>Status Filter</span>
                    <Select
                      value={urlStatus}
                      onChange={e => {
                        setUrlStatus(e.target.value);
                        setUrlPage(0);
                      }}
                    >
                      <option value="">All (Active & Removed)</option>
                      <option value="active">Active only</option>
                      <option value="removed">Removed only</option>
                    </Select>
                  </label>

                  <label className="sw-field" style={{ flex: 1, minWidth: 200 }}>
                    <span>Search URL</span>
                    <Input
                      placeholder="Filter by keyword or path..."
                      value={urlFilter}
                      onChange={e => {
                        setUrlFilter(e.target.value);
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
                  text="Run a scan or adjust your search keywords to view discovered URLs."
                />
              ) : (
                <>
                  <Table head={['URL', 'Status', 'Last Modified (<lastmod>)', 'First Seen', 'Last Seen']}>
                    {urlsQ.data.urls.map((u: any) => (
                      <tr key={u.id}>
                        <td>
                          <a
                            href={u.loc}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="sw-link"
                            style={{ wordBreak: 'break-all' }}
                          >
                            {u.loc}
                          </a>
                        </td>
                        <td>
                          {u.status === 'active' ? (
                            <Badge tone="green">Active</Badge>
                          ) : (
                            <Badge tone="red">Removed {ago(u.removed_at)}</Badge>
                          )}
                        </td>
                        <td className="muted">{fmtDate(u.lastmod, tz)}</td>
                        <td className="muted">{fmtDate(u.first_seen_at, tz)}</td>
                        <td className="muted">{ago(u.last_seen_at)}</td>
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

          {/* TAB 3: Issue Log */}
          {tab === 'issues' && (
            <Card
              title="Sitemap Issue Log"
              subtitle="Detected issues, including unexpected URL removals, 4xx/5xx responses, invalid XML, and structural failures."
              flush
            >
              {openIssues.length === 0 ? (
                <Empty
                  title="No active issues detected"
                  text="All sitemaps are reachable, valid XML, and reporting stable URL counts."
                />
              ) : (
                <Table head={['Severity', 'Issue', 'Sitemap', 'Occurrences', 'First Seen', 'Last Detected']}>
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
                        <a
                          href={issue.sitemap_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="sw-link small"
                          style={{ wordBreak: 'break-all' }}
                        >
                          {issue.sitemap_url}
                        </a>
                      </td>
                      <td>{issue.occurrence_count}</td>
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

      {/* Modal: Add Sitemap */}
      {showAddModal && (
        <Modal title="Add XML Sitemap" onClose={() => setShowAddModal(false)}>
          <form className="sw-form" onSubmit={handleAddSitemap}>
            <Field
              label="Sitemap URL"
              hint="Full public URL to the XML sitemap (e.g. https://example.com/sitemap.xml or .xml.gz)"
            >
              <Input
                type="url"
                required
                placeholder="https://example.com/sitemap.xml"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
              />
            </Field>

            <Field label="Check Interval" hint="How frequently SiteWatch should inspect this sitemap">
              <Select value={newInterval} onChange={e => setNewInterval(e.target.value)}>
                <option value="1">Every 1 hour (high-frequency sites)</option>
                <option value="6">Every 6 hours</option>
                <option value="12">Every 12 hours</option>
                <option value="24">Every 24 hours (recommended)</option>
                <option value="168">Weekly (7 days)</option>
              </Select>
            </Field>

            <div className="sw-form-actions">
              <Btn kind="ghost" type="button" onClick={() => setShowAddModal(false)}>
                Cancel
              </Btn>
              <Btn busy={addingBusy}>Add & Scan Now</Btn>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Sitemap Details & Scan History */}
      {detailSitemapId && (
        <Modal
          wide
          title={`Sitemap Details: ${detailQ.data?.sitemap?.url || ''}`}
          onClose={() => setDetailSitemapId(null)}
        >
          {detailQ.loading && !detailQ.data ? (
            <Skeleton rows={6} />
          ) : !detailQ.data ? (
            <ErrorBox error="Failed to load sitemap details" />
          ) : (
            <div>
              {/* Sitemap Metadata */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                  marginBottom: 20
                }}
              >
                <div className="sw-kpi" style={{ padding: 12 }}>
                  <p>TYPE</p>
                  <strong>{detailQ.data.sitemap.type === 'index' ? 'Index' : 'URL Set'}</strong>
                </div>
                <div className="sw-kpi" style={{ padding: 12 }}>
                  <p>DISCOVERED URLS</p>
                  <strong>{detailQ.data.sitemap.last_url_count}</strong>
                </div>
                <div className="sw-kpi" style={{ padding: 12 }}>
                  <p>STATUS</p>
                  <strong className={detailQ.data.sitemap.last_status === 'success' ? 'green' : 'red'}>
                    {detailQ.data.sitemap.last_status.toUpperCase()}
                  </strong>
                </div>
                <div className="sw-kpi" style={{ padding: 12 }}>
                  <p>CHECK INTERVAL</p>
                  <strong>{detailQ.data.sitemap.check_interval_hours}h</strong>
                </div>
              </div>

              {/* Child Sitemaps if index */}
              {detailQ.data.children?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ margin: '0 0 10px' }}>Child Sitemaps ({detailQ.data.children.length})</h4>
                  <Table head={['Child Sitemap URL', 'URLs', 'Status', 'Last Checked']}>
                    {detailQ.data.children.map((child: any) => (
                      <tr key={child.id}>
                        <td>
                          <a
                            href={child.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="sw-link"
                            style={{ wordBreak: 'break-all' }}
                          >
                            {child.url}
                          </a>
                        </td>
                        <td>{child.last_url_count}</td>
                        <td>
                          <Badge tone={child.last_status === 'success' ? 'green' : 'red'}>
                            {child.last_status}
                          </Badge>
                        </td>
                        <td className="muted">{ago(child.last_scanned_at)}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}

              {/* Recent Scan History */}
              <div>
                <h4 style={{ margin: '0 0 10px' }}>Recent Scan History (Snapshots)</h4>
                {!detailQ.data.scans?.length ? (
                  <p className="muted">No scans recorded yet.</p>
                ) : (
                  <Table head={['Scanned At', 'Result', 'HTTP', 'URLs Found', 'Added', 'Removed', 'Duration']}>
                    {detailQ.data.scans.map((sc: any) => (
                      <tr key={sc.id}>
                        <td>{fmtDate(sc.scanned_at, tz)}</td>
                        <td>
                          <Badge tone={sc.status === 'success' ? 'green' : 'red'}>
                            {sc.status.toUpperCase()}
                          </Badge>
                          {sc.error_message && (
                            <div className="red small" style={{ marginTop: 2 }}>
                              {sc.error_message}
                            </div>
                          )}
                        </td>
                        <td>{sc.status_code ?? '—'}</td>
                        <td>
                          <b>{sc.total_urls}</b>
                        </td>
                        <td>
                          {sc.added_urls_count > 0 ? (
                            <span className="improved">+{sc.added_urls_count}</span>
                          ) : (
                            '0'
                          )}
                        </td>
                        <td>
                          {sc.removed_urls_count > 0 ? (
                            <span className="declined">-{sc.removed_urls_count}</span>
                          ) : (
                            '0'
                          )}
                        </td>
                        <td className="muted">{sc.duration_ms} ms</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
