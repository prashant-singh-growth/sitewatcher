'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from '../../ui/context';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Kpi, Modal, Select, Skeleton, StatusBadge, Table, call, fmtMs, ago, toLocalInput, useAsync, useToast, scoreTone } from '../../ui/kit';

const PRESETS = [1, 2, 5, 10, 15, 30, 60];
const blank = { name: '', url: '', interval: '', custom: '', timeout_ms: '', retry_count: '', retry_delay_ms: '', http_method: '', expected_status: '', alert_on_down: '', alert_on_recovery: '', m_start: '', m_end: '' };
const num = (v: string) => (v === '' ? null : Number(v));

export default function Websites() {
  const { project, projectId, canWrite, reloadProjects } = useApp(); const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => (projectId ? call(`/api/sites?projectId=${projectId}`) : Promise.resolve({ sites: [] })), [projectId]);
  const [edit, setEdit] = useState<any>(null); const [f, setF] = useState<any>(blank); const [busy, setBusy] = useState(false);
  const sites: any[] = data?.sites ?? [];
  const openForm = (s: any | null) => { setEdit(s ?? 'new'); setF(!s ? blank : { name: s.name, url: s.url, interval: s.o_interval_minutes == null ? '' : PRESETS.includes(s.o_interval_minutes) ? String(s.o_interval_minutes) : 'custom', custom: s.o_interval_minutes && !PRESETS.includes(s.o_interval_minutes) ? String(s.o_interval_minutes) : '',
    timeout_ms: s.o_timeout_ms ?? '', retry_count: s.o_retry_count ?? '', retry_delay_ms: s.o_retry_delay_ms ?? '', http_method: s.o_http_method ?? '', expected_status: s.o_expected_status ?? '', alert_on_down: s.o_alert_on_down == null ? '' : String(s.o_alert_on_down), alert_on_recovery: s.o_alert_on_recovery == null ? '' : String(s.o_alert_on_recovery),
    m_start: s.maintenance_start ? toLocalInput(new Date(s.maintenance_start)) : '', m_end: s.maintenance_end ? toLocalInput(new Date(s.maintenance_end)) : '' }); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const body: any = { name: f.name, url: f.url, interval_minutes: f.interval === 'custom' ? num(f.custom) : num(f.interval), timeout_ms: num(f.timeout_ms), retry_count: num(f.retry_count), retry_delay_ms: num(f.retry_delay_ms), http_method: f.http_method || null, expected_status: f.expected_status || null,
      alert_on_down: f.alert_on_down === '' ? null : f.alert_on_down === '1', alert_on_recovery: f.alert_on_recovery === '' ? null : f.alert_on_recovery === '1',
      maintenance_start: f.m_start && f.m_end ? new Date(f.m_start).toISOString() : null, maintenance_end: f.m_start && f.m_end ? new Date(f.m_end).toISOString() : null };
    try { if (edit === 'new') await call('/api/sites', 'POST', { ...body, projectId }); else await call(`/api/sites/${edit.id}`, 'PATCH', body); toast(edit === 'new' ? 'Website added. It is checked on the next cron run.' : 'Website updated.'); setEdit(null); await Promise.all([reload(true as any), reloadProjects()]); }
    catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'err'); } finally { setBusy(false); }
  };
  const act = async (s: any, what: 'toggle' | 'delete') => { if (what === 'delete' && !confirm(`Remove ${s.name}? History is kept for reports and the URL can be added again later.`)) return; try { await (what === 'delete' ? call(`/api/sites/${s.id}`, 'DELETE') : call(`/api/sites/${s.id}`, 'PATCH', { action: 'toggle' })); await Promise.all([reload(true as any), reloadProjects()]); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } };
  const up = sites.filter(s => s.is_active && s.is_up === 1).length, down = sites.filter(s => s.is_active && s.is_up === 0).length;
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">MAIN</p><h1>Websites</h1><p className="muted">{project ? `Websites in ${project.name}. Each can have its own schedule.` : 'Select a project to see its websites.'}</p></div>{canWrite && <Btn onClick={() => openForm(null)}>＋ Add website</Btn>}</div>
    <ErrorBox error={error} retry={reload} />
    <div className="sw-kpis"><Kpi label="WEBSITES" value={sites.length} /><Kpi label="OPERATIONAL" value={up} tone="green" /><Kpi label="DOWN" value={down} tone="red" /><Kpi label="OPEN INCIDENTS" value={sites.reduce((a, s) => a + Number(s.open_incidents), 0)} tone="amber" /></div>
    <Card flush>{loading && !data ? <Skeleton rows={4} /> : !project ? <Empty title="No project selected" text="Create a project (Projects page) or ask for access." /> : !sites.length ? <Empty title="No websites in this project" text={canWrite ? 'Add your first URL to start monitoring.' : 'A project manager can add websites.'} action={canWrite ? <Btn onClick={() => openForm(null)}>Add website</Btn> : undefined} /> :
      <Table head={['Website', 'Status', 'Response', 'Every', 'Perf (M / D)', 'Last checked', '']}>{sites.map(s => <tr key={s.id}>
        <td><Link href={`/websites/${s.id}`} className="sw-link">{s.name}</Link><div className="muted small"><a href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a></div></td><td><StatusBadge active={s.is_active} up={s.is_up} /></td><td>{fmtMs(s.response_ms)}</td>
        <td>{s.eff_interval_minutes} min{s.o_interval_minutes == null && <span className="muted small"> default</span>}</td>
        <td>{s.mobile_perf == null ? '—' : <Badge tone={scoreTone(s.mobile_perf) as any}>{s.mobile_perf}</Badge>} {s.desktop_perf == null ? '' : <Badge tone={scoreTone(s.desktop_perf) as any}>{s.desktop_perf}</Badge>}</td><td className="muted">{ago(s.last_checked)}</td>
        <td>{canWrite && <div className="row-actions"><button title="Edit" onClick={() => openForm(s)}>✎</button><button title={s.is_active ? 'Pause' : 'Resume'} onClick={() => act(s, 'toggle')}>{s.is_active ? 'Ⅱ' : '▶'}</button><button title="Remove" onClick={() => act(s, 'delete')}>×</button></div>}</td></tr>)}</Table>}</Card>
    {edit && <Modal wide title={edit === 'new' ? 'Add website' : `Edit ${edit.name}`} onClose={() => setEdit(null)}><form className="sw-form cols" onSubmit={save}>
      <Field label="Display name"><Input required maxLength={120} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="URL" hint="Public http(s) URL. Private and internal addresses are blocked."><Input required type="url" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></Field>
      <div className="sw-sub full"><h3>Monitoring overrides</h3><p className="muted">Leave a field on “Project default” to inherit it.</p></div>
      <Field label="Check interval"><Select value={f.interval} onChange={e => setF({ ...f, interval: e.target.value })}><option value="">Project default</option>{PRESETS.map(i => <option key={i} value={i}>{i < 60 ? `${i} minute${i > 1 ? 's' : ''}` : '1 hour'}</option>)}<option value="custom">Custom…</option></Select></Field>
      {f.interval === 'custom' && <Field label="Custom interval (minutes)" hint="1 to 1440"><Input type="number" min={1} max={1440} required value={f.custom} onChange={e => setF({ ...f, custom: e.target.value })} /></Field>}
      <Field label="Timeout (ms)"><Input type="number" min={2000} max={30000} placeholder="Project default" value={f.timeout_ms} onChange={e => setF({ ...f, timeout_ms: e.target.value })} /></Field>
      <Field label="Retries"><Input type="number" min={0} max={3} placeholder="Project default" value={f.retry_count} onChange={e => setF({ ...f, retry_count: e.target.value })} /></Field>
      <Field label="Retry delay (ms)"><Input type="number" min={0} max={10000} placeholder="Project default" value={f.retry_delay_ms} onChange={e => setF({ ...f, retry_delay_ms: e.target.value })} /></Field>
      <Field label="HTTP method"><Select value={f.http_method} onChange={e => setF({ ...f, http_method: e.target.value })}><option value="">Project default</option><option>GET</option><option>HEAD</option></Select></Field>
      <Field label="Expected status codes"><Input placeholder="Project default (e.g. 200-399)" value={f.expected_status} onChange={e => setF({ ...f, expected_status: e.target.value })} /></Field>
      <Field label="Down alerts"><Select value={f.alert_on_down} onChange={e => setF({ ...f, alert_on_down: e.target.value })}><option value="">Project default</option><option value="1">On</option><option value="0">Off</option></Select></Field>
      <Field label="Recovery alerts"><Select value={f.alert_on_recovery} onChange={e => setF({ ...f, alert_on_recovery: e.target.value })}><option value="">Project default</option><option value="1">On</option><option value="0">Off</option></Select></Field>
      <Field label="Maintenance window start" hint="No checks or alerts during the window"><Input type="datetime-local" value={f.m_start} onChange={e => setF({ ...f, m_start: e.target.value })} /></Field>
      <Field label="Maintenance window end"><Input type="datetime-local" value={f.m_end} onChange={e => setF({ ...f, m_end: e.target.value })} /></Field>
      <div className="sw-form-actions"><Btn kind="ghost" type="button" onClick={() => setEdit(null)}>Cancel</Btn><Btn busy={busy}>{edit === 'new' ? 'Add website' : 'Save changes'}</Btn></div></form></Modal>}</div>;
}
