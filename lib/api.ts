import { NextRequest, NextResponse } from 'next/server';
import { ApiError } from './errors';
import { getCurrentUser, type SessionUser } from './auth';

export function clientIp(req: NextRequest) {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0].trim() || req.headers.get('x-real-ip') || '0.0.0.0').slice(0, 45);
}
/** CSRF defence in depth (cookie is already SameSite=Strict): browsers always send Origin on cross-site writes. */
function originAllowed(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { return false; }
}
export type ApiCtx = { req: NextRequest; user: SessionUser; params: Record<string, string>; ip: string };
export type PublicCtx = Omit<ApiCtx, 'user'>;

function fail(e: unknown) {
  if (e instanceof ApiError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  const err = e as { code?: string };
  if (err?.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'That value already exists.', code: 'duplicate' }, { status: 409 });
  console.error('[SiteWatch] Unhandled API error:', e);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
async function run(req: NextRequest, rc: { params: Promise<any> } | undefined, needAuth: boolean, h: (c: any) => Promise<unknown>) {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !originAllowed(req)) throw new ApiError(403, 'Cross-origin request blocked.');
    const params = rc?.params ? await rc.params : {};
    let user: SessionUser | null = null;
    if (needAuth) { user = await getCurrentUser(); if (!user) throw new ApiError(401, 'Unauthorized'); }
    const out = await h({ req, user, params, ip: clientIp(req) });
    return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
  } catch (e) { return fail(e); }
}
/** Authenticated route. Handlers still must call requireProject()/requireGlobalPermission() for authorisation. */
export const api = (h: (c: ApiCtx) => Promise<unknown>) => (req: NextRequest, rc: { params: Promise<any> }) => run(req, rc, true, h);
export const publicApi = (h: (c: PublicCtx) => Promise<unknown>) => (req: NextRequest, rc: { params: Promise<any> }) => run(req, rc, false, h);

export async function readBody(req: NextRequest): Promise<Record<string, any>> {
  try { const b = await req.json(); if (b && typeof b === 'object' && !Array.isArray(b)) return b; } catch { /* fallthrough */ }
  throw new ApiError(400, 'Invalid request body.');
}
export function idParam(v: string | undefined, label = 'ID') {
  if (!v || !/^\d{1,18}$/.test(v)) throw new ApiError(400, `Invalid ${label}.`);
  return Number(v);
}
