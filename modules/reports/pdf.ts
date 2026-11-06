import PDFDocument from 'pdfkit';
import https from 'node:https';
import http from 'node:http';
import { safeLookup, assertPublicUrlSyntax } from '@/lib/ssrf';
import { METRICS } from '@/modules/speedtest/compare';
import type { ReportData, Section, SiteReport } from './data';

const BRAND = '#4f65e8', INK = '#172033', MUTED = '#758096', LINE = '#e8ecf3', GREEN = '#16865d', RED = '#d84c55';
const clean = (s: unknown) => String(s ?? '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
export function fmtDuration(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s`; if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}
const fmtMetric = (unit: string, v: number | null) => v == null ? 'n/a' : unit === 'ms' ? (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`) : unit === 'cls' ? v.toFixed(3) : String(Math.round(v));
const fmtChange = (unit: string, d: number | null) => d == null ? 'n/a' : `${d > 0 ? '+' : ''}${unit === 'ms' ? (Math.abs(d) >= 1000 ? (d / 1000).toFixed(2) + ' s' : Math.round(d) + ' ms') : unit === 'cls' ? d.toFixed(3) : Math.round(d)}`;

/** Fetch a project logo with the same SSRF protections as monitoring (public IPs only, 1 MB cap, PNG/JPEG only). */
export function fetchLogo(url: string): Promise<Buffer | null> {
  return new Promise(resolve => {
    try {
      const u = assertPublicUrlSyntax(url);
      const req = (u.protocol === 'https:' ? https : http).request({ hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || undefined, path: u.pathname + u.search, method: 'GET', lookup: safeLookup as any, timeout: 5000 }, res => {
        const type = String(res.headers['content-type'] || '');
        if (res.statusCode !== 200 || !/image\/(png|jpe?g)/i.test(type)) { res.destroy(); return resolve(null); }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', c => { size += c.length; if (size > 1_000_000) { res.destroy(); resolve(null); } else chunks.push(c); });
        res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', () => resolve(null));
      });
      req.on('timeout', () => { req.destroy(); resolve(null); }); req.on('error', () => resolve(null)); req.end();
    } catch { resolve(null); }
  });
}

export async function renderPdf(d: ReportData, o: { title: string; sections: Section[]; timezone: string; logo: Buffer | null; generatedBy?: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: clean(o.title), Author: 'SiteWatch', Creator: 'SiteWatch' } });
  const chunks: Buffer[] = []; doc.on('data', c => chunks.push(c));
  const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))));
  const tz = o.timezone;
  const dt = (x: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(x));
  const W = doc.page.width - 84; const has = (s: Section) => o.sections.includes(s);
  const room = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };
  const h2 = (t: string) => { room(50); doc.moveDown(0.8).fillColor(INK).font('Helvetica-Bold').fontSize(14).text(clean(t)); doc.moveTo(42, doc.y + 2).lineTo(42 + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.6); };
  const h3 = (t: string) => { room(36); doc.moveDown(0.4).fillColor(BRAND).font('Helvetica-Bold').fontSize(11).text(clean(t)); doc.moveDown(0.2); };
  const p = (t: string, c = MUTED) => doc.fillColor(c).font('Helvetica').fontSize(9.5).text(clean(t), { width: W });
  function table(head: string[], body: string[][], widths: number[], colorFor?: (r: number, c: number) => string | undefined) {
    const tw = widths.reduce((a, b) => a + b, 0); const w = widths.map(x => (x / tw) * W);
    const row = (cells: string[], bold: boolean, r = -1) => {
      const hts = cells.map((c, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(clean(c), { width: w[i] - 8 }));
      const h = Math.max(...hts) + 8; room(h + 2); const y = doc.y; let x = 42;
      if (bold) doc.rect(42, y, W, h).fill('#f3f5fa');
      cells.forEach((c, i) => { doc.fillColor((r >= 0 && colorFor?.(r, i)) || INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(clean(c), x + 4, y + 4, { width: w[i] - 8 }); x += w[i]; });
      doc.y = y + h; doc.moveTo(42, doc.y).lineTo(42 + W, doc.y).strokeColor(LINE).stroke();
    };
    row(head, true); body.forEach((b, i) => row(b, false, i)); doc.moveDown(0.5);
  }
  function lineChart(points: { label: string; v: number | null }[], title: string, unit: string) {
    const vals = points.filter(x => x.v != null) as { label: string; v: number }[];
    if (vals.length < 2) { p(`${title}: not enough data points to draw a trend.`); return; }
    room(150); const x0 = 42 + 34, y0 = doc.y + 14, cw = W - 40, ch = 100;
    const max = Math.max(...vals.map(x => x.v)) * 1.1 || 1, min = 0;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(clean(title), 42, doc.y); const top = doc.y + 6;
    doc.rect(x0, top, cw, ch).strokeColor(LINE).stroke();
    for (let i = 0; i <= 3; i++) { const yy = top + ch - (ch * i) / 3; doc.moveTo(x0, yy).lineTo(x0 + cw, yy).strokeColor(LINE).stroke(); doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(String(Math.round((max * i) / 3)), 42, yy - 3, { width: 30, align: 'right' }); }
    const px = (i: number) => x0 + (cw * i) / (points.length - 1); const py = (v: number) => top + ch - ((v - min) / (max - min)) * ch;
    doc.strokeColor(BRAND).lineWidth(1.5); let started = false;
    points.forEach((pt, i) => { if (pt.v == null) { started = false; return; } started ? doc.lineTo(px(i), py(pt.v)) : doc.moveTo(px(i), py(pt.v)); started = true; }); doc.stroke(); doc.lineWidth(1);
    doc.fillColor(MUTED).fontSize(7).text(`${points[0].label}`, x0, top + ch + 4, { lineBreak: false }).text(`${points[points.length - 1].label}  (${unit})`, x0 + cw - 120, top + ch + 4, { width: 120, align: 'right', lineBreak: false });
    doc.y = top + ch + 20; doc.x = 42;
  }

  // ---- Cover / header ----
  doc.rect(0, 0, doc.page.width, 92).fill(BRAND);
  let tx = 42;
  if (o.logo) { try { doc.image(o.logo, 42, 18, { fit: [56, 56] }); tx = 112; } catch { /* unsupported image: skip */ } }
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text(clean(o.title), tx, 24, { width: doc.page.width - tx - 42 });
  doc.font('Helvetica').fontSize(10).text(clean(`${d.project.name}${d.project.client_name ? '  |  ' + d.project.client_name : ''}`), tx, doc.y + 2, { width: doc.page.width - tx - 42 });
  doc.fillColor(INK); doc.y = 108; doc.x = 42;
  table(['Report period', 'Generated', 'Websites'], [[`${dt(d.from)} to ${dt(d.to)}`, `${dt(new Date())} (${tz})`, String(d.totals.sites)]], [3, 2.4, 1]);
  if (d.project.primary_domain) p(`Primary domain: ${d.project.primary_domain}`);

  // ---- Summary ----
  if (has('summary')) {
    h2('Summary');
    table(['Uptime', 'Downtime', 'Incidents', 'Avg response', 'Checks'], [[
      d.totals.uptimePct == null ? 'n/a' : `${d.totals.uptimePct}%`, fmtDuration(d.totals.downtimeSeconds), String(d.totals.incidents),
      d.totals.avgMs == null ? 'n/a' : `${d.totals.avgMs} ms`, String(d.totals.checks)]], [1, 1, 1, 1, 1]);
    p('Uptime is the share of monitoring checks that passed. Downtime is the total length of incidents overlapping this period. Response time is measured until HTTP headers arrive and is not a browser load time.');
    if (d.sites.length) table(['Website', 'Uptime', 'Downtime', 'Incidents', 'Avg ms'], d.sites.map(s => [s.name, s.uptimePct == null ? 'no data' : `${s.uptimePct}%`, fmtDuration(s.downtimeSeconds), String(s.incidentCount), s.avgMs == null ? 'n/a' : String(s.avgMs)]), [3, 1, 1.2, 1, 1]);
  }
  // ---- Per-site detail ----
  for (const s of d.sites) {
    const needs = has('uptime') || has('response') || has('incidents') || has('speed') || has('comparison') || has('recommendations');
    if (!needs) break;
    doc.addPage(); doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(clean(s.name)); doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(clean(s.url)); doc.moveDown(0.4);
    if (has('uptime')) { h3('Uptime'); table(['Uptime', 'Checks', 'Failed checks', 'Downtime', 'Incidents'], [[s.uptimePct == null ? 'no data' : `${s.uptimePct}%`, String(s.checks), String(s.checks - s.upChecks), fmtDuration(s.downtimeSeconds), String(s.incidentCount)]], [1, 1, 1, 1, 1], (_r, c) => c === 0 && s.uptimePct != null ? (s.uptimePct >= 99.9 ? GREEN : s.uptimePct < 99 ? RED : undefined) : undefined); }
    if (has('response')) {
      h3('Response time'); table(['Average', 'Fastest', 'Slowest'], [[s.avgMs == null ? 'n/a' : `${s.avgMs} ms`, s.minMs == null ? 'n/a' : `${s.minMs} ms`, s.maxMs == null ? 'n/a' : `${s.maxMs} ms`]], [1, 1, 1]);
      lineChart(s.trend.map(t => ({ label: t.label, v: t.avgMs })), 'Average response time (ms), successful checks', 'ms');
    }
    if (has('incidents')) {
      h3('Incidents');
      if (!s.incidents.length) p('No incidents in this period.');
      else table(['Started', 'Recovered', 'Duration in period', 'Failed checks', 'Last error'], s.incidents.slice(0, 20).map(i => [dt(i.start), i.end ? dt(i.end) : 'Ongoing', fmtDuration(i.seconds), String(i.failures), (i.error || '').slice(0, 90)]), [2, 2, 1.4, 1, 3]);
      if (s.incidents.length > 20) p(`Showing 20 of ${s.incidents.length} incidents.`);
    }
    if (has('speed')) {
      h3('Lighthouse (PageSpeed Insights, lab data)');
      const m = s.speed.mobile?.last, dk = s.speed.desktop?.last;
      if (!m && !dk) p('No speed tests were run for this website in this period.');
      else {
        table(['Metric', 'Mobile', 'Desktop'], METRICS.map(mt => [mt.label, m ? fmtMetric(mt.unit, m[mt.key] == null ? null : Number(m[mt.key])) : 'no test', dk ? fmtMetric(mt.unit, dk[mt.key] == null ? null : Number(dk[mt.key])) : 'no test']), [3, 1.4, 1.4]);
        p(`Latest results in the period${m ? ` - mobile: ${dt(m.audited_at)}` : ''}${dk ? ` - desktop: ${dt(dk.audited_at)}` : ''}. Metrics shown as n/a were not returned by Google for that test.`);
      }
    }
    if (has('comparison')) {
      for (const dev of ['mobile', 'desktop'] as const) {
        const sp = s.speed[dev]; if (!sp) continue;
        h3(`Change over the period - ${dev}`);
        if (sp.count < 2) p('Only one test in this period, so there is nothing to compare. Run another test to see changes.');
        else {
          p(`Comparing ${dt(sp.first.audited_at)} with ${dt(sp.last.audited_at)} (${sp.count} tests).`);
          table(['Metric', 'Previous', 'Current', 'Change', 'Result'], sp.deltas.map(x => [x.label, fmtMetric(x.unit, x.previous), fmtMetric(x.unit, x.current), fmtChange(x.unit, x.change), x.direction === 'unavailable' ? 'n/a' : x.direction]), [3, 1.2, 1.2, 1.2, 1.2], (r, c) => c === 4 ? (sp.deltas[r].direction === 'improved' ? GREEN : sp.deltas[r].direction === 'declined' ? RED : undefined) : undefined);
        }
      }
    }
    if (has('recommendations')) {
      h3('Recommendations (from actual findings)');
      const recs: string[] = [];
      for (const dev of ['mobile', 'desktop'] as const) for (const o2 of (s.speed[dev]?.opportunities ?? []).slice(0, 4)) recs.push(`[${dev}] ${o2.title}${o2.displayValue ? ` (${o2.displayValue})` : ''}${o2.savingsMs ? ` - potential saving about ${Math.round(o2.savingsMs)} ms` : ''}`);
      if (s.incidentCount) { const worst = [...s.incidents].sort((a, b) => b.seconds - a.seconds)[0]; recs.push(`${s.incidentCount} incident(s) occurred. The longest lasted ${fmtDuration(worst.seconds)}${worst.error ? ` (${worst.error.slice(0, 80)})` : ''}; review hosting stability and alerting for this site.`); }
      if (s.uptimePct != null && s.uptimePct < 99.9 && !s.incidentCount) recs.push(`Uptime was ${s.uptimePct}% with failed checks but no recorded incident; the failures were isolated and recovered on retry.`);
      if (!recs.length) p('No issues were found in the data collected for this period.', INK);
      else recs.slice(0, 10).forEach(r => { room(24); doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(`•  ${clean(r)}`, { width: W, indent: 0 }); doc.moveDown(0.25); });
    }
  }
  // ---- Footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i); doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
    doc.text(clean(`SiteWatch report - ${d.project.name}`), 42, doc.page.height - 36, { width: W / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, 42 + W / 2, doc.page.height - 36, { width: W / 2, align: 'right', lineBreak: false });
  }
  doc.end(); return done;
}
