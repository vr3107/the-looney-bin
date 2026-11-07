// Find which hiring system a company's own careers page uses (e.g. careers.company.com
// embeds Greenhouse). POST /api/detect-careers { url } → { found: { ats, slug } | null }
const PATTERNS = [
  ["greenhouse", /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([A-Za-z0-9_-]+)/],
  ["greenhouse", /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/],
  ["greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([A-Za-z0-9_-]+)/],
  ["lever", /api\.lever\.co\/v0\/postings\/([A-Za-z0-9_.-]+)/],
  ["lever", /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9_.-]+)/],
  ["ashby", /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9_.-]+)/],
  ["ashby", /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/],
  ["smartrecruiters", /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/],
  ["workable", /apply\.workable\.com\/([A-Za-z0-9_-]+)/],
  ["recruitee", /([a-z0-9-]+)\.recruitee\.com/],
];
const IGNORE = new Set(["embed", "api", "v1", "js", "static", "assets", "careers", "jobs", "widget", "favicon.ico"]);
function isPublicHost(host) {
  return /\./.test(host) && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[)/i.test(host) && !/\.(local|internal)$/i.test(host);
}
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export async function onRequestPost({ request }) {
  try {
    if (new URL(request.headers.get("Origin") || "").host !== new URL(request.url).host) return json({ error: "same_origin_required" }, 403);
  } catch {
    return json({ error: "same_origin_required" }, 403);
  }
  const { url } = await request.json().catch(() => ({}));
  let target;
  try {
    target = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
  } catch {
    return json({ found: null, error: "bad_url" });
  }
  if (!/^https?:$/.test(target.protocol) || !isPublicHost(target.hostname)) return json({ found: null, error: "bad_url" });
  try {
    const r = await fetch(target, { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; TheLooneyBin careers detector)" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (/myworkdayjobs\.com/i.test(r.url)) return json({ found: { unsupported: "Workday" } });
    const html = (await r.text()).slice(0, 600_000) + " " + r.url;
    for (const [ats, re] of PATTERNS) {
      const m = html.match(re);
      if (m && !IGNORE.has(m[1].toLowerCase())) return json({ found: { ats, slug: decodeURIComponent(m[1]) } });
    }
    if (/myworkdayjobs\.com/i.test(html)) return json({ found: { unsupported: "Workday" } });
    return json({ found: null });
  } catch (e) {
    return json({ found: null, error: String(e.message || e).slice(0, 100) });
  }
}
