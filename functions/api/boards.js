// Job boards that can't be read from the browser: Himalayas and Working Nomads (no browser
// access), and Jooble, Google Jobs, USAJOBS and Adzuna (need API keys). POST /api/boards { query, location }
// A place search in the app adds { locationLong: "Cleveland, Ohio", radius: miles }, and each
// board is then asked for that town and the closest distance it supports.
// Optional Cloudflare Pages secrets: JOOBLE_API_KEY (jooble.org/api/about), SERPAPI_API_KEY (serpapi.com: Google Jobs, which
// gathers postings from LinkedIn, Indeed, Dice, ZipRecruiter, Glassdoor and company sites).
// ADZUNA_APP_ID + ADZUNA_APP_KEY (developer.adzuna.com, free). A board without its key is skipped.
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
async function getJson(url, init = {}, ms = 12_000) {
  const r = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) });
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
async function usajobs(env, query, location, place) {
  if (!env.USAJOBS_API_KEY || !env.USAJOBS_EMAIL || !query) return null;
  const params = new URLSearchParams({ Keyword: query, ResultsPerPage: "50", SortField: "opendate", SortDirection: "Desc" });
  if (place) {
    // USAJOBS writes places as "Atlanta, Georgia"; Radius is in miles.
    params.set("LocationName", place.long);
    params.set("Radius", String(Math.max(place.radius, 5)));
  } else if (/^remote/i.test(location || "")) params.set("RemoteIndicator", "True");
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
async function googleJobs(env, query, location, place) {
  if (!env.SERPAPI_API_KEY || !query) return null;
  const remote = !place && /^remote/i.test(location || "");
  const params = new URLSearchParams({ engine: "google_jobs", q: remote ? `${query} remote` : query, hl: "en", gl: "us" });
  params.set("location", place ? `${place.long}, United States` : remote || !location ? "United States" : location);
  if (remote) params.set("ltype", "1");
  // Distance in kilometres, in three steps (15, 35 and 100 miles) so nearby choices in the app share
  // one cached search instead of each using up a search from the monthly allowance.
  if (place) params.set("lrad", String(place.radius <= 15 ? 24 : place.radius <= 35 ? 56 : 161));
  const cacheKey = new Request(`https://cache.the-looney-bin.local/google-jobs?${params}`);
  const cache = globalThis.caches?.default;
  let d = cache ? await cache.match(cacheKey).then((r) => r?.json()).catch(() => null) : null;
  if (!d) {
    params.set("api_key", env.SERPAPI_API_KEY);
    // A new Google search through SerpApi can take 15–20 seconds.
    d = await getJson(`https://serpapi.com/search.json?${params}`, {}, 28_000);
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
// Working Nomads: remote jobs (public feed, no key). Remote only, so a place search skips it.
async function workingNomads() {
  const d = await getJson("https://www.workingnomads.com/api/exposed_jobs/");
  return (Array.isArray(d) ? d : []).slice(0, 300).map((j) => ({
    source: "Working Nomads",
    id: j.url || `${j.company_name}-${j.title}`,
    title: text(j.title, 200),
    company: j.company_name,
    location: [j.location, "Remote"].filter(Boolean).join(" / "),
    url: j.url,
    description: text(j.description),
    tags: [j.category_name, ...String(j.tags || "").split(",").map((t) => t.trim())].filter(Boolean).slice(0, 8),
    published: j.pub_date,
    salary: "",
  }));
}
// Adzuna (US): a large aggregator with a free developer key. Distance is in kilometres.
async function adzuna(env, query, location, place) {
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY || !query) return null;
  const remote = !place && /^remote/i.test(location || "");
  const params = new URLSearchParams({ app_id: env.ADZUNA_APP_ID, app_key: env.ADZUNA_APP_KEY, what: remote ? `${query} remote` : query, results_per_page: "50", sort_by: "date", "content-type": "application/json" });
  if (place) {
    params.set("where", place.long);
    params.set("distance", String(Math.max(Math.ceil(place.radius * 1.609), 5)));
  } else if (location && !remote && !/^(united states|usa|us|hybrid.*)$/i.test(location)) params.set("where", location);
  const d = await getJson(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`);
  return (d.results || []).map((j) => ({
    source: "Adzuna",
    id: String(j.id || j.redirect_url),
    title: text(j.title, 200),
    company: j.company?.display_name || "",
    location: j.location?.display_name || "",
    url: j.redirect_url,
    description: text(j.description),
    tags: [j.contract_time, j.contract_type, j.category?.label].filter(Boolean),
    published: j.created,
    salary: j.salary_min ? `$${Math.round(j.salary_min)}${j.salary_max && j.salary_max !== j.salary_min ? `–$${Math.round(j.salary_max)}` : ""}${j.salary_is_predicted === "1" ? " (estimate)" : ""}` : "",
  }));
}
// Jooble takes a distance only as one of these values in kilometres; each stands for a round number of miles.
const JOOBLE_RADIUS = [[0, "0"], [2.5, "4"], [5, "8"], [10, "16"], [16, "26"], [25, "40"], [50, "80"]];
async function jooble(env, query, location, place) {
  if (!env.JOOBLE_API_KEY) return null;
  const search = { keywords: query, location: /^remote/i.test(location || "") ? "" : location || "", page: 1 };
  // The closest Jooble distance that covers the miles asked for (80 km, about 50 miles, is its widest).
  if (place) search.radius = (JOOBLE_RADIUS.find(([miles]) => miles >= place.radius) || JOOBLE_RADIUS[JOOBLE_RADIUS.length - 1])[1];
  const d = await getJson(`https://jooble.org/api/${env.JOOBLE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(search),
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
  const body = (await request.json().catch(() => null)) || {};
  const query = String(body.query || "").slice(0, 200),
    location = String(body.location || "").slice(0, 120);
  // Place search: a whole number of miles (0–100) around the town in `location`.
  const miles = body.radius ?? null;
  if (miles !== null && !(typeof miles === "number" && Number.isInteger(miles) && miles >= 0 && miles <= 100)) return json({ error: "invalid_radius" }, 400);
  const place = miles !== null && location ? { radius: miles, long: String(body.locationLong || location).slice(0, 120) } : null;
  const names = ["Himalayas", "Working Nomads", "Jooble", "Google Jobs", "USAJOBS", "Adzuna"];
  // Himalayas and Working Nomads list remote jobs only, which a place search leaves out.
  const results = await Promise.allSettled([place ? null : himalayas(), place ? null : workingNomads(), jooble(env, query, location, place), googleJobs(env, query, location, place), usajobs(env, query, location, place), adzuna(env, query, location, place)]);
  const jobs = [],
    counts = {},
    errors = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      jobs.push(...r.value);
      counts[names[i]] = r.value.length;
    } else if (r.status === "rejected") errors[names[i]] = String(r.reason?.message || r.reason).slice(0, 120);
  });
  return json({ jobs, counts, errors, configured: { Jooble: !!env.JOOBLE_API_KEY, "Google Jobs": !!env.SERPAPI_API_KEY, USAJOBS: !!(env.USAJOBS_API_KEY && env.USAJOBS_EMAIL), Adzuna: !!(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) } });
}
