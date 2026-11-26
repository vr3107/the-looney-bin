// AI resume tailoring engine: runs the AI rewrite (/api/tailor), checks every
// edit against the resume, and adds deterministic ATS fixes (target title,
// confirmed skills). The tailoring page UI lives in tailor-studio.js.
const tailorSectionLabels = {
  summary: "Professional summary",
  skills: "Skills",
  experience: "Work experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  additional: "Other resume sections",
};

// Display names for skill terms ("power bi" → "Power BI").
const ACR = new Set("sql r aws gcp etl elt rag llm nlp mfa iam sso oidc saml scim ci/cd rest ec2 s3 ecs eks sap seo ux ui bi ml ai api apis soc pci siem hipaa gdpr tcp/ip a/b c++ c# .net mlops".split(" "));
function skillLabel(t) {
  return (
    /[A-Z]/.test(t)
      ? t
      : t
          .split(" ")
          .map((w) => (ACR.has(w) ? w.toUpperCase().replace("MLOPS", "MLOps") : /^(and|of|to|for)$/.test(w) ? w : w.replace(/^./, (c) => c.toUpperCase())))
          .join(" ")
          .replace(/^Pyspark$/, "PySpark").replace(/^Pytorch$/, "PyTorch").replace(/^Tensorflow$/, "TensorFlow").replace(/^Postgresql$/, "PostgreSQL").replace(/^Mongodb$/, "MongoDB").replace(/^Fastapi$/, "FastAPI").replace(/^Langchain$/, "LangChain").replace(/^Llamaindex$/, "LlamaIndex").replace(/^Langgraph$/, "LangGraph").replace(/^Github Actions$/, "GitHub Actions").replace(/^Gitlab CI$/, "GitLab CI").replace(/^Bigquery$/, "BigQuery").replace(/^Openai$/, "OpenAI").replace(/^Dbt$/, "dbt").replace(/^Numpy$/, "NumPy").replace(/^Xgboost$/, "XGBoost").replace(/^Lightgbm$/, "LightGBM").replace(/^Graphql$/, "GraphQL").replace(/^Javascript$/, "JavaScript").replace(/^Typescript$/, "TypeScript").replace(/^Node.js$/, "Node.js").replace(/^Next.js$/, "Next.js").replace(/^Oauth/, "OAuth").replace(/^Dynamodb$/, "DynamoDB").replace(/^Servicenow$/, "ServiceNow").replace(/^Hubspot$/, "HubSpot").replace(/^Sailpoint$/, "SailPoint").replace(/^Cyberark$/, "CyberArk"));
}
window.skillLabel = skillLabel;

