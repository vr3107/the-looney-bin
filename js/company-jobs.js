// Jobs straight from companies' own career sites, through the public job-board APIs of the
// hiring systems they use (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee).
// These APIs allow browser requests, so each visitor's browser fetches them directly.
// Plus extra job boards: The Muse and Hacker News (browser) and Himalayas / Jooble / Google Jobs /
// USAJOBS (/api/boards).

// Starter list: company boards checked to return U.S. jobs (Nov 2026). Users can add more, and each
// search also checks the companies the job index shows hiring for the searched roles.
const STARTER_COMPANIES = [
  ...["Peloton:peloton", "Betterment:betterment", "Twitch:twitch", "Airtable:airtable", "Intercom:intercom", "Netlify:netlify", "Carta:carta", "Vercel:vercel", "Fivetran:fivetran", "New Relic:newrelic", "PagerDuty:pagerduty", "Lucid Software:lucidsoftware", "SoFi:sofi", "Zscaler:zscaler", "Cockroach Labs:cockroachlabs", "Checkr:checkr", "Epic Games:epicgames", "Rubrik:rubrik", "Relativity Space:relativity", "Verkada:verkada", "Oscar Health:oscar", "Anduril:andurilindustries", "SpaceX:spacex", "Zocdoc:zocdoc", "Riot Games:riotgames", "Recursion:recursionpharmaceuticals", "Ginkgo Bioworks:ginkgobioworks", "IMC Trading:imc", "Akuna Capital:akunacapital", "DRW:drweng", "Jane Street:janestreet", "Yext:yext", "Point72:point72", "Blend:blend", "Appian:appian", "Gemini:gemini", "Anaplan:anaplan", "Smartsheet:smartsheet", "Klaviyo:klaviyo", "Attentive:attentive", "Mixpanel:mixpanel", "Braze:braze", "6sense:6sense", "Algolia:algolia", "Contentful:contentful", "JFrog:jfrog", "LaunchDarkly:launchdarkly", "Nextdoor:nextdoor", "Tanium:tanium", "Axon:axon", "Abnormal Security:abnormalsecurity", "Faire:faire", "Coursera:coursera", "Mozilla:mozilla"].map((s) => ["greenhouse", ...s.split(":")]),
  ...["Outreach:outreach", "Gopuff:gopuff"].map((s) => ["lever", ...s.split(":")]),
  ...["Modal:modal", "Cursor:cursor", "Pinecone:pinecone", "Vanta:vanta", "Writer:writer", "ElevenLabs:elevenlabs", "Resend:resend", "Railway:railway", "Airbyte:airbyte", "Plaid:plaid", "Decagon:decagon", "Render:render", "Drata:drata", "Temporal:temporal", "Sierra:sierra", "Hex:hex", "Harvey:harvey"].map((s) => ["ashby", ...s.split(":")]),
  ...["Stripe:stripe", "Airbnb:airbnb", "Databricks:databricks", "Coinbase:coinbase", "Cloudflare:cloudflare", "Figma:figma", "Discord:discord", "Robinhood:robinhood", "Lyft:lyft", "Pinterest:pinterest", "Reddit:reddit", "Instacart:instacart", "Dropbox:dropbox", "Asana:asana", "GitLab:gitlab", "Twilio:twilio", "Okta:okta", "Datadog:datadog", "MongoDB:mongodb", "Elastic:elastic", "Roblox:roblox", "Affirm:affirm", "Chime:chime", "Brex:brex", "Gusto:gusto", "Samsara:samsara", "Toast:toast", "Duolingo:duolingo", "Squarespace:squarespace", "Anthropic:anthropic", "Scale AI:scaleai", "Waymo:waymo", "Flexport:flexport", "DoorDash:doordashusa"].map((s) => ["greenhouse", ...s.split(":")]),
  ...["Palantir:palantir", "Spotify:spotify", "Zoox:zoox"].map((s) => ["lever", ...s.split(":")]),
  ...["OpenAI:openai", "Ramp:ramp", "Notion:notion", "Linear:linear", "PostHog:posthog", "Supabase:supabase", "Replit:replit", "Perplexity:perplexity", "Zapier:zapier", "Snowflake:snowflake", "Cohere:cohere"].map((s) => ["ashby", ...s.split(":")]),
  ...["ServiceNow:ServiceNow", "Bosch:BoschGroup", "Equinox:Equinox", "AbbVie:AbbVie", "Canva:Canva"].map((s) => ["smartrecruiters", ...s.split(":")]),
].map(([ats, name, slug]) => ({ ats, name, slug }));
const ATS_LABEL = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters", workable: "Workable", recruitee: "Recruitee" };
const COMPANY_SOURCE = "Company sites";

function companyBoards() {
  let mine = Array.isArray(data.companyBoards) ? data.companyBoards : [],
    removed = new Set(data.companyBoardsRemoved || []),
    key = (b) => `${b.ats}:${String(b.slug).toLowerCase()}`;
  let list = [...STARTER_COMPANIES.filter((b) => !removed.has(key(b))), ...mine];
  let seen = new Set();
  return list.filter((b) => !seen.has(key(b)) && seen.add(key(b)));
}
window.companyBoards = companyBoards;

