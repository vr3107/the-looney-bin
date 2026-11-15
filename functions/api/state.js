// Each person's saved data (profile and settings, jobs, resumes), stored as one row per item.
// GET /api/state → everything; POST /api/state → { baseRev, upserts:[{kind,id,v}], removes:[{kind,id}] }
import { json, fail, readJson, now } from "../_lib/core.js";

const KINDS = new Set(["core", "job", "resume"]);
const MAX_ITEM_BYTES = 700_000;
const MAX_ITEMS = 6000;
const okId = (id) => typeof id === "string" && id.length > 0 && id.length <= 160;

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare("SELECT kind, id, json FROM docs WHERE user_id = ? LIMIT ?").bind(data.user.id, MAX_ITEMS).all();
  const { rev } = await env.DB.prepare("SELECT rev FROM users WHERE id = ?").bind(data.user.id).first();
  // Stored JSON is spliced in as-is to avoid re-parsing large documents.
  const body = `{"rev":${rev},"docs":[${results.map((r) => `{"kind":${JSON.stringify(r.kind)},"id":${JSON.stringify(r.id)},"v":${r.json}}`).join(",")}]}`;
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env, data }) {
  const db = env.DB,
    userId = data.user.id,
    { body, error } = await readJson(request, 5_000_000);
  if (error) return error;
  const upserts = Array.isArray(body.upserts) ? body.upserts : [],
    removes = Array.isArray(body.removes) ? body.removes : [];
  if (upserts.length + removes.length > 1500) return fail("too_many_changes", 413);
  const statements = [],
    t = now();
  for (const u of upserts) {
    if (!u || !KINDS.has(u.kind) || !okId(u.id) || !u.v || typeof u.v !== "object") return fail("invalid_item");
    if (u.kind === "core" && u.id !== "core") return fail("invalid_item");
    const text = JSON.stringify(u.v);
    if (text.length > MAX_ITEM_BYTES) return fail("item_too_large", 413, { kind: u.kind, id: u.id });
    statements.push(db.prepare("INSERT INTO docs (user_id, kind, id, json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at").bind(userId, u.kind, u.id, text, t));
  }
  for (const r of removes) {
    if (!r || !KINDS.has(r.kind) || !okId(r.id)) return fail("invalid_item");
    statements.push(db.prepare("DELETE FROM docs WHERE user_id = ? AND kind = ? AND id = ?").bind(userId, r.kind, r.id));
  }
  if (upserts.length) {
    const { n } = await db.prepare("SELECT COUNT(*) AS n FROM docs WHERE user_id = ?").bind(userId).first();
    if (n + upserts.length > MAX_ITEMS) return fail("storage_full", 413);
  }
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
  const row = await db.prepare("UPDATE users SET rev = rev + 1 WHERE id = ? RETURNING rev").bind(userId).first();
  // stale = another device saved since this one last loaded; the client then reloads the merged result.
  return json({ rev: row.rev, stale: Number(body.baseRev) !== row.rev - 1 });
}