// Apply suggestions to a copy of the lines (bottom-up so indexes stay valid).
function applySuggestionsToLines(lines, suggestions) {
  let out = lines.slice();
  [...suggestions].sort((a, b) => b.start - a.start).forEach((s) => out.splice(s.start, s.beforeLines.length, ...s.afterLines));
  return out;
}
window.applySuggestionsToLines = applySuggestionsToLines;
// The job title without seniority or extras: "Senior Machine Learning Engineer (LLM) - Remote" → "Machine Learning Engineer".
function coreJobTitle(title) {
  let t = (typeof atsCleanTitle === "function" ? atsCleanTitle(title) : String(title || ""))
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/\s*[-–—|/]\s+|\s+[-–—|/]\s*|,/)[0]
    .replace(/\b(senior|sr\.?|junior|jr\.?|lead|staff|principal|head of|associate|entry[- ]level|mid[- ]level|intern|remote|hybrid|contract|i{1,3}|iv|level \d)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
window.coreJobTitle = coreJobTitle;
// A line is a section heading only if it has no inline content ("SKILLS", not "Languages: Python").
function isPureHeading(line) {
  let t = String(line || "").trim();
  return !!t && typeof jobloomSectionKey === "function" && !!jobloomSectionKey(t) && !/[:\-–—]\s*\S/.test(t);
}
function firstContentLine(lines, key) {
  let h = lines.findIndex((l) => isPureHeading(l) && jobloomSectionKey(String(l).trim()) === key);
  if (h < 0) return -1;
  for (let i = h + 1; i < lines.length && !isPureHeading(lines[i]); i++) if (String(lines[i] || "").trim()) return i;
  return -1;
}
const SKILL_CATEGORIES = {
  lang: "python sql r java javascript typescript go golang scala rust c++ c# .net kotlin swift php ruby bash",
  ml: "pandas numpy scikit-learn pytorch tensorflow keras xgboost lightgbm hugging face transformers langchain llamaindex langgraph openai llm rag nlp computer vision deep learning machine learning mlflow mlops embeddings vector databases pinecone faiss chroma weaviate prompt engineering fine-tuning generative ai statistics forecasting time series a/b testing feature engineering model deployment model monitoring data science",
  data: "spark pyspark hadoop kafka airflow dbt databricks snowflake bigquery redshift synapse etl elt data pipelines data modeling data warehousing postgresql mysql sql server oracle mongodb cassandra dynamodb redis elasticsearch neo4j tableau power bi looker excel qlik superset",
  cloud: "aws azure gcp google cloud sagemaker lambda ec2 s3 ecs eks vertex ai bedrock terraform docker kubernetes helm jenkins github actions gitlab ci ci/cd git linux microservices rest apis graphql grpc fastapi flask django spring boot node.js react",
};
const SKILL_LINE_LABELS = {
  lang: /language|programming/,
  ml: /\b(ml|ai|machine|learning|data science|frameworks?|librar|analytics|modeling)/,
  data: /\b(data(?! cent)|database|warehous|analytics|bi\b|visuali|big data)/,
  cloud: /\b(cloud|devops|tools?|platforms?|infrastructure|engineering|deployment|mlops)/,
};
function skillCategory(skill) {
  let s = String(skill).toLowerCase();
  for (let [cat, list] of Object.entries(SKILL_CATEGORIES)) if (list.split(" ").includes(s) || (s.includes(" ") && list.includes(s))) return cat;
  return /flow|ops|\bml\b|\bai\b/.test(s) ? "ml" : "other";
}
// Label for a new skills line when no existing line fits a skill's category.
function skillLineLabel(cat, job) {
  return { lang: "Programming", ml: "AI & Machine Learning", data: "Data Engineering & Analytics", cloud: "Cloud & DevOps" }[cat] || `${coreJobTitle(job.title) || "Role"} Skills`;
}
// Deterministic ATS fixes layered on top of the AI edits: headline with the
// job's title, and confirmed skills added to the Skills line.
function atsBoostSuggestions(job, lines, suggestions, confirmed, format) {
  let byStart = new Map(suggestions.map((s) => [s.start, s])),
    // Judge the draft by the changes that will actually be applied (flagged ones may not be).
    draft = appliedDraftLines(lines, suggestions).join("\n"),
    b = atsBreakdown(job, draft),
    added = [];
  if (!b) return suggestions;
  let upsert = (idx, transform, reason, section) => {
    let s = byStart.get(idx);
    if (s) {
      let next = transform(s.afterLines.slice());
      if (!next) return;
      s.afterLines = next;
      s.after = next.join("\n");
      s.reason += " · " + reason;
    } else {
      let next = transform([lines[idx]]);
      if (!next) return;
      s = { section: tailorSectionLabels[section], category: section, start: idx, end: idx + 1, beforeLines: [lines[idx]], afterLines: next, before: lines[idx], after: next.join("\n"), reason, evidence: lines[idx], evidenceSource: "resume", accepted: false, skipped: false, source: "ATS" };
      byStart.set(idx, s);
      added.push(s);
    }
    if (format === "pdf" && s.afterLines.some((l) => l.trim().length > Math.max(String(s.before).trim().length * 1.2, String(s.before).trim().length + 12))) {
      s.needsReview = true;
      if (!/Longer than the original PDF line/.test(s.reason)) s.reason = "⚠ Longer than the original PDF line — shorten it in the editor so it fits at the same size. " + s.reason;
    }
  };
  // 1. Job title: ATS systems weight an exact title match heavily.
  let title = coreJobTitle(job.title);
  if (title && b.parts.title.pct < 1) {
    let idx = firstContentLine(lines, "summary");
    // If the AI's summary rewrite needs review, add the headline under the contact line instead,
    // so the title match doesn't depend on that flagged change.
    if (idx >= 0 && byStart.get(idx)?.needsReview && format !== "pdf") {
      let h = lines.findIndex((l) => isPureHeading(l) && jobloomSectionKey(String(l).trim()) === "summary") - 1;
      while (h >= 0 && !String(lines[h]).trim()) h--;
      if (h >= 0 && !byStart.has(h))
        upsert(h, (after) => [...after, title], `Adds “${title}” as your headline — ATS systems weight an exact job-title match heavily. Keep it if it reflects roles you’re qualified for.`, "summary");
      idx = -1;
    }
    if (idx >= 0)
      upsert(
        idx,
        (after) => {
          if (format === "pdf") {
            let first = after[0];
            if (new RegExp("^\\s*" + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(first)) return null;
            let indent = (first.match(/^\s*/) || [""])[0];
            return [indent + title + " | " + first.trim(), ...after.slice(1)];
          }
          if (after.some((l) => l.trim().toLowerCase() === title.toLowerCase())) return null;
          let indent = (after[0].match(/^\s*/) || [""])[0];
          return [indent + title, ...after];
        },
        `Adds “${title}” as your headline — ATS systems weight an exact job-title match heavily. Keep it if it reflects roles you’re qualified for.`,
        "summary",
      );
    // Changing fields: the job's title isn't one the candidate has held, so the user decides.
    if (isRoleChange(job, lines.join("\n"))) {
      for (let s of byStart.values())
        if (s.source === "ATS" && s.after.includes(title) && !s.before.includes(title)) {
          s.needsReview = true;
          if (!/isn’t a title you’ve held/.test(s.reason)) s.reason = `⚠ “${title}” isn’t a title you’ve held — keep it only as your target role. ` + s.reason;
        }
    }
  }
  // 2. Skills you confirmed you have, written the way the job writes them.
  // Confirmed skills belong in the Skills section itself (not only in the summary or a bullet).
  let draftLines = appliedDraftLines(lines, [...byStart.values()]),
    skillsStart = firstContentLine(draftLines, "skills"),
    skillsText = [];
  for (let i = skillsStart; i >= 0 && i < draftLines.length && !isPureHeading(draftLines[i]); i++) skillsText.push(draftLines[i]);
  let draftTok = atsTokStr((skillsStart >= 0 ? skillsText : draftLines).join("\n")),
    missing = (confirmed || []).filter((t) => !atsHas(draftTok, t)).map((t) => skillLabel(t));
  if (missing.length) {
    let first = firstContentLine(lines, "skills"),
      skillLines = [];
    for (let i = first; i >= 0 && i < lines.length && !isPureHeading(lines[i]); i++) if (String(lines[i]).trim()) skillLines.push(i);
    // Put each skill on the Skills line whose label fits it (e.g. "Cloud & tools:"). If no line fits
    // (e.g. Spark on a data center resume), add a new line with a fitting label instead of stuffing
    // it under an unrelated one such as "Cabling & Networking:".
    let current = (i) => {
      let s = byStart.get(i);
      return s ? s.afterLines.join(" ") : String(lines[i]);
    };
    let groups = new Map(),
      newLines = new Map();
    for (let skill of missing) {
      let cat = skillCategory(skill),
        target = skillLines.find((i) => SKILL_LINE_LABELS[cat]?.test((current(i).split(":")[0] || "").toLowerCase()) && /:/.test(current(i)));
      if (target === undefined && format === "pdf") target = first;
      if (target === undefined || target < 0) {
        let label = skillLineLabel(cat, job);
        if (!newLines.has(label)) newLines.set(label, []);
        newLines.get(label).push(skill);
        continue;
      }
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push(skill);
    }
    for (let [idx, list] of groups)
      upsert(
        idx,
        (after) => {
          let i = after.length - 1;
          after[i] = after[i].replace(/[\s.,;]+$/, "") + (/[:]\s*$/.test(after[i]) ? " " : ", ") + list.join(", ");
          return after;
        },
        `Adds skills you confirmed: ${list.join(", ")}.`,
        "skills",
      );
    // New skill categories go first in the Skills section: the job's skills lead.
    if (newLines.size && skillLines.length)
      upsert(
        skillLines[0],
        (after) => [...[...newLines].map(([label, list]) => `${label}: ${list.join(", ")}`), ...after],
        `Adds skills you confirmed under ${[...newLines.keys()].map((l) => `“${l}”`).join(", ")}.`,
        "skills",
      );
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}
window.atsBoostSuggestions = atsBoostSuggestions;

// The job is in a different field from the resume (e.g. a data center resume for a
// data engineering job): the job's title isn't in the resume and few of its skills are.
function isRoleChange(job, resumeText, b) {
  b = b || atsBreakdown(job, resumeText);
  if (!b) return false;
  let titleWords = coreJobTitle(job.title).toLowerCase().split(/\s+/).filter((w) => w.length > 2),
    tok = atsTokStr(resumeText),
    titleHit = titleWords.length ? titleWords.filter((w) => atsHas(tok, w)).length / titleWords.length : 1;
  return (b.parts.skills.pct ?? 1) < 0.5 || (titleHit < 0.5 && (b.parts.skills.pct ?? 1) < 0.75);
}
window.isRoleChange = isRoleChange;
// Line ranges for tailoring a long resume in parts: split near the middle at a role
// heading (a dated, non-bullet line) so each role's bullets stay in one request.
function tailorRanges(lines) {
  let filled = lines.filter((l) => String(l).trim()).length;
  if (filled < 45) return [];
  let mid = Math.floor(lines.length / 2),
    isRole = (i) => !bulletPrefix(String(lines[i]).trim()) && /\b(19|20)\d{2}\b|\bpresent\b/i.test(lines[i]) && String(lines[i]).trim().length < 140,
    split = -1;
  for (let d = 0; d < lines.length / 4 && split < 0; d++) {
    if (mid - d > 5 && isRole(mid - d)) split = mid - d;
    else if (mid + d < lines.length - 5 && isRole(mid + d)) split = mid + d;
  }
  if (split < 0) split = mid;
  return [
    { from: 1, to: split },
    { from: split + 1, to: lines.length },
  ];
}
window.tailorRanges = tailorRanges;
// Run the AI rewrite and return checked suggestions (no DOM work).
window.aiTailorRun = async function (job, original, opts) {
  let lines = original.split("\n"),
    { format = "docx", notes = "", direction = "", confirmed = [], intensity = "balanced", sections = null } = opts || {},
    b = atsBreakdown(job, original),
    description = typeof plainText === "function" ? plainText(job.description || "") : String(job.description || ""),
    targetRole = String(job.targetRoles || window.tailorRoleForJob || "").slice(0, 200),
    riskySkills = (b?.parts.skills.missing || []).filter((t) => !confirmed.includes(t)),
    roleChange = isRoleChange(job, original, b);
  const payload = {
      mode: "tailor",
      consent: true,
      lines,
      job: { title: job.title || "", company: job.company || "", location: job.location || "", description: description.slice(0, 20000), targetRole },
      skillsNotInResume: riskySkills.slice(0, 30),
      sections: sections ? [...sections] : undefined,
      confirmedKeywords: confirmed,
      ats: {
        targetScore: opts?.target || 90,
        jobCoreTitle: coreJobTitle(job.title),
        skillsAlreadyInResume: b?.parts.skills.matched || [],
        keywordsMissingFromResume: [...(b?.parts.keywords.missing || []), ...(b?.parts.skills.missing || []).filter((t) => confirmed.includes(t))],
      },
      notes,
      direction,
      intensity,
      format,
      roleChange,
    };
  const call = async (editRange) => {
    const response = await fetch("/api/tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editRange ? { ...payload, editRange } : payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      let err = new Error(
        {
          ai_not_configured: "AI isn’t connected yet (add a Workers AI binding named AI to the Cloudflare Pages project).",
          rate_limited: "Too many AI requests in the last minute. Wait a moment and try again.",
          ai_quota_exceeded: "Today’s AI allowance is used up on every connected provider. Try again later (Cloudflare resets at 00:00 UTC).",
          ai_busy: "The AI providers are busy (per-minute limit). Wait a minute and press Tailor again.",
          input_too_long: "This resume or job description is too long for one request.",
          request_too_large: "This request is too large. Shorten the extra facts and try again.",
        }[result.error] || "AI tailoring couldn’t run right now.",
      );
      err.code = result.error || "failed";
      throw err;
    }
    return result;
  };
  // A long resume is tailored in two halves at once, so every bullet gets attention
  // (one response can only hold so many edits). If one half fails, the other still counts.
  let ranges = tailorRanges(lines),
    result;
  if (ranges.length < 2) result = await call(null);
  else {
    let parts = await Promise.allSettled(ranges.map((r) => call(r)));
    let ok = parts.filter((p) => p.status === "fulfilled").map((p) => p.value);
    if (!ok.length) throw parts[0].reason;
    result = { overview: ok[0].overview, edits: ok.flatMap((r) => r.edits || []), partial: ok.length < parts.length };
  }
  let { suggestions, rejected } = validateAiEdits(result.edits, lines, { notes, confirmed, format, sections, jobTitle: job.title || "", jobText: `${job.title || ""}\n${description}`, targetRole, riskySkills, roleChange });
  window.tailorRoleChange = roleChange;
  return { suggestions, rejected, overview: String(result.overview || "").slice(0, 1200) };
};

// Lines of the draft that the verified (auto-applied) suggestions produce.
function appliedDraftLines(lines, suggestions) {
  return applySuggestionsToLines(lines, suggestions.filter((s) => !s.needsReview && !s.lowersScore));
}
window.appliedDraftLines = appliedDraftLines;
// Fold a later tailoring round (edits made against the draft) back into the
// suggestions on the original lines, so every change still has one undo.
function mergeRoundSuggestions(lines, base, extra) {
  let applied = base.filter((s) => !s.needsReview && !s.lowersScore).sort((a, b) => a.start - b.start),
    held = new Set(base.filter((s) => s.needsReview || s.lowersScore).map((s) => s.start)),
    map = [],
    next = 0;
  for (let i = 0; i < lines.length; i++) {
    let s = applied[next];
    if (s && s.start === i) {
      s.afterLines.forEach((_, k) => map.push({ s, k }));
      i += s.beforeLines.length - 1;
      next++;
    } else map.push({ orig: i });
  }
  let out = base.slice();
  for (let e of [...extra].sort((a, b) => b.start - a.start)) {
    let at = map[e.start];
    if (!at) continue;
    if (at.s) {
      // Only verified rewrites are folded into an already-applied change.
      if (e.needsReview) continue;
      at.s.afterLines.splice(at.k, 1, ...e.afterLines);
      at.s.after = at.s.afterLines.join("\n");
      if (!at.s.reason.includes(e.reason)) at.s.reason += " · " + e.reason;
    } else {
      if (held.has(at.orig)) continue;
      let orig = lines[at.orig];
      out.push({ ...e, start: at.orig, end: at.orig + 1, beforeLines: [orig], before: orig, evidence: orig });
    }
  }
  return out.filter((s) => s.after !== s.before).sort((a, b) => a.start - b.start);
}
window.mergeRoundSuggestions = mergeRoundSuggestions;
// Keep the ATS score from going down: leave out any change that lowers it, and
// never end below the original resume's score.
function protectAtsScore(job, lines, suggestions) {
  let scoreOf = (list) => atsBreakdown(job, applySuggestionsToLines(lines, list).join("\n"))?.score ?? 0,
    original = atsBreakdown(job, lines.join("\n"))?.score ?? 0,
    active = () => suggestions.filter((s) => !s.needsReview && !s.lowersScore);
  suggestions.forEach((s) => (s.lowersScore = false));
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let s of active()) {
      let withIt = scoreOf(active()),
        without = scoreOf(active().filter((x) => x !== s));
      if (without > withIt) {
        s.lowersScore = true;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Changes can lower the score only together (e.g. each removes one of three mentions of a skill):
  // leave out whichever change costs the most until the score is back to at least the original.
  while (active().length && scoreOf(active()) < original) {
    let list = active(),
      best = list[0],
      bestScore = -1;
    for (let s of list) {
      let sc = scoreOf(list.filter((x) => x !== s));
      if (sc > bestScore) (best = s), (bestScore = sc);
    }
    best.lowersScore = true;
  }
  suggestions.forEach((s) => {
    s.reason = s.reason.replace(/^⚠ Not applied — it lowers the ATS score\. /, "");
    if (s.lowersScore) s.reason = "⚠ Not applied — it lowers the ATS score. " + s.reason;
  });
  return suggestions;
}
window.protectAtsScore = protectAtsScore;
// What still holds the draft below the target, as short instructions for the next AI round.
function atsGapDirection(job, draft, confirmed) {
  let b = atsBreakdown(job, draft);
  if (!b) return "";
  let p = b.parts,
    out = [`The ATS score is ${b.score}%; raise it.`],
    title = coreJobTitle(job.title);
  if (p.title.pct < 1 && title) out.push(`Use the exact title "${title}" in the first summary sentence.`);
  if (p.keywords.missing.length) out.push(`Work in these job keywords wherever the existing experience genuinely matches: ${p.keywords.missing.slice(0, 12).join(", ")}.`);
  let conf = p.skills.missing.filter((t) => confirmed.includes(t));
  if (conf.length) out.push(`Make sure these confirmed skills appear in the summary or bullets: ${conf.join(", ")}.`);
  if (p.skills.matched.length) out.push(`Use the job's exact wording for skills the resume already shows: ${p.skills.matched.slice(0, 12).join(", ")}.`);
  return out.join(" ");
}
window.atsGapDirection = atsGapDirection;

// "Apply all" applies verified changes only; flagged ones stay for one-by-one review.
const aiBaseApplyAll = window.applyAllTailorSuggestions;
window.applyAllTailorSuggestions = function (silent) {
  let held = (window.tailorSuggestions || []).filter((s) => (s.needsReview || s.lowersScore) && !s.accepted && !s.skipped);
  held.forEach((s) => (s.skipped = true));
  let toastFn = window.toast;
  if (silent === true) window.toast = () => {};
  try {
    aiBaseApplyAll();
  } finally {
    window.toast = toastFn;
    held.forEach((s) => (s.skipped = false));
    renderTailoringSuggestions();
  }
};

const NUM_RE = /\d[\d,.]*\s?(?:%|\+|k|m|bn|x)?/gi;
const numbersIn = (s) => (String(s).match(NUM_RE) || []).map((x) => x.toLowerCase().replace(/[\s,]/g, "").replace(/\.$/, ""));
function sectionOfLine(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    let key = typeof jobloomSectionKey === "function" ? jobloomSectionKey(lines[i]) : "";
    // "Languages: Python, SQL" is a line inside a section, not the section heading.
    if (key && !/[:\-–—]\s*\S/.test(String(lines[i]).trim())) return key;
  }
  return "additional";
}
function isProtectedLine(line, section) {
  let t = String(line || "").trim();
  if (!t) return true;
  // Headings are protected; "Label: content" lines (e.g. "Languages: Python, SQL") are editable.
  if (typeof jobloomSectionKey === "function" && jobloomSectionKey(t) && !/[:\-–—]\s*\S/.test(t)) return true;
  if (/@|https?:|www\.|linkedin\.com|github\.com|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i.test(t)) return true;
  if (section === "education" || section === "certifications") return true;
  // Job title / company / date lines (not bullets) carry facts that must not change.
  if (!bulletPrefix(t) && /\b(19|20)\d{2}\b|\bpresent\b|\bcurrent\b/i.test(t)) return true;
  return false;
}
// Named terms (tools, products, acronyms) in new text must come from the resume, facts, or confirmed keywords.
// Ordinary capitalized words taken from the job description ("Stakeholders", "Predictive Modeling") are
// allowed — mirroring the job's wording is the point of tailoring. Tool/product-style names that only the
// job mentions (AWS, A/B, PySpark, Node.js) still need the candidate's confirmation.
function unsupportedTerms(text, allowedLower, jobLower = "") {
  let words = String(text)
      .replace(/[‐-―−]/g, "-")
      .replace(/^\s*(?:[•●▪*-]|\d+[.)])\s+/, "")
      .replace(/\//g, " / ")
      .split(/\s+/),
    bad = [];
  let isNamed = (w) => /[A-Z].*[A-Z0-9+#]|[a-z][A-Z]|^[A-Z][a-z]+$/.test(w) && !/^(I|A|An|The|And|For|With|In|On|At|To|Of)$/.test(w);
  words.forEach((w, i) => {
    let clean = w.replace(/^[("'[]+|[)"'\].,;:!?]+$/g, "");
    // Skip the first word and any word that starts a new sentence.
    if (!clean || clean === "/" || i === 0 || /[.!?;]$/.test(words[i - 1] || "")) return;
    if (/^\d[\d.,%+]*$/.test(clean)) return; // numbers are checked separately
    if (!isNamed(clean) || allowedLower.includes(clean.toLowerCase())) return;
    // Plain capitalized verbs and words ("Analyzed", "Optimizing") aren't product names.
    if (/^[A-Z][a-z]{3,}(?:ed|ing|es|s)?$/.test(clean) && /(?:ed|ing)$/.test(clean) && !/^(Spring|Ping|Sling|Swing)$/.test(clean)) return;
    let plainWord = /^[A-Z][a-z]+(?:-[A-Za-z][a-z]+)*$/.test(clean);
    if (plainWord && jobLower.includes(clean.toLowerCase())) return;
    // "S3-backed": only the named parts of a hyphenated word need support.
    if (clean.includes("-")) {
      let parts = clean.split("-").filter((p) => p && isNamed(p) && !allowedLower.includes(p.toLowerCase()) && !(/^[A-Z][a-z]+$/.test(p) && jobLower.includes(p.toLowerCase())));
      bad.push(...parts);
      return;
    }
    bad.push(clean);
  });
  return [...new Set(bad)];
}
// A rewritten bullet must still describe the same work: it keeps a share of the
// original bullet's words. A bullet replaced with different work needs review.
const SAME_WORK_STOP = new Set("with and for the from into onto that this their using used use across including include while within over under per via also".split(" "));
function rewriteKeepsWork(orig, text) {
  let words = (s) => atsTokens(String(s).replace(/^\s*(?:[•●▪*-]|\d+[.)])\s+/, "")).filter((w) => w.length > 3 && !SAME_WORK_STOP.has(w) && !/^\d/.test(w)),
    before = [...new Set(words(orig))],
    after = new Set(words(text));
  if (before.length < 4) return true;
  return before.filter((w) => after.has(w)).length / before.length >= 0.25;
}
// Words from job skills the candidate hasn't shown (e.g. "pipeline", "warehouse", "ETL"): a bullet
// that newly uses one, when it appears nowhere in the resume, is claiming that work.
const GENERIC_SKILL_WORDS = new Set("data management analysis analytics engineering engineer design development develop testing test system systems tool tools platform platforms cloud skill skills experience process processes support monitoring documentation communication team teams business solution solutions service services technical technology operation operations software application applications".split(" "));
function claimedJobWords(text, orig, riskySkills, resumeTok, allowedTok) {
  let words = new Set(riskySkills.flatMap((t) => atsTokens(t)).filter((w) => w.length > 2 && !GENERIC_SKILL_WORDS.has(w)));
  if (!words.size) return [];
  let now = new Set(atsTokens(text)),
    before = new Set(atsTokens(orig));
  let shown = (w) => (String(text).split(/\s+/).find((x) => atsTokens(x).includes(w)) || w).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#]+$/g, "");
  return [...words].filter((w) => now.has(w) && !before.has(w) && !resumeTok.has(w) && !allowedTok.has(w)).map(shown);
}
// Changing fields: an edit that brings in two or more of the job's own work words that appear
// nowhere in the resume (e.g. "SAP", "transports", "kernel", "pipelines") describes work the
// candidate hasn't shown. Common soft-skill words don't count.
const SOFT_WORDS = new Set("ability abilities across align aligned business clear collaborate collaborated collaboration communicate communicated communication complex continuous coordinate coordinated cross-functional deliver delivered delivery detail drive driving effective efficient ensure ensuring excellent experience fast first focus high improve improvement improving including issues key level maintain make meet members needs ongoing partner partnered partners people plan planning priorities proactive problem problems projects provide quality quickly related reliable requirements resolve responsible review solve stakeholders standards strong success support supported team teams timely tools understanding using work working written".split(" "));
const COMMON_WORDS = "about above after again against also among around because before being below between both during each every from have having here into itself more most onto other over same some such than that their them then there these they this those through under until upon very what when where which while with within without would your".split(" ");
let softStems = null;
function isSoftWord(w) {
  // Compare stems: the tokenizer stems words ("business" → "busi"), so stem the lists too.
  softStems = softStems || new Set([...SOFT_WORDS, ...GENERIC_SKILL_WORDS, ...COMMON_WORDS].flatMap((x) => [x, ...atsTokens(x)]));
  return softStems.has(w);
}
function jobOnlyClaims(text, orig, jobTok, resumeTok, allowedTok, titles = [], min = 2) {
  let t = String(text);
  for (let title of titles) if (title) t = t.replace(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  let origTok = new Set(atsTokens(orig)),
    words = [...new Set(atsTokens(t))].filter((w) => w.length > 2 && !isSoftWord(w) && jobTok.has(w) && !resumeTok.has(w) && !allowedTok.has(w) && !origTok.has(w));
  if (words.length < min) return [];
  let shown = (w) => (t.split(/\s+/).find((x) => atsTokens(x).includes(w)) || w).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#]+$/g, "");
  return words.map(shown);
}
// Job skills the candidate hasn't shown or confirmed: an edit that newly claims one needs review.
function claimedMissingSkills(text, orig, riskySkills, titles = []) {
  if (!riskySkills.length) return [];
  // Using the job's own title ("Data Scientist") is not a claim of a skill ("data science").
  for (let t of titles) if (t) text = text.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  let now = atsTokStr(text),
    before = atsTokStr(orig);
  return riskySkills.filter((t) => atsHas(now, t) && !atsHas(before, t)).map((t) => skillLabel(t));
}
// Deleting skill lines that don't fit the job is fine, but the Skills section keeps at least
// `min` lines (or all of them, if it has fewer).
function keepSkillLines(lines, byLine, min, jobText = "") {
  let skill = lines.map((l, i) => i).filter((i) => sectionOfLine(lines, i) === "skills" && String(lines[i]).trim() && !isPureHeading(lines[i]));
  let left = skill.filter((i) => !byLine.get(i)?.del).length + skill.reduce((n, i) => n + (byLine.get(i)?.inserts.length || 0), 0);
  // Restore the deleted lines that share the most words with the job first.
  let jobTok = new Set(atsTokens(jobText)),
    relevance = (i) => atsTokens(lines[i]).filter((w) => w.length > 3 && jobTok.has(w)).length;
  for (let i of skill.filter((i) => byLine.get(i)?.del).sort((a, b) => relevance(b) - relevance(a))) {
    if (left >= Math.min(min, skill.length)) break;
    let en = byLine.get(i);
    en.del = false;
    if (en.replace === null && !en.inserts.length) byLine.delete(i);
    left++;
  }
}
// Deleting irrelevant bullets is fine, but every role keeps at least two.
function keepTwoBulletsPerRole(lines, byLine) {
  let blocks = [],
    cur = null;
  lines.forEach((l, i) => {
    let sec = sectionOfLine(lines, i),
      t = String(l).trim();
    if (sec !== "experience" && sec !== "projects") return (cur = null);
    if (!bulletPrefix(t) && /\b(19|20)\d{2}\b|\bpresent\b|\bcurrent\b/i.test(t)) blocks.push((cur = []));
    else if (cur && t.length > 30) cur.push(i);
  });
  for (let block of blocks) {
    let deleted = block.filter((i) => byLine.get(i)?.del && !byLine.get(i).inserts.length);
    let room = block.length - deleted.length;
    for (let i of deleted.reverse()) {
      if (room >= 2) break;
      let en = byLine.get(i);
      en.del = false;
      if (en.replace === null && !en.inserts.length) byLine.delete(i);
      room++;
    }
  }
}
// Items of a list line ("Databases: PostgreSQL, DynamoDB, Hive"): the text after the label, split on , ; |.
const TOOL_LINE_LABEL = /^\s*(?:[•●▪*-]\s+)?(environment|tech(?:nologies|nology)?(?: stack)?|tools(?: (?:used|&[^:]{0,20}))?|stack|key skills|skills used)\s*:/i;
function listItems(line) {
  let t = String(line || "");
  if (!t.includes(":")) return [];
  return t
    .slice(t.indexOf(":") + 1)
    .split(/[,;|]|\s+and\s+/)
    .map((x) => x.replace(/\([^)]*\)/g, " ").replace(/[.\s]+$/, "").trim())
    .filter((x) => x && x.length <= 40);
}
// Skills a rewritten list line no longer mentions. Dropping one or two that don't fit the job is
// fine; replacing most of the line with other skills loses real experience.
function droppedListItems(orig, text) {
  let before = listItems(orig);
  if (before.length < 3) return [];
  let now = atsTokStr(text);
  return before.filter((item) => !atsHas(now, item));
}
function validateAiEdits(edits, lines, opts) {
  let { notes = "", confirmed = [], format = "docx", sections, jobTitle = "", jobText = "", targetRole = "", riskySkills = [], roleChange = false } = opts,
    jobTok = new Set(atsTokens(jobText)),
    resumeText = lines.join("\n"),
    allowed = `${resumeText}\n${notes}\n${confirmed.join("\n")}`.toLowerCase(),
    allowedSummary = `${allowed}\n${jobTitle}\n${targetRole}`.toLowerCase(),
    jobLower = String(jobText).toLowerCase(),
    resumeTok = new Set(atsTokens(resumeText)),
    allowedTok = new Set(atsTokens(`${notes}\n${confirmed.join("\n")}`)),
    byLine = new Map(),
    rejected = 0;
  // A model sometimes packs several lines into one edit (e.g. "Languages: …\nTools: …").
  // Outside a fixed PDF layout, keep them as separate lines: the first replaces, the rest follow it.
  let expanded = [];
  for (let e of Array.isArray(edits) ? edits : []) {
    let parts = String(e?.text ?? "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (format !== "pdf" && e?.op !== "delete" && parts.length > 1) {
      expanded.push({ ...e, text: parts[0] });
      parts.slice(1).forEach((t) => expanded.push({ ...e, op: "insert_after", text: t }));
    } else expanded.push(e);
  }
  for (let e of expanded) {
    let n = Number(e?.line),
      op = ["replace", "insert_after", "delete"].includes(e?.op) ? e.op : "",
      idx = n - 1;
    if (!op || !Number.isInteger(n) || idx < 0 || idx >= lines.length) {
      rejected++;
      continue;
    }
    if (format === "pdf" && op !== "replace") {
      rejected++;
      continue;
    }
    let unknown = [],
      orig = lines[idx],
      section = sectionOfLine(lines, idx),
      text = String(e.text ?? "").replace(/\s*\n\s*/g, " ").trim();
    if (sections && !sections.has(section) && section !== "additional") {
      rejected++;
      continue;
    }
    if (op !== "insert_after" && isProtectedLine(orig, section)) {
      rejected++;
      continue;
    }
    if (op !== "delete") {
      if (!text || text.length > 700) {
        rejected++;
        continue;
      }
      // Keep the original line's bullet symbol and indentation.
      let m = bulletPrefix(orig),
        indent = (orig.match(/^\s*/) || [""])[0];
      if (m && !bulletPrefix(text)) text = m[1] + text;
      // No bullet symbol in the original text (e.g. Word draws the bullet): don't add one.
      else if (!m) text = indent + text.replace(/^\s*[•●▪*-]\s+/, "").replace(/^\s+/, "");
      // Keep an inline label such as "Languages:" exactly as written.
      let label = op === "replace" && !m && section !== "skills" ? (orig.match(/^\s*([A-Za-z][A-Za-z &/]{1,30}:)\s*/) || [])[1] : "";
      if (label && !text.trim().startsWith(label)) text = indent + label + " " + text.trim().replace(/^[A-Za-z][A-Za-z &/]{1,30}:\s*/, "");
      // Numbers must already exist nearby (or anywhere in the resume for the summary) or in the user's facts.
      let pool = section === "summary" ? resumeText : lines.slice(Math.max(0, idx - 4), idx + 5).join("\n"),
        okNums = new Set([...numbersIn(pool), ...numbersIn(notes)]);
      if (numbersIn(text).some((x) => !okNums.has(x) && !okNums.has(x.replace(/\+$/, "")))) {
        rejected++;
        continue;
      }
      // A Skills line's category label may be renamed for the job ("Data Platforms:"); only its items are claims.
      let claimText = section === "skills" && /^[^:]{1,40}:/.test(text) ? text.replace(/^[^:]{1,40}:/, "Skills:") : text;
      unknown = [...new Set([...unsupportedTerms(claimText, section === "summary" ? allowedSummary : allowed, jobLower), ...claimedMissingSkills(text, orig, riskySkills, [jobTitle, coreJobTitle(jobTitle)])])];
      let toolLine = TOOL_LINE_LABEL.test(orig),
        listLine = op === "replace" && (toolLine || (section === "skills" && orig.includes(":")));
      if (op === "replace" && (section === "experience" || section === "projects") && !toolLine && !rewriteKeepsWork(orig, text)) unknown.push("__different_work__");
      if (listLine && !roleChange) {
        let gone = droppedListItems(orig, text);
        if (gone.length) unknown.push("__drops__" + JSON.stringify({ gone, of: listItems(orig).length, skills: section === "skills" }));
      }
      if (roleChange) unknown.push(...jobOnlyClaims(text, orig, jobTok, resumeTok, allowedTok, section === "summary" ? [jobTitle, coreJobTitle(jobTitle)] : [], section === "skills" ? 1 : 2).filter((w) => !unknown.includes(w)));
      let withoutTitle = section === "summary" ? [jobTitle, coreJobTitle(jobTitle)].filter(Boolean).reduce((t, title) => t.replace(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "), text) : text;
      if (section !== "skills") unknown.push(...claimedJobWords(withoutTitle, orig, riskySkills, resumeTok, allowedTok).filter((w) => !unknown.some((u) => u.toLowerCase().startsWith(w))));
      if (op === "replace" && text.trim() === orig.trim()) continue;
      // A fixed PDF layout has a set width per line: flag rewrites that won't fit at the same size.
      if (format === "pdf" && text.trim().length > Math.max(orig.trim().length * 1.2, orig.trim().length + 12)) unknown.push("__too_long__");
    }
    let entry = byLine.get(idx) || { idx, section, replace: null, del: false, inserts: [], reasons: [], keywords: [], unknown: [] };
    if (unknown.length) entry.unknown.push(...unknown);
    if (op === "replace") entry.replace = text;
    else if (op === "delete") entry.del = true;
    else entry.inserts.push(text);
    if (e.reason) entry.reasons.push(String(e.reason).slice(0, 300));
    if (Array.isArray(e.keywords)) entry.keywords.push(...e.keywords.map(String).slice(0, 6));
    byLine.set(idx, entry);
  }
  // Skills the model moved to another Skills line (regrouping) aren't lost. Hold a list line
  // for review only if, across the whole new Skills section, it still loses most of its items
  // or loses one this job asks for.
  let skillsAfter = "";
  lines.forEach((l, i) => {
    if (sectionOfLine(lines, i) !== "skills") return;
    let en = byLine.get(i);
    skillsAfter += "\n" + (en ? [...(en.del ? [] : [en.replace ?? l]), ...en.inserts].join("\n") : l);
  });
  let skillsTok = atsTokStr(skillsAfter),
    jobTokStr = atsTokStr(jobText);
  for (let en of byLine.values()) {
    en.unknown = en.unknown.flatMap((u) => {
      if (!u.startsWith("__drops__")) return [u];
      let d = JSON.parse(u.slice(9)),
        gone = d.skills ? d.gone.filter((g) => !atsHas(skillsTok, g)) : d.gone,
        neededByJob = gone.filter((g) => atsHas(jobTokStr, g));
      return gone.length && ((gone.length / d.of > 0.6 && gone.length >= 3) || neededByJob.length) ? ["__drops__" + (neededByJob.length ? neededByJob : gone).slice(0, 8).join(", ")] : [];
    });
  }
  keepTwoBulletsPerRole(lines, byLine);
  keepSkillLines(lines, byLine, 3, jobText);
  let suggestions = [...byLine.values()]
    .sort((a, b) => a.idx - b.idx)
    .map((en) => {
      let orig = lines[en.idx],
        head = en.del ? [] : [en.replace ?? orig],
        after = [...head, ...en.inserts];
      return {
        section: tailorSectionLabels[en.section] || tailorSectionLabels.additional,
        category: en.section,
        start: en.idx,
        end: en.idx + 1,
        beforeLines: [orig],
        afterLines: after,
        before: orig,
        after: after.join("\n"),
        reason:
          (en.unknown.includes("__too_long__") ? "⚠ Longer than the original PDF line — shorten it in the editor so it fits at the same size. " : "") +
          (en.unknown.includes("__different_work__") ? "⚠ Verify before applying: this rewrite describes different work than your original bullet. " : "") +
          (en.unknown.filter((u) => u.startsWith("__drops__")).map((u) => `⚠ Verify before applying: this drops skills you listed (${u.slice(9)}). `)[0] || "") +
          (en.unknown.filter((u) => !u.startsWith("__")).length ? `⚠ Verify before applying: mentions ${[...new Set(en.unknown.filter((u) => !u.startsWith("__")))].join(", ")}, which isn’t in your resume. ` : "") +
          (en.reasons[0] || "Aligned with the job description.") +
          (en.keywords.length ? ` · Surfaces: ${[...new Set(en.keywords)].slice(0, 5).join(", ")}` : ""),
        needsReview: en.unknown.length > 0,
        evidence: orig,
        evidenceSource: "resume",
        accepted: false,
        skipped: false,
        source: "AI",
      };
    })
    .filter((s) => s.after !== s.before);
  return { suggestions, rejected };
}
window.validateAiEdits = validateAiEdits;
