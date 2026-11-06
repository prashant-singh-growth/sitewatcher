'use client';
import { useState } from 'react';
import { useApp } from '../../ui/context';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Modal, Select, Skeleton, Table, call, fmtDate, useAsync, useToast } from '../../ui/kit';

const ROLES: Record<string, string> = { super_admin: 'Master Admin', manager: 'Manager', member: 'Member' };
export default function Users() {
  const { can, user: me, projects } = useApp(); const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => (can.manageUsers ? call('/api/users') : Promise.resolve(null)), []);
  const [modal, setModal] = useState<null | 'new' | any>(null); const [f, setF] = useState<any>({}); const [busy, setBusy] = useState(false); const [detail, setDetail] = useState<any>(null); const [assign, setAssign] = useState({ projectId: '', role: 'member' });
  if (!can.manageUsers) return <Empty title="Not available" text="Only the Master Admin can manage users." />;
  const openNew = () => { setF({ role: 'member', timezone: 'UTC' }); setModal('new'); };
  const openEdit = async (u: any) => { setF({ display_name: u.display_name, email: u.email, role: u.role, status: u.status, timezone: u.timezone, password: '' }); setModal(u); setDetail(null); setDetail(await call(`/api/users/${u.id}`).catch(() => null)); };
  const run = async (fn: () => Promise<unknown>, ok: string, close = true) => { setBusy(true); try { await fn(); toast(ok); if (close) setModal(null); await reload(true as any); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(false); } };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (modal === 'new') run(() => call('/api/users', 'POST', f), 'User created.'); else { const body: any = { ...f }; if (!body.password) delete body.password; run(() => call(`/api/users/${modal.id}`, 'PATCH', body), 'User updated.'); } };
  const refreshDetail = async () => setDetail(await call(`/api/users/${modal.id}`).catch(() => null));
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">ADMINISTRATION</p><h1>User Management</h1><p className="muted">Create people, set their role, suspend access and assign projects.</p></div><Btn onClick={openNew}>＋ New user</Btn></div>
    <ErrorBox error={error} retry={reload} />
    <Card flush>{loading && !data ? <Skeleton /> : <Table head={['User', 'Role', 'Status', 'Projects', 'Last sign-in', '']}>{data?.users.map((u: any) => <tr key={u.id}><td><b>{u.display_name}</b><div className="muted small">{u.email} · @{u.username}</div></td><td><Badge tone={u.role === 'super_admin' ? 'blue' : 'gray'}>{ROLES[u.role]}</Badge></td><td><Badge tone={u.status === 'active' ? 'green' : 'amber'}>{u.status}</Badge></td><td>{u.project_count}</td><td className="muted">{fmtDate(u.last_login_at, me.timezone)}</td><td><button className="text-btn" onClick={() => openEdit(u)}>Manage</button></td></tr>)}</Table>}</Card>
    {modal && <Modal title={modal === 'new' ? 'New user' : `Manage ${modal.display_name}`} onClose={() => setModal(null)} wide>
      <form className="sw-form cols" onSubmit={submit}>
        <Field label="Full name"><Input required value={f.display_name || ''} onChange={e => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="Email"><Input required type="email" value={f.email || ''} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        {modal === 'new' && <Field label="Username" hint="Letters, numbers, . _ -"><Input required minLength={3} value={f.username || ''} onChange={e => setF({ ...f, username: e.target.value })} /></Field>}
        <Field label="Role"><Select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="member">Member</option><option value="manager">Manager</option><option value="super_admin">Master Admin</option></Select></Field>
        {modal !== 'new' && <Field label="Status"><Select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} disabled={modal.id === me.id}><option value="active">Active</option><option value="suspended">Suspended</option></Select></Field>}
        <Field label="Timezone"><Input value={f.timezone || ''} onChange={e => setF({ ...f, timezone: e.target.value })} placeholder="Asia/Kolkata" /></Field>
        <Field label={modal === 'new' ? 'Password' : 'Reset password (optional)'} hint="At least 12 characters. Resetting signs the user out everywhere."><Input type="password" autoComplete="new-password" minLength={12} required={modal === 'new'} value={f.password || ''} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
        <div className="sw-form-actions"><Btn busy={busy}>{modal === 'new' ? 'Create user' : 'Save changes'}</Btn>{modal !== 'new' && modal.id !== me.id && <Btn type="button" kind="danger" onClick={() => confirm(`Delete ${modal.display_name}? Their access is removed; their audit history is kept.`) && run(() => call(`/api/users/${modal.id}`, 'DELETE'), 'User deleted.')}>Delete user</Btn>}</div></form>
      {modal !== 'new' && <div className="sw-sub"><h3>Project access</h3>{!detail ? <Skeleton rows={2} /> : <>
        {detail.projects.length ? <Table head={['Project', 'Role', '']}>{detail.projects.map((p: any) => <tr key={p.id}><td>{p.name}</td><td>{p.role}</td><td><button className="text-btn danger" onClick={() => run(async () => { await call(`/api/projects/${p.id}/members/${modal.id}`, 'DELETE'); await refreshDetail(); }, 'Removed from project.', false)}>Remove</button></td></tr>)}</Table> : <p className="muted">Not assigned to any project.</p>}
        <div className="sw-inline-form"><Select value={assign.projectId} onChange={e => setAssign({ ...assign, projectId: e.target.value })} aria-label="Project"><option value="">Assign to project…</option>{projects.filter(p => !detail.projects.some((x: any) => x.id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><Select value={assign.role} onChange={e => setAssign({ ...assign, role: e.target.value })} aria-label="Project role"><option value="member">Member</option><option value="manager">Manager</option></Select>
          <Btn type="button" kind="ghost" disabled={!assign.projectId} onClick={() => run(async () => { await call(`/api/projects/${assign.projectId}/members`, 'POST', { email: modal.email, role: assign.role }); await refreshDetail(); }, 'Assigned.', false)}>Assign</Btn></div></>}</div>}
    </Modal>}</div>;
}
