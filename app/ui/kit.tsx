'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export async function call<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) location.href = '/login'; throw new Error(d.error || `Request failed (${r.status})`); }
  return d as T;
}
export async function download(url: string, body: unknown, fallbackName: string) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Download failed'); }
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const ref = useRef(fn); ref.current = fn;
  const reload = useCallback(async (silent = false) => {
    if (!silent) set(s => ({ ...s, loading: true }));
    try { set({ data: await ref.current(), error: '', loading: false }); } catch (e) { set(s => ({ data: s.data, error: e instanceof Error ? e.message : 'Failed to load', loading: false })); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...state, reload };
}

// ---------- formatting ----------
export const fmtDate = (v: string | Date | null | undefined, tz = 'UTC') => v ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—';
export const fmtShort = (v: string | Date | null | undefined, tz = 'UTC') => v ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
export const fmtDur = (s: number) => (s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);
export const fmtMs = (v: number | null | undefined) => v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const ago = (v: string | null) => { if (!v) return 'never'; const s = (Date.now() - new Date(v).getTime()) / 1000; return s < 90 ? 'just now' : `${fmtDur(s)} ago`; };

// ---------- toast ----------
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => { const id = Date.now() + Math.random(); setItems(x => [...x, { id, msg, kind }]); setTimeout(() => setItems(x => x.filter(i => i.id !== id)), kind === 'err' ? 7000 : 3500); }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="sw-toasts" role="status" aria-live="polite">{items.map(t => <div key={t.id} className={`sw-toast ${t.kind}`}>{t.msg}</div>)}</div></ToastCtx.Provider>;
}

// ---------- icons ----------
const ICONS: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18', pulse: 'M3 12h4l3-8 4 16 3-8h4',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z', file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6', chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  clock: 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', users: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0', menu: 'M4 6h16M4 12h16M4 18h16', chevron: 'M6 9l6 6 6-6', x: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M19 12l-7 7-7-7', plus: 'M12 5v14M5 12h14', play: 'M7 4l13 8-13 8z'
};
export const Icon = ({ name, size = 18 }: { name: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] || ''} /></svg>;

// ---------- primitives ----------
export const Card = ({ title, subtitle, actions, children, flush }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; flush?: boolean }) =>
  <section className="sw-card">{(title || actions) && <div className="sw-card-head"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div><div className="sw-actions">{actions}</div></div>}<div className={flush ? '' : 'sw-card-body'}>{children}</div></section>;
export const Kpi = ({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: 'green' | 'red' | 'amber' }) => <div className="sw-kpi"><p>{label}</p><strong className={tone}>{value}</strong>{note && <span>{note}</span>}</div>;
export const Badge = ({ tone = 'gray', children }: { tone?: 'green' | 'red' | 'amber' | 'blue' | 'gray'; children: React.ReactNode }) => <span className={`sw-badge ${tone}`}>{children}</span>;
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => <label className="sw-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
export const Empty = ({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) => <div className="sw-empty"><div className="sw-empty-icon"><Icon name="globe" size={22} /></div><h3>{title}</h3>{text && <p className="muted">{text}</p>}{action}</div>;
export const ErrorBox = ({ error, retry }: { error: string; retry?: () => void }) => error ? <div className="sw-error" role="alert">{error}{retry && <button className="text-btn" onClick={retry}>Retry</button>}</div> : null;
export const Skeleton = ({ rows = 3 }: { rows?: number }) => <div className="sw-skel">{Array.from({ length: rows }, (_, i) => <div key={i} className="sw-skel-row" style={{ width: `${95 - i * 12}%` }} />)}</div>;
export const Spinner = () => <span className="sw-spinner small" />;
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="sw-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className={`sw-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="sw-modal-head"><h2>{title}</h2><button className="sw-icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div><div className="sw-modal-body">{children}</div>{footer && <div className="sw-modal-foot">{footer}</div>}</div></div>;
}
export const Tabs = ({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) => <div className="sw-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
export const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => <div className="sw-table-wrap"><table className="sw-table"><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`sw-input ${p.className || ''}`} />;
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`sw-input ${p.className || ''}`} />;
export const Btn = ({ kind = 'primary', busy, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean }) => <button {...p} disabled={p.disabled || busy} className={`sw-btn ${kind} ${p.className || ''}`}>{busy && <Spinner />}{children}</button>;
export const StatusBadge = ({ active, up }: { active: number | boolean; up: number | null }) => !active ? <Badge>Paused</Badge> : up === null ? <Badge tone="amber">Pending</Badge> : up ? <Badge tone="green">● Operational</Badge> : <Badge tone="red">● Down</Badge>;
export const scoreTone = (s: number | null) => s == null ? 'gray' : s >= 90 ? 'green' : s >= 50 ? 'amber' : 'red';
export const ScoreRing = ({ label, value }: { label: string; value: number | null }) => {
  const r = 26, c = 2 * Math.PI * r, v = value ?? 0;
  return <div className="sw-ring"><svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r={r} className="track" /><circle cx="32" cy="32" r={r} className={`val ${scoreTone(value)}`} strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 32 32)" /><text x="32" y="37" textAnchor="middle">{value ?? '—'}</text></svg><span>{label}</span></div>;
};

export type Series = { name: string; color: string; points: { x: string; y: number | null }[] };
/** Dependency-free SVG line chart; hover any point for its exact value. */
export function LineChart({ series, height = 200, unit = '', tz = 'UTC', max }: { series: Series[]; height?: number; unit?: string; tz?: string; max?: number }) {
  const all = series.flatMap(s => s.points.filter(p => p.y != null).map(p => p.y as number));
  if (all.length < 2) return <div className="sw-chart-empty">Not enough data to draw a chart yet.</div>;
  const W = 640, H = height, L = 44, R = 10, T = 10, B = 24;
  const xs = [...new Set(series.flatMap(s => s.points.map(p => p.x)))].sort();
  const top = max ?? (Math.max(...all) * 1.15 || 1);
  const px = (x: string) => L + ((W - L - R) * xs.indexOf(x)) / Math.max(1, xs.length - 1);
  const py = (v: number) => T + (H - T - B) * (1 - v / top);
  const label = (x: string) => fmtShort(x, tz);
  return <div className="sw-chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart" preserveAspectRatio="none">
    {[0, 1, 2, 3].map(i => { const y = T + ((H - T - B) * i) / 3; return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} className="grid" /><text x={L - 6} y={y + 3} textAnchor="end" className="tick">{Math.round(top * (1 - i / 3))}</text></g>; })}
    {[0, Math.floor((xs.length - 1) / 2), xs.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => <text key={i} x={px(xs[i])} y={H - 6} textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'} className="tick">{label(xs[i])}</text>)}
    {series.map(s => { let d = '', pen = false; for (const p of s.points) { if (p.y == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)} `; pen = true; } return <g key={s.name}><path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />{s.points.map((p, i) => p.y == null ? null : <circle key={i} cx={px(p.x)} cy={py(p.y)} r="7" fill="transparent"><title>{`${s.name}: ${Math.round(p.y * 100) / 100}${unit} — ${fmtDate(p.x, tz)}`}</title></circle>)}</g>; })}
  </svg>{series.length > 1 && <div className="sw-legend">{series.map(s => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>}</div>;
}
