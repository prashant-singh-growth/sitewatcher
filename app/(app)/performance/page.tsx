'use client';
import { useEffect, useState } from 'react';
import { useApp } from '../../ui/context';
import { Card, Empty, ErrorBox, LineChart, Select, Skeleton, call, useAsync } from '../../ui/kit';

const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
export default function Performance() {
  const { projectId, user } = useApp(); const tz = user.timezone;
  const sitesQ = useAsync(() => (projectId ? call(`/api/sites?projectId=${projectId}`) : Promise.resolve({ sites: [] })), [projectId]);
  const sites: any[] = sitesQ.data?.sites ?? []; const [siteId, setSiteId] = useState(''); useEffect(() => { if (!sites.some(s => String(s.id) === siteId)) setSiteId(sites[0] ? String(sites[0].id) : ''); }, [sites, siteId]);
  const [range, setRange] = useState('30d'); const [device, setDevice] = useState('mobile');
  const from = new Date(Date.now() - RANGES[range] * 86400000).toISOString();
  const series = useAsync(() => (siteId ? call(`/api/sites/${siteId}/series?from=${from}`) : Promise.resolve({ series: [] })), [siteId, range]);
  const audits = useAsync(() => (siteId ? call(`/api/speedtest?siteId=${siteId}&device=${device}&from=${from}&limit=500`).catch(() => ({ audits: [] })) : Promise.resolve({ audits: [] })), [siteId, range, device]);
  const a: any[] = (audits.data?.audits ?? []).filter((x: any) => x.status === 'success').slice().reverse();
  const sr: any[] = series.data?.series ?? [];
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">ANALYTICS</p><h1>Performance History</h1><p className="muted">Long-term trends: uptime response times and Lighthouse scores.</p></div>
    <div className="sw-actions"><Select value={siteId} onChange={e => setSiteId(e.target.value)} aria-label="Website">{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><Select value={device} onChange={e => setDevice(e.target.value)} aria-label="Device"><option value="mobile">Mobile</option><option value="desktop">Desktop</option></Select><Select value={range} onChange={e => setRange(e.target.value)} aria-label="Range">{Object.keys(RANGES).map(r => <option key={r}>{r}</option>)}</Select></div></div>
    <ErrorBox error={series.error || sitesQ.error} />
    {!sites.length ? <Card>{sitesQ.loading ? <Skeleton /> : <Empty title="No websites" text="Add a website to see its history." />}</Card> : <>
      <Card title="Response time" subtitle="Average and slowest successful check per period"><LineChart tz={tz} unit=" ms" series={[{ name: 'Average', color: '#4f65e8', points: sr.map(x => ({ x: x.t, y: x.avg_ms })) }, { name: 'Slowest', color: '#d84c55', points: sr.map(x => ({ x: x.t, y: x.max_ms })) }]} /></Card>
      <Card title="Uptime %" subtitle="Share of checks that passed"><LineChart tz={tz} unit="%" max={100} series={[{ name: 'Uptime', color: '#16865d', points: sr.map(x => ({ x: x.t, y: x.uptime_pct })) }]} /></Card>
      <Card title={`Lighthouse scores (${device})`} subtitle="Each point is a saved audit"><LineChart tz={tz} max={100} series={[{ name: 'Performance', color: '#4f65e8', points: a.map(x => ({ x: x.audited_at, y: x.performance_score })) }, { name: 'Accessibility', color: '#c98512', points: a.map(x => ({ x: x.audited_at, y: x.accessibility_score })) }, { name: 'Best Practices', color: '#8250df', points: a.map(x => ({ x: x.audited_at, y: x.best_practices_score })) }, { name: 'SEO', color: '#16865d', points: a.map(x => ({ x: x.audited_at, y: x.seo_score })) }]} /></Card>
      <Card title={`Largest Contentful Paint (${device})`}><LineChart tz={tz} unit=" ms" series={[{ name: 'LCP', color: '#d84c55', points: a.map(x => ({ x: x.audited_at, y: x.lcp_ms })) }]} /></Card></>}</div>;
}
