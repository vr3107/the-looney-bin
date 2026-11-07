// ATS match score: how well a resume's text covers a job's requirements.
// Weighted like common ATS checks: hard skills 40, job keywords 20, job title 15,
// years of experience 10, education 5, resume format 10. Used everywhere a
// match % is shown, and before/after tailoring.
const ATS_WEIGHTS = { skills: 40, keywords: 20, title: 15, experience: 10, education: 5, format: 10 };
const ATS_SKILLS = (
  "python|sql|r|java|javascript|typescript|go|golang|scala|rust|c++|c#|.net|kotlin|swift|php|ruby|bash|shell scripting|" +
  "pandas|numpy|scikit-learn|pytorch|tensorflow|keras|xgboost|lightgbm|hugging face|transformers|langchain|llamaindex|langgraph|openai|llm|rag|vector databases|pinecone|faiss|chroma|weaviate|embeddings|prompt engineering|fine-tuning|nlp|computer vision|deep learning|machine learning|statistics|statistical modeling|a/b testing|experimentation|forecasting|time series|recommendation systems|reinforcement learning|generative ai|mlops|feature engineering|model deployment|model monitoring|data science|data analysis|predictive modeling|" +
  "spark|pyspark|hadoop|kafka|airflow|dbt|databricks|snowflake|bigquery|redshift|synapse|etl|elt|data pipelines|data modeling|data warehousing|data governance|data quality|postgresql|mysql|sql server|oracle|mongodb|cassandra|dynamodb|redis|elasticsearch|neo4j|" +
  "tableau|power bi|looker|excel|qlik|superset|data visualization|dashboards|" +
  "aws|azure|gcp|google cloud|sagemaker|lambda|ec2|s3|ecs|eks|vertex ai|azure ml|bedrock|cloudformation|terraform|docker|kubernetes|helm|jenkins|github actions|gitlab ci|ci/cd|git|linux|microservices|rest apis|graphql|grpc|fastapi|flask|django|spring boot|node.js|react|angular|vue|next.js|" +
  "oauth|oidc|openid connect|saml|okta|auth0|azure ad|entra id|scim|sso|single sign-on|iam|mfa|zero trust|ping identity|sailpoint|cyberark|" +
  "agile|scrum|jira|confluence|stakeholder management|product management|project management|" +
  "cybersecurity|soc 2|hipaa|gdpr|pci|siem|splunk|penetration testing|tcp/ip|" +
  "salesforce|sap|servicenow|hubspot|figma|ux research|seo|google analytics"
).split("|");
const ATS_STOP = new Set(
  "about above across after again also among and any are around based been before being both but can could daily day does doing each either etc every few from further have having help here highly ideal into its join just like make more most must need needs new not now our out over own per plus preferred qualifications related required requirements responsibilities role roles same should some strong such team teams than that their them then there these they this those through using very well what when where which while who will with within without work working would year years you your able ability across all including include includes experience experienced knowledge skills skill understanding familiarity proficiency proficient candidate company position opportunity apply applicants benefits salary equal employer status disability veteran gender race religion national origin".split(" "),
);
const atsJobCache = new WeakMap();
// Verb/noun forms count as the same keyword: built/build, deployed/deploying/deploy.
const ATS_IRREGULAR = { built: "build", led: "lead", wrote: "write", ran: "run", made: "make", grew: "grow", drove: "drive", taught: "teach", won: "win", began: "begin", brought: "bring", designed: "design" };
function atsStem(w) {
  if (ATS_IRREGULAR[w]) return ATS_IRREGULAR[w];
  if (w.length > 5) return w.replace(/(ing|ed|es|e|s)$/, "");
  return w;
}
function atsTokens(text) {
  return searchTokens(text).map(atsStem);
}
const atsTextCache = new Map();
function atsTokStr(text) {
  let hit = atsTextCache.get(text);
  if (hit) return hit;
  let s = ` ${atsTokens(text).join(" ")} `;
  if (atsTextCache.size > 200) atsTextCache.clear();
  atsTextCache.set(text, s);
  return s;
}
const atsTermCache = new Map();
function atsTermKey(term) {
  let k = atsTermCache.get(term);
  if (k === undefined) atsTermCache.set(term, (k = atsTokens(term).join(" ")));
  return k;
}
const atsFirstCache = new Map();
const atsSetCache = new Map();
// Word set for a token string, so most terms are rejected with one lookup.
function atsWordSet(tokStr) {
  let s = atsSetCache.get(tokStr);
  if (!s) {
    if (atsSetCache.size > 300) atsSetCache.clear();
    atsSetCache.set(tokStr, (s = new Set(tokStr.split(" "))));
  }
  return s;
}
function atsHas(tokStr, term) {
  let t = atsTermKey(term);
  if (!t) return false;
  let first = atsFirstCache.get(t);
  if (first === undefined) atsFirstCache.set(t, (first = t.split(" ")[0]));
  if (!atsWordSet(tokStr).has(first)) return false;
  return t === first || tokStr.includes(` ${t} `);
}
function atsDegreeLevel(text) {
  let t = String(text || "");
  if (/\b(ph\.?d|doctorate|doctoral)\b/i.test(t)) return 3;
  if (/\b(master'?s?|m\.?s\.?c?\b|m\.?tech|mba|m\.?eng|ms in|ms,)/i.test(t)) return 2;
  if (/\b(bachelor'?s?|b\.?s\.?c?\b|b\.?tech|b\.?e\.?\b|b\.?a\.?\b|undergraduate degree|bs in|ba in)/i.test(t)) return 1;
  return 0;
}
// What the job asks for: skills (weighted), keywords, title, years, degree.
function atsJobProfile(job) {
  let cached = atsJobCache.get(job);
  if (cached) return cached;
  let desc = (typeof plainText === "function" ? plainText(job.description || "") : String(job.description || "")).slice(0, 9000),
    sentences = desc.split(/\n|(?<=[.;!?])\s+/),
    // Tokenize each sentence once; the whole description is their concatenation.
    sentTokens = sentences.map((s) => atsTokens(s)),
    descTokens = sentTokens.flat(),
    tok = ` ${[...atsTokens(job.title || ""), ...descTokens, ...atsTokens((job.tags || []).join(", "))].join(" ")} `,
    req = sentTokens.filter((t, i) => /requir|must|qualif|experience (with|in)|proficien|expert|strong|hands-on|you have|you bring|minimum/i.test(sentences[i])).map((t) => ` ${t.join(" ")} `).join(" | "),
    pref = sentTokens.filter((t, i) => /prefer|nice to have|bonus|a plus|desired/i.test(sentences[i])).map((t) => ` ${t.join(" ")} `).join(" | "),
    skills = [];
  let weightFor = (term) => {
    let inReq = atsHas(req, term),
      inPref = atsHas(pref, term),
      count = 0,
      needle = ` ${atsTermKey(term)} `;
    for (let at = tok.indexOf(needle); at >= 0 && count < 2; at = tok.indexOf(needle, at + 1)) count++;
    return inReq || count >= 2 ? 2 : inPref ? 0.7 : 1;
  };
  for (let term of ATS_SKILLS) {
    if (!atsHas(tok, term)) continue;
    let key = atsTermKey(term);
    if (skills.some((s) => s.key === key)) continue;
    skills.push({ term, key, weight: weightFor(term) });
  }
  // Named tools the dictionary doesn't know, from requirement lines (e.g. "Snowflake", "dbt Cloud").
  for (let s of sentences.filter((l) => /requir|qualif|experience with|proficien|knowledge of|familiar|skills|prefer|must/i.test(l)))
    for (let m of s.matchAll(/\b([A-Z][a-zA-Z0-9+#.]*[A-Z0-9+#][a-zA-Z0-9+#.]*|[A-Z][a-z]+[A-Z][A-Za-z]+)\b/g)) {
      let t = m[1].replace(/\.$/, ""),
        key = atsTermKey(t);
      if (t.length > 1 && t.length < 30 && key && !/^(US|USA|EEO|PTO|LLC|INC|OR|AND|THE|IT|HR|OK|EST|PST|CST)$/i.test(t) && !skills.some((x) => x.key === key))
        skills.push({ term: t, key, weight: /prefer|nice to have|bonus|plus/i.test(s) ? 0.7 : 1.5 });
    }
  skills = skills.slice(0, 32);
  let skillTokens = new Set(skills.flatMap((s) => s.key.split(" "))),
    counts = new Map();
  for (let w of descTokens) {
    if (w.length < 4 || ATS_STOP.has(w) || ATS_STOP.has(w + "s") || SEARCH_MODIFIERS.has(w) || skillTokens.has(w) || /^\d/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  let titleCore = coreTokens(searchTokens(String(job.title || "").replace(/\([^)]*\)/g, " "))).filter((w) => !SEARCH_MODIFIERS.has(w)).map(atsStem);
  for (let w of titleCore) if (!skillTokens.has(w)) counts.set(w, (counts.get(w) || 0) + 3);
  let keywords = [...counts]
    .filter(([w, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w);
  let years = typeof jobYears === "function" ? jobYears(job) : null,
    degree = /\b(degree|bachelor|master|ph\.?d|b\.?s\.|m\.?s\.)\b/i.test(desc) ? Math.max(1, atsDegreeLevel(desc.match(/[^.]*\b(degree|bachelor|master|ph\.?d)[^.]*/i)?.[0] || "")) : 0;
  let profile = { skills, keywords, titleCore, title: job.title || "", years, degree };
  atsJobCache.set(job, profile);
  return profile;
}
// Total years from date ranges like "2019 – 2024" or "Jan 2021 - Present", merged so overlaps count once.
function atsResumeYears(text) {
  let now = new Date().getFullYear() + new Date().getMonth() / 12,
    spans = [];
  for (let m of String(text).matchAll(/\b((?:19|20)\d{2})\s*(?:[-–—]|to)\s*((?:19|20)\d{2}|present|current|now|today)\b/gi)) {
    let a = Number(m[1]),
      b = /\d/.test(m[2]) ? Number(m[2]) + 0.5 : now;
    if (b >= a && b - a < 45) spans.push([a, b]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0,
    cur = null;
  for (let s of spans) {
    if (!cur || s[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [...s];
    } else cur[1] = Math.max(cur[1], s[1]);
  }
  if (cur) total += cur[1] - cur[0];
  let stated = [...String(text).matchAll(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 45);
  return Math.max(Math.round(total * 10) / 10, stated.length ? Math.max(...stated) : 0);
}
function atsFormat(text) {
  let t = String(text || ""),
    lines = t.split("\n"),
    has = (key) => typeof jobloomSectionKey === "function" && lines.some((l) => jobloomSectionKey(l) === key),
    words = t.split(/\s+/).filter(Boolean).length,
    checks = [
      ["contact email", /[\w.+-]+@[\w-]+\.[\w.]+/.test(t)],
      ["Experience section", has("experience")],
      ["Skills section", has("skills")],
      ["Education section", has("education")],
      ["bullet points", lines.filter((l) => /^\s*(?:[•●▪*-]|\d+[.)])\s+/.test(l)).length >= 3 || lines.filter((l) => l.trim().length > 60).length >= 4],
      ["length (300–1,200 words)", words >= 250 && words <= 1300],
    ];
  return { pct: checks.filter((c) => c[1]).length / checks.length, missing: checks.filter((c) => !c[1]).map((c) => c[0]) };
}
function atsBreakdown(job, resumeText) {
  let text = String(resumeText || "");
  if (!text.trim() || !job) return null;
  let p = atsJobProfile(job),
    tok = atsTokStr(text),
    skillTotal = p.skills.reduce((a, s) => a + s.weight, 0),
    skillHit = p.skills.filter((s) => atsHas(tok, s.term)),
    skillPct = skillTotal ? skillHit.reduce((a, s) => a + s.weight, 0) / skillTotal : null,
    kwHit = p.keywords.filter((w) => tok.includes(` ${w} `)),
    kwPct = p.keywords.length ? kwHit.length / p.keywords.length : null,
    titlePct = 1;
  if (p.titleCore.length) {
    let present = p.titleCore.filter((w) => tok.includes(` ${w} `)).length;
    titlePct = tok.includes(` ${p.titleCore.join(" ")} `) ? 1 : present === p.titleCore.length ? 0.8 : (present / p.titleCore.length) * 0.6;
  }
  let have = atsResumeYears(text),
    expPct = p.years ? Math.min(1, have / p.years) : 1,
    eduHave = atsDegreeLevel(text),
    eduPct = !p.degree ? 1 : eduHave >= p.degree ? 1 : eduHave ? 0.6 : 0,
    fmt = atsFormat(text),
    parts = {
      skills: { pct: skillPct, matched: skillHit.map((s) => s.term), missing: p.skills.filter((s) => !skillHit.includes(s)).sort((a, b) => b.weight - a.weight).map((s) => s.term) },
      keywords: { pct: kwPct, matched: kwHit, missing: p.keywords.filter((w) => !kwHit.includes(w)) },
      title: { pct: titlePct, title: p.title, core: p.titleCore },
      experience: { pct: expPct, need: p.years, have },
      education: { pct: eduPct, need: p.degree, have: eduHave },
      format: fmt,
    },
    weights = { ...ATS_WEIGHTS };
  // Spread the weight of components the job doesn't express.
  if (skillPct === null) (weights.keywords += weights.skills), (weights.skills = 0);
  if (kwPct === null) (weights.skills += weights.keywords), (weights.keywords = 0);
  let total = 0;
  for (let k of Object.keys(weights)) total += weights[k] * (parts[k].pct ?? 0);
  let score = Math.max(1, Math.min(99, Math.round(total)));
  return { score, parts, weights };
}
// Keep existing callers working: same shape as the old breakdown.
window.jobScoreBreakdown = function (job, resumeText) {
  let b = atsBreakdown(job, resumeText);
  if (!b) return { score: null, coverage: 0, prominence: 0, seniority: null, role: null, terms: [], matched: [] };
  let pct = (x) => (x === null || x === undefined ? null : Math.round(100 * x));
  return {
    score: b.score,
    coverage: pct(b.parts.skills.pct ?? b.parts.keywords.pct),
    prominence: pct(b.parts.keywords.pct ?? b.parts.skills.pct),
    role: pct(b.parts.title.pct),
    seniority: pct(b.parts.experience.pct),
    terms: [...b.parts.skills.matched, ...b.parts.skills.missing],
    matched: b.parts.skills.matched,
    ats: b,
  };
};
window.atsBreakdown = atsBreakdown;
window.atsJobProfile = atsJobProfile;
