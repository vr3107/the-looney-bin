// Extend the tailoring review to the full resume while preserving the user's original wording and facts.
const jobloomSectionPatterns = {
  summary:
    /^(?:(?:professional|career|executive|personal)\s+)?(?:summary|profile|objective|about(?:\s+me)?)(?:\s*[:\-–—].*)?$/i,
  skills:
    /^(?:(?:technical|core|relevant)\s+)?(?:skills|competencies|technologies|tools)(?:\s*[:\-–—].*)?$/i,
  experience:
    /^(?:(?:professional|work|career|employment)\s+)?(?:experience|history)(?:\s*[:\-–—].*)?$/i,
  projects:
    /^(?:(?:selected|academic|personal|key)\s+)?projects?(?:\s*[:\-–—].*)?$/i,
  education:
    /^(?:education|academic background|education and coursework|relevant coursework)(?:\s*[:\-–—].*)?$/i,
  certifications:
    /^(?:(?:professional|licenses and)\s+)?(?:certifications?|licenses?|credentials?)(?:\s*[:\-–—].*)?$/i,
  additional:
    /^(?:awards?(?: and honors?)?|honors?|leadership|publications?|volunteer(?:ing)?(?: experience)?|community involvement|professional development|patents?|presentations?|memberships?|languages|interests|activities|accomplishments?)(?:\s*[:\-–—].*)?$/i,
};
function jobloomNormalizedHeading(line) {
  return String(line || "")
    .trim()
    .replace(/^[•●▪*-]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[:\-–—]+$/, "")
    .trim();
}
function jobloomSectionKey(line) {
  let value = jobloomNormalizedHeading(line);
  if (value.length > 72 || /[.!?]$/.test(value)) return "";
  for (let key of Object.keys(jobloomSectionPatterns))
    if (jobloomSectionPatterns[key].test(value)) return key;
  return "";
}
window.jobloomSections = function (lines, key) {
  let sections = [];
  for (let idx = 0; idx < lines.length; idx++) {
    if (jobloomSectionKey(lines[idx]) !== key) continue;
    let end = lines.findIndex((line, i) => i > idx && jobloomSectionKey(line));
    if (end < 0) end = lines.length;
    let raw = String(lines[idx] || "").trim(),
      start = idx + 1;
    if (/[:\-–—]\s*\S/.test(raw)) start = idx;
    sections.push({ headingIndex: idx, start, end, heading: raw, key });
  }
  return sections;
};
window.tailoringSection = function (lines, key) {
  return window.jobloomSections(lines, key)[0] || null;
};
const jobloomSectionNames = {
  summary: "Professional summary",
  skills: "Skills",
  experience: "Work experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  additional: "Other resume sections",
};
function jobloomBulletRewrite(line) {
  let m = bulletPrefix(line);
  if (!m) return line;
  let prefix = m[1],
    text = m[2],
    updated = text
      .replace(/^responsible for\b/i, "Managed")
      .replace(/^worked on\b/i, "Contributed to")
      .replace(/^helped (?:to )?/i, "Supported ")
      .replace(/^assisted (?:with|in)\b/i, "Supported")
      .replace(/^participated in\b/i, "Contributed to")
      .replace(/\butilized\b/gi, "used")
      .replace(/\bin order to\b/gi, "to");
  return prefix + updated;
}
function jobloomReorderBulletClusters(
  lines,
  section,
  terms,
  category,
  label,
  out,
  groupLimit,
  polish,
) {
  if (!section) return;
  let seen = 0,
    i = section.start;
  while (i < section.end) {
    if (!bulletPrefix(lines[i])) {
      i++;
      continue;
    }
    let start = i,
      slots = [],
      entries = [];
    while (i < section.end) {
      if (bulletPrefix(lines[i])) {
        slots.push(i);
        entries.push({
          line: lines[i],
          index: i,
          rank: lineRelevance(lines[i], terms),
        });
        i++;
        continue;
      }
      if (!String(lines[i] || "").trim() && bulletPrefix(lines[i + 1] || "")) {
        slots.push(i);
        i++;
        continue;
      }
      break;
    }
    seen++;
    if (groupLimit && seen > groupLimit) continue;
    let sorted = entries
        .map((x) => ({
          line: polish && x.rank > 0 ? jobloomBulletRewrite(x.line) : x.line,
          rank: x.rank,
          index: x.index,
        }))
        .sort((a, b) => b.rank - a.rank || a.index - b.index),
      afterLines = lines.slice(start, i),
      cursor = 0;
    afterLines = afterLines.map((line) =>
      bulletPrefix(line) ? sorted[cursor++].line : line,
    );
    let before = lines.slice(start, i).join("\n"),
      after = afterLines.join("\n");
    if (after !== before)
      out.push({
        section: label + (seen > 1 ? " · group " + seen : ""),
        category,
        start,
        end: i,
        beforeLines: before.split("\n"),
        afterLines: after.split("\n"),
        before,
        after,
        reason: polish
          ? "Bring job-relevant evidence forward and clarify only vague wording. No new results or qualifications are added."
          : "Bring the most job-relevant existing entries first while keeping their facts unchanged.",
        evidence: before,
        accepted: false,
        skipped: false,
      });
  }
}
function jobloomBulletOnlySort(text, terms) {
  let lines = String(text || "").split("\n"),
    nonblank = lines
      .map((line, index) => ({ line, index, rank: lineRelevance(line, terms) }))
      .filter((x) => x.line.trim());
  if (nonblank.length < 2 || !nonblank.every((x) => bulletPrefix(x.line)))
    return String(text || "");
  let sorted = nonblank
      .slice()
      .sort((a, b) => b.rank - a.rank || a.index - b.index),
    next = 0;
  return lines
    .map((line) => (line.trim() ? sorted[next++].line : line))
    .join("\n");
}
window.buildTailoringSuggestions = function (job, original, b) {
  let lines = String(original || "").split(/\r?\n/),
    terms = tailoringTerms(job, b),
    out = [],
    add = (category, label, section, before, after, reason, evidence) => {
      if (before !== after)
        out.push({
          section: label,
          category,
          start: section.start,
          end: section.end,
          beforeLines: before.split("\n"),
          afterLines: after.split("\n"),
          before,
          after,
          reason,
          evidence: evidence || before,
          accepted: false,
          skipped: false,
        });
    };
  let summary = tailoringSection(lines, "summary");
  if (summary) {
    let before = sectionLines(lines, summary).join("\n"),
      after = sortedSummaryText(before, terms);
    add(
      "summary",
      jobloomSectionNames.summary,
      summary,
      before,
      after,
      "Prioritize the existing summary statements that best support this job. The wording and facts remain yours.",
      before,
    );
  }
  let skills = tailoringSection(lines, "skills");
  if (skills) {
    let before = sectionLines(lines, skills).join("\n"),
      after = reorderSkillText(before, terms),
      skillText = before.toLowerCase(),
      generic = new Set(
        "senior junior lead staff principal associate director vice president engineering engineer developer data analyst designer product manager architect specialist solutions software technology technical remote hybrid".split(
          /\s+/,
        ),
      ),
      candidateTerms = jobMatchTerms(job).filter((term) => {
        let normalized = term.toLowerCase(),
          rx = new RegExp(
            "(^|[^a-z0-9])" +
              term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
              "([^a-z0-9]|$)",
            "i",
          );
        return (
          term.length > 2 &&
          !generic.has(normalized) &&
          rx.test(original) &&
          !rx.test(before)
        );
      }),
      selected = window.confirmedResumeKeywordSelectionActive
        ? new Set(window.confirmedResumeKeywords || [])
        : null,
      verified = candidateTerms
        .filter((term) => !selected || selected.has(term))
        .slice(0, 6);
    if (verified.length && after.trim()) {
      let skillLines = after.split("\n"),
        last = skillLines.length - 1,
        delimiter = skillLines[last].includes("|")
          ? " | "
          : skillLines[last].includes(";")
            ? "; "
            : ", ";
      skillLines[last] =
        skillLines[last].replace(/\s+$/, "") +
        delimiter +
        verified.join(delimiter.trim() === "|" ? " | " : delimiter);
      after = skillLines.join("\n");
    }
    add(
      "skills",
      jobloomSectionNames.skills,
      skills,
      before,
      after,
      verified.length
        ? "Prioritize relevant skills and surface only terms already stated elsewhere in your resume. Check the source evidence before accepting."
        : "Prioritize existing skills that appear in the job posting.",
      before,
    );
  }
  let experience = tailoringSection(lines, "experience");
  jobloomReorderBulletClusters(
    lines,
    experience,
    terms,
    "experience",
    jobloomSectionNames.experience,
    out,
    window.tailorExperienceMode === "full" ? 0 : 2,
    true,
  );
  for (let key of ["projects", "education", "certifications", "additional"])
    for (let section of jobloomSections(lines, key)) {
      jobloomReorderBulletClusters(
        lines,
        section,
        terms,
        key,
        jobloomSectionNames[key],
        out,
        0,
        key === "projects",
      );
      let before = sectionLines(lines, section).join("\n"),
        after = jobloomBulletOnlySort(before, terms);
      if (
        after !== before &&
        !out.some(
          (x) =>
            x.category === key &&
            x.start >= section.start &&
            x.start < section.end,
        )
      )
        add(
          key,
          jobloomSectionNames[key],
          section,
          before,
          after,
          "Prioritize the entries that best support this job; names, dates, degrees, and credentials stay unchanged.",
          before,
        );
    }
  return out;
};
function jobloomCategoryFor(section) {
  let value = String(section || "").toLowerCase();
  if (value.includes("summary")) return "summary";
  if (value.includes("skill")) return "skills";
  if (value.includes("experience")) return "experience";
  if (value.includes("project")) return "projects";
  if (value.includes("education")) return "education";
  if (value.includes("certification") || value.includes("license"))
    return "certifications";
  return "additional";
}
function jobloomGetCurrentJob() {
  return (
    data.jobs.find((x) => x.id === window.tailorJobId) ||
    (liveListings || []).find((x) => x.id === window.tailorJobId)
  );
}
function jobloomRefreshSuggestions() {
  let job = jobloomGetCurrentJob(),
    body = document.getElementById("tailored-body");
  if (!job || !body) return;
  let original = window.tailorOriginalText || "";
  if (
    body.value !== original ||
    (window.tailorSuggestions || []).some((x) => x.accepted || x.skipped)
  ) {
    toast(
      "Reset the draft and review choices before changing tailoring options.",
    );
    return false;
  }
  window.tailorSuggestions = buildTailoringSuggestions(
    job,
    original,
    window.tailorMatchExplanation || {},
  );
  renderTailoringSuggestions();
  return true;
}
const jobloomOriginalRenderSuggestions = window.renderTailoringSuggestions;
window.renderTailoringSuggestions = function () {
  jobloomOriginalRenderSuggestions();
  let list = window.tailorSuggestions || [],
    cards = document.querySelectorAll("#suggestion-list .suggestion-card"),
    selected = window.tailorSelectedSections;
  cards.forEach((card, index) => {
    let category =
      list[index]?.category || jobloomCategoryFor(list[index]?.section);
    card.hidden = !!selected && !selected.has(category);
  });
  let root = document.getElementById("suggestion-list");
  if (root && !list.length)
    root.innerHTML =
      '<div class="analysis-note">No automatic change passed the evidence checks. You can still edit every resume section on the right; the comparison above shows what the job asks for and what the source resume proves.</div>';
};
const jobloomOriginalApplyAll = window.applyAllTailorSuggestions;
window.applyAllTailorSuggestions = function () {
  let list = window.tailorSuggestions || [],
    selected = window.tailorSelectedSections;
  [...list.keys()]
    .filter(
      (i) =>
        !list[i].accepted &&
        !list[i].skipped &&
        (!selected ||
          selected.has(
            list[i].category || jobloomCategoryFor(list[i].section),
          )),
    )
    .sort((a, b) => list[b].start - list[a].start)
    .forEach((i) => window.resolveTailorSuggestion(i, "apply"));
  toast(
    "Selected section suggestions applied. Review every edit and its evidence before saving.",
  );
};
function jobloomBuildTailorControls(jobId) {
  let suggestions = window.tailorSuggestions || [],
    original = window.tailorOriginalText || "",
    previousSelection = window.tailorSelectedSections,
    controlsBefore = document.getElementById("jobloom-tailor-controls");
  controlsBefore?.remove();
  let list = document.getElementById("suggestion-list");
  if (!list) return;
  let present = Object.keys(jobloomSectionPatterns).filter((key) =>
      tailoringSection(original.split(/\r?\n/), key),
    ),
    categories = [
      ...new Set([
        ...present,
        ...suggestions.map((s) => s.category || jobloomCategoryFor(s.section)),
      ]),
    ],
    counts = Object.fromEntries(
      categories.map((key) => [
        key,
        suggestions.filter(
          (s) => (s.category || jobloomCategoryFor(s.section)) === key,
        ).length,
      ]),
    ),
    names = categories
      .map(
        (key) =>
          '<label class="tailor-check"><input type="checkbox" data-tailor-section="' +
          key +
          '" ' +
          (!previousSelection || previousSelection.has(key) ? "checked" : "") +
          "><span>" +
          esc(jobloomSectionNames[key] || key) +
          "</span><small>" +
          counts[key] +
          " edits</small></label>",
      )
      .join(""),
    job = jobloomGetCurrentJob(),
    jdTerms = job ? jobMatchTerms(job) : [],
    skill = tailoringSection(original.split(/\r?\n/), "skills"),
    skillText = skill
      ? sectionLines(original.split(/\r?\n/), skill).join("\n").toLowerCase()
      : "",
    generic = new Set(
      "senior junior lead staff principal associate director vice president engineering engineer developer data analyst designer product manager architect specialist solutions software technology technical remote hybrid".split(
        /\s+/,
      ),
    ),
    verified = jdTerms
      .filter((term) => {
        let rx = new RegExp(
          "(^|[^a-z0-9])" +
            term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            "([^a-z0-9]|$)",
          "i",
        );
        return (
          term.length > 2 &&
          !generic.has(term.toLowerCase()) &&
          rx.test(original) &&
          !rx.test(skillText)
        );
      })
      .slice(0, 6),
    unverified = jdTerms
      .filter((term) => !original.toLowerCase().includes(term.toLowerCase()))
      .slice(0, 8),
    selectedKeywords = new Set(window.confirmedResumeKeywords || []),
    toolWords = new Set(
      "python pyspark spark sql postgresql mysql mongodb redis aws azure gcp kubernetes docker git jira tableau powerbi databricks snowflake terraform airflow react node java javascript typescript c++ c# pytorch tensorflow scikit-learn linux".split(
        /\s+/,
      ),
    ),
    toolTerms = verified.filter((x) => toolWords.has(x.toLowerCase())),
    functionalTerms = verified.filter((x) => !toolWords.has(x.toLowerCase())),
    keywordGroup = (title, items) =>
      '<div class="tailor-keyword-group"><b>' +
      title +
      '</b><div class="tailor-keywords">' +
      (items.length
        ? items
            .map(
              (term) =>
                '<label class="tailor-keyword"><input type="checkbox" data-verified-keyword="' +
                esc(term) +
                '" ' +
                (!window.confirmedResumeKeywordSelectionActive ||
                selectedKeywords.has(term)
                  ? "checked"
                  : "") +
                "><span>" +
                esc(term) +
                "</span></label>",
            )
            .join("")
        : '<span class="help">No additional job terms were found in this resume.</span>') +
      "</div></div>",
    missingMarkup = unverified.length
      ? '<div class="tailor-keyword-group"><b>Job terms not found in the source resume</b><div class="tailor-keywords">' +
        unverified
          .map(
            (term) =>
              '<span class="tailor-keyword unverified">' +
              esc(term) +
              " · no resume evidence</span>",
          )
          .join("") +
        '</div><p class="tailor-control-note">These are not added automatically. Add a term only if it accurately describes your experience.</p></div>'
      : "",
    html =
      '<section class="tailor-controls" id="jobloom-tailor-controls"><h4>Choose resume sections to enhance</h4><div class="tailor-control-grid">' +
      names +
      '</div><div class="tailor-mode"><strong style="font-size:10px">Work experience depth</strong><label><input type="radio" name="tailor-depth" value="quick" ' +
      (window.tailorExperienceMode !== "full" ? "checked" : "") +
      '> Quick · first 2 bullet groups</label><label><input type="radio" name="tailor-depth" value="full" ' +
      (window.tailorExperienceMode === "full" ? "checked" : "") +
      '> Full · all experience bullet groups</label></div><h4>ATS terms found elsewhere in your resume</h4><p class="tailor-control-note">Select verified terms to surface in Skills. Terms absent from the source resume are listed separately and will not be invented.</p><div class="tailor-keyword-groups">' +
      keywordGroup("Tools & technologies", toolTerms) +
      keywordGroup("Functional skills", functionalTerms) +
      missingMarkup +
      "</div></section>";
  list.insertAdjacentHTML("beforebegin", html);
  window.tailorSelectedSections = previousSelection
    ? new Set([...previousSelection].filter((key) => categories.includes(key)))
    : new Set(categories);
  let host = document.getElementById("jobloom-tailor-controls");
  host.querySelectorAll("[data-tailor-section]").forEach(
    (input) =>
      (input.onchange = () => {
        let key = input.dataset.tailorSection;
        if (input.checked) window.tailorSelectedSections.add(key);
        else window.tailorSelectedSections.delete(key);
        renderTailoringSuggestions();
      }),
  );
  host.querySelectorAll("[data-verified-keyword]").forEach(
    (input) =>
      (input.onchange = () => {
        let oldActive = window.confirmedResumeKeywordSelectionActive,
          oldKeywords = [...(window.confirmedResumeKeywords || [])];
        window.confirmedResumeKeywordSelectionActive = true;
        window.confirmedResumeKeywords = [
          ...host.querySelectorAll("[data-verified-keyword]:checked"),
        ].map((x) => x.dataset.verifiedKeyword);
        if (jobloomRefreshSuggestions()) jobloomBuildTailorControls(jobId);
        else {
          window.confirmedResumeKeywordSelectionActive = oldActive;
          window.confirmedResumeKeywords = oldKeywords;
          jobloomBuildTailorControls(jobId);
        }
      }),
  );
  host.querySelectorAll('[name="tailor-depth"]').forEach(
    (input) =>
      (input.onchange = () => {
        let oldMode = window.tailorExperienceMode;
        window.tailorExperienceMode = input.value;
        if (jobloomRefreshSuggestions()) jobloomBuildTailorControls(jobId);
        else {
          window.tailorExperienceMode = oldMode;
          jobloomBuildTailorControls(jobId);
        }
      }),
  );
  renderTailoringSuggestions();
}
const jobloomTailorWithSelectedResume = window.tailorResume;
window.tailorResume = function (jobId, sourceResumeId) {
  window.tailorExperienceMode = "quick";
  window.confirmedResumeKeywordSelectionActive = false;
  window.tailorSelectedSections = null;
  let result = jobloomTailorWithSelectedResume(jobId, sourceResumeId);
  jobloomBuildTailorControls(jobId);
  let steps = document.querySelector("#tailor-area .tailor-step-row");
  if (steps)
    steps.innerHTML =
      '<span class="step-active">1 · Compare job</span><span class="step-active">2 · Choose sections</span><span>3 · Review and edit</span><span>4 · Download or save</span>';
  return result;
};
