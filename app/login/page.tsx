import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import LoginForm from './ui/login-form';
export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  return <main className="login-shell"><div className="login-card"><div className="brand-mark">S</div><p className="eyebrow">SITEWATCH MONITOR</p><h1>Welcome back</h1><p className="muted">Sign in to view your website health.</p><LoginForm /></div></main>;
}
