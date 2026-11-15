// Owner-only: invite codes, who can sign up, and the list of people with accounts.
import { json, fail, readJson, now, sha256Hex, getSetting } from "../../_lib/core.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return "LB-" + [0, 4, 8].map((i) => [...b.slice(i, i + 4)].map((x) => ALPHABET[x % 32]).join("")).join("-");
}
const owner = (data) => data.user?.role === "owner";

export async function onRequestGet({ env, data, params }) {
  if (!owner(data)) return fail("owner_only", 403);
  if (params.action !== "overview") return fail("not_found", 404);
  const db = env.DB,
    [users, invites] = await db.batch([db.prepare("SELECT name, email, role, created_at, last_login FROM users ORDER BY created_at LIMIT 500"), db.prepare("SELECT substr(code_hash, 1, 16) AS id, label, max_uses, uses, created_at, expires_at FROM invites ORDER BY created_at DESC LIMIT 200")]);
  return json({ signupMode: await getSetting(db, "signup_mode", "invite"), users: users.results, invites: invites.results });
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
  if (params.action === "signup-mode") {
    if (!["invite", "open", "closed"].includes(body.mode)) return fail("invalid_mode");
    await db.prepare("INSERT INTO settings (key, value) VALUES ('signup_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(body.mode).run();
    return json({ ok: true, mode: body.mode });
  }
  return fail("not_found", 404);
}
