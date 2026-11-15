// Account endpoints: /api/auth/{config,me,signup,signin,google,signout,password,delete}
import { json, fail, readJson, now, uid, sha256Hex, hashPassword, verifyPassword, normEmail, validEmail, passwordProblem, cleanName, createSession, clearCookie, sessionToken, publicUser, rateOk, clientIp, getSetting, logEvent } from "../../_lib/core.js";

const normInvite = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
async function signupMode(db) {
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM users").first();
  return n === 0 ? "first" : await getSetting(db, "signup_mode", "invite");
}
// Checks an invite without using it up; returns its hash when valid.
async function checkInvite(db, code) {
  const norm = normInvite(code);
  if (norm.length < 8) return "";
  const hash = await sha256Hex(norm),
    row = await db.prepare("SELECT 1 FROM invites WHERE code_hash = ? AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)").bind(hash, now()).first();
  return row ? hash : "";
}
async function useInvite(db, hash) {
  const r = await db.prepare("UPDATE invites SET uses = uses + 1 WHERE code_hash = ? AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)").bind(hash, now()).run();
  return r.meta.changes === 1;
}
async function gate(db, mode, invite) {
  if (mode === "closed") return { error: fail("signup_closed", 403) };
  if (mode !== "invite") return {};
  const hash = await checkInvite(db, invite);
  return hash ? { hash } : { error: fail("invite_invalid", 403) };
}
async function signedIn(db, user, status = 200) {
  return json({ user: publicUser({ ...user, has_password: !!user.pw_hash || !!user.has_password }) }, status, { "Set-Cookie": await createSession(db, user.id) });
}

async function signup({ request, env }) {
  const db = env.DB;
  if (!(await rateOk(db, "signup:" + clientIp(request), 10, 3600))) return fail("rate_limited", 429);
  const { body, error } = await readJson(request, 4000);
  if (error) return error;
  const email = normEmail(body.email),
    name = cleanName(body.name),
    problem = passwordProblem(body.password, email);
  if (!validEmail(email)) return fail("email_invalid");
  if (!name) return fail("name_required");
  if (problem) return fail("password_weak", 400, { message: problem });
  const mode = await signupMode(db),
    g = await gate(db, mode, body.invite);
  if (g.error) return g.error;
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) return fail("email_taken", 409);
  if (g.hash && !(await useInvite(db, g.hash))) return fail("invite_invalid", 403);
  const user = { id: uid(), email, name, role: mode === "first" ? "owner" : "user", ...(await hashPassword(body.password)) };
  try {
    await db.prepare("INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(user.id, email, name, user.pw_hash, user.pw_salt, user.pw_iter, user.role, now()).run();
  } catch {
    return fail("email_taken", 409);
  }
  await logEvent(db, request, user.id, "account_created");
  return signedIn(db, user, 201);
}

async function signin({ request, env }) {
  const db = env.DB,
    { body, error } = await readJson(request, 4000);
  if (error) return error;
  const email = normEmail(body.email),
    password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  if (!(await rateOk(db, "signin-ip:" + clientIp(request), 30, 600)) || !(await rateOk(db, "signin:" + email.slice(0, 254), 8, 600))) return fail("rate_limited", 429);
  const user = validEmail(email) ? await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() : null;
  if (!(await verifyPassword(password, user))) {
    if (user) await logEvent(db, request, user.id, "signin_failed");
    return fail("credentials_invalid", 401);
  }
  if (user.disabled) return fail("account_suspended", 403);
  await logEvent(db, request, user.id, "signin");
  return signedIn(db, user);
}

