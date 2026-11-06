'use client';
import { useEffect, useState } from 'react';
import { useApp } from '../../ui/context';
import { Badge, Btn, Card, ErrorBox, Field, Input, Skeleton, call, useAsync, useToast } from '../../ui/kit';

export default function Settings() {
  const { user, can } = useApp(); const toast = useToast();
  const [p, setP] = useState({ display_name: user.name, timezone: user.timezone }); const [pw, setPw] = useState({ current: '', next: '' }); const [busy, setBusy] = useState('');
  const sys = useAsync(() => (can.manageSettings ? call('/api/settings') : Promise.resolve(null)), [can.manageSettings]);
  const [vals, setVals] = useState<Record<string, string>>({}); useEffect(() => { if (sys.data) setVals(Object.fromEntries(sys.data.settings.map((s: any) => [s.key, String(s.value)]))); }, [sys.data]);
  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => { setBusy(id); try { await fn(); toast(ok); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'err'); } finally { setBusy(''); } };
  return <div className="sw-page"><div className="sw-page-head"><div><p className="eyebrow">ADMINISTRATION</p><h1>Settings</h1></div></div>
    <Card title="Your profile" subtitle={`${user.email}`}><form className="sw-form cols" onSubmit={e => { e.preventDefault(); act('profile', async () => { await call('/api/auth/profile', 'PATCH', p); }, 'Profile saved. Reload to see the new timezone everywhere.'); }}>
      <Field label="Name"><Input required value={p.display_name} onChange={e => setP({ ...p, display_name: e.target.value })} /></Field><Field label="Timezone" hint="All dates are stored in UTC and shown in this timezone. e.g. Asia/Kolkata, Europe/London"><Input required value={p.timezone} onChange={e => setP({ ...p, timezone: e.target.value })} /></Field>
      <div className="sw-form-actions"><Btn busy={busy === 'profile'}>Save profile</Btn></div></form></Card>
    <Card title="Change password" subtitle="You stay signed in here; all other sessions are signed out."><form className="sw-form cols" onSubmit={e => { e.preventDefault(); act('pw', async () => { await call('/api/auth/profile', 'PATCH', { current_password: pw.current, new_password: pw.next }); setPw({ current: '', next: '' }); }, 'Password changed.'); }}>
      <Field label="Current password"><Input type="password" autoComplete="current-password" required value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></Field><Field label="New password" hint="At least 12 characters"><Input type="password" autoComplete="new-password" minLength={12} required value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></Field>
      <div className="sw-form-actions"><Btn busy={busy === 'pw'}>Change password</Btn></div></form></Card>
    {can.manageSettings && <>{sys.loading && !sys.data ? <Skeleton /> : sys.data && <><Card title="Platform settings" subtitle="Limits for the monitoring dispatcher on this server."><ErrorBox error={sys.error} />
      <form className="sw-form cols" onSubmit={e => { e.preventDefault(); act('sys', () => call('/api/settings', 'PATCH', Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v)]))), 'Settings saved.'); }}>
        {sys.data.settings.map((s: any) => <Field key={s.key} label={s.label} hint={`${s.min} to ${s.max}`}><Input type="number" min={s.min} max={s.max} value={vals[s.key] ?? ''} onChange={e => setVals({ ...vals, [s.key]: e.target.value })} /></Field>)}<div className="sw-form-actions"><Btn busy={busy === 'sys'}>Save platform settings</Btn></div></form></Card>
      <Card title="Integrations" subtitle="Configured with environment variables on the server (never shown here)."><div className="sw-chips"><span>Google PageSpeed API key {sys.data.integrations.pagespeedKey ? <Badge tone="green">configured</Badge> : <Badge tone="red">missing</Badge>}</span><span>SMTP email {sys.data.integrations.smtp ? <Badge tone="green">configured</Badge> : <Badge tone="red">missing</Badge>}</span><span>Cron secret {sys.data.integrations.cronSecret ? <Badge tone="green">configured</Badge> : <Badge tone="red">missing</Badge>}</span></div></Card></>}</>}</div>;
}
