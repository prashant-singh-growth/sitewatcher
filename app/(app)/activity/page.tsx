'use client';
import { useState } from 'react';
import { useApp } from '../../ui/context';
import { Btn, Card, Empty, ErrorBox, Field, Input, Select, Skeleton, Table, call, fmtDate, useAsync } from '../../ui/kit';

const GROUPS = ['auth.', 'project.', 'site.', 'speedtest.', 'report.', 'user.', 'settings.'];
export default function Activity() {
  const { can, projects, user } = useApp(); const tz = user.timezone;
  const [f, setF] = useState({ userId: '', projectId: '', action: '', from: '', to: '' }); const [extra, setExtra] = useState<any[]>([]); const [more, setMore] = useState<number | null>(null);
  const users = useAsync(() => (can.manageUsers ? call('/api/users') : Promise.resolve(null)), []);
  const qs = (before?: number) => new URLSearchParams({ limit: '50', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, k === 'from' || k === 'to' ? new Date(v as string).toISOString() : v])), ...(before ? { before: String(before) } : {}) }).toString();
  const q = useAsync(async () => { if (!can.viewActivity) return null; const d = await call(`/api/activity?${qs()}`); setExtra([]); setMore(d.nextBefore); return d; }, [f.userId, f.projectId, f.action, f.from, f.to, can.viewActivity]);
  if (!can.viewActivity) return <div className="sw-page"><Empty title="Not available" text="Activity logs are visible to managers and the Master Admin." /></div>;
  const logs = [...(q.data?.logs ?? []), ...extra];
  const loadMore = async () => { const d = await call(`/api/activity?${qs(more!)}`); setExtra(x => [...x, ...d.logs]); setMore(d.nextBefore); };
  const detail = (l: any) => { const m = l.metadata; if (!m) return ''; if (m.changes) return Object.entries<any>(m.changes).map(([k, v]) => `${k}: ${v.from ?? '∅'} → ${v.to ?? '∅'}`).join('; ').slice(0, 140); return Object.entries(m).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ').slice(0, 140); };
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">ANALYTICS</p><h1>Activity Logs</h1><p className="muted">{user.role === 'super_admin' ? 'Everything people do on the platform.' : 'Activity in the projects you manage.'} Logs are read-only.</p></div></div>
    <Card><div className="sw-form cols">{users.data && <Field label="User"><Select value={f.userId} onChange={e => setF({ ...f, userId: e.target.value })}><option value="">Everyone</option>{users.data.users.map((u: any) => <option key={u.id} value={u.id}>{u.display_name}</option>)}</Select></Field>}
      <Field label="Project"><Select value={f.projectId} onChange={e => setF({ ...f, projectId: e.target.value })}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Action type"><Select value={f.action} onChange={e => setF({ ...f, action: e.target.value })}><option value="">All actions</option>{GROUPS.map(g => <option key={g} value={g}>{g}*</option>)}</Select></Field>
      <Field label="From"><Input type="datetime-local" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field><Field label="To"><Input type="datetime-local" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field></div></Card>
    <ErrorBox error={q.error} retry={q.reload} />
    <Card flush>{q.loading && !q.data ? <Skeleton rows={5} /> : !logs.length ? <Empty title="No activity found" text="Try widening the filters." /> : <><Table head={['When', 'User', 'Action', 'Project', 'Details', ...(user.role === 'super_admin' ? ['IP'] : [])]}>{logs.map(l => <tr key={l.id}><td className="muted">{fmtDate(l.created_at, tz)}</td><td>{l.user_name || <span className="muted">system</span>}</td><td><code>{l.action}</code></td><td>{l.project_name || '—'}</td><td className="muted small">{detail(l)}</td>{user.role === 'super_admin' && <td className="muted small">{l.ip_address || ''}</td>}</tr>)}</Table>{more && <div className="pad center"><Btn kind="ghost" onClick={loadMore}>Load older activity</Btn></div>}</>}</Card></div>;
}
