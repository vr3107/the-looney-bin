// "Add a job" from a pasted link: POST /api/job-from-link { url } → the posting's details.
//
// Hiring systems with public posting data are read directly (Greenhouse, Lever, Ashby, Workday,
// SmartRecruiters, Workable, Recruitee, Dice). Any other career page is read once for the standard
// job data (schema.org JobPosting) or, failing that, its title and summary. LinkedIn, Indeed,
// Glassdoor and ZipRecruiter don't allow other sites to read their pages, so only the link and the
// job ID in it are returned for those.
import { isPublicUrl, fetchChecked, readCapped } from "../_lib/net.js";
import { initializeDice, diceRequest, structuredResult } from "./dice-search.js";

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
    if (cur.count >= 20) return false;
    cur.count += 1;
  } else requestsByIp.set(ip, { startedAt: now, count: 1 });
  if (requestsByIp.size > 5000) for (const [k, v] of requestsByIp) if (now - v.startedAt >= 60_000) requestsByIp.delete(k);
  return true;
}

// ---- text helpers ----
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", trade: "™", reg: "®", copy: "©" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
// HTML (or entity-escaped HTML) → readable text with paragraphs and bullets kept.
export function htmlToText(html) {
  let s = String(html || "");
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s); // Greenhouse sends escaped HTML
  s = s
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|section|tr|table)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|ul|ol|section|tr|table)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=• )/g, "\n") // bullets in one list stay together
    .trim()
    .slice(0, 40_000);
}
const clean = (s, n = 200) => decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, n);
const money = (n) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
function salaryText(min, max, unit = "", currency = "USD") {
  min = Number(min) || 0;
  max = Number(max) || 0;
  if (!min && !max) return "";
  const per = /hour/i.test(unit) ? "/hr" : /month/i.test(unit) ? "/mo" : "";
  const fmt = currency && currency !== "USD" ? (n) => `${Math.round(n).toLocaleString("en-US")} ${currency}` : per ? (n) => `$${Number(n).toFixed(n % 1 ? 2 : 0)}` : money;
  return min && max && min !== max ? `${fmt(min)}–${fmt(max)}${per}` : `${fmt(min || max)}${per}`;
}
const iso = (d) => {
  const t = typeof d === "number" ? d : Date.parse(d || "");
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : "";
};
function result(fields) {
  const r = {
    title: clean(fields.title),
    company: clean(fields.company, 120),
    location: clean(fields.location, 200),
    salary: clean(fields.salary, 80),
    description: String(fields.description || "").slice(0, 40_000),
    jobId: clean(fields.jobId, 80),
    posted: fields.posted || "",
    employmentType: clean(fields.employmentType, 60),
    workplace: clean(fields.workplace, 30),
    skills: (fields.skills || []).map((s) => clean(s, 60)).filter(Boolean).slice(0, 40),
    source: fields.source,
    url: fields.url,
    partial: Boolean(fields.partial),
    note: fields.note || "",
  };
  return r;
}
async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) }, redirect: "manual", signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---- hiring systems ----
const SLUG = "[A-Za-z0-9_.-]+";
async function greenhouse(u) {
  let m = u.href.match(new RegExp(`(?:boards|job-boards)(?:\\.eu)?\\.greenhouse\\.io/(?:embed/job_app\\?for=)?(${SLUG})/jobs/(\\d+)`));
  const slug = m?.[1] || u.searchParams.get("for"),
    id = m?.[2] || u.searchParams.get("token") || u.searchParams.get("gh_jid");
  if (!slug || !id || !/^\d+$/.test(id) || !new RegExp(`^${SLUG}$`).test(slug)) return null;
  const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?pay_transparency=true`);
  const pay = (j.pay_input_ranges || [])[0];
  return result({ title: j.title, company: j.company_name || slug, location: j.location?.name, description: htmlToText(j.content), jobId: j.requisition_id || id, posted: iso(j.first_published || j.updated_at), salary: pay ? salaryText(pay.min_cents / 100, pay.max_cents / 100, "", pay.currency_type) : "", source: "Greenhouse", url: j.absolute_url || u.href });
}
async function lever(u) {
  const m = u.href.match(new RegExp(`jobs(?:\\.eu)?\\.lever\\.co/(${SLUG})/([0-9a-f-]{36})`, "i"));
  if (!m) return null;
  const eu = /jobs\.eu\.lever/.test(u.host) ? "api.eu.lever.co" : "api.lever.co";
  const j = await getJson(`https://${eu}/v0/postings/${m[1]}/${m[2]}`);
  const lists = (j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
  const sr = j.salaryRange;
  return result({ title: j.text, company: m[1], location: j.categories?.allLocations?.join(" / ") || j.categories?.location, description: [j.descriptionPlain || htmlToText(j.description), lists, j.additionalPlain || htmlToText(j.additional)].filter(Boolean).join("\n\n"), jobId: m[2], posted: iso(j.createdAt), employmentType: j.categories?.commitment, workplace: j.workplaceType, salary: sr ? salaryText(sr.min, sr.max, sr.interval, sr.currency) : "", skills: [j.categories?.team, j.categories?.department].filter(Boolean), source: "Lever", url: j.hostedUrl || u.href });
}
async function ashby(u) {
  const m = u.href.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  if (!/^[A-Za-z0-9 _.-]+$/.test(slug)) return null;
  const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`);
  const j = (d.jobs || []).find((x) => String(x.id).toLowerCase() === m[2].toLowerCase());
  if (!j) throw new Error("This posting is no longer listed on the company’s job board.");
  return result({ title: j.title, company: d.organizationName || slug, location: [j.location, ...(j.secondaryLocations || []).map((x) => x.location)].filter(Boolean).join(" / "), description: j.descriptionPlain || htmlToText(j.descriptionHtml), jobId: j.id, posted: iso(j.publishedAt), employmentType: j.employmentType, workplace: j.workplaceType || (j.isRemote ? "Remote" : ""), salary: j.compensation?.compensationTierSummary || "", skills: [j.department, j.team].filter(Boolean), source: "Ashby", url: j.jobUrl || u.href });
}
async function workday(u) {
  const m = u.href.match(/^https:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_.-]+)\/(job\/[^?#]+)/i);
  if (!m) return null;
  const [, tenant, wd, site, path] = m;
  const d = await getJson(`https://${tenant.toLowerCase()}.${wd.toLowerCase()}.myworkdayjobs.com/wday/cxs/${tenant.toLowerCase()}/${site}/${path}`);
  const j = d.jobPostingInfo || {};
  return result({ title: j.title, company: d.hiringOrganization?.name || tenant, location: [j.location, ...(j.additionalLocations || [])].filter(Boolean).join(" / "), description: htmlToText(j.jobDescription), jobId: j.jobReqId, posted: iso(j.startDate), employmentType: j.timeType, workplace: j.remoteType || "", source: "Workday", url: j.externalUrl || u.href });
}
async function smartRecruiters(u) {
  const m = u.href.match(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/);
  if (!m) return null;
  const j = await getJson(`https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`);
  const s = j.jobAd?.sections || {};
  const l = j.location || {};
  return result({ title: j.name, company: j.company?.name || m[1], location: l.remote ? "Remote" + (l.country ? `, ${l.country.toUpperCase()}` : "") : [l.city, l.region, l.country?.toUpperCase()].filter(Boolean).join(", "), description: ["companyDescription", "jobDescription", "qualifications", "additionalInformation"].map((k) => s[k] && `${s[k].title || ""}\n${htmlToText(s[k].text)}`).filter(Boolean).join("\n\n"), jobId: j.refNumber || m[2], posted: iso(j.releasedDate), employmentType: j.typeOfEmployment?.label, workplace: l.remote ? "Remote" : l.hybrid ? "Hybrid" : "", source: "SmartRecruiters", url: j.postingUrl || u.href });
}
async function workable(u) {
  const m = u.href.match(/apply\.workable\.com\/([A-Za-z0-9_-]+)\/j\/([A-Z0-9]+)/i);
  if (!m) return null;
  const j = await getJson(`https://apply.workable.com/api/v2/accounts/${m[1]}/jobs/${m[2]}`);
  const l = j.location || {};
  return result({ title: j.title, company: j.company?.title || m[1], location: [l.city, l.region, l.country].filter(Boolean).join(", ") + (j.remote ? " (Remote)" : ""), description: [htmlToText(j.description), j.requirements && "Requirements\n" + htmlToText(j.requirements), j.benefits && "Benefits\n" + htmlToText(j.benefits)].filter(Boolean).join("\n\n"), jobId: m[2], posted: iso(j.published), employmentType: j.type, workplace: j.workplace || (j.remote ? "Remote" : ""), source: "Workable", url: u.href });
}
async function recruitee(u) {
  const m = u.href.match(/^https:\/\/([a-z0-9-]+)\.recruitee\.com\/o\/([a-z0-9-]+)/i);
  if (!m) return null;
  const d = await getJson(`https://${m[1]}.recruitee.com/api/offers/${m[2]}`);
  const j = d.offer || {};
  return result({ title: j.title, company: j.company_name || m[1], location: j.location || [j.city, j.state_code, j.country_code].filter(Boolean).join(", "), description: [htmlToText(j.description), htmlToText(j.requirements)].filter(Boolean).join("\n\n"), jobId: j.id, posted: iso(j.published_at || j.created_at), employmentType: j.employment_type_code, workplace: j.remote ? "Remote" : j.hybrid ? "Hybrid" : "", source: "Recruitee", url: j.careers_url || u.href });
}
async function dice(u) {
  const m = u.href.match(/dice\.com\/job-detail\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const connection = await initializeDice().catch(() => new Promise((ok) => setTimeout(ok, 800)).then(initializeDice));
  const call = async (name, id) => {
    const { rpc } = await diceRequest({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { job_id: m[1] } } }, connection.session, connection.protocolVersion);
    if (rpc?.error || rpc?.result?.isError) return null;
    if (rpc?.result?.structuredContent) return rpc.result.structuredContent;
    const text = (rpc?.result?.content || []).find((c) => c.type === "text")?.text || "";
    try {
      return JSON.parse(text);
    } catch {
      return structuredResult(rpc?.result);
    }
  };
  const [details, company] = await Promise.all([call("get_job_details", 2), call("get_company", 3).catch(() => null)]);
  if (!details?.description) throw new Error("Dice didn’t return this posting.");
  const text = htmlToText(details.description);
  const pay = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*\$\s?([\d,]+(?:\.\d+)?)/);
  return result({ title: "", company: company?.name || "", description: text, jobId: m[1], salary: pay ? salaryText(pay[1].replace(/,/g, ""), pay[2].replace(/,/g, "")) : "", skills: (details.skills || []).map((s) => s.name), source: "Dice", url: `https://www.dice.com/job-detail/${m[1]}`, partial: true, note: "Dice shares the description and skills but not the title or location: add those from the posting." });
}

