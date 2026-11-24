// Owner-only: invite codes, who can sign up, and the list of people with accounts.
import { json, fail, readJson, now, sha256Hex, getSetting, logEvent } from "../../_lib/core.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return "LB-" + [0, 4, 8].map((i) => [...b.slice(i, i + 4)].map((x) => ALPHABET[x % 32]).join("")).join("-");
}
const owner = (data) => data.user?.role === "owner";

// GET /api/admin/overview?q=&offset= → one page of 100 accounts (optionally matching q by name or
// email), the total, and where the next page starts; plus invites and the sign-up setting.
const PAGE = 100;
export async function onRequestGet({ request, env, data, params }) {
  if (!owner(data)) return fail("owner_only", 403);
  if (params.action !== "overview") return fail("not_found", 404);
  const url = new URL(request.url),
    q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100),
    offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(url.searchParams.get("offset")) || 0))),
    like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%",
    where = q ? "WHERE lower(name) LIKE ?1 ESCAPE '\\' OR lower(email) LIKE ?1 ESCAPE '\\'" : "",
    db = env.DB,
    bind = (stmt, ...rest) => (q ? stmt.bind(like, ...rest) : stmt.bind(...rest));
  const [users, count, invites] = await db.batch([
    bind(db.prepare(`SELECT id, name, email, role, disabled, created_at, last_login FROM users ${where} ORDER BY created_at, id LIMIT ${q ? "?2 OFFSET ?3" : "?1 OFFSET ?2"}`), PAGE + 1, offset),
    bind(db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`)),
    db.prepare("SELECT substr(code_hash, 1, 16) AS id, label, max_uses, uses, created_at, expires_at FROM invites ORDER BY created_at DESC LIMIT 200"),
  ]);
  const more = users.results.length > PAGE;
  return json({ signupMode: await getSetting(db, "signup_mode", "invite"), users: users.results.slice(0, PAGE), total: count.results[0].n, nextOffset: more ? offset + PAGE : null, query: q, invites: invites.results });
}
export async function onRequestPost({ request, env, data, params }) {
  if (!owner(data)) return fail("owner_only", 403);
  const db = env.DB,
    { body, error } = await readJson(request, 2000);
  if (error) return error;
  if (params.action === "invite") {
    const code = newCode(),
      uses = Math.max(1, Math.min(50, Math.round(Number(body.maxUses) || 1))),
      days = Math.max(1, Math.min(365, Math.round(Number(body.days) || 14)));
    await db.prepare("INSERT INTO invites (code_hash, label, max_uses, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await sha256Hex(code.replace(/-/g, "")), String(body.label || "").replace(/[<>]/g, "").slice(0, 80), uses, data.user.id, now(), now() + days * 86400)
      .run();
    return json({ code }, 201);
  }
  if (params.action === "revoke") {
    if (!/^[0-9a-f]{16}$/.test(String(body.id))) return fail("invalid_id");
    await db.prepare("DELETE FROM invites WHERE substr(code_hash, 1, 16) = ?").bind(body.id).run();
    return json({ ok: true });
  }
  if (params.action === "suspend") {
    // Suspending blocks sign-in and signs the person out everywhere; their data is kept and can be restored.
    if (!/^[0-9a-f]{8,64}$/.test(String(body.id))) return fail("invalid_id");
    const target = await db.prepare("SELECT id, role FROM users WHERE id = ?").bind(body.id).first();
    if (!target) return fail("not_found", 404);
    if (target.role === "owner") return fail("cannot_suspend_admin", 409);
    const off = body.suspended ? 1 : 0;
    await db.batch([db.prepare("UPDATE users SET disabled = ? WHERE id = ?").bind(off, target.id), ...(off ? [db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id)] : [])]);
    await logEvent(db, request, target.id, off ? "suspended_by_admin" : "restored_by_admin");
    return json({ ok: true, suspended: !!off });
  }
  if (params.action === "signup-mode") {
    if (!["invite", "open", "closed"].includes(body.mode)) return fail("invalid_mode");
    await db.prepare("INSERT INTO settings (key, value) VALUES ('signup_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(body.mode).run();
    return json({ ok: true, mode: body.mode });
  }
  return fail("not_found", 404);
}
