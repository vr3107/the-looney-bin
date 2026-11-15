// Shared server code for The Looney Bin accounts: database schema, passwords,
// sessions, rate limits and request helpers. Used by the Pages Functions in /functions/api.
export const SESSION_COOKIE = "__Host-lb_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000; // the maximum Cloudflare Workers allows
const enc = new TextEncoder();

export const now = () => Math.floor(Date.now() / 1000);
export function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
export const fail = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', pw_hash TEXT, pw_salt TEXT, pw_iter INTEGER, google_sub TEXT UNIQUE, role TEXT NOT NULL DEFAULT 'user', rev INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS docs (user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, kind, id))`,
  `CREATE TABLE IF NOT EXISTS files (user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL, bytes BLOB NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id))`,
  `CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, type TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_user ON events(user_id, id)`,
  `CREATE TABLE IF NOT EXISTS usage (user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day, kind))`,
];
let schemaReady;
// Creates the tables on first use, so no manual database setup is needed.
export function ensureSchema(db) {
  schemaReady ||= db
    .batch(SCHEMA.map((sql) => db.prepare(sql)))
    // Columns added after the first release; "duplicate column" just means it's already there.
    .then(() => db.prepare("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0").run().catch(() => {}))
    .catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const uid = () => hex(crypto.getRandomValues(new Uint8Array(12)));
export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { pw_hash: await pbkdf2(password, salt, PBKDF2_ITERATIONS), pw_salt: hex(salt), pw_iter: PBKDF2_ITERATIONS };
}
// Always does the hashing work, even for unknown users, so timing doesn't reveal which emails exist.
export async function verifyPassword(password, user) {
  const salt = user?.pw_salt ? unhex(user.pw_salt) : new Uint8Array(16);
  const got = await pbkdf2(password, salt, user?.pw_iter || PBKDF2_ITERATIONS);
  return !!user?.pw_hash && safeEqual(got, user.pw_hash);
}

export const normEmail = (s) => String(s || "").trim().toLowerCase();
export const validEmail = (s) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
export function passwordProblem(password, email) {
  if (typeof password !== "string" || password.length < 10) return "Use at least 10 characters for your password.";
  if (password.length > 200) return "That password is too long.";
  if (email && password.toLowerCase() === email) return "Your password can’t be your email address.";
  if (/^(.)\1+$/.test(password) || /^(password|1234567890|qwertyuiop)/i.test(password)) return "That password is too easy to guess.";
  return "";
}
export const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);

function cookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export const clearCookie = () => cookie("", 0);
export async function createSession(db, userId) {
  const token = randomToken(32),
    t = now();
  await db.batch([
    db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256Hex(token), userId, t, t + SESSION_DAYS * 86400),
    db.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(t, userId),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
  ]);
  return cookie(token, SESSION_DAYS * 86400);
}
export function sessionToken(request) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([A-Za-z0-9_-]{20,100})"));
  return m ? m[1] : "";
}
export async function getSessionUser(db, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const row = await db
    .prepare("SELECT u.id, u.email, u.name, u.role, u.rev, u.google_sub, u.pw_hash IS NOT NULL AS has_password, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0")
    .bind(await sha256Hex(token), now())
    .first();
  return row || null;
}
export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, hasPassword: !!u.has_password, google: !!u.google_sub });

// Counts an attempt in a fixed window and returns false once the limit is passed.
export async function rateOk(db, key, limit, windowSeconds) {
  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO rate (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate.window_start + ?3 <= ?2 THEN 1 ELSE rate.count + 1 END,
         window_start = CASE WHEN rate.window_start + ?3 <= ?2 THEN ?2 ELSE rate.window_start END
       RETURNING count`,
    )
    .bind(key, t, windowSeconds)
    .first();
  if (Math.random() < 0.02) await db.prepare("DELETE FROM rate WHERE window_start < ?").bind(t - 86400).run();
  return (row?.count || 1) <= limit;
}
// Security history shown to each person in their account settings (kept to their latest 60 entries).
export async function logEvent(db, request, userId, type) {
  try {
    await db.prepare("INSERT INTO events (user_id, type, ip, ua, at) VALUES (?, ?, ?, ?, ?)").bind(userId, type, clientIp(request), (request.headers.get("User-Agent") || "").slice(0, 200), now()).run();
    if (Math.random() < 0.1) await db.prepare("DELETE FROM events WHERE user_id = ?1 AND id NOT IN (SELECT id FROM events WHERE user_id = ?1 ORDER BY id DESC LIMIT 60)").bind(userId).run();
  } catch {}
}
export const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";

// Reads a JSON body with a hard size limit.
export async function readJson(request, maxBytes = 20_000) {
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return { error: fail("json_required", 415) };
  if (Number(request.headers.get("Content-Length") || 0) > maxBytes) return { error: fail("request_too_large", 413) };
  const text = await request.text();
  if (text.length > maxBytes) return { error: fail("request_too_large", 413) };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw 0;
    return { body };
  } catch {
    return { error: fail("invalid_json", 400) };
  }
}
export async function getSetting(db, key, fallback) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : fallback;
}
export function sameOrigin(request) {
  try {
    return new URL(request.headers.get("Origin") || "").host === new URL(request.url).host;
  } catch {
    return false;
  }
}
