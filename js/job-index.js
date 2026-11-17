// "Job index" source: about 1.2 million US jobs from company career sites (Greenhouse, Lever,
// Ashby, Workday, iCIMS, BambooHR, Paylocity), rebuilt daily by .github/workflows/jobs-index.yml
// and published as small files split by title word. A search downloads only the file for the
// least common word in each searched role, then keeps titles containing every word.
const JOB_INDEX_URL = "https://looney-bin-jobs.pages.dev";
const JOB_INDEX_MAX_PER_ROLE = 3000;
const ATS_NAMES = { Greenhouse: "Greenhouse", Lever: "Lever", Ashby: "Ashby", Workday: "Workday", iCIMS: "iCIMS", BambooHR: "BambooHR", Paylocity: "Paylocity" };
const LEVEL_NAMES = { i: "Internship", e: "Entry level", m: "Mid level", s: "Senior", x: "Executive" };

// Keep in sync with scripts/build-jobs-index.mjs.
const INDEX_STOP = new Set("and or of the a an to in for with at on by from via per".split(" "));
function indexTitleWords(title) {
  return [...new Set(String(title || "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").split(" ").filter((w) => w.length > 1 && !INDEX_STOP.has(w)))];
}
function indexBucketOf(word, buckets) {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 0x01000193) >>> 0;
  return h % buckets;
}

let jobIndexMeta = null;
const jobIndexFiles = new Map(); // path → rows (kept for the session)
async function jobIndexGet(path) {
  if (jobIndexFiles.has(path)) return jobIndexFiles.get(path);
  let r = await fetch(`${JOB_INDEX_URL}/${path}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  let text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text(),
    rows = JSON.parse(text);
  jobIndexFiles.set(path, rows);
  return rows;
}
// "0g" / "acme-corp" → "0g" / "Acme Corp" (company names in the index are board IDs).
function indexCompanyName(id) {
  let s = String(id || "").replace(/[-_]\d+$/, "").replace(/[-_.]+/g, " ").trim();
  return /[A-Z]/.test(s) ? s : s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function indexJob(row) {
  let [title, company, location, url, ats, level, salary, day] = row,
    job = baseJob(
      "Job index",
      url,
      title,
      indexCompanyName(company),
      location || "Not specified",
      url,
      "",
      [ATS_NAMES[ats] || ats, LEVEL_NAMES[level]].filter(Boolean),
      day ? new Date(Date.UTC(2020, 0, 1) + day * 864e5).toISOString() : "",
      salary ? `~$${Math.round(salary / 1000)}K (estimate)` : "",
    );
  // Greenhouse postings can load their full description when opened.
  let gh = String(url).match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([A-Za-z0-9_-]+)\/jobs\/(\d+)/);
  if (gh) Object.assign(job, { ats: "greenhouse", atsSlug: gh[1], atsJobId: gh[2], needsDetails: true });
  // Lever and Ashby: the same posting checked live on the company's board merges with this one.
  let lv = !gh && String(url).match(/jobs\.lever\.co\/([A-Za-z0-9_.-]+)\/([0-9a-f-]{36})/i),
    ab = !gh && !lv && String(url).match(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)\/([0-9a-f-]{36})/i);
  if (lv) Object.assign(job, { atsKey: `lever:${lv[1].toLowerCase()}:${lv[2].toLowerCase()}` });
  let wdj = !gh && !lv && !ab && typeof workdayFromUrl === "function" && workdayFromUrl(url);
  if (wdj) Object.assign(job, { atsKey: `workday:${wdj.tenant}:${wdj.path}` });
  if (ab) Object.assign(job, { atsKey: `ashby:${decodeURIComponent(ab[1]).toLowerCase()}:${ab[2].toLowerCase()}` });
  return job;
}
// roles: [{ raw, ... }] from parseJobSearch. area: the place search in force, if any
// (js/geo-search.js); its test runs before the per-role limit, so nearby jobs aren't crowded out.
async function loadJobIndex(roles, progress = () => {}, area = null) {
  let out = [];
  try {
    progress("Loading the daily job index…");
    jobIndexMeta ||= await (await fetch(`${JOB_INDEX_URL}/meta.json`, { signal: AbortSignal.timeout(20000) })).json();
    let words = jobIndexMeta.words || {},
      buckets = jobIndexMeta.buckets || 2048;
    for (let role of roles.slice(0, 5)) {
      let want = indexTitleWords(role.raw || role);
      if (!want.length) continue;
      // Download the file for the least common word (a word without its own file is rare).
      let rarest = [...want].sort((a, b) => (words[a] ?? 0) - (words[b] ?? 0))[0],
        rows = await jobIndexGet(words[rarest] ? `w/${rarest}.json.gz` : `b/${indexBucketOf(rarest, buckets)}.json.gz`);
      let hits = rows.filter((row) => {
        let have = indexTitleWords(row[0]);
        return want.every((w) => have.includes(w)) && (!area || area.keepLocation(row[2]));
      });
      hits.sort((a, b) => (b[7] || 0) - (a[7] || 0));
      out.push(...hits.slice(0, JOB_INDEX_MAX_PER_ROLE).map(indexJob));
    }
  } catch (e) {
    feedErrors.push(`Job index unavailable (${e.message}).`);
  }
  feedStats["Job index"] = out.length;
  return out;
}
window.loadJobIndex = loadJobIndex;
