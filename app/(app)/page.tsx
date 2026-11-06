'use client';
import Link from 'next/link';
import { useApp } from '../ui/context';
import { Badge, Card, Empty, ErrorBox, Kpi, Skeleton, Table, call, fmtDate, fmtMs, useAsync, ago } from '../ui/kit';

const ROLE = { super_admin: 'Master Admin dashboard', manager: 'Project Manager dashboard', member: 'Member dashboard' } as Record<string, string>;
export default function Overview() {
  const { user, tz } = { ...useApp(), tz: useApp().user.timezone };
  const { data, error, loading, reload } = useAsync(() => call('/api/overview'), []);
  if (loading && !data) return <Skeleton rows={6} />;
  const projects: any[] = data?.projects ?? []; const p = data?.platform;
  const sum = projects.reduce((a, x) => ({ sites: a.sites + Number(x.site_count), up: a.up + Number(x.up_count), down: a.down + Number(x.down_count), inc: a.inc + Number(x.open_incidents) }), { sites: 0, up: 0, down: 0, inc: 0 });
  return <div className="sw-page">
    <div className="sw-page-head"><div><p className="eyebrow">{ROLE[user.role]}</p><h1>Welcome back, {user.name.split(' ')[0]}</h1><p className="muted">Live health of {user.role === 'super_admin' ? 'every project on the platform' : 'the projects you can access'}.</p></div></div>
    <ErrorBox error={error} retry={reload} />
    <div className="sw-kpis">
      {p && <><Kpi label="USERS" value={p.users} note={`${p.suspended} suspended`} /><Kpi label="PROJECTS" value={p.projects} note="Not archived" /></>}
      <Kpi label="WEBSITES" value={sum.sites} note={p ? `${p.checks24h} checks in 24 h` : 'In your projects'} /><Kpi label="OPERATIONAL" value={sum.up} tone="green" note="Latest check passed" /><Kpi label="DOWN" value={sum.down} tone="red" note="Latest check failed" /><Kpi label="OPEN INCIDENTS" value={sum.inc} tone="amber" note="Awaiting recovery" />
      {p && <Kpi label="SPEED TESTS (7 D)" value={p.audits7d} />}</div>
    <div className="sw-grid-2">
      <Card title="Projects" subtitle="Aggregated health" flush actions={<Link href="/projects" className="text-btn">View all</Link>}>
        {!projects.length ? <Empty title="No projects yet" text={user.role === 'member' ? 'Ask an administrator to add you to a project.' : 'Create a project to start monitoring websites.'} /> :
          <Table head={['Project', 'Sites', 'Up / Down', 'Avg response', 'Incidents']}>{projects.map(x => <tr key={x.id}><td><Link href={`/projects/${x.id}`} className="sw-link">{x.name}</Link><div className="muted small">{x.client_name || '—'}</div></td><td>{x.site_count}</td><td><span className="green">{x.up_count}</span> / <span className={Number(x.down_count) ? 'red' : ''}>{x.down_count}</span></td><td>{fmtMs(x.avg_response_ms)}</td><td>{Number(x.open_incidents) ? <Badge tone="red">{x.open_incidents} open</Badge> : <Badge tone="green">None</Badge>}</td></tr>)}</Table>}
      </Card>
      <Card title="Open incidents" flush>{!data?.openIncidents?.length ? <Empty title="All clear" text="No websites are currently down." /> :
        <Table head={['Website', 'Since', 'Error']}>{data.openIncidents.map((i: any) => <tr key={i.id}><td><Link href={`/websites/${i.site_id}`} className="sw-link">{i.site_name}</Link><div className="muted small">{i.project_name}</div></td><td>{ago(i.started_at)}</td><td className="muted small">{(i.last_error || '').slice(0, 70)}</td></tr>)}</Table>}</Card>
      <Card title="Recent speed tests" flush actions={<Link href="/speed-test" className="text-btn">Open Speed Test</Link>}>{!data?.recentSpeed?.length ? <Empty title="No speed tests yet" text="Run one from the Speed Test page." /> :
        <Table head={['Website', 'Device', 'Performance', 'When']}>{data.recentSpeed.map((a: any) => <tr key={a.id}><td>{a.site_name}<div className="muted small">{a.project_name}</div></td><td>{a.device}</td><td>{a.status === 'failed' ? <Badge tone="red">Failed</Badge> : <b>{a.performance_score ?? '—'}</b>}</td><td className="muted">{ago(a.audited_at)}</td></tr>)}</Table>}</Card>
      {data?.activity && <Card title={user.role === 'super_admin' ? 'Platform activity' : 'Project activity'} flush actions={<Link href="/activity" className="text-btn">All activity</Link>}><Table head={['Who', 'Action', 'Project', 'When']}>{data.activity.map((a: any) => <tr key={a.id}><td>{a.user_name || 'system'}</td><td><code>{a.action}</code></td><td className="muted">{a.project_name || '—'}</td><td className="muted">{ago(a.created_at)}</td></tr>)}</Table></Card>}
      {data?.cron && <Card title="Cron dispatcher" subtitle="Last runs" flush actions={<Link href="/cron-monitor" className="text-btn">Details</Link>}>{!data.cron.length ? <Empty title="No cron runs recorded" text="Check the Hostinger Cron Job." /> : <Table head={['Started', 'Due', 'Checked', 'Up / Down', 'Duration']}>{data.cron.map((c: any) => <tr key={c.id}><td>{fmtDate(c.started_at, tz)}</td><td>{c.due_count}</td><td>{c.checked}</td><td>{c.up_count} / {c.down_count}</td><td>{c.duration_ms == null ? '—' : `${c.duration_ms} ms`}</td></tr>)}</Table>}</Card>}
    </div></div>;
}