// ---- sites that don't allow reading their pages ----
function linkOnly(u) {
  const host = u.hostname.replace(/^www\./, "");
  const q = (k) => u.searchParams.get(k);
  const site = /linkedin\.com$/.test(host) ? "LinkedIn" : /(^|\.)indeed\./.test(host) ? "Indeed" : /(^|\.)glassdoor\./.test(host) ? "Glassdoor" : /ziprecruiter\.com$/.test(host) ? "ZipRecruiter" : "";
  if (!site) return null;
  const id = site === "LinkedIn" ? (u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1] || q("currentJobId") : site === "Indeed" ? q("jk") || q("vjk") : site === "Glassdoor" ? q("jl") || q("jobListingId") : (u.pathname.match(/\/(?:jobs|c)\/[^?#]*/) || [""])[0].split("/").pop();
  return result({ jobId: id || "", source: site, url: u.href, partial: true, note: `${site} doesn’t allow other sites to read its job pages. Open the posting and use the “Save to Looney Bin” button to bring in every detail, or paste the description below.` });
}

// ---- any other career page: schema.org JobPosting, then title and summary ----
function jobPostingFrom(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const raw of blocks) {
    let d;
    try {
      d = JSON.parse(raw.trim());
    } catch {
      try {
        d = JSON.parse(decodeEntities(raw.trim()));
      } catch {
        continue;
      }
    }
    const stack = [d];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== "object") continue;
      if (Array.isArray(x)) stack.push(...x);
      else {
        const t = x["@type"];
        if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return x;
        if (x["@graph"]) stack.push(x["@graph"]);
      }
    }
  }
  return null;
}
function placeOf(jp) {
  const locs = [].concat(jp.jobLocation || []).map((l) => l?.address || l).filter(Boolean);
  const text = locs
    .map((a) => (typeof a === "string" ? a : [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter((v) => typeof v === "string" && v).join(", ")))
    .filter(Boolean);
  const remote = jp.jobLocationType === "TELECOMMUTE";
  if (remote) {
    const where = [].concat(jp.applicantLocationRequirements || []).map((r) => r?.name).filter(Boolean);
    return ["Remote" + (where.length ? ` (${where.join(", ")})` : ""), ...text].join(" / ");
  }
  return [...new Set(text)].join(" / ");
}
const meta = (html, name) => decodeEntities((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, "i")) || [])[1] || "");
async function careerPage(u) {
  const { r, finalUrl } = await fetchChecked(u, "text/html,application/xhtml+xml");
  if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? "This site didn’t let the app read the page." : r.status === 404 || r.status === 410 ? "This posting wasn’t found — it may have closed." : `The page answered ${r.status}.`);
  const html = await readCapped(r, 1_500_000);
  // A company page that embeds a hiring system: read the posting from that system.
  const gh = html.match(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/|embed\/job_board\/js\?for=|embed\/job_app\?for=)([A-Za-z0-9_.-]+)/);
  const ghId = new URL(finalUrl).searchParams.get("gh_jid") || u.searchParams.get("gh_jid");
  if (gh && ghId) {
    const viaGh = await greenhouse(new URL(`https://boards.greenhouse.io/${gh[1]}/jobs/${ghId}`)).catch(() => null);
    if (viaGh) return { ...viaGh, url: u.href };
  }
  const jp = jobPostingFrom(html);
  if (jp) {
    const bs = jp.baseSalary,
      v = bs?.value || {};
    return result({
      title: jp.title,
      company: jp.hiringOrganization?.name || meta(html, "og:site_name"),
      location: placeOf(jp),
      description: htmlToText(jp.description),
      jobId: jp.identifier?.value || (typeof jp.identifier === "string" ? jp.identifier : ""),
      posted: iso(jp.datePosted),
      employmentType: [].concat(jp.employmentType || []).join(", ").replace(/_/g, " ").toLowerCase(),
      workplace: jp.jobLocationType === "TELECOMMUTE" ? "Remote" : "",
      salary: bs ? salaryText(v.minValue ?? v.value, v.maxValue, v.unitText, bs.currency) : "",
      skills: [].concat(jp.skills || []).flatMap((s) => (typeof s === "string" ? s.split(/,\s*/) : [])),
      source: new URL(finalUrl).hostname.replace(/^www\./, ""),
      url: u.href,
    });
  }
  const title = meta(html, "og:title") || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  if (!title) throw new Error("No job details were found on this page.");
  return result({ title, company: meta(html, "og:site_name"), description: meta(html, "og:description") || meta(html, "description"), source: new URL(finalUrl).hostname.replace(/^www\./, ""), url: u.href, partial: true, note: "This page doesn’t publish structured job details, so only its title and summary were read. Paste the full description for a better match." });
}

