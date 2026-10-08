// Cross-device sync through a private GitHub Gist.
// The payload is encrypted in the browser (AES-GCM, key from PBKDF2 over the user's
// passphrase), so the gist only ever holds ciphertext. Secret gists are unlisted, not
// private, which is why the encryption matters.
import { store } from './util.js';

const API = 'https://api.github.com';
const FILE = 'knowbase-sync.json';
const DESCRIPTION = 'knowbase sync (encrypted)';

let cfg = store.get('kb.sync', null); // { token, pass, gistId, lastSync, error }
let keyCache = null;
let salt = null;
let inflight = null;

const saveCfg = () => store.set('kb.sync', cfg);
export const configured = () => !!(cfg?.token && cfg?.pass && cfg?.gistId);
export const status = () => (cfg ? { lastSync: cfg.lastSync || null, error: cfg.error || null } : null);

function b64(bytes) {
  bytes = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(saltB64) {
  if (keyCache?.salt === saltB64) return keyCache.key;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(cfg.pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: 250000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache = { salt: saltB64, key };
  return key;
}

async function encrypt(obj, saltB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyFor(saltB64),
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  return { v: 1, salt: saltB64, iv: b64(iv), data: b64(data) };
}

async function decrypt(env) {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await keyFor(env.salt), unb64(env.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("The passphrase doesn't match the one your synced data was saved with.");
  }
}

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    cache: 'no-store',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${cfg.token}`,
      'x-github-api-version': '2022-11-28',
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token. Check that it has Gists read and write access and has not expired.');
  if (res.status === 403 || res.status === 404) throw new Error(`GitHub refused the request (${res.status}). The token may be missing the Gists permission.`);
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

async function findGist() {
  for (let page = 1; page <= 10; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files?.[FILE]);
    if (hit) return hit.id;
    if (list.length < 100) return null;
  }
  return null;
}

async function pull() {
  const g = await gh(`/gists/${cfg.gistId}`);
  const f = g.files?.[FILE];
  if (!f) throw new Error('The sync gist no longer has its data file.');
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  const env = JSON.parse(text);
  salt = env.salt;
  return decrypt(env);
}

async function push(state) {
  const env = await encrypt(state, salt);
  await gh(`/gists/${cfg.gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(env) } } }),
  });
}

/** Pull, merge with local, push the result if it differs. Calls are serialized. */
export function syncNow(local, merge) {
  if (!configured()) return Promise.resolve(local);
  const run = async () => {
    try {
      const remote = await pull();
      const merged = merge(local, remote);
      if (JSON.stringify(merged) !== JSON.stringify(remote)) await push(merged);
      cfg.lastSync = Date.now();
      cfg.error = null;
      return merged;
    } catch (err) {
      cfg.error = err.message;
      throw err;
    } finally {
      saveCfg();
    }
  };
  inflight = (inflight || Promise.resolve()).catch(() => {}).then(run);
  return inflight;
}

/** First-time setup on a device: find the existing gist or create one, then sync. */
export async function connect(token, pass, local, merge) {
  cfg = { token: token.trim(), pass };
  keyCache = null;
  try {
    const existing = await findGist();
    if (existing) {
      cfg.gistId = existing;
    } else {
      salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const env = await encrypt(local, salt);
      const g = await gh('/gists', {
        method: 'POST',
        body: JSON.stringify({ description: DESCRIPTION, public: false, files: { [FILE]: { content: JSON.stringify(env) } } }),
      });
      cfg.gistId = g.id;
    }
    saveCfg();
    return await syncNow(local, merge);
  } catch (err) {
    // Don't keep half-working credentials around.
    cfg = null;
    store.set('kb.sync', null);
    throw err;
  }
}

export function disconnect() {
  cfg = null;
  keyCache = null;
  salt = null;
  store.set('kb.sync', null);
}