// ---------- reading each hiring system ----------
async function getJson(url, opts = {}) {
  let r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(opts.timeout || 25000), ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function companyJob(board, id, title, location, url, description, published, extra = {}) {
  let job = baseJob(COMPANY_SOURCE, `${board.ats}:${board.slug}:${id}`, String(title || "").replace(/\s+/g, " ").trim(), extra.company || board.name, location, url, description, [ATS_LABEL[board.ats], ...(extra.tags || [])].filter(Boolean), published, extra.salary || "");
  job.sourceHome = extra.home || url;
  job.ats = board.ats;
  job.atsSlug = board.slug;
  job.atsJobId = String(id);
  job.needsDetails = !!extra.needsDetails;
  return job;
}
const ATS_READERS = {
  // Greenhouse's list has no descriptions; matching jobs get theirs fetched afterwards.
  async greenhouse(b) {
    let d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.slug)}/jobs`);
    return (d.jobs || []).map((j) =>
      companyJob(b, j.id, j.title, j.location?.name, j.absolute_url, "", j.first_published || j.updated_at, { needsDetails: true, tags: (j.departments || []).map((x) => x.name), home: `https://boards.greenhouse.io/${b.slug}`, company: b.picked && j.company_name ? String(j.company_name).trim() : "" }),
    );
  },
  async lever(b) {
    let d = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(b.slug)}?mode=json`);
    return (Array.isArray(d) ? d : []).map((j) =>
      companyJob(b, j.id, j.text, [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" / "), j.hostedUrl, [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}: ${String(l.content || "").replace(/<[^>]+>/g, " ")}`), j.additionalPlain].filter(Boolean).join("\n"), j.createdAt ? new Date(j.createdAt).toISOString() : "", {
        tags: [j.categories?.commitment, j.categories?.team, j.workplaceType].filter(Boolean),
        home: `https://jobs.lever.co/${b.slug}`,
      }),
    );
  },
  async ashby(b) {
    let d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.slug)}?includeCompensation=true`);
    return (d.jobs || [])
      .filter((j) => j.isListed !== false)
      .map((j) =>
        companyJob(b, j.id, j.title, [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean).join(" / ") + (j.isRemote ? " · Remote" : ""), j.jobUrl, j.descriptionPlain || j.descriptionHtml, j.publishedAt, {
          tags: [j.employmentType, j.department, j.workplaceType].filter(Boolean),
          salary: j.compensation?.compensationTierSummary || "",
          home: `https://jobs.ashbyhq.com/${b.slug}`,
        }),
      );
  },
  // SmartRecruiters searches server-side, so only matching postings come back.
  async smartrecruiters(b, query) {
    let out = [];
    for (let q of (query.length ? query : [""]).slice(0, 3)) {
      let d = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.slug)}/postings?limit=100${q ? "&q=" + encodeURIComponent(q) : ""}`);
      out.push(
        ...(d.content || []).map((j) =>
          companyJob(b, j.id, j.name, [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ") + (j.location?.remote ? " · Remote" : ""), `https://jobs.smartrecruiters.com/${b.slug}/${j.id}`, "", j.releasedDate, {
            needsDetails: true,
            tags: [j.typeOfEmployment?.label, j.experienceLevel?.label, j.department?.label].filter(Boolean),
            home: `https://careers.smartrecruiters.com/${b.slug}`,
          }),
        ),
      );
    }
    return out;
  },
  async workable(b) {
    let d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(b.slug)}?details=true`);
    return (d.jobs || []).map((j) =>
      companyJob(b, j.shortcode, j.title, [j.city, j.state, j.country].filter(Boolean).join(", ") + (j.telecommuting ? " · Remote" : ""), j.url || j.shortlink, j.description, j.published_on || j.created_at, {
        tags: [j.employment_type, j.department].filter(Boolean),
        home: `https://apply.workable.com/${b.slug}`,
      }),
    );
  },
  async recruitee(b) {
    let d = await getJson(`https://${encodeURIComponent(b.slug)}.recruitee.com/api/offers/`);
    return (d.offers || []).map((j) =>
      companyJob(b, j.id, j.title, [j.city, j.state_name || j.state_code, j.country].filter(Boolean).join(", ") + (j.remote ? " · Remote" : ""), j.careers_url, [j.description, j.requirements].filter(Boolean).join("\n"), j.published_at || j.created_at, {
        tags: [j.employment_type_code, j.department].filter(Boolean),
        home: `https://${b.slug}.recruitee.com`,
      }),
    );
  },
};
// Full descriptions for postings whose list API omits them (Greenhouse, SmartRecruiters).
async function fillJobDetails(job) {
  try {
    if (job.ats === "greenhouse") {
      let d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(job.atsSlug)}/jobs/${job.atsJobId}`);
      let html = new DOMParser().parseFromString(d.content || "", "text/html").documentElement.textContent; // content is HTML-escaped
      job.description = plainText(html).slice(0, 9000);
      job.salary ||= (d.pay_input_ranges || []).map((p) => `${p.currency_type || ""} ${p.min_cents / 100}–${p.max_cents / 100}`).join("; ");
    } else if (job.ats === "smartrecruiters") {
      let d = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(job.atsSlug)}/postings/${job.atsJobId}`);
      job.description = plainText(Object.values(d.jobAd?.sections || {}).map((s) => `${s.title || ""}\n${s.text || ""}`).join("\n")).slice(0, 9000);
      job.url = d.postingUrl || d.applyUrl || job.url;
    }
  } catch {}
  job.needsDetails = false;
  return job;
}