export async function readJobLink(href) {
  let u;
  try {
    u = new URL(String(href).trim());
  } catch {
    throw new Error("bad_url");
  }
  if (!isPublicUrl(u)) throw new Error("bad_url");
  const only = linkOnly(u);
  if (only) return only;
  for (const reader of [greenhouse, lever, ashby, workday, smartRecruiters, workable, recruitee, dice]) {
    let r = null;
    try {
      r = await reader(u);
    } catch (e) {
      if (reader === dice) throw e;
      // a hiring system's data couldn't be read: try the page itself below
      r = null;
    }
    if (r) return r;
  }
  return careerPage(u);
}

export async function onRequestPost({ request }) {
  if (!allowedOrigin(request)) return json({ error: "same_origin_required" }, 403);
  if (!withinRateLimit(request.headers.get("CF-Connecting-IP") || "unknown")) return json({ error: "rate_limited", message: "Too many links at once. Wait a minute and try again." }, 429);
  const body = (await request.json().catch(() => null)) || {};
  if (typeof body.url !== "string" || body.url.length > 2000) return json({ error: "bad_url", message: "Paste the full link to a job posting (starting with https://)." }, 400);
  try {
    return json({ job: await readJobLink(body.url) });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === "bad_url") return json({ error: "bad_url", message: "That isn’t a public job posting link. Paste the full link starting with https://." }, 400);
    const known = /posting|page|site|Dice|board|found|closed/i.test(msg) && msg.length < 200;
    return json({ error: "unreadable", message: known ? msg : "The job details couldn’t be read from this link. You can still fill them in below." }, 422);
  }
}
