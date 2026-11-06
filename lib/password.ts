
import {
  randomBytes,
  scrypt,
  timingSafeEqual
} from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(
  password: string,
  salt: Buffer,
  n = N,
  r = R,
  p = P
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEYLEN,
      {
        N: n,
        r,
        p,
        maxmem: 128 * 1024 * 1024
      },
      (error, key) => {
        if (error) {
          reject(error);
        } else {
          resolve(key);
        }
      }
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);

  const key = await derive(password, salt);

  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  try {
    if (typeof stored !== 'string') return false;

    const parts = stored.split('$');

    if (parts.length !== 6) return false;

    const [alg, nStr, rStr, pStr, saltStr, keyStr] = parts;

    if (alg !== 'scrypt') return false;

    const n = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);

    if (
      !Number.isSafeInteger(n) ||
      !Number.isSafeInteger(r) ||
      !Number.isSafeInteger(p) ||
      n < 2 ||
      (n & (n - 1)) !== 0 ||
      r < 1 ||
      p < 1 ||
      n > 65536 ||
      r > 16 ||
      p > 4
    ) {
      return false;
    }

    const salt = Buffer.from(saltStr, 'base64');
    const expected = Buffer.from(keyStr, 'base64');

    if (salt.length !== 16 || expected.length !== KEYLEN) {
      return false;
    }

    const actual = await derive(password, salt, n, r, p);

    return timingSafeEqual(actual, expected);

  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

/** Used to equalise timing when a login names an unknown user. */
export const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  Buffer.alloc(64).toString('base64');

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 12) {
    return 'Password must be at least 12 characters.';
  }

  if (pw.length > 200) {
    return 'Password is too long.';
  }

  return null;
}