let googleKeys = { at: 0, keys: [] };
export async function verifyGoogle(credential, clientId) {
  const [h, p, s] = String(credential || "").split(".");
  if (!h || !p || !s) return null;
  const dec = (x) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    header = JSON.parse(new TextDecoder().decode(dec(h))),
    claims = JSON.parse(new TextDecoder().decode(dec(p)));
  if (header.alg !== "RS256") return null;
  if (Date.now() - googleKeys.at > 3600_000) googleKeys = { at: Date.now(), keys: (await (await fetch("https://www.googleapis.com/oauth2/v3/certs")).json()).keys || [] };
  const jwk = googleKeys.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, dec(s), new TextEncoder().encode(h + "." + p));
  if (!ok || claims.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) || !(claims.exp > now()) || claims.email_verified !== true || !claims.sub) return null;
  return claims;
}
async function google({ request, env }) {
  const db = env.DB;
  if (!env.GOOGLE_CLIENT_ID) return fail("google_not_configured", 503);
  if (!(await rateOk(db, "google:" + clientIp(request), 30, 600))) return fail("rate_limited", 429);
  const { body, error } = await readJson(request, 8000);
  if (error) return error;
  let claims = null;
  try {
    claims = await verifyGoogle(body.credential, env.GOOGLE_CLIENT_ID);
  } catch {}
  if (!claims) return fail("google_invalid", 401);
  const email = normEmail(claims.email);
  let user = await db.prepare("SELECT * FROM users WHERE google_sub = ?").bind(claims.sub).first();
  if (!user) {
    user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (user) await db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(claims.sub, user.id).run();
  }
  if (!user) {
    const mode = await signupMode(db),
      g = await gate(db, mode, body.invite);
    if (g.error) return g.error;
    if (g.hash && !(await useInvite(db, g.hash))) return fail("invite_invalid", 403);
    user = { id: uid(), email, name: cleanName(claims.name) || email.split("@")[0], role: mode === "first" ? "owner" : "user" };
    await db.prepare("INSERT INTO users (id, email, name, google_sub, role, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(user.id, email, user.name, claims.sub, user.role, now()).run();
    await logEvent(db, request, user.id, "account_created");
  }
  if (user.disabled) return fail("account_suspended", 403);
  await logEvent(db, request, user.id, "signin_google");
  return signedIn(db, user);
}

async function signout({ request, env }) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}

async function password({ request, env, data }) {
  const db = env.DB,
    { body, error } = await readJson(request, 4000);
  if (error) return error;
  if (!(await rateOk(db, "pw:" + data.user.id, 8, 600))) return fail("rate_limited", 429);
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(data.user.id).first();
  if (user.pw_hash && !(await verifyPassword(String(body.current || "").slice(0, 200), user))) return fail("credentials_invalid", 401);
  const problem = passwordProblem(body.next, user.email);
  if (problem) return fail("password_weak", 400, { message: problem });
  const h = await hashPassword(body.next);
  // Changing the password signs out every other device.
  await db.batch([db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?").bind(h.pw_hash, h.pw_salt, h.pw_iter, user.id), db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, data.user.token_hash)]);
  await logEvent(db, request, user.id, "password_changed");
  return json({ ok: true });
}

// Sign out every device except the one making the request.
async function signoutOthers({ request, env, data }) {
  const r = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(data.user.id, data.user.token_hash).run();
  await logEvent(env.DB, request, data.user.id, "signed_out_other_devices");
  return json({ ok: true, removed: r.meta.changes });
}

async function profile({ request, env, data }) {
  const { body, error } = await readJson(request, 2000);
  if (error) return error;
  const name = cleanName(body.name);
  if (!name) return fail("name_required");
  await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, data.user.id).run();
  return json({ ok: true, name });
}

async function remove({ request, env, data }) {
  const db = env.DB,
    { body, error } = await readJson(request, 4000);
  if (error) return error;
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(data.user.id).first();
  if (body.confirm !== "DELETE") return fail("confirm_required");
  if (user.pw_hash && !(await verifyPassword(String(body.password || "").slice(0, 200), user))) return fail("credentials_invalid", 401);
  if (user.role === "owner" && (await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n > 1) return fail("owner_cannot_delete", 409);
  await db.batch(["docs", "files", "sessions", "usage", "events"].map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id)).concat(db.prepare("DELETE FROM users WHERE id = ?").bind(user.id)));
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}

export async function onRequestGet({ params, env, data }) {
  if (params.action === "config") {
    const mode = await signupMode(env.DB);
    return json({ signup: mode === "first" ? "open" : mode, firstAccount: mode === "first", googleClientId: env.GOOGLE_CLIENT_ID || "" });
  }
  if (params.action === "security") {
    if (!data.user) return fail("sign_in_required", 401);
    const db = env.DB,
      [sessions, events] = await db.batch([db.prepare("SELECT token_hash, created_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 30").bind(data.user.id, now()), db.prepare("SELECT type, ip, ua, at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 25").bind(data.user.id)]);
    return json({ sessions: sessions.results.map((s) => ({ created_at: s.created_at, current: s.token_hash === data.user.token_hash })), events: events.results });
  }
  if (params.action === "me") return json(data.user ? { user: publicUser(data.user), rev: data.user.rev } : { user: null });
  return fail("not_found", 404);
}
export async function onRequestPost(context) {
  const handler = { signup, signin, google, signout, password, profile, delete: remove, "signout-others": signoutOthers }[context.params.action];
  return handler ? handler(context) : fail("not_found", 404);
}
