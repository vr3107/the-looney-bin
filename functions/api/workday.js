// Live search of companies' Workday career sites (myworkdayjobs.com), which browsers can't read
// directly. POST /api/workday { query, boards: [{ tenant, wd, site, name? }] } (up to 40 boards).
// Each board is asked for its newest postings matching the query; results are cached for an hour.
// Only *.myworkdayjobs.com is ever contacted, with each part of the address checked.
const MAX_BOARDS = 40,
  PER_BOARD = 20,
  CONCURRENCY = 8,
  CACHE_SECONDS = 3600;
const requestsByIp = new Map();
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function allowedOrigin(request) {
  try {
    return new URL(request.headers.get("Origin") || "").host === new URL(request.url).host;
  } catch {
    return false;
  }
}
function withinRateLimit(ip) {
  const now = Date.now(),
    cur = requestsByIp.get(ip);
  if (cur && now - cur.startedAt < 60_000) {
    if (cur.count >= 12) return false;
    cur.count += 1;
  } else requestsByIp.set(ip, { startedAt: now, count: 1 });
  if (requestsByIp.size > 5000) for (const [k, v] of requestsByIp) if (now - v.startedAt >= 60_000) requestsByIp.delete(k);
  return true;
}
const TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/i,
  WD = /^wd\d{1,3}$/i,
  SITE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export function validBoard(b) {
  return b && typeof b === "object" && TENANT.test(b.tenant || "") && WD.test(b.wd || "") && SITE.test(b.site || "");
}
// "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" → ISO date
export function postedOn(s, now = Date.now()) {
  s = String(s || "").toLowerCase();
  let days = /today/.test(s) ? 0 : /yesterday/.test(s) ? 1 : Number((s.match(/(\d+)\+?\s*day/) || [])[1]);
  return Number.isFinite(days) ? new Date(now - days * 864e5).toISOString() : "";
}
async function searchBoard(b, query) {
  const tenant = b.tenant.toLowerCase(),
    wd = b.wd.toLowerCase(),
    host = `https://${tenant}.${wd}.myworkdayjobs.com`,
    api = `${host}/wday/cxs/${tenant}/${b.site}/jobs`,
    cache = globalThis.caches?.default,
    cacheKey = new Request(`https://cache.the-looney-bin.local/workday/${tenant}/${wd}/${encodeURIComponent(b.site)}?q=${encodeURIComponent(query)}`);
  let d = cache ? await cache.match(cacheKey).then((r) => r?.json()).catch(() => null) : null;
  if (!d) {
    const r = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": "en-US" },
      body: JSON.stringify({ appliedFacets: {}, limit: PER_BOARD, offset: 0, searchText: query }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    d = await r.json();
    if (cache) await cache.put(cacheKey, new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_SECONDS}` } })).catch(() => {});
  }
  return (Array.isArray(d.jobPostings) ? d.jobPostings : [])
    .filter((j) => j && j.title && typeof j.externalPath === "string" && j.externalPath.startsWith("/"))
    .map((j) => ({
      title: String(j.title).slice(0, 200),
      company: String(b.name || "").slice(0, 120),
      location: String(j.locationsText || "").slice(0, 200),
      url: `${host}/en-US/${b.site}${j.externalPath}`,
      published: postedOn(j.postedOn),
      id: `workday:${tenant}:${(j.bulletFields || [])[0] || j.externalPath}`,
      tags: [b.wd && "Workday"].filter(Boolean),
    }));
}
export async function onRequestPost({ request }) {
  if (!allowedOrigin(request)) return json({ error: "same_origin_required" }, 403);
  if (!withinRateLimit(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "rate_limited" }, 429);
  const body = (await request.json().catch(() => null)) || {},
    query = String(body.query || "").trim().slice(0, 120),
    boards = Array.isArray(body.boards) ? body.boards : [];
  if (!query) return json({ error: "query_required" }, 400);
  if (boards.length > MAX_BOARDS || !boards.every(validBoard)) return json({ error: "invalid_boards" }, 400);
  const jobs = [],
    failed = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, boards.length) }, async () => {
      while (i < boards.length) {
        const b = boards[i++];
        try {
          jobs.push(...(await searchBoard(b, query)));
        } catch (e) {
          failed.push(`${b.tenant}/${b.site}: ${String(e.message || e).slice(0, 60)}`);
        }
      }
    }),
  );
  return json({ jobs, checked: boards.length, failed });
}
