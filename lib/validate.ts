import { ApiError } from './errors';
const bad = (m: string): never => { throw new ApiError(400, m); };

export function str(v: unknown, label: string, o: { min?: number; max: number; optional?: boolean }): string | null {
  if (v === undefined || v === null || v === '') { if (o.optional) return null; return bad(`${label} is required.`); }
  if (typeof v !== 'string') return bad(`${label} must be text.`);
  const s = v.trim();
  if (s.length < (o.min ?? 1)) return bad(`${label} is too short.`);
  if (s.length > o.max) return bad(`${label} must be at most ${o.max} characters.`);
  return s;
}
export function int(v: unknown, label: string, o: { min: number; max: number }): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < o.min || n > o.max) return bad(`${label} must be a whole number between ${o.min} and ${o.max}.`);
  return n;
}
export function oneOf<T extends string>(v: unknown, label: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) return bad(`${label} must be one of: ${allowed.join(', ')}.`);
  return v as T;
}
export function bool(v: unknown, label: string): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return v === 1;
  return bad(`${label} must be true or false.`);
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function email(v: unknown, label = 'Email'): string {
  const s = str(v, label, { max: 190 })!.toLowerCase();
  if (!EMAIL.test(s)) bad(`${label} is not a valid email address.`);
  return s;
}
export function emailList(v: unknown, label: string, max = 10): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return null;
  const list = String(v).split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length > max) bad(`${label}: at most ${max} addresses.`);
  for (const e of list) if (!EMAIL.test(e)) bad(`${label}: "${e}" is not a valid email address.`);
  return [...new Set(list)].join(', ');
}
export function slugify(s: string) { return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'project'; }
export function timezone(v: unknown, label = 'Timezone'): string {
  const s = str(v, label, { max: 64 })!;
  try { new Intl.DateTimeFormat('en', { timeZone: s }); } catch { bad(`${label} is not a valid IANA timezone.`); }
  return s;
}
export function isoDate(v: unknown, label: string): Date {
  const d = new Date(String(v));
  if (typeof v !== 'string' || Number.isNaN(d.getTime())) return bad(`${label} must be a valid date.`);
  return d;
}
export function httpUrlOrNull(v: unknown, label: string): string | null {
  const s = str(v, label, { max: 500, optional: true });
  if (!s) return null;
  try { const u = new URL(s); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw 0; return u.toString(); } catch { return bad(`${label} must be an http(s) URL.`); }
}
/** "200-299,301,401" -> predicate. Null when the spec is malformed. */
export function parseStatusSpec(spec: string): ((code: number) => boolean) | null {
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 20) return null;
  const ranges: [number, number][] = [];
  for (const p of parts) {
    const m = /^(\d{3})(?:-(\d{3}))?$/.exec(p);
    if (!m) return null;
    const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
    if (lo < 100 || hi > 599 || lo > hi) return null;
    ranges.push([lo, hi]);
  }
  return c => ranges.some(([lo, hi]) => c >= lo && c <= hi);
}
export function statusSpec(v: unknown, label = 'Expected status codes'): string {
  const s = str(v, label, { max: 100 })!.replace(/\s+/g, '');
  if (!parseStatusSpec(s)) bad(`${label} must look like "200-399" or "200,301,404".`);
  return s;
}
