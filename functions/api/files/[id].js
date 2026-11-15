// Original resume files (DOCX/PDF), private to each person. PUT / GET / DELETE /api/files/:id
import { json, fail, now } from "../../_lib/core.js";

const MAX_BYTES = 1_900_000; // D1 stores up to 2 MB per value
const MAX_FILES = 300;
const okId = (id) => typeof id === "string" && /^[\w.:-]{1,160}$/.test(id);

export async function onRequestPut({ request, env, data, params }) {
  if (!okId(params.id)) return fail("invalid_id");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) return fail("file_too_large", 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return fail(bytes.byteLength ? "file_too_large" : "empty_file", 413);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE user_id = ? AND id != ?").bind(data.user.id, params.id).first();
  if (n >= MAX_FILES) return fail("storage_full", 413);
  let name = "";
  try {
    name = decodeURIComponent(request.headers.get("X-File-Name") || "").slice(0, 200);
  } catch {}
  const type = (request.headers.get("Content-Type") || "").slice(0, 120);
  await env.DB.prepare("INSERT INTO files (user_id, id, name, type, size, bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, type = excluded.type, size = excluded.size, bytes = excluded.bytes, updated_at = excluded.updated_at")
    .bind(data.user.id, params.id, name, type, bytes.byteLength, bytes, now())
    .run();
  return json({ ok: true, size: bytes.byteLength });
}
export async function onRequestGet({ env, data, params }) {
  if (!okId(params.id)) return fail("invalid_id");
  const row = await env.DB.prepare("SELECT name, type, bytes FROM files WHERE user_id = ? AND id = ?").bind(data.user.id, params.id).first();
  if (!row) return fail("not_found", 404);
  // Always sent as a download, never as a page, so an uploaded file can't run in the site.
  return new Response(new Uint8Array(row.bytes), {
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment", "X-File-Type": row.type.replace(/[^\w./+-]/g, ""), "X-File-Name": encodeURIComponent(row.name), "Cache-Control": "private, no-store" },
  });
}
export async function onRequestDelete({ env, data, params }) {
  if (!okId(params.id)) return fail("invalid_id");
  await env.DB.prepare("DELETE FROM files WHERE user_id = ? AND id = ?").bind(data.user.id, params.id).run();
  return json({ ok: true });
}
