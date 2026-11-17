// The Muse's public jobs API no longer allows browser requests, so the app asks through here.
// GET /api/muse?page=0&category=…&location=… — only these parameters are passed on, to
// https://www.themuse.com/api/public/jobs only. Answers are cached for 30 minutes.
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
export async function onRequestGet({ request }) {
  const url = new URL(request.url),
    page = Number(url.searchParams.get("page") || 0);
  if (!Number.isInteger(page) || page < 0 || page > 20) return json({ error: "invalid_page" }, 400);
  const out = new URLSearchParams({ page: String(page) });
  url.searchParams.getAll("category").slice(0, 5).forEach((c) => clean(c, 50) && out.append("category", clean(c, 50)));
  url.searchParams.getAll("location").slice(0, 8).forEach((l) => clean(l, 80) && out.append("location", clean(l, 80)));
  url.searchParams.getAll("level").slice(0, 4).forEach((l) => clean(l, 40) && out.append("level", clean(l, 40)));
  const target = `https://www.themuse.com/api/public/jobs?${out}`,
    cache = globalThis.caches?.default,
    key = new Request(`https://cache.the-looney-bin.local/muse?${out}`);
  let hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return new Response(hit.body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  let r;
  try {
    r = await fetch(target, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(12_000) });
  } catch (e) {
    return json({ error: "muse_unavailable" }, 502);
  }
  if (!r.ok) return json({ error: `muse_http_${r.status}` }, 502);
  const d = await r.json().catch(() => null);
  if (!d || !Array.isArray(d.results)) return json({ error: "muse_bad_answer" }, 502);
  // Only the fields the app uses.
  const body = JSON.stringify({
    page_count: Number(d.page_count) || 0,
    results: d.results.map((j) => ({ id: j.id, name: j.name, company: { name: j.company?.name }, locations: (j.locations || []).map((l) => ({ name: l.name })), refs: { landing_page: j.refs?.landing_page }, contents: String(j.contents || "").slice(0, 20000), levels: (j.levels || []).map((l) => ({ name: l.name })), categories: (j.categories || []).map((c) => ({ name: c.name })), publication_date: j.publication_date })),
  });
  if (cache) await cache.put(key, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=1800" } })).catch(() => {});
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
