'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function LoginForm() {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Login failed'); router.replace('/'); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Login failed'); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="form-stack"><label>Username or email<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>{error && <p className="error-text">{error}</p>}<button className="primary-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>;
}
