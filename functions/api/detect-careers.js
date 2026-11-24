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
// Only ordinary public web addresses: a careers page is never an IP address, a local or internal
// name, a non-standard port, or an address with a user name or password in it.
export function isPublicUrl(u) {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  if (u.port && !((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80"))) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host.startsWith("[") || host.includes(":")) return false;
  if (/^[\d.]+$/.test(host) || /^0x/i.test(host)) return false; // IPv4 in any written form
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|private|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$/.test(host)) return false;
  return /^[a-z0-9.-]+$/.test(host) && /\.[a-z][a-z0-9-]*[a-z0-9]$/.test(host);
}
// Fetch a page, following up to 5 redirects and checking every address on the way.
async function fetchChecked(url) {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    if (!isPublicUrl(current)) throw new Error("bad_url");
    const r = await fetch(current, { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; TheLooneyBin careers detector)" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("Location")) {
      current = new URL(r.headers.get("Location"), current);
      continue;
    }
    return { r, finalUrl: current.href };
  }
  throw new Error("too_many_redirects");
}
// Read at most `limit` characters of the page.
async function readCapped(r, limit = 600_000) {
  if (!r.body) return "";
  const reader = r.body.getReader(),
    decoder = new TextDecoder();
  let text = "";
  while (text.length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text.slice(0, limit);
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
  const { url } = (await request.json().catch(() => null)) || {};
  if (typeof url !== "string" || url.length > 500) return json({ found: null, error: "bad_url" });
  let target;
  try {
    target = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
  } catch {
    return json({ found: null, error: "bad_url" });
  }
  if (!isPublicUrl(target)) return json({ found: null, error: "bad_url" });
  try {
    const { r, finalUrl } = await fetchChecked(target);
    if (/myworkdayjobs\.com/i.test(finalUrl)) return json({ found: { unsupported: "Workday" } });
    const html = (await readCapped(r)) + " " + finalUrl;
    for (const [ats, re] of PATTERNS) {
      const m = html.match(re);
      if (m && !IGNORE.has(m[1].toLowerCase())) return json({ found: { ats, slug: decodeURIComponent(m[1]) } });
    }
    if (/myworkdayjobs\.com/i.test(html)) return json({ found: { unsupported: "Workday" } });
    return json({ found: null });
  } catch (e) {
    return json({ found: null, error: e.message === "bad_url" ? "bad_url" : "unreachable" });
  }
}
