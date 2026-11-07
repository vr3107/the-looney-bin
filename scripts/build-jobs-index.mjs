// Builds the daily job index used by the app's "Job index" source.
//
// Source: the public dataset published by Riley-Dorrington/job-board-aggregator (MIT
// licensed): about 1.4 million open jobs from company career sites (Greenhouse, Lever,
// Ashby, Workday, iCIMS, BambooHR, Paylocity), refreshed daily.
//
// Output (a static site, published to Cloudflare Pages by .github/workflows/jobs-index.yml):
//   meta.json          { updated, total, buckets, words: { word: count } }
//   w/<word>.json.gz   jobs whose title contains a common word (one file per word)
//   b/<n>.json.gz      jobs for all other title words, grouped by hash(word) % buckets
//   _headers           lets the app read the files from its own domain
// Each job is [title, company, location, url, ats, level, salaryMedian, firstSeenDay].
//
// Usage: node scripts/build-jobs-index.mjs <outDir> [localChunkDir]

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { gunzipSync, gzipSync, constants } from "node:zlib";
import { join } from "node:path";

const SOURCE = "https://riley-dorrington.github.io/job-board-data/data/chunks";
const BUCKETS = 2048;
const OWN_FILE_MIN = 1500; // words in at least this many titles get their own file
const outDir = process.argv[2] || "dist-index";
const localDir = process.argv[3] || "";

// Keep in sync with js/job-index.js (the browser side uses the same rules).
const STOP = new Set("and or of the a an to in for with at on by from via per".split(" "));
export function titleWords(title) {
  return [...new Set(String(title || "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w)))];
}
export function bucketOf(word) {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 0x01000193) >>> 0;
  return h % BUCKETS;
}

const NON_US = /\b(uk|united kingdom|england|london|canada|toronto|vancouver|montreal|india|bangalore|bengaluru|hyderabad|pune|mumbai|chennai|germany|berlin|munich|france|paris|ireland|dublin|china|shanghai|beijing|singapore|australia|sydney|melbourne|japan|tokyo|brazil|são paulo|sao paulo|mexico|poland|warsaw|spain|madrid|barcelona|netherlands|amsterdam|israel|tel aviv|philippines|manila|emea|apac|latam|europe|switzerland|zurich|sweden|stockholm|denmark|norway|finland|italy|portugal|lisbon|argentina|colombia|chile|korea|seoul|taiwan|vietnam|indonesia|malaysia|thailand|south africa|nigeria|kenya|egypt|uae|dubai|saudi|turkey|romania|czech|hungary|ukraine|greece|austria|belgium|new zealand)\b/i;
const US_HINT = /united states|\busa\b|\bu\.s\.|\bus\b|remote|,\s*[A-Z]{2}\b/i;
const LEVEL = { intern: "i", entry: "e", junior: "e", mid: "m", senior: "s", lead: "s", executive: "x" };
const DAY0 = Date.UTC(2020, 0, 1);

async function getBuffer(name) {
  if (localDir) return readFileSync(join(localDir, name));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${SOURCE}/${name}?v=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) throw new Error(`${name}: ${e.message}`);
      await new Promise((res) => setTimeout(res, attempt * 5000));
    }
  }
}

const started = Date.now();
const manifest = JSON.parse((await getBuffer("jobs_manifest.json")).toString("utf8"));
const jobs = [];
const seenUrls = new Set();
let read = 0,
  skippedNonUs = 0;
for (const chunk of manifest.chunks) {
  const rows = JSON.parse(gunzipSync(await getBuffer(chunk)).toString("utf8"));
  for (const r of Array.isArray(rows) ? rows : rows.jobs || []) {
    read++;
    const url = String(r.url || "");
    const title = String(r.title || "").replace(/\s+/g, " ").trim();
    if (!/^https?:\/\//.test(url) || !title || seenUrls.has(url)) continue;
    const location = String(r.location || "").replace(/\s+/g, " ").trim();
    if (NON_US.test(location) && !US_HINT.test(location)) {
      skippedNonUs++;
      continue;
    }
    seenUrls.add(url);
    const first = Date.parse(r.first_seen || r.scraped_at || "");
    jobs.push([
      title.slice(0, 160),
      String(r.company || "").slice(0, 80),
      location.slice(0, 80),
      url,
      String(r.ats || ""),
      LEVEL[String(r.skill_level || "").toLowerCase()] || "",
      Math.round((r.salary && r.salary.median) || 0),
      Number.isFinite(first) ? Math.floor((first - DAY0) / 864e5) : 0,
    ]);
  }
}
seenUrls.clear();

// Title word → job numbers.
const byWord = new Map();
jobs.forEach((job, i) => {
  for (const w of titleWords(job[0])) {
    let list = byWord.get(w);
    if (!list) byWord.set(w, (list = []));
    list.push(i);
  }
});

if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(join(outDir, "w"), { recursive: true });
mkdirSync(join(outDir, "b"), { recursive: true });
const gz = (rows) => gzipSync(Buffer.from(JSON.stringify(rows)), { level: constants.Z_BEST_COMPRESSION });
const words = {};
const bucketJobs = Array.from({ length: BUCKETS }, () => new Set());
let bytes = 0,
  files = 0;
for (const [w, list] of byWord) {
  if (list.length >= OWN_FILE_MIN && /^[a-z0-9]+$/.test(w)) {
    const data = gz(list.map((i) => jobs[i]));
    writeFileSync(join(outDir, "w", `${w}.json.gz`), data);
    words[w] = list.length;
    bytes += data.length;
    files++;
  } else for (const i of list) bucketJobs[bucketOf(w)].add(i);
}
bucketJobs.forEach((set, n) => {
  const data = gz([...set].map((i) => jobs[i]));
  writeFileSync(join(outDir, "b", `${n}.json.gz`), data);
  bytes += data.length;
  files++;
});
writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify({ updated: manifest.last_updated || new Date().toISOString(), built: new Date().toISOString(), total: jobs.length, buckets: BUCKETS, ownFileMin: OWN_FILE_MIN, words, source: "https://github.com/Riley-Dorrington/job-board-aggregator (MIT License)" }),
);
writeFileSync(join(outDir, "_headers"), "/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=3600\n");
console.log(
  `Read ${read.toLocaleString()} jobs, kept ${jobs.length.toLocaleString()} (skipped ${skippedNonUs.toLocaleString()} outside the US). ` +
    `${byWord.size.toLocaleString()} title words: ${Object.keys(words).length} own files + ${BUCKETS} buckets = ${files.toLocaleString()} files, ` +
    `${(bytes / 1e6).toFixed(1)} MB compressed, in ${Math.round((Date.now() - started) / 1000)}s.`,
);
