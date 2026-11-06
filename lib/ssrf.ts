import dns from 'node:dns';
import net from 'node:net';
import { ApiError } from './errors';

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa', '.intranet', '.corp'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data', 'kubernetes.default']);

function v4ToInt(ip: string) { return ip.split('.').reduce((a, o) => a * 256 + Number(o), 0); }
const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
];
function v4Private(ip: string) {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => { const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0); });
}
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) { const n = v4ToInt(tail[1]); s = s.slice(0, -tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16); }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest].map(g => parseInt(g, 16));
  return groups.length === 8 && groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}
const g2v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for any address that must never be contacted: loopback, private, link-local, CGNAT, multicast, reserved, metadata... */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true; // unparseable -> refuse
  const g = expandV6(ip);
  if (!g) return true;
  if (g.every(x => x === 0)) return true;                                   // ::
  if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return true;         // ::1
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4Private(g2v4(g[6], g[7])); // ::ffff:a.b.c.d and ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Private(g2v4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return v4Private(g2v4(g[1], g[2]));                  // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true;                              // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;// link-local / site-local
  if ((g[0] & 0xff00) === 0xff00) return true;                              // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                      // documentation
  if (g[0] === 0x2001 && g[1] === 0) return true;                           // Teredo
  return false;
}

/** Static URL checks + literal-IP check. Hostnames are resolved and re-checked at connection time by safeLookup. */
export function assertPublicUrlSyntax(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ApiError(400, 'Enter a valid URL including http:// or https://.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ApiError(400, 'Only http and https URLs are allowed.');
  if (u.username || u.password) throw new ApiError(400, 'URLs containing credentials are not allowed.');
  if (raw.length > 2000) throw new ApiError(400, 'URL is too long.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) throw new ApiError(400, 'URL has no host.');
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some(s => host.endsWith(s))) throw new ApiError(400, 'That host is not a public website.');
  if (net.isIP(host) && isPrivateIp(host)) throw new ApiError(400, 'Private, loopback and reserved IP addresses are not allowed.');
  if (!net.isIP(host) && !host.includes('.')) throw new ApiError(400, 'Enter a fully-qualified public domain name.');
  return u;
}
/** Async version used when a URL is saved: also requires the name to resolve to public addresses right now. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = assertPublicUrlSyntax(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return u;
  let addrs: dns.LookupAddress[];
  try { addrs = await dns.promises.lookup(host, { all: true }); } catch { throw new ApiError(400, 'That domain name does not resolve. Check the spelling or DNS.'); }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new ApiError(400, 'That domain resolves to a private or reserved address and cannot be monitored.');
  return u;
}

/** `lookup` hook for http(s).request: the address validated here is the address connected to, which defeats DNS rebinding. */
export function safeLookup(hostname: string, options: any, cb: (...a: any[]) => void) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) return cb(new Error('Blocked: host resolves to a non-public address.'));
    if (options?.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
  });
}
