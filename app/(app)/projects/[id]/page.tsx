'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from '../../../ui/context';
import MembersPanel from '../../../ui/members';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Kpi, Select, Skeleton, StatusBadge, Table, Tabs, call, fmtMs, ago, useAsync, useToast, scoreTone } from '../../../ui/kit';

export default function ProjectDetail() {
  const id = Number(useParams<{ id: string }>().id); const { reloadProjects, setProjectId } = useApp(); const toast = useToast();
  const [tab, setTab] = useState('overview'); useEffect(() => setProjectId(id), [id, setProjectId]);
  const proj = useAsync(() => call(`/api/projects/${id}`), [id]); const sites = useAsync(() => call(`/api/sites?projectId=${id}`), [id]);
  const p = proj.data?.project, s = proj.data?.settings, can = (x: string) => proj.data?.permissions?.includes(x);
  const [d, setD] = useState<any>(null); const [det, setDet] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) setD({ interval_minutes: s.interval_minutes, timeout_ms: s.timeout_ms, retry_count: s.retry_count, retry_delay_ms: s.retry_delay_ms, http_method: s.http_method, expected_status: s.expected_status, alert_on_down: !!s.alert_on_down, alert_on_recovery: !!s.alert_on_recovery, alert_emails: s.alert_emails || '' }); if (p) setDet({ name: p.name, client_name: p.client_name || '', primary_domain: p.primary_domain || '', logo_url: p.logo_url || '', description: p.description || '', status: p.status }); }, [s, p]);
  const save = async (body: any, ok: string) => { setBusy(true); try { await call(`/api/projects/${id}`, 'PATCH', body); toast(ok); await Promise.all([proj.reload(), reloadProjects()]); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); } };
  if (proj.loading && !p) return <Skeleton rows={5} />;
  if (proj.error) return <ErrorBox error={proj.error} retry={proj.reload} />;
  const list: any[] = sites.data?.sites ?? []; const up = list.filter(x => x.is_active && x.is_up === 1).length, down = list.filter(x => x.is_active && x.is_up === 0).length;
  const resp = list.filter(x => x.is_up === 1 && x.response_ms != null); const avg = resp.length ? Math.round(resp.reduce((a, x) => a + x.response_ms, 0) / resp.length) : null;
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">PROJECT</p><h1>{p.name} <Badge tone={p.status === 'active' ? 'green' : p.status === 'paused' ? 'amber' : 'gray'}>{p.status}</Badge></h1><p className="muted">{[p.client_name, p.primary_domain].filter(Boolean).join(' · ') || 'No client details yet'}</p></div>
    <div className="sw-actions"><Link className="sw-btn ghost" href="/websites">Manage websites</Link><Link className="sw-btn ghost" href="/reports">Reports</Link></div></div>
    <Tabs value={tab} onChange={setTab} tabs={[['overview', 'Overview'], ['members', 'Members'], ['defaults', 'Monitoring defaults'], ['details', 'Details']]} />
    {tab === 'overview' && <><div className="sw-kpis"><Kpi label="WEBSITES" value={list.length} /><Kpi label="OPERATIONAL" value={up} tone="green" /><Kpi label="DOWN" value={down} tone="red" /><Kpi label="AVG RESPONSE" value={fmtMs(avg)} /><Kpi label="OPEN INCIDENTS" value={list.reduce((a, x) => a + Number(x.open_incidents), 0)} tone="amber" /></div>
      <Card title="Websites" subtitle="Latest status and Lighthouse performance" flush>{!list.length ? <Empty title="No websites in this project" text="Add websites on the Websites page." /> :
        <Table head={['Website', 'Status', 'Response', 'Mobile score', 'Desktop score', 'Last speed test']}>{list.map(x => <tr key={x.id}><td><Link className="sw-link" href={`/websites/${x.id}`}>{x.name}</Link><div className="muted small">{x.url}</div></td><td><StatusBadge active={x.is_active} up={x.is_up} /></td><td>{fmtMs(x.response_ms)}</td>
          <td>{x.mobile_perf == null ? <span className="muted">—</span> : <Badge tone={scoreTone(x.mobile_perf) as any}>{x.mobile_perf}</Badge>}</td><td>{x.desktop_perf == null ? <span className="muted">—</span> : <Badge tone={scoreTone(x.desktop_perf) as any}>{x.desktop_perf}</Badge>}</td><td className="muted">{ago(x.mobile_perf_at || x.desktop_perf_at)}</td></tr>)}</Table>}</Card></>}
    {tab === 'members' && <MembersPanel projectId={id} />}
    {tab === 'defaults' && d && <Card title="Monitoring defaults" subtitle="Websites inherit these unless they set their own override.">
      <form className="sw-form cols" onSubmit={e => { e.preventDefault(); save({ settings: { ...d, interval_minutes: +d.interval_minutes, timeout_ms: +d.timeout_ms, retry_count: +d.retry_count, retry_delay_ms: +d.retry_delay_ms } }, 'Defaults saved.'); }}>
        <Field label="Check interval (minutes)" hint="1 to 1440"><Input type="number" min={1} max={1440} value={d.interval_minutes} onChange={e => setD({ ...d, interval_minutes: e.target.value })} disabled={!can('site.configure')} /></Field>
        <Field label="Timeout (ms)"><Input type="number" min={2000} max={30000} value={d.timeout_ms} onChange={e => setD({ ...d, timeout_ms: e.target.value })} disabled={!can('site.configure')} /></Field>
        <Field label="Retries after a failure"><Input type="number" min={0} max={3} value={d.retry_count} onChange={e => setD({ ...d, retry_count: e.target.value })} disabled={!can('site.configure')} /></Field>
        <Field label="Retry delay (ms)"><Input type="number" min={0} max={10000} value={d.retry_delay_ms} onChange={e => setD({ ...d, retry_delay_ms: e.target.value })} disabled={!can('site.configure')} /></Field>
        <Field label="HTTP method"><Select value={d.http_method} onChange={e => setD({ ...d, http_method: e.target.value })} disabled={!can('site.configure')}><option>GET</option><option>HEAD</option></Select></Field>
        <Field label="Expected status codes" hint="e.g. 200-399 or 200,301,401"><Input value={d.expected_status} onChange={e => setD({ ...d, expected_status: e.target.value })} disabled={!can('site.configure')} /></Field>
        <Field label="Alert on downtime"><Select value={d.alert_on_down ? '1' : '0'} onChange={e => setD({ ...d, alert_on_down: e.target.value === '1' })} disabled={!can('site.configure')}><option value="1">Yes</option><option value="0">No</option></Select></Field>
        <Field label="Alert on recovery"><Select value={d.alert_on_recovery ? '1' : '0'} onChange={e => setD({ ...d, alert_on_recovery: e.target.value === '1' })} disabled={!can('site.configure')}><option value="1">Yes</option><option value="0">No</option></Select></Field>
        <Field label="Alert recipients" hint="Comma separated. Empty = the server's default ALERT_TO."><Input value={d.alert_emails} onChange={e => setD({ ...d, alert_emails: e.target.value })} disabled={!can('site.configure')} /></Field>
        {can('site.configure') ? <div className="sw-form-actions"><Btn busy={busy}>Save defaults</Btn></div> : <p className="muted">Only managers can change defaults.</p>}</form></Card>}
    {tab === 'details' && det && <Card title="Project details"><form className="sw-form cols" onSubmit={e => { e.preventDefault(); save(det, 'Project updated.'); }}>
      <Field label="Name"><Input required value={det.name} onChange={e => setDet({ ...det, name: e.target.value })} disabled={!can('project.update')} /></Field><Field label="Client"><Input value={det.client_name} onChange={e => setDet({ ...det, client_name: e.target.value })} disabled={!can('project.update')} /></Field>
      <Field label="Primary domain"><Input value={det.primary_domain} onChange={e => setDet({ ...det, primary_domain: e.target.value })} disabled={!can('project.update')} /></Field><Field label="Logo URL (PNG/JPEG)"><Input value={det.logo_url} onChange={e => setDet({ ...det, logo_url: e.target.value })} disabled={!can('project.update')} /></Field>
      <Field label="Status" hint="Paused and archived projects are not monitored. Archived is read-only."><Select value={det.status} onChange={e => setDet({ ...det, status: e.target.value })} disabled={!can('project.update')}><option value="active">Active</option><option value="paused">Paused</option><option value="archived" disabled={!can('project.archive')}>Archived</option></Select></Field>
      <Field label="Description"><textarea className="sw-input" rows={3} value={det.description} onChange={e => setDet({ ...det, description: e.target.value })} disabled={!can('project.update')} /></Field>
      {can('project.update') && <div className="sw-form-actions"><Btn busy={busy}>Save details</Btn></div>}</form></Card>}
  </div>;
}
