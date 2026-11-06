'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from '../../ui/context';
import { Badge, Btn, Card, Empty, Field, Input, Modal, Table, call, fmtMs, useToast } from '../../ui/kit';

export default function Projects() {
  const { projects, can, reloadProjects, setProjectId } = useApp(); const toast = useToast();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', client_name: '', primary_domain: '', logo_url: '', description: '' });
  const create = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { const d = await call('/api/projects', 'POST', Object.fromEntries(Object.entries(f).filter(([, v]) => v))); await reloadProjects(); setProjectId(d.id); toast('Project created.'); setOpen(false); setF({ name: '', client_name: '', primary_domain: '', logo_url: '', description: '' }); } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'err'); } finally { setBusy(false); } };
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">MAIN</p><h1>Projects</h1><p className="muted">Each client or product is a project. Websites, reports and team access all belong to a project.</p></div>{can.createProject && <Btn onClick={() => setOpen(true)}>＋ New project</Btn>}</div>
    <Card flush>{!projects.length ? <Empty title="No projects" text={can.createProject ? 'Create your first project to add websites.' : 'You have not been added to any project yet.'} action={can.createProject ? <Btn onClick={() => setOpen(true)}>Create project</Btn> : undefined} /> :
      <Table head={['Project', 'Status', 'Websites', 'Up / Down', 'Avg response', 'Incidents', 'Members', 'Your role']}>{projects.map(p => <tr key={p.id}><td><Link className="sw-link" href={`/projects/${p.id}`}>{p.name}</Link><div className="muted small">{p.client_name || p.primary_domain || '—'}</div></td>
        <td><Badge tone={p.status === 'active' ? 'green' : p.status === 'paused' ? 'amber' : 'gray'}>{p.status}</Badge></td><td>{p.site_count}</td><td><span className="green">{p.up_count}</span> / <span className={Number(p.down_count) ? 'red' : ''}>{p.down_count}</span></td><td>{fmtMs(p.avg_response_ms)}</td><td>{Number(p.open_incidents) ? <Badge tone="red">{p.open_incidents}</Badge> : '0'}</td><td>{p.member_count}</td><td className="muted">{p.my_role}</td></tr>)}</Table>}</Card>
    {open && <Modal title="New project" onClose={() => setOpen(false)}><form className="sw-form" onSubmit={create}>
      <Field label="Project name"><Input required maxLength={160} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="GrowthCX" /></Field>
      <Field label="Client / company"><Input maxLength={160} value={f.client_name} onChange={e => setF({ ...f, client_name: e.target.value })} /></Field>
      <Field label="Primary domain (optional)"><Input value={f.primary_domain} onChange={e => setF({ ...f, primary_domain: e.target.value })} placeholder="growth.cx" /></Field>
      <Field label="Logo URL (optional)" hint="Public PNG or JPEG. Used on PDF reports."><Input type="url" value={f.logo_url} onChange={e => setF({ ...f, logo_url: e.target.value })} /></Field>
      <Field label="Description"><textarea className="sw-input" rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <div className="sw-form-actions"><Btn kind="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn><Btn busy={busy}>Create project</Btn></div></form></Modal>}</div>;
}
