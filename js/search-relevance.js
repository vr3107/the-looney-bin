// Search relevance for job titles, postings, and company names.
// Whole-word matching with abbreviation/synonym normalization, light stemming,
// typo tolerance, related-role families, company-name matching, "exact phrases",
// and -exclusions. Loaded before job-search.js, which calls roleRelevance /
// companyRelevance / parseJobSearch.

// Phrase-level synonyms, applied after lowercasing and symbol cleanup.
const SEARCH_PHRASES = [
  [/\bc\+\+/g, " cpp "],
  [/\bc#/g, " csharp "],
  [/\.net\b/g, " dotnet "],
  [/\bnode\.?js\b/g, " nodejs "],
  [/\breact\.?js\b/g, " react "],
  [/\bvue\.?js\b/g, " vue "],
  [/\bnext\.?js\b/g, " nextjs "],
  [/\bci\s*\/\s*cd\b/g, " cicd "],
  [/\bai\s*\/\s*ml\b|\bml\s*\/\s*ai\b/g, " ai ml "],
];
const SEARCH_WORD_PHRASES = [
  [/\bmachine learning\b/g, "ml"],
  [/\bartificial intelligence\b/g, "ai"],
  [/\b(generative ai|gen ai|genai)\b/g, "genai ai"],
  [/\blarge language models?\b|\bllms\b/g, "llm"],
  [/\bnatural language processing\b/g, "nlp"],
  [/\bcomputer vision\b/g, "computervision"],
  [/\bdeep learning\b/g, "deeplearning"],
  [/\bbusiness intelligence\b/g, "bi"],
  [/\buser experience\b/g, "ux"],
  [/\buser interface\b/g, "ui"],
  [/\bquality assurance\b/g, "qa"],
  [/\bfront ?end\b/g, "frontend"],
  [/\bback ?end\b/g, "backend"],
  [/\bfull ?stack\b/g, "fullstack"],
  [/\bdev ?ops\b/g, "devops"],
  [/\bml ?ops\b/g, "mlops"],
  [/\bsite reliability( engineering| engineer)?\b/g, "sre"],
  [/\bidentity (and|&)? ?access management\b/g, "iam"],
  [/\bsoftware development engineer\b|\bsde\b|\bswe\b/g, "software engineer"],
  [/\bdata centres?\b|\bdatacent(er|re)s?\b/g, "data center"],
  [/\bpower ?bi\b/g, "powerbi"],
  [/\bcyber ?security\b/g, "cybersecurity"],
];
const SEARCH_ABBREV = {
  sr: "senior", snr: "senior", jr: "junior", mgr: "manager", eng: "engineer",
  engr: "engineer", dev: "developer", devs: "developer", admin: "administrator",
  sys: "systems", ops: "operations", mgmt: "management", assoc: "associate",
  tech: "technical", arch: "architect", analytic: "analytics",
};
// Stems shared by query and posting, so "Data Science" ≈ "Data Scientist", "Engineers" ≈ "Engineer".
const SEARCH_STEMS = {
  engineering: "engineer", engineers: "engineer", science: "scientist",
  sciences: "scientist", scientists: "scientist", analysts: "analyst",
  developers: "developer", managers: "manager", architects: "architect",
  designers: "designer", specialists: "specialist", consultants: "consultant",
  administrators: "administrator", technicians: "technician", programmers: "programmer",
  directors: "director", leads: "lead", interns: "intern", internship: "intern",
  internships: "intern", nurses: "nurse", accountants: "accountant",
  representatives: "representative", coordinators: "coordinator", officers: "officer",
  recruiters: "recruiter", writers: "writer", researchers: "researcher",
};
// Words that describe seniority or arrangement, not the role itself.
const SEARCH_MODIFIERS = new Set(
  "senior junior lead staff principal i ii iii iv v entry level mid associate remote hybrid onsite on site contract contractor fulltime full part time w2 c2c 1099 the of and for in at with to a an us usa united states new grad graduate experienced".split(" "),
);
// Generic role nouns: matching only one of these is not a role match by itself.
const SEARCH_HEADS = new Set(
  "engineer developer analyst scientist manager specialist consultant architect administrator designer director associate coordinator technician programmer officer representative lead intern head expert professional".split(" "),
);
// Broad domain words that don't identify a role on their own ("Data Entry Clerk" is not a "Data Scientist" match).
const SEARCH_WEAK = new Set(
  "data business software technical systems system information digital it product project operations general global customer services service solutions application applications platform web computer".split(" "),
);
const COMPANY_SUFFIXES = new Set(
  "inc incorporated llc l l c ltd limited corp corporation co company plc lp llp gmbh ag sa bv group holdings holding the".split(" "),
);
// Related-role families: query role → title phrases that count as a related role.
const ROLE_FAMILIES = {
  "data scientist": ["ml engineer", "ml scientist", "ai engineer", "applied scientist", "research scientist", "decision scientist", "ml", "ai scientist", "quantitative analyst", "data analyst", "nlp engineer", "deeplearning"],
  "ml engineer": ["ai engineer", "data scientist", "mlops", "applied scientist", "deeplearning", "nlp", "computervision", "llm", "genai", "ml", "ai scientist", "research engineer"],
  "ai engineer": ["ml engineer", "genai", "llm", "nlp", "data scientist", "applied scientist", "ml", "ai", "prompt engineer", "ai developer"],
  "data analyst": ["business analyst", "bi analyst", "bi developer", "bi engineer", "analytics engineer", "reporting analyst", "insights analyst", "data scientist", "product analyst", "analytics", "bi"],
  "data engineer": ["analytics engineer", "data architect", "etl developer", "etl engineer", "big data", "data platform", "database engineer", "bi engineer", "data warehouse", "data integration", "data pipeline"],
  "software engineer": ["software developer", "backend engineer", "frontend engineer", "fullstack engineer", "fullstack developer", "backend developer", "frontend developer", "application developer", "web developer", "platform engineer"],
  "software developer": ["software engineer", "backend developer", "frontend developer", "fullstack developer", "application developer", "web developer"],
  "product manager": ["product owner", "program manager", "product lead", "product director"],
  "project manager": ["program manager", "scrum master", "delivery manager", "project coordinator"],
  "devops engineer": ["sre", "platform engineer", "cloud engineer", "infrastructure engineer", "devops", "release engineer", "build engineer"],
  "cloud engineer": ["devops engineer", "cloud architect", "platform engineer", "infrastructure engineer", "sre", "aws", "azure", "gcp"],
  "business analyst": ["data analyst", "systems analyst", "product analyst", "business systems analyst", "bi analyst"],
  "security engineer": ["security analyst", "cybersecurity", "information security", "soc analyst", "security architect", "iam"],
  "iam engineer": ["iam", "identity engineer", "identity", "okta", "sso", "access management", "security engineer"],
  "data center": ["critical facilities", "facility engineer", "facilities engineer", "data center operations", "data center technician", "network engineer", "systems engineer", "infrastructure engineer", "electrical engineer"],
  "qa engineer": ["test engineer", "sdet", "automation engineer", "qa analyst", "quality engineer", "qa"],
  "ux designer": ["product designer", "ui designer", "ux researcher", "interaction designer", "ux", "ui"],
};

// One combined pass for the word-level phrases (much faster on long descriptions).
const SEARCH_WORD_RE = new RegExp(SEARCH_WORD_PHRASES.map(([re]) => "(" + re.source.replace(/\((?!\?)/g, "(?:") + ")").join("|"), "g");
function searchClean(text) {
  let s = String(text || "").toLowerCase();
  if (/[+#.\/]/.test(s)) for (let [re, rep] of SEARCH_PHRASES) s = s.replace(re, rep);
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/\b(sr|snr|jr|mgr|eng|engr|dev|devs|admin|sys|ops|mgmt|assoc|tech|arch|analytic)\b/g, (w) => SEARCH_ABBREV[w]);
  return s.replace(SEARCH_WORD_RE, (...m) => {
    for (let i = 1; i <= SEARCH_WORD_PHRASES.length; i++) if (m[i] !== undefined) return SEARCH_WORD_PHRASES[i - 1][1];
    return m[0];
  });
}
function searchStem(w) {
  if (SEARCH_STEMS[w]) return SEARCH_STEMS[w];
  if (w.length > 4 && w.endsWith("s") && !/(ss|us|is|ics|ops|ys)$/.test(w)) return w.slice(0, -1);
  return w;
}
function searchTokens(text) {
  let s = searchClean(text);
  return s ? s.split(" ").map(searchStem) : [];
}
function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i],
      best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}
// Whole-token match, allowing a typo or two in longer words.
function tokenIn(token, tokens) {
  if (tokens.includes(token)) return "exact";
  if (token.length < 5) return "";
  let max = token.length >= 9 ? 2 : 1;
  return tokens.some((t) => t.length >= 4 && t[0] === token[0] && editDistanceWithin(token, t, max)) ? "fuzzy" : "";
}
function containsSequence(tokens, seq) {
  if (!seq.length || seq.length > tokens.length) return false;
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let j = 0; j < seq.length; j++) if (tokens[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}
const jobSearchCache = new WeakMap();
function jobSearchData(job) {
  let c = jobSearchCache.get(job);
  if (c) return c;
  let title = searchTokens(job.title),
    body = searchTokens(`${job.title} ${(job.tags || []).join(" ")} ${String(job.description || "").slice(0, 6000)}`);
  c = { scores: new Map(), title, titleWords: searchClean(job.title).split(" "), body, bodySet: new Set(body), company: companyTokens(job.company) };
  jobSearchCache.set(job, c);
  return c;
}
function companyTokens(name) {
  return searchClean(name).split(" ").filter((w) => w && !COMPANY_SUFFIXES.has(w));
}
function coreTokens(tokens) {
  let core = tokens.filter((t) => !SEARCH_MODIFIERS.has(t));
  return core.length ? core : tokens;
}
// Parse the search box: comma-separated terms, "exact phrases", and -exclusions.
function parseJobSearch(raw) {
  let text = String(raw || ""),
    exclude = [];
  text = text.replace(/(^|[\s,])-(\"[^\"]+\"|[^\s,]+)/g, (m, pre, word) => {
    exclude.push(searchTokens(word.replace(/\"/g, "")));
    return pre;
  });
  let terms = text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => {
      let exact = /^\".+\"$/.test(t),
        clean = t.replace(/\"/g, "").trim();
      return { raw: clean, exact, tokens: searchTokens(clean), words: searchClean(clean).split(" ").filter(Boolean) };
    })
    .filter((t) => t.tokens.length);
  return { terms, exclude: exclude.filter((e) => e.length) };
}
function asTerm(term) {
  if (term && typeof term === "object" && Array.isArray(term.tokens)) return term;
  return { raw: String(term || ""), exact: false, tokens: searchTokens(term) };
}
// True when the posting title contains an excluded word or phrase.
function jobExcluded(job, exclude) {
  if (!exclude?.length) return false;
  let d = jobSearchData(job);
  return exclude.some((seq) => containsSequence(d.title, seq) || containsSequence(d.company, seq));
}
function companyRelevance(job, term) {
  let t = asTerm(term),
    q = companyTokens(t.raw);
  if (!q.length) return 0;
  let c = jobSearchData(job).company;
  if (!c.length) return 0;
  let qs = q.join(" "),
    cs = c.join(" ");
  if (qs === cs) return 100;
  // A role-shaped term ("Data Engineer") only matches a company exactly.
  if (q.some((w) => SEARCH_HEADS.has(searchStem(w)))) return 0;
  if (containsSequence(c, q) && c.indexOf(q[0]) === 0) return 97;
  if (containsSequence(c, q) && (q.length > 1 || q[0].length >= 4)) return 93;
  if (qs.length >= 5 && cs.length >= 5 && editDistanceWithin(qs, cs, qs.length >= 10 ? 2 : 1)) return 90;
  if (q.length > 1 && cs.length >= 5 && c.length >= q.length && editDistanceWithin(qs, c.slice(0, q.length).join(" "), qs.length >= 10 ? 2 : 1)) return 80;
  return 0;
}
function roleRelevance(job, term) {
  let t = asTerm(term),
    cache = jobSearchData(job).scores,
    key = (t.exact ? "\"" : "") + t.raw;
  if (cache.has(key)) return cache.get(key);
  let score = scoreRole(job, t);
  cache.set(key, score);
  return score;
}
function scoreRole(job, t) {
  let companyScore = companyRelevance(job, t);
  if (companyScore) return companyScore;
  let d = jobSearchData(job),
    q = coreTokens(t.tokens);
  if (!q.length) return 0;
  if (t.exact) return containsSequence(d.titleWords, t.words || searchClean(t.raw).split(" ")) ? 100 : 0;
  if (containsSequence(d.title, q)) return 100;
  let hits = q.map((w) => tokenIn(w, d.title));
  if (hits.every(Boolean)) return hits.includes("fuzzy") ? 88 : 92;
  let key = q.join(" "),
    family = ROLE_FAMILIES[key] || ROLE_FAMILIES[key.replace(/ (developer|engineer)$/, " engineer")];
  if (family && family.some((phrase) => containsSequence(d.title, searchTokens(phrase)))) return 74;
  let domain = q.filter((w) => !SEARCH_HEADS.has(w)),
    heads = q.filter((w) => SEARCH_HEADS.has(w)),
    domainHits = domain.filter((w) => tokenIn(w, d.title)).length,
    headHit = heads.some((w) => tokenIn(w, d.title));
  let strongHits = domain.filter((w) => !SEARCH_WEAK.has(w) && tokenIn(w, d.title)).length;
  if (strongHits)
    return Math.min(72, 54 + Math.round((14 * domainHits) / domain.length) + (headHit ? 4 : 0));
  if (domainHits && headHit) return 60;
  if (q.length === 1 || containsSequence(d.body, q)) return d.bodySet.has(q[0]) || containsSequence(d.body, q) ? 45 : 0;
  if (domain.length && headHit && domain.every((w) => d.bodySet.has(w))) return 40;
  return 0;
}
// Quick whole-word check used by the "filter results" box: every word must
// appear (allowing typos) in the job title or company name.
function quickJobMatch(job, text) {
  let q = searchTokens(text);
  if (!q.length) return true;
  let d = jobSearchData(job),
    pool = [...d.title, ...d.company, ...companyTokens(job.company)];
  return q.every((w) => tokenIn(w, pool) || pool.some((p) => p.startsWith(w) && w.length >= 2));
}
window.parseJobSearch = parseJobSearch;
window.quickJobMatch = quickJobMatch;
