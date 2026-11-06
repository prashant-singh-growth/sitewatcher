import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'SiteWatch — Agency Monitoring Platform', description: 'Website uptime, speed and reporting platform for agencies.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
