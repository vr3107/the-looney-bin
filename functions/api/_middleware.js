// Runs before every /api request: requires a same-site request for anything that
// changes data, loads the signed-in user, and blocks everything except the
// sign-in endpoints for visitors who aren't signed in.
import { ensureSchema, fail, getSessionUser, sameOrigin, now } from "../_lib/core.js";

const PUBLIC = new Set(["/api/auth/signin", "/api/auth/signup", "/api/auth/google", "/api/auth/config", "/api/auth/me", "/api/auth/signout"]);
const AI_DAILY_LIMIT = 60;

function secure(response) {
  const r = new Response(response.body, response);
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "same-origin");
  r.headers.set("X-Frame-Options", "DENY");
  if (!r.headers.has("Cache-Control")) r.headers.set("Cache-Control", "no-store");
  return r;
}
export async function onRequest(context) {
  const { request, env, next, data } = context,
    path = new URL(request.url).pathname.replace(/\/+$/, ""),
    reading = request.method === "GET" || request.method === "HEAD";
  if (request.method === "OPTIONS") return secure(new Response(null, { status: 204 }));
  if (!reading && !sameOrigin(request)) return secure(fail("same_origin_required", 403));
  if (!env.DB?.prepare) return secure(fail("accounts_not_configured", 503));
  try {
    await ensureSchema(env.DB);
    data.user = await getSessionUser(env.DB, request);
    if (!data.user && !PUBLIC.has(path)) return secure(fail("sign_in_required", 401));
    if (data.user && path === "/api/tailor" && !reading) {
      const day = new Date().toISOString().slice(0, 10),
        limit = Number(env.AI_DAILY_LIMIT) || AI_DAILY_LIMIT,
        row = await env.DB.prepare("INSERT INTO usage (user_id, day, kind, count) VALUES (?, ?, 'ai', 1) ON CONFLICT(user_id, day, kind) DO UPDATE SET count = count + 1 RETURNING count").bind(data.user.id, day).first();
      if ((row?.count || 1) > limit) return secure(fail("daily_ai_limit", 429, { limit }));
      if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM usage WHERE day < ?").bind(new Date((now() - 14 * 86400) * 1000).toISOString().slice(0, 10)).run();
    }
    return secure(await next());
  } catch (e) {
    console.error("api error", path, e?.message);
    return secure(fail("server_error", 500));
  }
}
