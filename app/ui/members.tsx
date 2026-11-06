'use client';
import { useState } from 'react';
import { call, useToast, Btn, Input, Select, Table, Badge, Skeleton, ErrorBox, Card, Empty } from './kit';
import { useApp } from './context';
import { useAsync } from './kit';

/** Add / change / remove members of one project. The server enforces who may do this; the UI only hides controls. */
export default function MembersPanel({ projectId }: { projectId: number }) {
  const { user, reloadProjects } = useApp(); const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => call(`/api/projects/${projectId}`), [projectId]);
  const [email, setEmail] = useState(''); const [role, setRole] = useState('member'); const [busy, setBusy] = useState(false);
  const canManage = data?.permissions?.includes('project.members.manage') && data?.project?.status !== 'archived';
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); await Promise.all([reload(true as any), reloadProjects()]); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } };
  const add = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); await run(() => call(`/api/projects/${projectId}/members`, 'POST', { email, role }), 'Member added.'); setEmail(''); setBusy(false); };
  return <Card title="Team members" subtitle={data?.project ? `Who can access ${data.project.name}` : undefined}>
    <ErrorBox error={error} retry={reload} />
    {canManage && <form className="sw-inline-form" onSubmit={add}><Input type="email" required placeholder="Existing user's email" value={email} onChange={e => setEmail(e.target.value)} aria-label="Member email" /><Select value={role} onChange={e => setRole(e.target.value)} aria-label="Role"><option value="member">Member</option><option value="manager">Manager</option></Select><Btn busy={busy}>Add member</Btn></form>}
    {loading && !data ? <Skeleton /> : !data?.members?.length ? <Empty title="No members yet" text="Add people so they can see this project." /> :
      <Table head={['Name', 'Email', 'Role', '']}>{data.members.map((m: any) => <tr key={m.id}><td><b>{m.display_name}</b>{m.status === 'suspended' && <> <Badge tone="amber">Suspended</Badge></>}</td><td className="muted">{m.email}</td>
        <td>{canManage ? <Select value={m.role} onChange={e => run(() => call(`/api/projects/${projectId}/members/${m.id}`, 'PATCH', { role: e.target.value }), 'Role updated.')} aria-label={`Role of ${m.display_name}`}><option value="member">Member</option><option value="manager">Manager</option></Select> : <Badge tone={m.role === 'manager' ? 'blue' : 'gray'}>{m.role}</Badge>}</td>
        <td>{canManage && m.id !== user.id && <button className="text-btn danger" onClick={() => confirm(`Remove ${m.display_name} from this project?`) && run(() => call(`/api/projects/${projectId}/members/${m.id}`, 'DELETE'), 'Member removed.')}>Remove</button>}</td></tr>)}</Table>}
    {!canManage && data && <p className="muted pad">Only project managers can change membership.</p>}
  </Card>;
}