// ---------- searching every followed company ----------
const companyCache = new Map(); // "ats:slug" → { at, jobs }
async function runLimited(items, limit, fn) {
  let out = [],
    i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        let k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}
// Companies the job index shows hiring for this search, on systems the browser can read live
// (Greenhouse, Lever, Ashby): checking them live adds today's postings and full descriptions.
const INDEX_PICKS = 100;
// Large employers on Workday, searched live by keyword through /api/workday (Workday sites can't be
// read by browsers). tenant:wdN:site:name — checked to answer (Nov 2026).
const WORKDAY_COMPANIES = [
  "capitalone:wd12:capital_one:Capital One", "cisco:wd5:cisco_careers:Cisco", "nvidia:wd5:nvidiaexternalcareersite:NVIDIA", "salesforce:wd12:external_career_site:Salesforce",
  "verizon:wd12:verizon-careers:Verizon", "mastercard:wd1:corporatecareers:Mastercard", "keybank:wd5:external_career_site:KeyBank", "ccf:wd1:clevelandcliniccareers:Cleveland Clinic",
  "target:wd5:targetcareers:Target", "workday:wd5:workday:Workday", "hpe:wd5:jobsathpe:Hewlett Packard Enterprise", "cardinalhealth:wd1:ext:Cardinal Health",
  "humana:wd5:humana_external_career_site:Humana", "cigna:wd5:cignacareers:Cigna", "mckesson:wd3:external_careers:McKesson", "pfizer:wd1:pfizercareers:Pfizer",
  "medtronic:wd1:medtroniccareers:Medtronic", "vanguard:wd5:vanguard_external:Vanguard", "tmobile:wd1:external:T-Mobile", "analogdevices:wd1:external:Analog Devices",
  "rockwellautomation:wd1:external_rockwell_automation:Rockwell Automation", "thermofisher:wd5:thermofishercareers:Thermo Fisher", "jci:wd5:jci:Johnson Controls", "astrazeneca:wd3:careers:AstraZeneca",
  "caci:wd1:external:CACI", "ngc:wd1:northrop_grumman_external_site:Northrop Grumman", "micron:wd1:external:Micron", "broadcom:wd1:external_career:Broadcom",
  "nike:wd1:nke:Nike", "disney:wd5:disneycareer:Disney", "usaa:wd1:usaajobswd:USAA", "blackrock:wd1:blackrock_professional:BlackRock",
  "fis:wd5:searchjobs:FIS", "fiserv:wd5:ext:Fiserv", "elevancehealth:wd1:ant:Elevance Health", "cvshealth:wd1:cvs_health_careers:CVS Health",
  "abbott:wd5:abbottcareers:Abbott", "regeneron:wd1:careers:Regeneron", "geaerospace:wd5:ge_externalsite:GE Aerospace", "huntington:wd12:hnbcareers:Huntington Bank",
].map((s) => {
  let [tenant, wd, site, name] = s.split(":");
  return { tenant, wd, site, name };
});
const WORKDAY_PICKS = 40;
// "https://capitalone.wd12.myworkdayjobs.com/en-US/capital_one/job/…" → { tenant, wd, site, path }
function workdayFromUrl(url) {
  let m = String(url || "").match(/^https:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_.-]+)\/job\/(.+)$/i);
  return m ? { tenant: m[1].toLowerCase(), wd: m[2].toLowerCase(), site: m[3], path: m[4].replace(/[?#].*$/, "").toLowerCase() } : null;
}
window.workdayFromUrl = workdayFromUrl;
// Workday employers the job index shows hiring for this search (besides the list above).
function workdayFromIndex(indexJobs, max = WORKDAY_PICKS) {
  let have = new Set(WORKDAY_COMPANIES.map((b) => b.tenant)),
    found = new Map();
  for (let j of indexJobs || []) {
    let b = workdayFromUrl(j.url);
    if (!b || have.has(b.tenant)) continue;
    let key = `${b.tenant}|${b.site.toLowerCase()}`,
      f = found.get(key) || { tenant: b.tenant, wd: b.wd, site: b.site, name: j.company, count: 0 };
    f.count += 1;
    found.set(key, f);
  }
  return [...found.values()].sort((a, b) => b.count - a.count).slice(0, max).map(({ count, ...b }) => b);
}
window.workdayFromIndex = workdayFromIndex;
async function loadWorkday(roles, progress = () => {}, indexJobs = []) {
  let picked = workdayFromIndex(indexJobs),
    batches = [WORKDAY_COMPANIES, picked].filter((b) => b.length),
    queries = roles.map((r) => String(r.raw || r).trim()).filter(Boolean).slice(0, 3),
    out = [],
    failed = 0;
  if (!queries.length) return [];
  progress(`Searching ${WORKDAY_COMPANIES.length + picked.length} Workday career sites…`);
  await Promise.all(
    queries.flatMap((query) =>
      batches.map(async (boards) => {
        try {
          let r = await fetch("/api/workday", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, boards }) }),
            d = await r.json();
          if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
          failed += (d.failed || []).length;
          for (let j of d.jobs || []) {
            let job = baseJob(COMPANY_SOURCE, j.id, j.title, j.company || indexCompanyName(String(j.id).split(":")[1]), j.location || "Not specified", j.url, "", ["Workday"], j.published, "");
            let w = workdayFromUrl(j.url);
            if (w) job.atsKey = `workday:${w.tenant}:${w.path}`;
            out.push(job);
          }
        } catch (e) {
          feedErrors.push(`Workday career sites: ${e.message}.`);
        }
      }),
    ),
  );
  window.workdaySitesChecked = WORKDAY_COMPANIES.length + picked.length;
  return out;
}
window.loadWorkday = loadWorkday;
function boardFromJobUrl(url) {
  let m = String(url || "").match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([A-Za-z0-9_-]+)\/jobs\//);
  if (m) return { ats: "greenhouse", slug: m[1] };
  m = String(url || "").match(/jobs\.lever\.co\/([A-Za-z0-9_.-]+)\//);
  if (m) return { ats: "lever", slug: m[1] };
  m = String(url || "").match(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)\//);
  if (m) return { ats: "ashby", slug: decodeURIComponent(m[1]) };
  return null;
}
function boardsFromIndex(indexJobs, following, max = INDEX_PICKS) {
  let have = new Set(following.map((b) => `${b.ats}:${String(b.slug).toLowerCase()}`)),
    found = new Map();
  for (let j of indexJobs || []) {
    let b = boardFromJobUrl(j.url);
    if (!b) continue;
    let key = `${b.ats}:${b.slug.toLowerCase()}`;
    if (have.has(key)) continue;
    let f = found.get(key) || { ...b, name: j.company, count: 0, newest: 0 };
    f.count += 1;
    f.newest = Math.max(f.newest, Date.parse(j.published) || 0);
    found.set(key, f);
  }
  // Most matching postings first, then the most recently active.
  return [...found.values()].sort((a, b) => b.count - a.count || b.newest - a.newest).slice(0, max).map(({ ats, slug, name }) => ({ ats, slug, name, picked: true }));
}
window.boardsFromIndex = boardsFromIndex;
// roles: [{ raw, ... }] from parseJobSearch; returns matching postings with descriptions.
// area: the place search in force, if any (js/geo-search.js). extra: more boards for this search only.
async function loadCompanyJobs(roles, progress = () => {}, area = null, extra = []) {
  let followed = companyBoards(),
    boards = [...followed, ...extra],
    names = roles.map((r) => r.raw || r).filter(Boolean),
    done = 0,
    failed = [];
  let lists = await runLimited(boards, 6, async (b) => {
    let key = `${b.ats}:${String(b.slug).toLowerCase()}`,
      hit = companyCache.get(key);
    try {
      if (!hit || Date.now() - hit.at > LIVE_REFRESH_MS || b.ats === "smartrecruiters") {
        hit = { at: Date.now(), jobs: await ATS_READERS[b.ats](b, names) };
        companyCache.set(key, hit);
      }
    } catch (e) {
      // A company picked from the index may have moved its board since; only followed ones are reported.
      if (!b.picked) failed.push(b.name);
      hit = { jobs: [] };
    }
    progress(`Checked ${++done} of ${boards.length} company career sites…`);
    return hit.jobs;
  });
  let all = lists.flat(),
    matched = names.length ? all.filter((j) => names.some((role) => roleRelevance(j, role) > 0)) : all.slice(0, 300);
  // Outside the search area: dropped here, before any descriptions are fetched for them.
  if (area) matched = matched.filter((j) => area.within(j));
  // Fetch full descriptions for the best title matches (needed to rank against the resume).
  let need = matched
    .filter((j) => j.needsDetails)
    .sort((a, b) => Math.max(...names.map((r) => roleRelevance(b, r)), 0) - Math.max(...names.map((r) => roleRelevance(a, r)), 0))
    .slice(0, 200);
  if (need.length) progress(`Reading ${need.length} matching job descriptions from company sites…`);
  await runLimited(need, 10, fillJobDetails);
  feedStats[COMPANY_SOURCE] = matched.length;
  window.companySitesChecked = { followed: followed.length, picked: extra.length };
  if (failed.length) feedErrors.push(`Couldn’t reach ${failed.length} company site${failed.length === 1 ? "" : "s"}: ${failed.slice(0, 6).join(", ")}${failed.length > 6 ? "…" : ""}.`);
  // Postings beyond the first 200 keep their title and location; the description loads when opened.
  return matched;
}
// Opening a posting whose description hasn't loaded yet: load it first.
const companyBaseOpenDetails = window.openDetails;
window.openDetails = function (id) {
  let job = (typeof liveListings !== "undefined" && (liveListings || []).find((x) => x.id === id)) || data.jobs.find((x) => x.id === id);
  if (job?.needsDetails && job.ats) {
    fillJobDetails(job).then(() => {
      let saved = data.jobs.find((x) => x.id === id);
      if (saved && saved !== job && !saved.description) {
        saved.description = job.description;
        saved.needsDetails = false;
        persist();
      }
      window.openDetails(id);
    });
    return;
  }
  return companyBaseOpenDetails.apply(this, arguments);
};
window.loadCompanyJobs = loadCompanyJobs;

// ---------- extra job boards ----------
// The Muse: browser request; no keyword search, so pick categories from the query.
const MUSE_CATEGORIES = [
  [/data (engineer|scien|analy)|analytics|machine learning|\bml\b|\bai\b|bi developer/, ["Data and Analytics", "Data Science"]],
  [/software|developer|engineer|devops|sre|backend|frontend|full ?stack|cloud|platform/, ["Software Engineering", "IT"]],
  [/\bit\b|support|technician|help ?desk|network|system admin|infrastructure|data center/, ["IT"]],
  [/product manager|product owner/, ["Product Management"]],
  [/project|program manager|scrum/, ["Project Management"]],
  [/design|ux|ui/, ["Design and UX"]],
  [/sap|erp|consultant/, ["IT", "Software Engineering"]],
];
async function loadMuse(roles, progress, area = null) {
  let q = roles.map((r) => r.raw || r).join(" ").toLowerCase(),
    cats = [...new Set(MUSE_CATEGORIES.filter(([re]) => re.test(q)).flatMap(([, c]) => c))].slice(0, 3);
  if (!cats.length) cats = ["Software Engineering", "Data and Analytics"];
  progress("Loading The Muse…");
  let out = [];
  try {
    for (let page = 0; page < 4; page++) {
      let params = new URLSearchParams({ page: String(page) });
      cats.forEach((c) => params.append("category", c));
      // A place search asks for the main towns in the area ("Cleveland, OH"), The Muse's own format.
      if (area) area.towns(6).forEach((town) => params.append("location", town));
      let d = await getJson(`https://www.themuse.com/api/public/jobs?${params}`);
      out.push(
        ...(d.results || []).map((j) =>
          baseJob("The Muse", j.id, j.name, j.company?.name, (j.locations || []).map((l) => l.name).join(" / "), j.refs?.landing_page, j.contents, [...(j.levels || []).map((l) => l.name), ...(j.categories || []).map((c) => c.name)], j.publication_date),
        ),
      );
      if (page + 1 >= (d.page_count || 0)) break;
    }
  } catch (e) {
    feedErrors.push(`The Muse stopped after ${out.length} listings (${e.message}).`);
  }
  feedStats["The Muse"] = out.length;
  return out;
}
// Hacker News "Ask HN: Who is hiring?" (monthly thread of direct-from-company posts), through
// HN's public Algolia search (browser access allowed): only posts matching the search come back.
function hnJob(hit) {
  let html = String(hit.comment_text || ""),
    textAll = plainText(html.replace(/<p>/gi, "\n")),
    // The header line: "Company | Role(s) | Location | Remote | Salary | URL" (before the first paragraph).
    first = (new DOMParser().parseFromString(html.split(/<p>/i)[0], "text/html").body.textContent || "").split("\n")[0].trim(),
    parts = first
      .split(/\s*\|\s*/)
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter((x) => x && x.length <= 140 && !/^https?:/i.test(x)),
    link = ((html.match(/href="([^"]+)"/) || [])[1] || "").replace(/&#x2F;/g, "/").replace(/&amp;/g, "&");
  const LOC = /\b(remote|onsite|on-site|in-office|hybrid|anywhere|worldwide|us-based)\b|,\s*[A-Z]{2}\b|\b(sf|nyc|bay area|london|berlin|toronto|usa|u\.s\.|united states|europe|emea|canada)\b/i;
  const ROLE = /engineer|developer|scientist|analyst|manager|designer|architect|lead|sre|devops|founding|product|data|ml\b|ai\b|staff|head of|director|recruiter|marketing|sales/i;
  let company = parts[0] || hit.author,
    role = parts.find((x, i) => i && ROLE.test(x) && !(LOC.test(x) && !/engineer|developer|scientist|analyst|manager|designer|architect/i.test(x))) || "Open roles",
    loc = parts.find((x, i) => i && x !== role && LOC.test(x)) || "",
    pay = parts.find((x) => /\$|€|£|\d{2,3}k\b/i.test(x)) || "";
  let job = baseJob("HN Who is hiring", hit.objectID, role.slice(0, 160), company.slice(0, 120), loc || "Not specified", `https://news.ycombinator.com/item?id=${hit.objectID}`, textAll, ["Hacker News"], hit.created_at, pay.slice(0, 80));
  if (/^https?:/i.test(link)) job.extraSources = [{ name: "Company link", url: link }];
  return job;
}
async function loadHackerNews(roles, progress) {
  progress("Loading Hacker News: Who is hiring…");
  let out = [];
  try {
    let stories = await getJson("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6"),
      thread = (stories.hits || []).find((h) => /who is hiring/i.test(h.title || ""));
    if (!thread) return [];
    let queries = roles.map((r) => r.raw || r).filter(Boolean).slice(0, 3);
    for (let q of queries.length ? queries : ["engineer"]) {
      let d = await getJson(`https://hn.algolia.com/api/v1/search?tags=comment,story_${thread.objectID}&hitsPerPage=100&query=${encodeURIComponent(q)}`);
      out.push(...(d.hits || []).filter((h) => String(h.parent_id) === String(thread.objectID) && h.comment_text).map(hnJob));
    }
  } catch (e) {
    feedErrors.push(`Hacker News stopped after ${out.length} posts (${e.message}).`);
  }
  let seen = new Set();
  out = out.filter((j) => !seen.has(j.id) && seen.add(j.id));
  feedStats["HN Who is hiring"] = out.length;
  return out;
}
window.hnJob = hnJob;
// Himalayas, Working Nomads (no browser access) and Jooble / Google Jobs / USAJOBS / Adzuna (keys) go through /api/boards.
async function loadServerBoards(query, location, progress, area = null) {
  progress("Loading Himalayas, Working Nomads, Google Jobs, Jooble, USAJOBS and Adzuna…");
  try {
    // A place search sends the town (both "Cleveland, OH" and "Cleveland, Ohio") and the distance in miles.
    let r = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(area ? { query, location: area.town, locationLong: area.townLong, radius: area.townRadius } : { query, location }) }),
      d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    let jobs = (d.jobs || []).map((j) => {
      let job = baseJob(j.source, j.id, j.title, j.company, j.location, j.url, j.description, j.tags || [], j.published, j.salary || "");
      // Google Jobs: where it's posted (LinkedIn, Indeed, Dice, …), each a link on the card.
      if (Array.isArray(j.applyOptions)) job.extraSources = j.applyOptions.filter((a) => a.name && a.url).map((a) => ({ name: a.name, url: a.url }));
      return job;
    });
    for (let [name, n] of Object.entries(d.counts || {})) feedStats[name] = n;
    // Optional boards without their key: say so, with how to connect them.
    let off = Object.entries(d.configured || {}).filter(([, on]) => !on).map(([name]) => name);
    if (off.length) feedErrors.push(`Not connected: ${off.join(", ")} (add ${off.map((n) => ({ Jooble: "JOOBLE_API_KEY", "Google Jobs": "SERPAPI_API_KEY", USAJOBS: "USAJOBS_API_KEY + USAJOBS_EMAIL", Adzuna: "ADZUNA_APP_ID + ADZUNA_APP_KEY" })[n]).join(", ")} as Cloudflare Secrets, then redeploy).`);
    for (let [name, err] of Object.entries(d.errors || {})) feedErrors.push(`${name}: ${err}.`);
    return jobs;
  } catch (e) {
    feedErrors.push(`Extra job boards unavailable (${e.message}).`);
    return [];
  }
}
window.loadExtraJobSources = async function (roles, query, location, progress, area = null) {
  // The job index loads first (quickly): the companies it shows hiring are then checked live too.
  let index = typeof loadJobIndex === "function" ? loadJobIndex(roles, progress, area) : Promise.resolve([]),
    company = index.then((jobs) => loadCompanyJobs(roles, progress, area, boardsFromIndex(jobs, companyBoards()))),
    workday = index.then((jobs) => loadWorkday(roles, progress, jobs)),
    groups = await Promise.all([company, workday, loadMuse(roles, progress, area), loadHackerNews(roles, progress), loadServerBoards(query, location, progress, area), index]);
  // Workday postings count under "Company sites".
  feedStats[COMPANY_SOURCE] = (feedStats[COMPANY_SOURCE] || 0) + groups[1].length;
  return groups.flat();
};

