import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Shell from '../ui/shell';
export const dynamic = 'force-dynamic';
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getCurrentUser())) redirect('/login'); // server-side gate; every API still re-checks permissions
  return <Shell>{children}</Shell>;
}
