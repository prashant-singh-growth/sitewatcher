'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ALL_ITEMS, NAV } from '@/lib/nav';
import { AppProvider, useApp } from './context';
import { Icon, ToastProvider, Badge, call, useAsync } from './kit';

function Crumbs({ path }: { path: string }) {
  const seg = '/' + (path.split('/')[1] || ''); const item = ALL_ITEMS.find(i => i.href === seg);
  const detail = path.split('/').length > 2;
  return <nav className="sw-crumbs" aria-label="Breadcrumb"><span>SiteWatch</span><span>/</span>{item && (detail ? <><Link href={item.href}>{item.label}</Link><span>/</span><b>Detail</b></> : <b>{item.label}</b>)}</nav>;
}
function Search() {
  const [q, setQ] = useState(''); const [res, setRes] = useState<any>(null); const router = useRouter(); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (q.trim().length < 2) { setRes(null); return; } const t = setTimeout(() => call(`/api/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes(null)), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setRes(null); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const go = (href: string) => { setRes(null); setQ(''); router.push(href); };
  return <div className="sw-search" ref={box}><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects and websites…" aria-label="Search" />
    {res && <div className="sw-dropdown">{!res.projects.length && !res.sites.length && <p className="muted pad">No matches.</p>}
      {res.projects.map((p: any) => <button key={`p${p.id}`} onClick={() => go(`/projects/${p.id}`)}><Icon name="folder" size={15} />{p.name}<small>Project</small></button>)}
      {res.sites.map((s: any) => <button key={`s${s.id}`} onClick={() => go(`/websites/${s.id}`)}><Icon name="globe" size={15} />{s.name}<small>{s.project_name}</small></button>)}</div>}</div>;
}
function Bell() {
  const [open, setOpen] = useState(false); const { data } = useAsync(() => call('/api/overview'), []);
  const inc: any[] = data?.openIncidents ?? [];
  return <div className="sw-pop"><button className="sw-icon-btn" onClick={() => setOpen(o => !o)} aria-label={`Notifications (${inc.length} open incidents)`}><Icon name="bell" />{inc.length > 0 && <i className="sw-dot">{inc.length}</i>}</button>
    {open && <div className="sw-dropdown right" onMouseLeave={() => setOpen(false)}><p className="sw-dd-title">Open incidents</p>{!inc.length && <p className="muted pad">All systems operational.</p>}
      {inc.slice(0, 8).map(i => <Link key={i.id} href={`/websites/${i.site_id}`} onClick={() => setOpen(false)} className="sw-dd-item"><b>{i.site_name}</b><small>{i.project_name} · {(i.last_error || '').slice(0, 60)}</small></Link>)}</div>}</div>;
}
function UserMenu() {
  const { user } = useApp(); const [open, setOpen] = useState(false); const router = useRouter();
  const logout = async () => { await call('/api/auth/logout', 'POST').catch(() => undefined); location.href = '/login'; };
  return <div className="sw-pop"><button className="sw-user" onClick={() => setOpen(o => !o)} aria-label="Account menu"><span className="sw-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="sw-user-name">{user.name}</span><Icon name="chevron" size={14} /></button>
    {open && <div className="sw-dropdown right" onMouseLeave={() => setOpen(false)}><p className="sw-dd-title">{user.email}</p><div className="pad"><Badge tone="blue">{user.role === 'super_admin' ? 'Master Admin' : user.role === 'manager' ? 'Manager' : 'Member'}</Badge></div>
      <button className="sw-dd-item" onClick={() => { setOpen(false); router.push('/settings'); }}>Profile & settings</button><button className="sw-dd-item" onClick={logout}>Sign out</button></div>}</div>;
}
function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const { can, projects, projectId, setProjectId } = useApp(); const [nav, setNav] = useState(false); const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => setNav(false), [path]);
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));
  return <div className="sw-shell">
    <aside className={`sw-side ${nav ? 'open' : ''}`} aria-label="Primary"><div className="sw-brand"><div className="brand-mark small">S</div><span>SiteWatch</span></div>
      <nav>{NAV.map(sec => { const items = sec.items.filter(i => !i.gate || can[i.gate]); if (!items.length) return null; return <div key={sec.title} className="sw-nav-sec">
        <button className="sw-nav-title" onClick={() => setCollapsed(c => ({ ...c, [sec.title]: !c[sec.title] }))} aria-expanded={!collapsed[sec.title]}>{sec.title}<span className={collapsed[sec.title] ? 'rot' : ''}><Icon name="chevron" size={13} /></span></button>
        {!collapsed[sec.title] && items.map(i => <Link key={i.href} href={i.href} className={`sw-nav-item ${active(i.href) ? 'active' : ''}`} aria-current={active(i.href) ? 'page' : undefined}><Icon name={i.icon} />{i.label}</Link>)}</div>; })}</nav></aside>
    {nav && <div className="sw-scrim" onClick={() => setNav(false)} />}
    <div className="sw-main"><header className="sw-header"><button className="sw-icon-btn sw-burger" onClick={() => setNav(true)} aria-label="Open menu"><Icon name="menu" /></button><Crumbs path={path} />
      <div className="sw-header-right"><Search /><select className="sw-input sw-proj" aria-label="Active project" value={projectId ?? ''} onChange={e => setProjectId(Number(e.target.value))} disabled={!projects.length}>{!projects.length && <option value="">No projects</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.status !== 'active' ? ` (${p.status})` : ''}</option>)}</select><Bell /><UserMenu /></div></header>
      <main className="sw-content">{children}</main></div></div>;
}
export default function Shell({ children }: { children: React.ReactNode }) { return <ToastProvider><AppProvider><Frame>{children}</Frame></AppProvider></ToastProvider>; }