// ---------- following companies ----------
// Recognize a careers URL on a known hiring system.
function atsFromUrl(raw) {
  let u;
  try {
    u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  let h = u.hostname.toLowerCase(),
    seg = u.pathname.split("/").filter(Boolean),
    q = u.searchParams;
  if (/(^|\.)greenhouse\.io$/.test(h)) {
    let slug = q.get("for") || (seg[0] === "embed" ? seg[2] : seg[0]);
    if (h.startsWith("boards-api.")) slug = seg[2];
    return slug ? { ats: "greenhouse", slug } : null;
  }
  if (h === "jobs.lever.co" || h === "jobs.eu.lever.co") return seg[0] ? { ats: "lever", slug: seg[0] } : null;
  if (h === "api.lever.co") return seg[2] ? { ats: "lever", slug: seg[2] } : null;
  if (h === "jobs.ashbyhq.com") return seg[0] ? { ats: "ashby", slug: seg[0] } : null;
  if (/smartrecruiters\.com$/.test(h)) return seg[0] ? { ats: "smartrecruiters", slug: seg[0] } : null;
  if (h === "apply.workable.com") return seg[0] ? { ats: "workable", slug: seg[0] } : null;
  if (h.endsWith(".workable.com") && h !== "www.workable.com") return { ats: "workable", slug: h.split(".")[0] };
  if (h.endsWith(".recruitee.com")) return { ats: "recruitee", slug: h.split(".")[0] };
  if (/myworkdayjobs\.com$/.test(h)) return { unsupported: "Workday" };
  return null;
}
async function boardJobCount(board) {
  try {
    return (await ATS_READERS[board.ats](board, [])).length;
  } catch {
    return -1;
  }
}
// Add a company from a careers URL or a company name. Returns { board } or { error }.
window.addCompanyBoard = async function (input, displayName) {
  let raw = String(input || "").trim();
  if (!raw) return { error: "Paste a careers page link or type a company name." };
  let found = atsFromUrl(raw);
  if (!found && /[./]/.test(raw)) {
    // A company's own careers page: look for the hiring system it embeds.
    try {
      let r = await fetch("/api/detect-careers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: raw }) });
      found = (await r.json()).found || null;
    } catch {}
  }
  if (found?.unsupported) return { error: `This company uses ${found.unsupported}, which doesn’t offer a public jobs feed. Search it on the company’s site instead.` };
  let name = displayName || (found ? found.slug : raw);
  name = name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let candidates = found
    ? [found]
    : (() => {
        let base = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
        let dashed = raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
        return ["greenhouse", "lever", "ashby", "workable"].flatMap((ats) => [...new Set([base, dashed])].map((slug) => ({ ats, slug })));
      })();
  for (let c of candidates) {
    let board = { ats: c.ats, slug: c.slug, name },
      existing = companyBoards().find((b) => b.ats === board.ats && b.slug.toLowerCase() === board.slug.toLowerCase());
    if (existing && found) return { error: `${existing.name} is already in your list.` };
    let n = await boardJobCount(board);
    if (n > 0 || (found && n === 0)) {
      data.companyBoards = [...(data.companyBoards || []).filter((b) => !(b.ats === board.ats && b.slug.toLowerCase() === board.slug.toLowerCase())), board];
      data.companyBoardsRemoved = (data.companyBoardsRemoved || []).filter((k) => k !== `${board.ats}:${board.slug.toLowerCase()}`);
      persist();
      return { board, count: n };
    }
  }
  return { error: found ? "That careers page didn’t return any jobs." : `Couldn’t find a public job board for “${raw}”. Paste the link to its careers page instead.` };
};
window.removeCompanyBoard = function (ats, slug) {
  let key = `${ats}:${String(slug).toLowerCase()}`;
  data.companyBoards = (data.companyBoards || []).filter((b) => `${b.ats}:${b.slug.toLowerCase()}` !== key);
  if (STARTER_COMPANIES.some((b) => `${b.ats}:${b.slug.toLowerCase()}` === key)) data.companyBoardsRemoved = [...new Set([...(data.companyBoardsRemoved || []), key])];
  companyCache.delete(key);
  persist();
};
window.resetCompanyBoards = function () {
  data.companyBoardsRemoved = [];
  persist();
};

// ---------- "Company career sites" panel ----------
window.renderCompanyPanel = function () {
  let box = document.getElementById("companypanel");
  if (!box) return;
  let boards = companyBoards(),
    removed = (data.companyBoardsRemoved || []).length;
  box.innerHTML = `<details class="company-panel"><summary><b>Company career sites</b> · checking ${boards.length} companies and ${WORKDAY_COMPANIES.length} large Workday employers live, plus up to ${INDEX_PICKS + WORKDAY_PICKS} more per search that the daily job index (about 45,000 companies) shows hiring for your roles</summary>
<form class="company-add" onsubmit="event.preventDefault(); companyPanelAdd()">
  <input id="companyadd" type="text" autocomplete="off" placeholder="Type a company name (15,000+ to pick from) or paste a careers page link" aria-label="Company name or careers page" aria-controls="companysuggest" oninput="companySuggest(this.value)" />
  <button class="btn btn-sm btn-primary" type="submit">Add company</button>
</form>
<div id="companysuggest" class="company-suggest" role="listbox" aria-label="Matching companies"></div>
<p class="help" id="companyaddstatus" role="status" aria-live="polite">Jobs from these companies come straight from their own career sites. Remove any you don’t want with ×.${removed ? ` <a href="#" onclick="event.preventDefault(); resetCompanyBoards(); renderCompanyPanel()">Restore ${removed} removed</a>` : ""}</p>
<div class="company-chips">${boards
    .map((b) => `<span class="company-chip" title="${esc(ATS_LABEL[b.ats])}">${esc(b.name)}<button type="button" aria-label="Remove ${esc(b.name)}" onclick="removeCompanyBoard('${esc(b.ats)}','${esc(b.slug)}'); renderCompanyPanel()">×</button></span>`)
    .join("")}</div></details>`;
};
window.companyPanelAdd = async function () {
  let input = document.getElementById("companyadd"),
    status = document.getElementById("companyaddstatus"),
    value = input.value.trim();
  status.textContent = `Looking for ${value}’s job board…`;
  let r = await window.addCompanyBoard(value);
  if (r.error) {
    status.textContent = r.error;
    return;
  }
  window.renderCompanyPanel();
  let s = document.getElementById("companyaddstatus");
  if (s) s.textContent = `Added ${r.board.name} (${ATS_LABEL[r.board.ats]}, ${r.count} open job${r.count === 1 ? "" : "s"}). Search again to include its jobs.`;
  document.querySelector("#companypanel details")?.setAttribute("open", "");
};
// ---------- company autocomplete ----------
// 15,000+ Greenhouse / Lever / Ashby company board IDs (data/company-directory.json, from
// Riley-Dorrington/job-board-aggregator, MIT licensed). Loaded the first time the user types.
let companyDirectory = null;
async function loadCompanyDirectory() {
  if (companyDirectory) return companyDirectory;
  let d = await (await fetch("data/company-directory.json")).json(),
    list = [];
  for (let [ats, ids] of Object.entries(d.companies || {})) for (let slug of ids) list.push({ ats, slug, key: slug.toLowerCase().replace(/[^a-z0-9]/g, "") });
  return (companyDirectory = list);
}
// "scale-ai" → "Scale Ai", "10up-2" → "10up".
function prettyCompany(slug) {
  return String(slug)
    .replace(/[-_]\d+$/, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
window.companySuggest = async function (value) {
  let box = document.getElementById("companysuggest"),
    q = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!box) return;
  if (q.length < 2 || /[./]/.test(value)) return (box.innerHTML = "");
  let list = await loadCompanyDirectory().catch(() => []),
    following = new Set(companyBoards().map((b) => `${b.ats}:${b.slug.toLowerCase()}`)),
    starts = list.filter((c) => c.key.startsWith(q)),
    contains = starts.length < 8 ? list.filter((c) => !c.key.startsWith(q) && c.key.includes(q)) : [],
    // One row per company: a company can be listed on more than one system (e.g. after moving).
    groups = new Map();
  for (let c of [...starts.sort((a, b) => a.key.length - b.key.length), ...contains]) {
    let name = prettyCompany(c.slug),
      k = name.toLowerCase();
    if (!groups.has(k)) groups.set(k, { name, boards: [] });
    groups.get(k).boards.push(c);
    if (groups.size > 8) break;
  }
  let hits = [...groups.values()].slice(0, 8);
  if (document.getElementById("companyadd")?.value !== value) return; // typed on meanwhile
  window.companySuggestions = hits;
  box.innerHTML = hits.length
    ? hits
        .map((g, i) => {
          let on = g.boards.some((c) => following.has(`${c.ats}:${c.slug.toLowerCase()}`));
          return `<button type="button" role="option" class="company-option" ${on ? "disabled" : ""} onclick="companyPick(${i})"><b>${esc(g.name)}</b> <small>${esc([...new Set(g.boards.map((c) => ATS_LABEL[c.ats]))].join(" / "))}${on ? " · following" : ""}</small></button>`;
        })
        .join("")
    : `<p class="help">No company named “${esc(value)}” in the directory. Paste its careers page link instead.</p>`;
};
// Try each board known for the company until one has open jobs.
window.companyPick = async function (index) {
  let g = (window.companySuggestions || [])[index],
    status = document.getElementById("companyaddstatus");
  if (!g) return;
  document.getElementById("companysuggest").innerHTML = "";
  if (status) status.textContent = `Checking ${g.name}’s job board…`;
  let r = { error: `${g.name} has no open jobs on its listed job board right now.` };
  for (let c of g.boards) {
    let n = await boardJobCount({ ats: c.ats, slug: c.slug, name: g.name });
    if (n > 0) {
      r = await window.addCompanyBoard({ greenhouse: `https://boards.greenhouse.io/${c.slug}`, lever: `https://jobs.lever.co/${c.slug}`, ashby: `https://jobs.ashbyhq.com/${c.slug}` }[c.ats], g.name);
      break;
    }
  }
  if (r.error) return status && (status.textContent = r.error);
  window.renderCompanyPanel();
  let s = document.getElementById("companyaddstatus");
  if (s) s.textContent = `Added ${r.board.name} (${ATS_LABEL[r.board.ats]}, ${r.count} open job${r.count === 1 ? "" : "s"}). Search again to include its jobs.`;
  document.querySelector("#companypanel details")?.setAttribute("open", "");
};
document.addEventListener("DOMContentLoaded", () => window.renderCompanyPanel());
if (document.readyState !== "loading") window.renderCompanyPanel();
