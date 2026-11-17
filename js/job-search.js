let feedStats = {},
  feedErrors = [],
  liveShown = 60,
  liveListingsCheckedAt = 0,
  baseListingsFetchedAt = 0,
  baseLiveListings = null,
  baseFeedStats = {};
const LIVE_REFRESH_MS = 5 * 60 * 1000;
let searchRun = 0; // counts searches, so an older one that finishes late can't replace newer results
// Place search (js/place-search.js): the area being searched, or null. Read by the board links too.
window.searchArea = null;
window.searchPlaceError = "";
window.searchPlaceErrorTitle = "";
// The nearest distance a job board's own search offers, at least as wide as the app's.
function boardRadius(miles, choices) {
  return choices.find((c) => c >= miles) ?? choices[choices.length - 1];
}
function plainText(html) {
  let d = new DOMParser().parseFromString(String(html || ""), "text/html");
  return (d.body.textContent || "").replace(/\s+/g, " ").trim();
}
async function getFeed(url) {
  let r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function baseJob(
  source,
  id,
  title,
  company,
  location,
  url,
  description,
  tags,
  published,
  salary = "",
) {
  return {
    id: `${source}:${id}`,
    source,
    sourceId: String(id),
    title: title || "Untitled role",
    company: company || "Company not listed",
    location: location || "Not specified",
    url: url || "",
    description: plainText(description).slice(0, 9000),
    tags: Array.isArray(tags) ? tags : [tags].filter(Boolean),
    published: published || "",
    salary,
    status: "Saved",
    added: Date.now(),
    sourceHome: {
      Jobicy: "https://jobicy.com/jobs",
      Arbeitnow: "https://www.arbeitnow.com",
      "Remote OK": "https://remoteok.com",
      Remotive: "https://remotive.com/remote-jobs",
      Dice: "https://www.dice.com/jobs",
    }[source],
  };
}
async function loadJobicy(progress) {
  let out = [],
    url = "https://jobicy.com/api/jobs?count=100";
  for (let p = 1; p <= 10 && url; p++) {
    progress(`Loading Jobicy page ${p}/10…`);
    try {
      let d = await getFeed(url);
      out.push(
        ...(d.jobs || []).map((j) =>
          baseJob(
            "Jobicy",
            j.id,
            j.jobTitle,
            j.companyName,
            j.jobGeo,
            j.url,
            j.jobDescription || j.jobExcerpt,
            [...(j.jobIndustry || []), ...(j.jobType || []), j.jobLevel].filter(
              Boolean,
            ),
            j.pubDate,
          ),
        ),
      );
      if (!d.nextCursor) break;
      url =
        "https://jobicy.com/api/jobs?" +
        new URLSearchParams({ count: "100", cursor: d.nextCursor });
    } catch (e) {
      feedErrors.push(
        `Jobicy stopped after ${out.length} listings (${e.message}).`,
      );
      break;
    }
  }
  feedStats.Jobicy = out.length;
  return out;
}
async function loadArbeitnow(progress) {
  let out = [];
  for (let p = 1; p <= 5; p++) {
    progress(`Loading Arbeitnow page ${p}/5…`);
    try {
      let d = await getFeed(
        `https://www.arbeitnow.com/api/job-board-api?page=${p}`,
      );
      let rows = d.data || [];
      out.push(
        ...rows.map((j) =>
          baseJob(
            "Arbeitnow",
            j.slug,
            j.title,
            j.company_name,
            `${j.location || ""}${j.remote ? " · Remote" : ""}`,
            j.url,
            j.description,
            j.tags || j.job_types,
            j.created_at,
          ),
        ),
      );
      if (!d.links?.next || !rows.length) break;
    } catch (e) {
      feedErrors.push(
        `Arbeitnow stopped after ${out.length} listings (${e.message}).`,
      );
      break;
    }
  }
  feedStats.Arbeitnow = out.length;
  return out;
}
async function loadRemoteOK(progress) {
  progress("Loading Remote OK…");
  try {
    let d = await getFeed("https://remoteok.com/api"),
      out = d
        .filter((j) => j && j.id && j.position)
        .map((j) =>
          baseJob(
            "Remote OK",
            j.id,
            j.position,
            j.company,
            j.location || "Remote",
            j.url || j.apply_url,
            j.description,
            j.tags,
            j.date,
            [j.salary_min, j.salary_max].filter(Boolean).join("–"),
          ),
        );
    feedStats["Remote OK"] = out.length;
    return out;
  } catch (e) {
    feedErrors.push(`Remote OK unavailable (${e.message}).`);
    feedStats["Remote OK"] = 0;
    return [];
  }
}
async function loadRemotive(progress) {
  progress("Loading Remotive…");
  try {
    let d = await getFeed("https://remotive.com/api/remote-jobs"),
      out = (d.jobs || []).map((j) =>
        baseJob(
          "Remotive",
          j.id,
          j.title,
          j.company_name,
          j.candidate_required_location,
          j.url,
          j.description,
          [j.category, j.job_type, ...(j.tags || [])].filter(Boolean),
          j.publication_date,
          j.salary,
        ),
      );
    feedStats.Remotive = out.length;
    return out;
  } catch (e) {
    feedErrors.push(`Remotive unavailable (${e.message}).`);
    feedStats.Remotive = 0;
    return [];
  }
}
// The same posting found on several boards: one card, with a link to each board.
// Matched by the hiring system's posting id, the link, or the title + company + town.
const COMPANY_SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|company|the|group|holdings|usa|us)\b/g;
function jobKeys(j) {
  let keys = [];
  if (j.atsKey) keys.push(j.atsKey);
  else if (j.ats && j.atsSlug && j.atsJobId) keys.push(`${j.ats}:${String(j.atsSlug).toLowerCase()}:${String(j.atsJobId).toLowerCase()}`);
  if (j.url) keys.push(String(j.url).replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase());
  let title = String(j.title || "").toLowerCase().replace(/\(.*?\)|[^a-z0-9]+/g, " ").trim(),
    company = String(j.company || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(COMPANY_SUFFIX, "").replace(/\s+/g, ""),
    town = "";
  try {
    let p = window.geoCore?.placesIn?.(j.location || "")[0];
    town = p ? `${p.key}.${p.st}` : "";
  } catch {}
  if (!town) town = String(j.location || "").toLowerCase().split(/[,/(]/)[0].replace(/[^a-z]+/g, "");
  if (title && company.length > 1) keys.push(`t:${title}|${company}|${town}`);
  return keys;
}
function uniqueJobs(jobs) {
  let map = new Map(),
    out = [];
  for (let j of jobs) {
    let keys = jobKeys(j),
      found = keys.map((k) => map.get(k)).find(Boolean);
    if (found) keys.forEach((k) => map.has(k) || map.set(k, found));
    else keys.forEach((k) => map.set(k, j));
    if (!found) {
      out.push(j);
      // extraSources: other boards carrying the same posting (e.g. Google Jobs' LinkedIn / Indeed links).
      j.sources = [{ name: j.source, url: j.url || j.sourceHome }, ...(j.extraSources || []).filter((s) => s.name !== j.source)];
    } else {
      if (!found.sources.some((s) => s.name === j.source))
        found.sources.push({ name: j.source, url: j.url || j.sourceHome });
      if ((j.description || "").length > (found.description || "").length) {
        found.description = j.description;
        found.needsDetails = false;
      }
      if (!found.salary && j.salary) found.salary = j.salary;
      if (!found.published || (j.published && new Date(j.published) > new Date(found.published))) found.published = j.published || found.published;
    }
  }
  return out;
}
function score(job) {
  let terms = resumeTerms();
  if (!terms.length) return null;
  let text = (
    job.title +
    " " +
    job.company +
    " " +
    job.description +
    " " +
    (job.tags || []).join(" ")
  ).toLowerCase();
  let hits = terms.filter((w) => text.includes(w)).length;
  return Math.round((100 * hits) / terms.length);
}
// area: the place search in force, if any; Dice is then asked for that town and distance.
async function loadDiceJobs(query, location, area) {
  window.diceStatus = { ok: false, count: 0, query: query || "", location: location || "" };
  if (!query) return [];
  const postedHours = document.getElementById("recencyfilter")?.value || "all";
  // Kept for five minutes under the search, the place and the distance asked for.
  const keyStart = `jobloom.dice.search.v1:${encodeURIComponent(query)}:${encodeURIComponent(location || "")}:`,
    keyEnd = `:${postedHours}`,
    cacheKey = `${keyStart}${area ? area.queryRadius : "any"}${keyEnd}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached?.at && Date.now() - cached.at < LIVE_REFRESH_MS && Array.isArray(cached.jobs)) {
      feedStats.Dice = cached.jobs.length;
      Object.assign(window.diceStatus, { ok: true, count: cached.jobs.length });
      return cached.jobs;
    }
  } catch {}

  try {
    const response = await fetch("/api/dice-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query,
        location,
        postedHours,
        ...(area ? { radius: area.queryRadius } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 429) {
      // Too many searches in a minute. A wider search of the same place from the last few minutes
      // holds these postings too (the results are narrowed to the distance afterwards).
      if (area)
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i) || "";
          if (!key.startsWith(keyStart) || !key.endsWith(keyEnd)) continue;
          const wider = Number(key.slice(keyStart.length, key.length - keyEnd.length));
          if (!(wider > area.queryRadius)) continue;
          let kept = null;
          try {
            kept = JSON.parse(sessionStorage.getItem(key) || "null");
          } catch {}
          if (kept?.at && Date.now() - kept.at < LIVE_REFRESH_MS && Array.isArray(kept.jobs)) {
            feedStats.Dice = kept.jobs.length;
            Object.assign(window.diceStatus, { ok: true, count: kept.jobs.length });
            return kept.jobs;
          }
        }
      window.diceStatus.detail = "rate_limited";
      throw new Error("Dice search is temporarily unavailable.");
    }
    if (!response.ok) {
      window.diceStatus.detail = payload.detail || "";
      throw new Error("Dice search is temporarily unavailable.");
    }
    if (payload.error) throw new Error("Dice search is temporarily unavailable.");
    const jobs = uniqueJobs((payload.jobs || []).map((j, index) => {
      const tags = [
        ...(Array.isArray(j.workplaceTypes) ? j.workplaceTypes : []),
        j.employmentType,
        ...(j.easyApply ? ["Easy Apply"] : []),
      ].filter(Boolean);
      const diceLocation = normalizeLocation(location);
      const diceState = requestedUSState(diceLocation);
      const remoteInUS = /^(remote us|remote from usa|remote from united states|us remote)$/.test(diceLocation) ||
        diceLocation === "united states" || Boolean(diceState);
      const hybridInUS = /^(hybrid us|hybrid in usa|hybrid in united states|us hybrid)$/.test(diceLocation) ||
        diceLocation === "united states" || Boolean(diceState);
      if (remoteInUS && (j.isRemote || tags.some((tag) => /remote/i.test(tag)))) {
        tags.push(diceState ? `Remote in ${diceState[0]}` : "Remote in United States");
      }
      if (hybridInUS && tags.some((tag) => /hybrid/i.test(tag))) {
        tags.push(diceState ? `Hybrid in ${diceState[0]}` : "Hybrid in United States");
      }
      const item = baseJob(
        "Dice",
        j.guid || j.id || index,
        j.title,
        j.companyName || j.company?.name,
        j.jobLocation?.displayName || j.location || "Not specified",
        j.detailsPageUrl || j.url,
        j.summary || j.description,
        tags,
        j.postedDate || j.publicationDate,
        j.salary || "",
      );
      item.url = j.detailsPageUrl || j.url || "";
      item.easyApply = Boolean(j.easyApply);
      item.companyPageUrl = j.companyPageUrl || "";
      return item;
    }));
    feedStats.Dice = jobs.length;
    Object.assign(window.diceStatus, { ok: true, count: jobs.length });
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), jobs }));
    } catch {}
    return jobs;
  } catch (error) {
    feedStats.Dice = 0;
    return [];
  }
}
// Direct Dice search URL for one role, carrying the app's location, workplace and posting-age filters.
function diceSearchUrl(role, location) {
  const area = window.searchArea;
  if (area) location = area.query;
  const normalized = normalizeLocation(location);
  const isRemoteUS = /^(remote us|remote from usa|remote from united states|us remote|remote usa)$/.test(normalized);
  const isHybridUS = /^(hybrid us|hybrid in usa|hybrid in united states|us hybrid|hybrid usa)$/.test(normalized);
  const url = new URL("https://www.dice.com/jobs");
  url.searchParams.set("q", role);
  if (isRemoteUS || isHybridUS) url.searchParams.set("location", "United States");
  else if (location && normalized !== "remote") url.searchParams.set("location", location);
  const workplace = document.getElementById("workplacefilter")?.value || "all";
  if (isRemoteUS || normalized === "remote" || workplace === "Remote") url.searchParams.set("filters.workplaceTypes", "Remote");
  else if (isHybridUS || workplace === "Hybrid") url.searchParams.set("filters.workplaceTypes", "Hybrid");
  else if (workplace === "On-site") url.searchParams.set("filters.workplaceTypes", "On-Site");
  const hours = Number(document.getElementById("recencyfilter")?.value);
  if (hours > 0 && hours <= 24) url.searchParams.set("filters.postedDate", "ONE");
  else if (hours > 24 && hours <= 72) url.searchParams.set("filters.postedDate", "THREE");
  else if (hours > 72 && hours <= 168) url.searchParams.set("filters.postedDate", "SEVEN");
  if (area) url.searchParams.set("radius", String(Math.max(area.queryRadius, 5)));
  url.searchParams.set("radiusUnit", "mi");
  return url.href;
}
const EXTERNAL_BOARDS = [
  ["Dice", "https://www.dice.com/jobs"],
  ["LinkedIn", "https://www.linkedin.com/jobs/search/"],
  ["Indeed", "https://www.indeed.com/jobs"],
  ["ZipRecruiter", "https://www.ziprecruiter.com/jobs-search/"],
  ["Glassdoor", "https://www.glassdoor.com/Job/jobs.htm"],
  ["Adzuna", "https://www.adzuna.com/search"],
  ["Google Jobs", "https://www.google.com/search"],
];
// Boards whose postings are listed inside the app (the rest open as external searches).
const LISTED_BOARDS = ["Company sites", "Job index", "Dice", "Google Jobs", "HN Who is hiring", "USAJOBS", "Himalayas", "Jooble", "Jobicy", "Arbeitnow", "Remote OK", "Remotive"];
function selectedBoard() {
  return document.getElementById("boardfilter")?.value || "all";
}
function boardSearchUrl(label, role, location) {
  if (label === "Dice") return diceSearchUrl(role, location);
  const board = EXTERNAL_BOARDS.find(([name]) => name === label);
  if (!board) return "";
  // A place search sends the place and the board's closest distance setting. Indeed, ZipRecruiter and
  // Google take a ZIP code as it is; the others are given the town.
  const area = window.searchArea,
    takesZip = /indeed|ziprecruiter|google/.test(board[1]);
  if (area) location = takesZip ? area.query : area.town;
  const areaRadius = area ? (takesZip ? area.queryRadius : area.townRadius) : 0;
  const normalizedLocation = normalizeLocation(location);
  const isRemoteUS = /^(remote us|remote from usa|remote from united states|us remote)$/.test(normalizedLocation);
  const isHybridUS = /^(hybrid us|hybrid in usa|hybrid in united states|us hybrid)$/.test(normalizedLocation);
  const externalLocation = isRemoteUS || isHybridUS ? "United States" : location;
  const q = `${role}${isRemoteUS ? " remote" : ""}${isHybridUS ? " hybrid" : ""}`;
  const url = new URL(board[1]);
  // Carry the app's filters (posting age, workplace, job type, level) into the board's own search.
  const hours = Number(document.getElementById("recencyfilter")?.value) || 0,
    workplace = isRemoteUS ? "Remote" : isHybridUS ? "Hybrid" : document.getElementById("workplacefilter")?.value || "all",
    jobType = document.getElementById("typefilter")?.value || "all",
    level = document.getElementById("levelfilter")?.value || "all";
  if (url.hostname.includes("linkedin.com")) {
    url.searchParams.set("keywords", role);
    if (externalLocation) url.searchParams.set("location", externalLocation);
    if (area) url.searchParams.set("distance", String(boardRadius(areaRadius, [0, 5, 10, 25, 50, 100])));
    if (hours) url.searchParams.set("f_TPR", `r${hours * 3600}`);
    const wt = { Remote: "2", Hybrid: "3", "On-site": "1" }[workplace];
    if (wt) url.searchParams.set("f_WT", wt);
    const jt = { "Full-time": "F", Contract: "C", "Part-time": "P", Internship: "I" }[jobType];
    if (jt) url.searchParams.set("f_JT", jt);
    const exp = { Internship: "1", "Entry level": "2", "Mid level": "3,4", Senior: "4", "Lead / Staff": "4,5", Manager: "4,5" }[level];
    if (exp) url.searchParams.set("f_E", exp);
    url.searchParams.set("sortBy", "DD");
  } else if (url.hostname.includes("indeed.com")) {
    url.searchParams.set("q", workplace === "all" || workplace === "On-site" ? role : `${role} ${workplace.toLowerCase()}`);
    if (externalLocation) url.searchParams.set("l", externalLocation);
    if (area) url.searchParams.set("radius", String(boardRadius(areaRadius, [0, 5, 10, 15, 25, 35, 50, 100])));
    if (hours) url.searchParams.set("fromage", String([1, 3, 7, 14].find((d) => d * 24 >= hours) || 14));
    const jt = { "Full-time": "fulltime", Contract: "contract", "Part-time": "parttime", Internship: "internship" }[jobType];
    if (jt) url.searchParams.set("jt", jt);
    url.searchParams.set("sort", "date");
  } else if (url.hostname.includes("adzuna.com")) {
    url.searchParams.set("q", q);
    if (externalLocation) url.searchParams.set("w", externalLocation);
  } else if (url.hostname.includes("glassdoor.com")) {
    url.searchParams.set("sc.keyword", `${q}${externalLocation ? " " + externalLocation : ""}`);
    if (hours) url.searchParams.set("fromAge", String([1, 3, 7, 14, 30].find((d) => d * 24 >= hours) || 30));
  } else if (url.hostname.includes("ziprecruiter.com")) {
    url.searchParams.set("search", q);
    if (externalLocation) url.searchParams.set("location", externalLocation);
    if (area) url.searchParams.set("radius", String(boardRadius(areaRadius, [5, 10, 25, 50, 100])));
    if (hours) url.searchParams.set("days", String([1, 5, 10, 30].find((d) => d * 24 >= hours) || 30));
  } else {
    url.searchParams.set("ibp", "htl;jobs");
    url.searchParams.set("q", area ? `${q} jobs near ${externalLocation}` : `${q} jobs ${externalLocation || ""}`.trim());
  }
  return url.href;
}
function searchRoles(query) {
  return (query || "jobs").split(",").map((role) => role.trim()).filter(Boolean).slice(0, 5);
}
function renderExternalSearchLinks(query, location) {
  window.lastBoardSearch = { query, location };
  const links = document.getElementById("boardlinks");
  if (!links) return;
  const board = selectedBoard(),
    boards = EXTERNAL_BOARDS.filter(([label]) => board === "all" || label === board);
  if (!boards.length) {
    links.innerHTML = `<div class="help">Showing postings listed from <strong>${esc(board)}</strong> only. Choose “All job boards” to search every board again.</div>`;
    return;
  }
  links.innerHTML = `<details${board === "all" ? "" : " open"}><summary>Search ${board === "all" ? "these boards" : esc(board)} directly on their sites</summary><div class="help">${searchRoles(query).map((role) => `<span style="display:block;margin-top:5px">${esc(role)}: ${boards.map(([label]) => `<a href="${esc(boardSearchUrl(label, role, location))}" target="_blank" rel="noopener" style="color:var(--green)">${esc(label)} ↗</a>`).join(" · ")}</span>`).join("")}<span style="display:block;margin-top:7px">${board === "all" ? "Results from the connected public feeds (including Dice when its service responds) are ranked below; these links open the board’s own search results. LinkedIn does not provide this app an open job-listing feed." : LISTED_BOARDS.includes(board) ? `Only ${esc(board)} postings are shown below; this link opens ${esc(board)}’s own search results.` : `${esc(board)} doesn’t provide this app a job-listing feed, so its postings open on ${esc(board)}’s site.`}</span></div></details>`;
}
window.setBoardFilter = function () {
  liveShown = 60;
  const last = window.lastBoardSearch;
  if (last) renderExternalSearchLinks(last.query, last.location);
  renderJobs();
};
async function searchBoards() {
  if (!String(data.profile.resume || "").trim()) {
    toast("Add your resume in My profile before searching for matches.");
    navigate("profile");
    return;
  }
  const run = ++searchRun;
  liveMode = true;
  liveShown = 60;
  feedStats = { ...baseFeedStats };
  feedErrors = [];
  let box = document.getElementById("jobs"),
    progress = (s) => {
      if (run !== searchRun) return;
      box.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>Building your job results…</strong><p>${esc(s)}<br>Fetching multiple pages, then ranking listings against your resume.</p></div>`;
    };
  progress("Connecting to public job feeds…");
  // A city, town, ZIP code or "near me" with a distance, if one is set.
  window.searchPlaceError = "";
  const where = window.geoSearch ? await window.geoSearch.prepare().catch(() => ({ error: "The place couldn’t be worked out. Check the city, town or ZIP code and search again." })) : {};
  if (run !== searchRun) return false;
  if (where.error) {
    window.searchArea = null;
    window.searchPlaceError = where.error;
    window.searchPlaceErrorTitle = where.title || "That place wasn’t found.";
    window.liveResults = [];
    renderJobs();
    return;
  }
  const area = where.area || null;
  window.searchArea = area;
  try {
    let baseJobs = Array.isArray(baseLiveListings) &&
      Date.now() - baseListingsFetchedAt < LIVE_REFRESH_MS
      ? baseLiveListings
      : null;
    if (!baseJobs) {
      let cached = null;
      try {
        cached = JSON.parse(
        sessionStorage.getItem("jobloom.aggregate.v2") || "null",
        );
      } catch {}
      if (
        cached?.at &&
        Date.now() - cached.at < LIVE_REFRESH_MS &&
        Array.isArray(cached.jobs)
      ) {
        baseJobs = cached.jobs;
        baseFeedStats = cached.stats || {};
        baseListingsFetchedAt = cached.at;
        feedStats = { ...baseFeedStats };
      } else {
        let groups = await Promise.all([
          loadJobicy(progress),
          loadArbeitnow(progress),
          loadRemoteOK(progress),
          loadRemotive(progress),
        ]);
        baseJobs = uniqueJobs(groups.flat());
        baseListingsFetchedAt = Date.now();
        baseFeedStats = { ...feedStats };
        try {
          let compact = baseJobs.map((j) => ({
            ...j,
            description: j.description.slice(0, 1600),
          }));
          sessionStorage.setItem(
            "jobloom.aggregate.v2",
            JSON.stringify({ at: baseListingsFetchedAt, jobs: compact, stats: baseFeedStats }),
          );
        } catch {}
      }
    }
    baseLiveListings = baseJobs;
    let q = (document.getElementById("query").value || "").trim().toLowerCase(),
      // With a place search the town decides where; otherwise the state box (or the profile's location).
      loc = area
        ? area.query
        : (
            document.getElementById("location").value ||
            data.profile.location ||
            ""
          )
            .trim()
            .toLowerCase(),
      searchQuery = q ||
        (window.activeResume && window.activeResume()?.targetRoles) ||
        data.profile.role ||
        "",
      parsedSearch = parseJobSearch(searchQuery),
      roleQueries = parsedSearch.terms,
      plainQuery = roleQueries.map((t) => t.raw).join(", ") || searchQuery,
      saved = new Set(data.jobs.map((x) => x.url).filter(Boolean));
    window.lastParsedSearch = parsedSearch;
    // Dice, company career sites, and the other boards load together.
    // "Related titles" on: Dice is also asked about one related title per searched role (up to 4 in all).
    let diceQuery = plainQuery;
    if (window.searchRelatedTitles !== false && typeof relatedTitles === "function") {
      let extra = roleQueries.slice(0, 2).flatMap((r) => relatedTitles(r, 1));
      diceQuery = [...new Set([...roleQueries.map((t) => t.raw), ...extra])].slice(0, 4).join(", ") || plainQuery;
    }
    const [diceJobs, extraJobs] = await Promise.all([
      loadDiceJobs(diceQuery, loc, area),
      typeof window.loadExtraJobSources === "function" ? window.loadExtraJobSources(roleQueries, plainQuery, loc, progress, area) : [],
    ]);
    if (run !== searchRun) return false;
    let all = uniqueJobs([...baseJobs, ...diceJobs, ...extraJobs]);
    liveListings = all;
    liveListingsCheckedAt = Date.now();
    renderExternalSearchLinks(plainQuery, loc);
    let results = all
      .filter(
        (j) =>
          !saved.has(j.url) &&
          !jobExcluded(j, parsedSearch.exclude) &&
          // A place search keeps only postings that name a town inside the distance.
          (area ? area.within(j) : jobMatchesLocation(loc, j.location, j.tags, j.source)) &&
          (!roleQueries.length ||
            roleQueries.some((role) => roleRelevance(j, role) > 0)),
      )
      .map((j) => {
        let m = score(j);
        const roleScore = roleQueries.length
          ? Math.max(...roleQueries.map((role) => roleRelevance(j, role)))
          : 0;
        let text = (
          j.title +
          " " +
          j.company +
          " " +
          j.description +
          " " +
          j.tags.join(" ")
        ).toLowerCase();
        return {
          ...j,
          // Miles from the centre of the search to the posting's town (place searches only).
          distance: area ? area.distance(j) : null,
          roleScore,
          roleLabel:
            roleQueries.some((role) => companyRelevance(j, role))
              ? "Company match"
              : roleScore >= 88
              ? "Direct role match"
              : roleScore >= 60
                ? "Related role"
                : roleScore > 0
                  ? "Broader role match"
                  : "",
          match: m === null ? 0 : m,
          matchTerms: resumeTerms()
            .filter((w) => text.includes(w))
            .slice(0, 5),
        };
      })
      .sort(
        (a, b) =>
          b.roleScore - a.roleScore ||
          b.match - a.match ||
          new Date(b.published) - new Date(a.published),
      );
    window.liveResults = results;
    renderJobs();
  } catch (e) {
    if (run !== searchRun) return false;
    window.liveResults = [];
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="bigico">↯</div><strong>Couldn’t load job listings.</strong><p>${esc(e.message || "Check your internet connection and try again.")}</p><button class="btn btn-sm" style="margin-top:13px" onclick="searchBoards()">Try again</button></div>`;
  }
}
function renderJobs() {
  let box = document.getElementById("jobs");
  if (!box) return;
  let f = document.getElementById("matchfilter")?.value || "all";
  if (liveMode) {
    if (window.searchPlaceError) {
      document.getElementById("jobcount").textContent = "";
      box.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>${esc(window.searchPlaceErrorTitle || "That place wasn’t found.")}</strong><p>${esc(window.searchPlaceError)}</p></div>`;
      return;
    }
    const area = window.searchArea,
      sort = document.getElementById("sortfilter")?.value;
    let all = window.liveResults || [],
      arr = f === "all" ? all : all.filter((x) => x.match >= Number(f));
    if (sort === "nearest" && area)
      // Whole miles, so postings in the same town stay ranked by fit.
      arr = [...arr].sort(
        (a, b) =>
          Math.round(a.distance ?? 1e6) - Math.round(b.distance ?? 1e6) ||
          (b.roleScore || 0) - (a.roleScore || 0) ||
          b.match - a.match ||
          new Date(b.published) - new Date(a.published),
      );
    else if (sort === "recent")
      arr = [...arr].sort(
        (a, b) =>
          (b.roleScore || 0) - (a.roleScore || 0) ||
          new Date(b.published) - new Date(a.published),
      );
    else
      arr = [...arr].sort(
        (a, b) =>
          (b.roleScore || 0) - (a.roleScore || 0) ||
          b.match - a.match ||
          new Date(b.published) - new Date(a.published),
      );
    const board = selectedBoard();
    if (board !== "all")
      arr = arr.filter((x) =>
        (x.sources || [{ name: x.source }]).some((src) => src.name === board),
      );
    arr = arr.filter(window.jobPassesFilters);
    window.refreshFilterChips();
    let visible = arr.slice(0, liveShown),
      pool = liveListings?.length || 0,
      stats = Object.entries(feedStats)
        .map(([n, c]) => `${n} ${c}`)
        .join(" · "),
      count = document.getElementById("jobcount");
    const checked = liveListingsCheckedAt
      ? ` · checked ${new Date(liveListingsCheckedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "";
    count.textContent = `${(window.activeResume && window.activeResume()?.name) || "Resume"} · ${arr.length.toLocaleString()} result${arr.length === 1 ? "" : "s"}${area ? " " + area.describe() : ""} from ${pool.toLocaleString()} listings${stats ? " · " + stats : ""}${checked}`;
    let summary = feedErrors.length
      ? `<div class="analysis-note" style="grid-column:1/-1">Some feeds were unavailable: ${esc(feedErrors.join(" "))}</div>`
      : "";
    const dice = window.diceStatus;
    if (board !== "all" && !LISTED_BOARDS.includes(board) && !arr.length) {
      const last = window.lastBoardSearch || {};
      box.innerHTML = `<div class="analysis-note dice-note" style="grid-column:1/-1"><strong>${esc(board)}:</strong> ${esc(board)} doesn’t provide this app a job-listing feed${(liveListings || []).some((j) => j.source === "Google Jobs") ? " and no Google Jobs result for this search was posted there" : " (add a free SerpApi key to see its postings through Google Jobs)"}. Open the same search on ${esc(board)}:<span class="dice-links">${searchRoles(last.query).map((r) => `<a class="btn btn-sm" style="text-decoration:none" href="${esc(boardSearchUrl(board, r, last.location))}" target="_blank" rel="noopener">${esc(r)} on ${esc(board)} ↗</a>`).join("")}</span></div>`;
      return;
    }
    if (dice && (board === "all" || board === "Dice") && (!dice.ok || !dice.count)) {
      const diceRoles = String(dice.query || "").split(",").map((r) => r.trim()).filter(Boolean).slice(0, 5);
      if (diceRoles.length)
        summary += `<div class="analysis-note dice-note" style="grid-column:1/-1"><strong>Dice:</strong> ${dice.ok ? "Dice returned no postings for this search." : dice.detail === "rate_limited" ? "Dice can be searched a few times a minute through this app, and that limit was just reached. Search again in a minute to list its postings." : (/login|access token|password/i.test(dice.detail || "") ? "Dice’s job search service is down on Dice’s side right now (its sign-in to Dice’s own systems is failing), so its postings can’t be listed here until Dice fixes it." : "Dice’s job search service isn’t responding right now, so its postings can’t be listed here.")}${arr.some((x) => x.source !== "Dice" && (x.sources || []).some((src) => src.name === "Dice")) ? " Dice postings found through Google Jobs are shown below." : ""} Open the same search on Dice:<span class="dice-links">${diceRoles.map((r) => `<a class="btn btn-sm" style="text-decoration:none" href="${esc(diceSearchUrl(r, dice.location))}" target="_blank" rel="noopener">${esc(r)} on Dice ↗</a>`).join("")}</span></div>`;
    }
    // A place search with only a handful of results: offer wider distances and the big boards' own searches.
    if (area && arr.length && arr.length < 8 && board === "all" && !window.showHiddenJobs) {
      const role = searchRoles((window.lastBoardSearch || {}).query)[0],
        widerSteps = [25, 50, 100].filter((miles) => miles > area.radius).slice(0, 2);
      summary += `<div class="analysis-note dice-note" style="grid-column:1/-1"><strong>${arr.length} posting${arr.length === 1 ? " names" : "s name"} a town ${esc(area.describe())}.</strong> Company career sites and job feeds list fewer openings outside the largest cities.${widerSteps.length ? " Try a wider distance, or" : " You can also"} run the same search on the big job boards, which carry the place and distance:<span class="dice-links">${widerSteps.map((miles) => `<button class="btn btn-sm" onclick="geoSearch.widen(${miles})">Within ${miles} miles</button>`).join("")}${["LinkedIn", "Indeed", "ZipRecruiter", "Dice", "Google Jobs"].map((name) => `<a class="btn btn-sm" style="text-decoration:none" href="${esc(boardSearchUrl(name, role, area.query))}" target="_blank" rel="noopener">${esc(name)} ↗</a>`).join("")}</span></div>`;
    }
    if (!arr.length) {
      // With a place search, offer the next distances up.
      const wider = area && !window.showHiddenJobs ? [25, 50, 100].filter((miles) => miles > area.radius).slice(0, 2) : [];
      box.innerHTML =
        summary +
        `<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>${area && !window.showHiddenJobs ? `No postings found ${esc(area.describe())}.` : "No postings matched this filter."}</strong><p>${window.showHiddenJobs ? "You haven’t hidden any jobs that match these filters." : area ? "Only postings that name a town inside this distance are shown. Try a wider distance, a nearby city, or fewer filters." : "Try widening the filters above, or choose “All job boards” and “All match scores”."}</p>${wider.length ? `<div class="empty-actions">${wider.map((miles) => `<button class="btn" onclick="geoSearch.widen(${miles})">Search within ${miles} miles</button>`).join("")}<button class="btn" onclick="geoSearch.clear()">Search without a place</button></div>` : ""}</div>`;
      return;
    }
    box.innerHTML =
      summary +
      visible
        .map((x) => window.jobCardHtml(x))
        .join("") +
      (arr.length > visible.length
        ? `<button class="btn" style="grid-column:1/-1" onclick="liveShown+=60;renderJobs()">Show 60 more · ${arr.length - visible.length} remaining</button>`
        : "");
    return;
  }
  let arr = [...data.jobs];
  if (f !== "all") arr = arr.filter((x) => (score(x) ?? 0) >= Number(f));
  if (document.getElementById("sortfilter")?.value === "match")
    arr.sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0));
  else arr.sort((a, b) => b.added - a.added);
  document.getElementById("jobcount").textContent =
    `${arr.length} saved role${arr.length === 1 ? "" : "s"}`;
  box.innerHTML = arr.length
    ? arr
        .map((x) => {
          let s = score(x);
          return `<article class="card job"><div class="jobtop"><div style="display:flex;gap:11px"><div class="companylogo">${esc((x.company || "?")[0].toUpperCase())}</div><div><h3>${esc(x.title)}</h3><div class="company">${esc(x.company)}${x.location ? " · " + esc(x.location) : ""}</div></div></div><span class="score">${s === null ? "Add resume" : s + "% match"}</span></div><div class="tags">${
            (x.tags || [])
              .slice(0, 4)
              .map((t) => `<span class="tag">${esc(t)}</span>`)
              .join("") || '<span class="tag">Added by you</span>'
          }</div><div class="jobfoot"><span>${x.salary ? esc(x.salary) + " · " : ""}${statusPill(x.status)}</span><div style="display:flex;gap:7px"><button class="btn btn-sm" onclick="openDetails(decodeURIComponent('${encodeURIComponent(x.id)}'))">Details</button>${x.url ? `<a class="btn btn-sm" style="text-decoration:none" href="${esc(x.url)}" target="_blank" rel="noopener">Open role ↗</a>` : ""}</div></div></article>`;
        })
        .join("")
    : `<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>No saved roles yet.</strong><p>Find live resume matches above, then save openings to track your next steps.</p><button class="btn btn-sm" style="margin-top:13px" onclick="openModal('job')">＋ Add a role manually</button></div>`;
}
function saveLive(id) {
  let x = (liveListings || []).find((j) => j.id === id);
  if (!x) return;
  if (data.jobs.some((j) => j.url === x.url)) {
    toast("This role is already in your tracker.");
    return;
  }
  data.jobs.push({
    ...x,
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    added: Date.now(),
    status: "Saved",
  });
  persist();
  toast("Role saved to your application tracker.");
}

function plainText(html) {
  let source = String(html || "")
    .replace(/<\s*br\b[^>]*>/gi, "\n")
    .replace(/<\s*\/(?:p|div|li|h[1-6]|tr)\s*>/gi, "\n");
  let d = new DOMParser().parseFromString(source, "text/html");
  return (d.body.textContent || "")
    .split(/\n+/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
(() => {
  const oldSearch = window.searchBoards;
  function setAgeFilter() {
    let all = window.allLiveResults || [],
      v = document.getElementById("recencyfilter")?.value || "all";
    if (v === "all") {
      window.liveResults = all;
      return;
    }
    let cutoff = Date.now() - Number(v) * 3600000;
    window.liveResults = all.filter((j) => {
      let t = Date.parse(j.published || "");
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  window.searchBoards = async () => {
    if ((await oldSearch()) === false) return; // overtaken by a newer search
    window.allLiveResults = window.liveResults || [];
    setAgeFilter();
    renderJobs();
  };
  let age = document.getElementById("recencyfilter");
  if (age)
    age.onchange = () => {
      setAgeFilter();
      renderJobs();
    };
})();
setInterval(() => {
  const discover = document.getElementById("page-discover");
  if (
    liveMode &&
    document.visibilityState !== "hidden" &&
    discover &&
    !discover.classList.contains("hidden") &&
    // not while a place is being typed: the refresh would read the half-typed name
    document.activeElement?.id !== "place" &&
    Date.now() - liveListingsCheckedAt >= LIVE_REFRESH_MS
  ) {
    window.searchBoards();
  }
}, 60 * 1000);
function jobMatchExplanation(job) {
  let resume = data.profile.resume || "",
    resumeLow = resume.toLowerCase(),
    body = (
      job.title +
      " " +
      job.description +
      " " +
      (job.tags || []).join(" ")
    ).toLowerCase(),
    terms = resumeTerms(),
    matched = terms.filter((w) => body.includes(w)),
    missing = terms.filter((w) => !body.includes(w)),
    roleText = (data.profile.role || "").trim(),
    roleWords = [
      ...new Set(
        (roleText.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []).filter(
          (w) =>
            ![
              "the",
              "and",
              "for",
              "with",
              "of",
              "to",
              "in",
              "or",
              "a",
              "an",
            ].includes(w),
        ),
      ),
    ],
    title = (job.title || "").toLowerCase(),
    roleHit = roleWords.filter((w) => title.includes(w)),
    yearsRE =
      /\b(?:at least\s+|minimum(?: of)?\s+|over\s+)?(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+|professional\s+|work\s+)?experience\b/gi,
    jobYears = [...String(job.description || "").matchAll(yearsRE)].map((m) =>
      Number(m[1]),
    ),
    resumeYears = [...resume.matchAll(yearsRE)].map((m) => Number(m[1])),
    sentences = String(job.description || "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((x) => x.trim())
      .filter(Boolean),
    requirements = sentences
      .filter((x) =>
        /\b(required|must|minimum|experience|proficien|qualification|degree|certif|license|years?)\b/i.test(
          x,
        ),
      )
      .slice(0, 4),
    resumeLines = resume
      .split(/\n+|(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 30),
    evidence = resumeLines
      .filter((line) => matched.some((w) => line.toLowerCase().includes(w)))
      .slice(0, 3),
    credTerms = [
      ...new Set(
        (
          String(job.description || "").match(
            /\b(?:bachelor(?:'s)?|master(?:'s)?|ph\.d\.?|degree|certification|certified|license|licence|CPA|PMP)\b/gi,
          ) || []
        ).map((x) => x.toLowerCase()),
      ),
    ],
    credMissing = credTerms.filter((w) => !resumeLow.includes(w));
  return {
    terms,
    matched,
    missing,
    roleWords,
    roleHit,
    jobYears,
    resumeYears,
    requirements,
    evidence,
    credTerms,
    credMissing,
  };
}
function openDetails(id) {
  let x =
    data.jobs.find((a) => a.id === id) ||
    (liveListings || []).find((a) => a.id === id);
  if (!x) return;
  let p = data.profile,
    roleText = String(
      x.targetRoles || jobResume(x)?.targetRoles || p.role || "",
    ).trim(),
    b = jobMatchExplanation(x),
    skillTerms = b.terms.filter((w) => !b.roleWords.includes(w)),
    skillHits = skillTerms.filter((w) => b.matched.includes(w)),
    skillMiss = skillTerms.filter((w) => b.missing.includes(w)),
    value = x.match ?? score(x),
    roleStatus = !b.roleWords.length
      ? "Add preferred roles in My profile for a title comparison"
      : `${b.roleHit.length} of ${b.roleWords.length} target-role words appear in this title`,
    skillSummary = skillHits.length
      ? skillHits.join(", ")
      : "No sampled job keywords found in the resume",
    notFound = skillMiss.length
      ? skillMiss.join(", ")
      : "All sampled job keywords appear somewhere in the resume",
    yearsText = b.jobYears.length
      ? `Posting states ${Math.max(...b.jobYears)} years of experience. ` +
        (b.resumeYears.length
          ? `Resume explicitly states ${Math.max(...b.resumeYears)} years.`
          : "No total years-of-experience figure was found in the resume text.")
      : "No explicit years-of-experience requirement was detected in the posting.",
    isSaved = data.jobs.some((a) => a.id === id),
    evidenceHtml = b.evidence.length
      ? b.evidence
          .map(
            (z) =>
              `<li>${esc(z.slice(0, 230))}${z.length > 230 ? "…" : ""}</li>`,
          )
          .join("")
      : "<li>No matching experience sentence was located by keyword. Review your resume wording for paraphrases.</li>",
    reqHtml = b.requirements.length
      ? b.requirements
          .map((line) => {
            let hits = b.matched.filter((w) => line.toLowerCase().includes(w));
            return `<li>${esc(line.slice(0, 260))}${line.length > 260 ? "…" : ""}<div class="fit-hint">${hits.length ? "Resume keyword evidence: " + esc(hits.join(", ")) : "Not found verbatim in the resume text; check whether your experience demonstrates this requirement."}</div></li>`;
          })
          .join("")
      : "<li>No clearly labeled requirements sentence was detected. Review the full listing.</li>",
    credHtml = b.credTerms.length
      ? b.credMissing.length
        ? `Posting mentions ${esc(b.credTerms.join(", "))}; these terms were not found in your resume text.`
        : `Posting mentions ${esc(b.credTerms.join(", "))}; matching terms appear in the resume.`
      : "No degree or certification requirement was detected automatically.";
  document.getElementById("modalroot").innerHTML =
    `<div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal match-modal"><div class="modalhead"><div><div class="eyebrow">RESUME MATCH BREAKDOWN</div><h2>${esc(x.title)}</h2><div class="sub">${esc(x.company)} · ${esc(x.location || "Location not listed")}</div></div><button class="x" onclick="closeModal()">×</button></div><div class="match-score-head"><strong>${value === null ? "—" : value + "%"}</strong><span>resume match estimate</span><small>${b.matched.length} of ${b.terms.length} sampled job keywords appear in the resume text${x.match !== undefined && x.match !== score(x) ? " · includes a small location preference boost" : ""}</small></div><div class="match-grid"><div class="fit-panel"><h3>Role / title</h3><p>${esc(roleStatus)}</p><div class="fit-hint">${roleText ? "Target role: " + esc(roleText) : "No target role is set, so title alignment is not included as a separate signal."}</div></div><div class="fit-panel"><h3>Job keywords found in resume</h3><p class="fit-good">${esc(skillSummary)}</p><div class="fit-hint">These sampled terms occur in both your resume and the listing text.</div></div><div class="fit-panel"><h3>Job keywords not found in resume</h3><p class="fit-missing">${esc(notFound)}</p><div class="fit-hint">These posting terms were not found in parsed resume text; wording differences may be missed.</div></div><div class="fit-panel"><h3>Years of experience</h3><p>${esc(yearsText)}</p><div class="fit-hint">Only explicit “years of experience” phrases are counted. Employment dates are not converted into a total.</div></div><div class="fit-panel"><h3>Experience evidence in your resume</h3><ul>${evidenceHtml}</ul><div class="fit-hint">Keyword-based evidence finder; it can miss relevant experience described with different wording.</div></div><div class="fit-panel"><h3>Requirements to review</h3><ul>${reqHtml}</ul><div class="fit-hint">“Not found” means not found in the parsed text, not proof that you lack the qualification.</div></div><div class="fit-panel"><h3>Education / certification signals</h3><p>${credHtml}</p></div></div><div class="analysis-note">The estimate considers posting keyword coverage, how visibly evidence appears in Summary, Skills, or leading Experience bullets, role-title overlap, and explicit years-of-experience language. It is not an employer ATS score or hiring prediction; check the full posting and parsed resume.</div>${x.description ? `<div class="field"><label>Full job description</label><div class="help" style="max-height:180px;overflow:auto;white-space:pre-wrap">${esc(x.description)}</div></div>` : ""}<div id="draftarea"></div><div class="modalactions">${isSaved ? `<button class="btn" onclick="deleteJob(decodeURIComponent('${encodeURIComponent(x.id)}'))">Remove</button>` : `<button class="btn" onclick="saveLive(decodeURIComponent('${encodeURIComponent(x.id)}'))">Save role</button>`}<button class="btn" onclick="closeModal()">Done</button>${isSaved ? `<button class="btn" onclick="makeDraft(decodeURIComponent('${encodeURIComponent(x.id)}'))">Prepare draft</button>` : ""}${x.url ? `<a class="btn btn-primary" style="text-decoration:none" href="${esc(x.url)}" target="_blank" rel="noopener">Open listing ↗</a>` : ""}</div></div></div>`;
}

window.saveLive = function (id) {
  let x = (liveListings || []).find((j) => j.id === id);
  if (!x) return;
  if (data.jobs.some((j) => j.url === x.url)) {
    toast("This role is already in your tracker.");
    return;
  }
  let copy = {
    ...x,
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    added: Date.now(),
    status: "Saved",
    resumeId: data.activeResumeId,
    targetRoles:
      (window.activeResume && window.activeResume()?.targetRoles) ||
      data.profile.role ||
      "",
  };
  delete copy.match;
  delete copy.matchTerms;
  delete copy.roleScore;
  delete copy.roleLabel;
  // Miles from a search centre (possibly "near me") belong to that search, not to the saved job.
  delete copy.distance;
  data.jobs.push(copy);
  persist();
  toast("Role saved to your application tracker.");
};
