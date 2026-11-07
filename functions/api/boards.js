// Job boards that can't be read from the browser: Himalayas (no browser access), and
// Jooble, Google Jobs and USAJOBS (need API keys). POST /api/boards { query, location }
// Optional Cloudflare Pages secrets: JOOBLE_API_KEY (jooble.org/api/about), SERPAPI_API_KEY (serpapi.com: Google Jobs, which
// gathers postings from LinkedIn, Indeed, Dice, ZipRecruiter, Glassdoor and company sites).
// A board without its key is skipped.
const requestsByIp = new Map();
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
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
    if (cur.count >= 10) return false;
    cur.count += 1;
  } else requestsByIp.set(ip, { startedAt: now, count: 1 });
  if (requestsByIp.size > 5000) for (const [k, v] of requestsByIp) if (now - v.startedAt >= 60_000) requestsByIp.delete(k);
  return true;
}
const text = (s, n = 4000) =>
  String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function himalayas() {
  const out = [];
  for (let offset = 0; offset < 100; offset += 20) {
    const d = await getJson(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`);
    const rows = d.jobs || [];
    out.push(
      ...rows.map((j) => ({
        source: "Himalayas",
        id: j.guid || j.applicationLink || `${j.companyName}-${j.title}`,
        title: j.title,
        company: j.companyName,
        location: [...(j.locationRestrictions || []), "Remote"].join(" / "),
        url: j.applicationLink || j.guid,
        description: text(j.description || j.excerpt),
        tags: [j.employmentType, j.seniority].flat().filter(Boolean),
        published: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : "",
        salary: j.minSalary ? `${j.currency || ""} ${j.minSalary}–${j.maxSalary || ""}` : "",
      })),
    );
    if (rows.length < 20) break;
  }
  return out;
}
// US federal jobs: USAJOBS Search API. Secrets USAJOBS_API_KEY + USAJOBS_EMAIL (the email you
// registered at developer.usajobs.gov, which USAJOBS requires in the User-Agent header).
async function usajobs(env, query, location) {
  if (!env.USAJOBS_API_KEY || !env.USAJOBS_EMAIL || !query) return null;
  const params = new URLSearchParams({ Keyword: query, ResultsPerPage: "50", SortField: "opendate", SortDirection: "Desc" });
  if (/^remote/i.test(location || "")) params.set("RemoteIndicator", "True");
  else if (location && !/^(united states|usa|us)$/i.test(location)) params.set("LocationName", location);
  const d = await getJson(`https://data.usajobs.gov/api/search?${params}`, { headers: { "Authorization-Key": env.USAJOBS_API_KEY, "User-Agent": env.USAJOBS_EMAIL } });
  return (d.SearchResult?.SearchResultItems || []).map((item) => {
    const j = item.MatchedObjectDescriptor || {},
      pay = (j.PositionRemuneration || [])[0];
    return {
      source: "USAJOBS",
      id: j.PositionID || item.MatchedObjectId,
      title: j.PositionTitle,
      company: [j.OrganizationName, j.DepartmentName].filter(Boolean).join(" · "),
      location: j.PositionLocationDisplay,
      url: j.PositionURI,
      description: text([j.UserArea?.Details?.JobSummary, j.QualificationSummary, ...(j.UserArea?.Details?.MajorDuties || [])].filter(Boolean).join(" "), 6000),
      tags: [(j.PositionSchedule || [])[0]?.Name, "Federal"].filter(Boolean),
      published: j.PublicationStartDate,
      salary: pay ? `$${Math.round(pay.MinimumRange)}–$${Math.round(pay.MaximumRange)} ${pay.Description || ""}`.trim() : "",
    };
  });
}
// Google Jobs through SerpApi. One search per request (free plan: 250 a month), cached for 6 hours.
async function googleJobs(env, query, location) {
  if (!env.SERPAPI_API_KEY || !query) return null;
  const remote = /^remote/i.test(location || "");
  const params = new URLSearchParams({ engine: "google_jobs", q: remote ? `${query} remote` : query, hl: "en", gl: "us" });
  params.set("location", remote || !location ? "United States" : location);
  if (remote) params.set("ltype", "1");
  const cacheKey = new Request(`https://cache.the-looney-bin.local/google-jobs?${params}`);
  const cache = globalThis.caches?.default;
  let d = cache ? await cache.match(cacheKey).then((r) => r?.json()).catch(() => null) : null;
  if (!d) {
    params.set("api_key", env.SERPAPI_API_KEY);
    d = await getJson(`https://serpapi.com/search.json?${params}`);
    if (d.error && !/hasn.t returned any results/i.test(d.error)) throw new Error(d.error);
    if (cache) await cache.put(cacheKey, new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=21600" } })).catch(() => {});
  }
  return (d.jobs_results || []).map((j) => {
    const via = String(j.via || "").replace(/^via\s+/i, "").trim(),
      apply = j.apply_options || [],
      best = apply.find((a) => via && a.title?.toLowerCase().includes(via.toLowerCase())) || apply[0],
      ext = j.detected_extensions || {};
    return {
      source: "Google Jobs",
      id: j.job_id || `${j.company_name}-${j.title}`,
      title: j.title,
      company: j.company_name,
      location: j.location,
      url: best?.link || j.share_link || "",
      description: text(j.description, 6000),
      tags: [via && `via ${via}`, ext.schedule_type, ext.work_from_home && "Remote", ...apply.slice(0, 4).map((a) => a.title && `on ${a.title}`)].filter(Boolean),
      published: postedAgo(ext.posted_at),
      salary: ext.salary || "",
      applyOptions: apply.slice(0, 6).map((a) => ({ name: a.title, url: a.link })),
    };
  });
}
// "3 days ago" → ISO date.
function postedAgo(s) {
  const m = String(s || "").match(/(\d+)\s*(minute|hour|day|week|month)/i);
  if (!m) return "";
  const ms = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[m[2].toLowerCase()];
  return new Date(Date.now() - Number(m[1]) * ms).toISOString();
}
async function jooble(env, query, location) {
  if (!env.JOOBLE_API_KEY) return null;
  const d = await getJson(`https://jooble.org/api/${env.JOOBLE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords: query, location: /^remote/i.test(location || "") ? "" : location || "", page: 1 }),
  });
  return (d.jobs || []).map((j) => ({
    source: "Jooble",
    id: j.id,
    title: text(j.title, 200),
    company: j.company,
    location: j.location,
    url: j.link,
    description: text(j.snippet),
    tags: [j.type].filter(Boolean),
    published: j.updated,
    salary: j.salary || "",
  }));
}
export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request)) return json({ error: "same_origin_required" }, 403);
  if (!withinRateLimit(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "rate_limited" }, 429);
  const body = await request.json().catch(() => ({}));
  const query = String(body.query || "").slice(0, 200),
    location = String(body.location || "").slice(0, 120);
  const names = ["Himalayas", "Jooble", "Google Jobs", "USAJOBS"];
  const results = await Promise.allSettled([himalayas(), jooble(env, query, location), googleJobs(env, query, location), usajobs(env, query, location)]);
  const jobs = [],
    counts = {},
    errors = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      jobs.push(...r.value);
      counts[names[i]] = r.value.length;
    } else if (r.status === "rejected") errors[names[i]] = String(r.reason?.message || r.reason).slice(0, 120);
  });
  return json({ jobs, counts, errors, configured: { Jooble: !!env.JOOBLE_API_KEY, "Google Jobs": !!env.SERPAPI_API_KEY, USAJOBS: !!(env.USAJOBS_API_KEY && env.USAJOBS_EMAIL) } });
}
