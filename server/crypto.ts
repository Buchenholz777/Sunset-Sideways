/** Kryptografie nur mit WebCrypto (läuft identisch in Cloudflare Workers und Node ≥ 20). */
const enc = new TextEncoder();
const b64 = (u: Uint8Array): string => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: ArrayBuffer | Uint8Array): string => Array.from(new Uint8Array(u as ArrayBuffer), (b) => b.toString(16).padStart(2, '0')).join('');

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));
export const randomToken = (n = 32): string => b64(randomBytes(n)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const sha256Hex = async (s: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/** Zeitkonstanter Vergleich. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

// ---- Passwort: PBKDF2-HMAC-SHA-256 (Cloudflare Workers erlauben höchstens 100 000 Iterationen; Argon2id ist dort nicht verfügbar)
export const PBKDF2_ITER = 100_000;
async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iter: number, len = 32): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, len * 8));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^pbkdf2-sha256\$(\d{1,7})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(stored.trim());
  if (!m || Number(m[1]) > 100_000) return false;
  try {
    const want = unb64(m[3]);
    const got = await pbkdf2(password, unb64(m[2]), Number(m[1]), want.length);
    return safeEqual(b64(got), b64(want));
  } catch { return false; }
}
/** Fester Vergleichswert, damit eine Anmeldung ohne gesetztes Passwort gleich lange dauert (kein Zeit-Orakel). */
export const DUMMY_HASH = 'pbkdf2-sha256$100000$' + 'A'.repeat(22) + '==$' + 'A'.repeat(43) + '=';

// ---- AES-GCM (Search-Console-Token ruhend verschlüsseln)
async function aesKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('gsc:' + secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(secret: string, text: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function unseal(secret: string, blob: string): Promise<string | null> {
  try {
    const [iv, ct] = blob.split('.').map(unb64);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(secret), ct));
  } catch { return null; }
}
