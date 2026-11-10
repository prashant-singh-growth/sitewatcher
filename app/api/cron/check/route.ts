import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runMonitoring } from '@/modules/monitoring/engine';
import { runDueSpeedTests } from '@/modules/speedtest/service';
import { runDueReports } from '@/modules/reports/service';
import { runDueSitemaps } from '@/modules/sitemaps/service';
import { runDueRobotsChecks } from '@/modules/robots/service';
import { runDueIndexabilityChecks } from '@/modules/indexability/service';
export const dynamic = 'force-dynamic';
export const maxDuration = 110;

function secretOk(supplied: string | null) {
  const expected = process.env.CRON_SECRET;
  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
/**
 * The ONE Hostinger cron entry point (every minute). Order: uptime checks first (they are the priority),
 * then due speed-test schedules and due email reports if enough of the request time remains.
 */
async function handler(req: NextRequest) {
  if (!secretOk(req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const started = Date.now();
  try {
    const monitoring = await runMonitoring('cron');
    const extras: Record<string, unknown> = {};
    try { extras.speedTests = await runDueSpeedTests(started); } catch (e) { console.error('[SiteWatch] speed-test dispatch failed:', e); extras.speedTests = { error: true }; }
    try { extras.sitemaps = await runDueSitemaps(started); } catch (e) { console.error('[SiteWatch] sitemap dispatch failed:', e); extras.sitemaps = { error: true }; }
    try { extras.robots = await runDueRobotsChecks(started); } catch (e) { console.error('[SiteWatch] robots dispatch failed:', e); extras.robots = { error: true }; }
    try { extras.indexability = await runDueIndexabilityChecks(new Date(started)); } catch (e) { console.error('[SiteWatch] indexability dispatch failed:', e); extras.indexability = { error: true }; }
    try { extras.reports = await runDueReports(started); } catch (e) { console.error('[SiteWatch] report dispatch failed:', e); extras.reports = { error: true }; }
    return NextResponse.json({ ok: true, ...monitoring, ...extras, timestamp: new Date().toISOString() });
  } catch (e) { console.error('[SiteWatch] Cron check failed:', e); return NextResponse.json({ error: 'Monitoring run failed.' }, { status: 500 }); }
}
export const GET = handler;
export const POST = handler;
