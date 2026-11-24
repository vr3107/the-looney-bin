function sectionHeadingIndex(lines, re) {
  return lines.findIndex((line) => re.test(line.trim()));
}
function naturalResumeInsertion(body, addition) {
  let raw = String(body || "").replace(/\r/g, ""),
    text = String(addition || "").trim();
  if (!text) return raw;
  let lines = raw.split("\n"),
    summaryRe =
      /^(professional\s+)?(summary|profile|objective|career summary)\b.*$/i,
    experienceRe =
      /^(professional\s+)?(work\s+)?(experience|employment history|career history)\b.*$/i,
    majorRe =
      /^(skills|technical skills|experience|work experience|professional experience|projects|education|certifications|summary|professional summary|profile|objective)\b.*$/i,
    idx = sectionHeadingIndex(lines, summaryRe),
    section = "SUMMARY";
  if (idx >= 0) idx++;
  else {
    idx = sectionHeadingIndex(lines, experienceRe);
    section = "EXPERIENCE";
    if (idx >= 0) idx++;
    else {
      idx = sectionHeadingIndex(lines, majorRe);
      section = "CONTACT / INTRO";
      if (idx < 0) {
        let nonblank = 0;
        idx = 0;
        while (idx < lines.length && nonblank < 3) {
          if (lines[idx].trim()) nonblank++;
          idx++;
        }
      }
    }
  }
  let block = text.split(/\n+/);
  if (idx > 0 && lines[idx - 1]?.trim()) block.unshift("");
  block.push("");
  lines.splice(idx, 0, ...block);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
function composedResume(summary, body) {
  return naturalResumeInsertion(body, summary);
}
// Line comparison that counts repeats: a line appearing once more after editing is one added
// line (the later copy), and one copy fewer is one removed line.
// addedAt / removedAt: positions (line numbers) in the updated / previous text, for highlighting.
function diffLines(before, after) {
  let a = (before || "").split(/\r?\n/),
    b = (after || "").split(/\r?\n/),
    count = (list) => list.reduce((m, x) => (x.trim() ? m.set(x, (m.get(x) || 0) + 1) : m), new Map()),
    left = count(a),
    right = count(b),
    added = [],
    removed = [],
    unchanged = [],
    addedAt = new Set(),
    removedAt = new Set();
  b.forEach((x, i) => {
    if (!x.trim()) return;
    if (left.get(x) > 0) left.set(x, left.get(x) - 1), unchanged.push(x);
    else added.push(x), addedAt.add(i);
  });
  a.forEach((x, i) => {
    if (!x.trim()) return;
    if (right.get(x) > 0) right.set(x, right.get(x) - 1);
    else removed.push(x), removedAt.add(i);
  });
  return { added, removed, unchanged, addedAt, removedAt };
}
function paintResumeDiff(before, after) {
  let d = diffLines(before, after),
    old = document.getElementById("resume-diff-old"),
    fresh = document.getElementById("resume-diff-new");
  if (old)
    old.innerHTML = (before || "")
      .split(/\r?\n/)
      .map(
        (x, i) =>
          '<span class="' +
          (d.removedAt.has(i) ? "diff-removed" : "diff-kept") +
          '">' +
          (esc(x) || " ") +
          "</span>",
      )
      .join("\n");
  if (fresh)
    fresh.innerHTML = (after || "")
      .split(/\r?\n/)
      .map(
        (x, i) =>
          '<span class="' +
          (d.addedAt.has(i) ? "diff-added" : "diff-kept") +
          '">' +
          (esc(x) || " ") +
          "</span>",
      )
      .join("\n");
  let meta = document.getElementById("resume-diff-count");
  if (meta)
    meta.textContent =
      d.added.length +
      " added · " +
      d.removed.length +
      " removed · " +
      d.unchanged.length +
      " unchanged lines";
}
const MATCH_STOP = new Set(
  "about above across after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other ought our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves year years requirement requirements required preferred responsibility responsibilities qualification qualifications candidate candidates applicants position role roles opportunity work workplace working ability strong proficient proficiency successful success team company including must please ensure expected provide support using used able join create build maintain develop design good great independently collaboratively".split(
    /\s+/,
  ),
);
function cleanJobText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
function jobMatchTerms(job) {
  let desc = cleanJobText(job?.description || ""),
    sentences = desc
      .split(/(?<=[.!?])\s+|\n+/)
      .map((x) => x.trim())
      .filter((x) =>
        /\b(required|must|minimum|preferred|qualification|experience|proficien|knowledge|responsibilit|skills?|degree|certif|license|years?)\b/i.test(
          x,
        ),
      ),
    tokens = (text) =>
      String(text || "")
        .toLowerCase()
        .match(/[a-z][a-z0-9+#.-]{2,}/g) || [],
    count = new Map();
  for (let term of tokens(desc))
    if (!MATCH_STOP.has(term)) count.set(term, (count.get(term) || 0) + 1);
  let descriptionTerms = [...count]
      .sort((a, b) => b[1] - a[1])
      .map((x) => x[0]),
    ordered = [
      ...tokens((job?.tags || []).join(" ")).slice(0, 6),
      ...sentences.flatMap(tokens),
      ...tokens(job?.title || "").slice(0, 5),
      ...descriptionTerms,
    ],
    seen = new Set();
  return ordered
    .filter(
      (x) =>
        x.length > 2 &&
        !MATCH_STOP.has(x) &&
        !/^[0-9]/.test(x) &&
        !seen.has(x) &&
        seen.add(x),
    )
    .slice(0, 18);
}
function roleAlignment(job, roleText) {
  let title = String(job?.title || "").toLowerCase(),
    groups = String(roleText || "")
      .split(",")
      .map((role) => [
        ...new Set(
          (role.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []).filter(
            (x) => !MATCH_STOP.has(x),
          ),
        ),
      ])
      .filter((x) => x.length),
    ranked = groups
      .map((words) => ({ words, hits: words.filter((x) => title.includes(x)) }))
      .sort(
        (a, b) =>
          b.hits.length / Math.max(1, b.words.length) -
          a.hits.length / Math.max(1, a.words.length),
      );
  return ranked.length
    ? {
        words: ranked[0].words,
        hits: ranked[0].hits,
        ratio: ranked[0].hits.length / Math.max(1, ranked[0].words.length),
      }
    : { words: [], hits: [], ratio: 0.5 };
}
function jobScoreBreakdown(job, resumeText, roleText) {
  let resume = String(resumeText || ""),
    low = resume.toLowerCase(),
    terms = jobMatchTerms(job);
  if (!terms.length)
    return {
      score: null,
      coverage: 0,
      prominence: 0,
      seniority: null,
      role: null,
      terms: [],
      matched: [],
    };
  let matched = terms.filter((x) => low.includes(x)),
    coverage = matched.length / terms.length,
    lines = resume.split(/\r?\n/),
    visible = "";
  let sum = tailoringSection(lines, "summary"),
    skill = tailoringSection(lines, "skills"),
    exp = tailoringSection(lines, "experience");
  if (sum) visible += sectionLines(lines, sum).join(" ") + " ";
  if (skill) visible += sectionLines(lines, skill).join(" ") + " ";
  if (exp) {
    let bullets = lines
      .slice(exp.start, exp.end)
      .filter((x) => bulletPrefix(x))
      .slice(0, 4);
    visible += bullets.join(" ");
  }
  let prominence = matched.length
    ? matched.filter((x) => visible.toLowerCase().includes(x)).length /
      matched.length
    : 0;
  if (!sum && !skill && !exp) prominence = coverage;
  let roleFit = roleAlignment(job, roleText),
    role = roleFit.ratio,
    yearsRE =
      /\b(?:at least\s+|minimum(?: of)?\s+|over\s+)?(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+|professional\s+|work\s+)?experience\b/gi,
    jobYears = [...cleanJobText(job?.description || "").matchAll(yearsRE)].map(
      (x) => Number(x[1]),
    ),
    resumeYears = [...resume.matchAll(yearsRE)].map((x) => Number(x[1])),
    seniority = jobYears.length
      ? resumeYears.length
        ? Math.max(...resumeYears) >= Math.max(...jobYears)
          ? 1
          : Math.max(...resumeYears) / Math.max(...jobYears)
        : 0.45
      : 0.65,
    score = Math.min(
      96,
      Math.round(
        28 + 57 * coverage + 7 * prominence + 4 * role + 4 * seniority,
      ),
    );
  return {
    score,
    coverage: Math.round(100 * coverage),
    prominence: Math.round(100 * prominence),
    seniority: Math.round(100 * seniority),
    role: Math.round(100 * role),
    roleWords: roleFit.words,
    roleHit: roleFit.hits,
    terms,
    matched,
  };
}
function score(job) {
  let r = jobResume(job),
    resume = r?.text || data.profile.resume || "",
    role = job?.targetRoles || r?.targetRoles || data.profile.role || "";
  return jobScoreBreakdown(job, resume, role).score;
}
function jobMatchExplanation(job) {
  let r = jobResume(job),
    resume = r?.text || data.profile.resume || "",
    resumeLow = resume.toLowerCase(),
    body = cleanJobText(job?.description || ""),
    terms = jobMatchTerms(job),
    matched = terms.filter((w) => resumeLow.includes(w)),
    missing = terms.filter((w) => !resumeLow.includes(w)),
    roleText = String(
      job?.targetRoles || r?.targetRoles || data.profile.role || "",
    ).trim(),
    roleFit = roleAlignment(job, roleText),
    roleWords = roleFit.words,
    roleHit = roleFit.hits,
    yearsRE =
      /\b(?:at least\s+|minimum(?: of)?\s+|over\s+)?(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+|professional\s+|work\s+)?experience\b/gi,
    jobYears = [...body.matchAll(yearsRE)].map((m) => Number(m[1])),
    resumeYears = [...resume.matchAll(yearsRE)].map((m) => Number(m[1])),
    sentences = body
      .split(/(?<=[.!?])\s+|\n+/)
      .map((x) => x.trim())
      .filter(Boolean),
    requirements = sentences
      .filter((x) =>
        /\b(required|must|minimum|experience|proficien|qualification|degree|certif|license|years?|responsibilit|knowledge|skills?)\b/i.test(
          x,
        ),
      )
      .slice(0, 8),
    resumeLines = resume
      .split(/\n+|(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 24),
    evidence = resumeLines
      .filter((line) => matched.some((w) => line.toLowerCase().includes(w)))
      .slice(0, 4),
    credTerms = [
      ...new Set(
        (
          body.match(
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
function updateTailoredPreview(job, before) {
  let summary = document.getElementById("tailored-summary")?.value || "",
    body = document.getElementById("tailored-body")?.value || "",
    text = composedResume(summary, body),
    role = window.tailorRoleForJob || data.profile.role || "",
    current = jobScoreBreakdown(job, before, role),
    draft = jobScoreBreakdown(job, text, role),
    scoreNode = document.getElementById("tailored-preview-score");
  if (scoreNode)
    scoreNode.textContent = draft.score === null ? "—" : draft.score + "%";
  let note = document.getElementById("tailored-score-note");
  if (note) {
    let delta =
      current.score === null || draft.score === null
        ? 0
        : draft.score - current.score;
    note.textContent =
      delta === 0
        ? "No score change yet. Reordering alone does not create new qualification evidence. Compare the requirement map and signals below."
        : "Draft match " +
          (delta > 0 ? "+" : "") +
          delta +
          " points. The increase reflects clearer evidence placement or additional verified job terms.";
  }
  let breakdown = document.getElementById("tailored-breakdown");
  if (breakdown) {
    let dims = [
      ["Job keywords", current.coverage, draft.coverage],
      ["Evidence visibility", current.prominence, draft.prominence],
      ["Role title", current.role, draft.role],
      ["Experience years", current.seniority, draft.seniority],
    ];
    breakdown.innerHTML = dims
      .map(
        ([label, a, b]) =>
          "<article><b>" +
          esc(label) +
          "</b><span>Current " +
          (a === null ? "—" : a + "%") +
          ' · Draft <strong class="' +
          (b > a ? "improved" : "") +
          '">' +
          (b === null ? "—" : b + "%") +
          "</strong></span></article>",
      )
      .join("");
  }
  let map = document.getElementById("tailored-requirement-map");
  if (map)
    map.innerHTML = renderRequirementMap(
      job,
      text,
      window.tailorMatchExplanation || {},
    );
  paintResumeDiff(before, text);
}
function tailoringSection(lines, key) {
  let patterns = {
      summary:
        /^(professional\s+)?(summary|profile|objective|career summary)\b/i,
      skills: /^(technical\s+)?(core\s+)?skills\b/i,
      experience:
        /^(professional\s+)?(work\s+)?(experience|employment history|career history)\b/i,
    },
    idx = lines.findIndex((x) => patterns[key].test(x.trim()));
  if (idx < 0) return null;
  let next =
      /^(professional\s+)?(summary|profile|objective|career summary|technical\s+skills|skills|professional\s+experience|work\s+experience|experience|employment history|career history|projects|education|certifications|awards)\b/i,
    end = lines.findIndex((x, i) => i > idx && next.test(x.trim()));
  if (end < 0) end = lines.length;
  let start = idx + 1,
    heading = lines[idx].trim(),
    colon = heading.indexOf(":");
  if (colon > 0 && colon < 28 && heading.slice(colon + 1).trim()) start = idx;
  return { headingIndex: idx, start: start, end: end };
}
function tailoringTerms(job, b) {
  return [...new Set([...jobMatchTerms(job), ...(b?.matched || [])])];
}
function lineRelevance(line, terms) {
  let text = String(line || "").toLowerCase();
  return terms.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
}
function sectionLines(lines, section) {
  return section ? lines.slice(section.start, section.end) : [];
}
function sortedSummaryText(text, terms) {
  let raw = String(text || ""),
    parts = raw.split(/(\n{2,})/),
    content = parts.filter((x, i) => i % 2 === 0);
  if (content.length > 1) {
    let sorted = content
        .map((x, i) => ({ x, i, n: lineRelevance(x, terms) }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map((x) => x.x),
      k = 0;
    return parts.map((x, i) => (i % 2 === 0 ? sorted[k++] : x)).join("");
  }
  let lines = raw.split("\n"),
    groups = [],
    buffer = [];
  for (let line of lines) {
    buffer.push(line);
    let complete =
      /[.!?][\"')\]]*$/.test(line.trim()) ||
      /^\s*(?:[•●▪*-]|\d+[.)])\s+/.test(line);
    if (complete) {
      groups.push(buffer.join("\n"));
      buffer = [];
    }
  }
  if (buffer.length) groups.push(buffer.join("\n"));
  if (groups.length < 2) return raw;
  let sorted = groups
    .map((x, i) => ({ x, i, n: lineRelevance(x, terms) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.x);
  return sorted.join("\n");
}
function reorderSkillText(text, terms) {
  let lines = String(text || "").split("\n"),
    nonblank = lines
      .map((x, i) => ({ x, i, n: lineRelevance(x, terms) }))
      .filter((a) => a.x.trim()),
    bulletLines =
      nonblank.length > 1 &&
      nonblank.every((a) => /^\s*(?:[•●▪*-]|\d+[.)])\s+/.test(a.x));
  if (bulletLines) {
    let sorted = nonblank.slice().sort((a, b) => b.n - a.n || a.i - b.i),
      ordered = sorted.map((a) => a.x),
      k = 0;
    return lines.map((x) => (x.trim() ? ordered[k++] : x)).join("\n");
  }
  return lines
    .map((line) => {
      let colon = line.indexOf(":"),
        label = "",
        value = line;
      if (colon > 0 && colon < 34) {
        label = line.slice(0, colon + 1);
        value = line.slice(colon + 1);
      }
      let delimiter = value.includes(",")
        ? ","
        : value.includes("|")
          ? "|"
          : value.includes(";")
            ? ";"
            : null;
      if (!delimiter) return line;
      let items = value.split(delimiter);
      if (items.length < 3) return line;
      let sorted = items
        .map((x, i) => ({ x, i, n: lineRelevance(x, terms) }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map((x) => x.x);
      return label + sorted.join(delimiter);
    })
    .join("\n");
}
function bulletPrefix(line) {
  return String(line || "").match(/^(\s*(?:[•●▪*-]|\d+[.)])\s+)(.+)$/);
}
function buildTailoringSuggestions(job, original, b) {
  let lines = String(original || "").split(/\r?\n/),
    terms = tailoringTerms(job, b),
    out = [],
    add = (section, start, end, before, after, reason, evidence) => {
      if (before !== after)
        out.push({
          section,
          start,
          end,
          beforeLines: before.split("\n"),
          afterLines: after.split("\n"),
          before,
          after,
          reason,
          evidence: evidence || before,
          accepted: false,
          skipped: false,
        });
    },
    sum = tailoringSection(lines, "summary"),
    skill = tailoringSection(lines, "skills"),
    exp = tailoringSection(lines, "experience");
  if (sum) {
    let before = sectionLines(lines, sum).join("\n"),
      after = sortedSummaryText(before, terms);
    add(
      "Professional summary",
      sum.start,
      sum.end,
      before,
      after,
      "Move the clearest existing job-relevant summary block first. Facts and wording remain unchanged.",
      before,
    );
  }
  if (skill) {
    let before = sectionLines(lines, skill).join("\n"),
      after = reorderSkillText(before, terms),
      reason =
        "Prioritize skills already listed in your resume that appear in this posting.",
      evidence = before;
    if (exp) {
      let notSkill = new Set(
          "senior junior lead staff principal associate director vice president engineering engineer developer data analyst designer product manager architect specialist solutions software technology technical remote hybrid".split(
            /\s+/,
          ),
        ),
        verified = terms
          .filter((term) => {
            if (notSkill.has(term.toLowerCase())) return false;
            let escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              rx = new RegExp("(^|[^a-z0-9])" + escaped + "([^a-z0-9]|$)", "i");
            return rx.test(original) && !rx.test(before);
          })
          .filter((term) =>
            lines.some(
              (line, i) =>
                i >= exp.start &&
                i < exp.end &&
                line.toLowerCase().includes(term),
            ),
          )
          .slice(0, 4);
      if (verified.length && after.trim()) {
        let skillLines = after.split("\n"),
          last = skillLines.length - 1,
          delimiter = skillLines[last].includes(",")
            ? ", "
            : skillLines[last].includes("|")
              ? " | "
              : ", ";
        skillLines[last] =
          skillLines[last].replace(/\s+$/, "") +
          delimiter +
          verified.join(delimiter.trim() === "|" ? " | " : ", ");
        after = skillLines.join("\n");
        reason =
          "Prioritize listed skills for this posting and surface these additional skills already demonstrated in Experience. Review the evidence before accepting.";
        evidence = lines
          .slice(exp.start, exp.end)
          .filter((line) =>
            verified.some((term) => line.toLowerCase().includes(term)),
          )
          .slice(0, 4)
          .join("\n");
      }
    }
    add("Skills", skill.start, skill.end, before, after, reason, evidence);
  }
  if (exp) {
    let i = exp.start;
    while (i < exp.end) {
      if (!bulletPrefix(lines[i])) {
        i++;
        continue;
      }
      let begin = i,
        group = [];
      while (i < exp.end && bulletPrefix(lines[i])) {
        group.push({
          text: lines[i],
          index: i,
          n: lineRelevance(lines[i], terms),
        });
        i++;
      }
      if (group.length > 1) {
        let sorted = group
          .slice()
          .sort((a, b) => b.n - a.n || a.index - b.index);
        if (sorted.some((x, j) => x.index !== group[j].index)) {
          let before = lines.slice(begin, i).join("\n"),
            after = sorted.map((x) => x.text).join("\n");
          add(
            "Experience bullets",
            begin,
            i,
            before,
            after,
            "Bring the most relevant existing bullets forward within this role. Employers, titles, dates, and facts stay in place.",
            before,
          );
        }
      } else {
        let item = group[0],
          m = item.text.match(/^(\s*(?:[•●▪*-]|\d+[.)])\s+)(.+)$/),
          weak = m?.[2].match(
            /^(worked on|helped with|assisted with)\s+(.+)$/i,
          );
        if (weak && item.n > 0) {
          let verb = /^worked on$/i.test(weak[1])
              ? "Contributed to"
              : "Supported",
            after =
              m[1] +
              verb +
              " " +
              weak[2].replace(/^([a-z])/, (x) => x.toUpperCase());
          add(
            "Experience bullet",
            begin,
            i,
            item.text,
            after,
            "Clarify a vague opener while retaining the same work and evidence.",
            item.text,
          );
        }
      }
    }
  }
  return out;
}
function requirementEvidence(requirement, resume) {
  let stop = new Set(
      "about and are for from have into that the this with will years year experience required preferred ability work".split(
        /\s+/,
      ),
    ),
    terms = [
      ...new Set(
        (
          String(requirement || "")
            .toLowerCase()
            .match(/[a-z][a-z0-9+#.-]{2,}/g) || []
        ).filter((x) => !stop.has(x)),
      ),
    ],
    lines = String(resume || "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    ranked = lines
      .map((line) => ({
        line,
        hits: terms.filter((w) => line.toLowerCase().includes(w)),
      }))
      .sort((a, b) => b.hits.length - a.hits.length);
  return {
    terms,
    evidence: ranked[0]?.hits.length ? ranked[0].line : "",
    hits: ranked[0]?.hits || [],
  };
}
function renderRequirementMap(job, resume, b) {
  let reqs = (b.requirements || []).slice(0, 8);
  if (!reqs.length)
    return '<div class="empty" style="padding:12px"><strong>No clearly labeled requirements were detected.</strong><p>Review the full posting and assess the role manually.</p></div>';
  return (
    '<div class="requirement-map">' +
    reqs
      .map((req) => {
        let x = requirementEvidence(req, resume),
          ratio = x.terms.length ? x.hits.length / x.terms.length : 0,
          status = !x.evidence
            ? "No evidence detected"
            : ratio >= 0.55
              ? "Evidence found"
              : "Partial evidence";
        return (
          '<article class="requirement-item"><div class="requirement-top"><b>' +
          esc(status) +
          "</b><span>" +
          x.hits.length +
          "/" +
          x.terms.length +
          " terms</span></div><p>" +
          esc(req) +
          '</p><div class="requirement-evidence">' +
          (x.evidence
            ? "Resume evidence: “" + esc(x.evidence.slice(0, 260)) + "”"
            : "No matching sentence found in the parsed resume.") +
          "</div></article>"
        );
      })
      .join("") +
    "</div>"
  );
}
function renderTailoringSuggestions() {
  let root = document.getElementById("suggestion-list"),
    list = window.tailorSuggestions || [];
  if (!root) return;
  root.innerHTML = list.length
    ? list
        .map(
          (s, i) =>
            '<article class="suggestion-card ' +
            (s.accepted ? "accepted" : "") +
            (s.skipped ? " skipped" : "") +
            '"><div class="suggestion-card-head"><div><span class="tag">' +
            esc(s.section) +
            "</span><b>" +
            esc(
              s.accepted
                ? "Applied to draft"
                : s.skipped
                  ? "Skipped"
                  : "Suggested change",
            ) +
            '</b></div><div class="suggestion-actions">' +
            (s.skipped
              ? '<button class="btn btn-sm" data-review="' +
                i +
                '">Review again</button>'
              : s.accepted
                ? '<button class="btn btn-sm" data-undo="' +
                  i +
                  '">Undo</button>'
                : '<button class="btn btn-sm" data-skip="' +
                  i +
                  '">Skip</button><button class="btn btn-primary btn-sm" data-apply="' +
                  i +
                  '">Apply suggestion</button>') +
            "</div></div><p>" +
            esc(s.reason) +
            '</p><div class="suggestion-diff"><div><label>Current</label><pre>' +
            esc(s.before) +
            "</pre></div><div><label>Suggested</label><pre>" +
            esc(s.after) +
            '</pre></div></div><div class="suggestion-evidence"><b>' +
            (s.evidenceSource === "notes"
              ? "Your additional fact"
              : "Resume evidence") +
            "</b><p>" +
            esc(s.evidence.slice(0, 420)) +
            "</p></div></article>",
        )
        .join("")
    : '<div class="analysis-note">No safe automatic edits were detected in Summary, Skills, or bullet phrasing. You can still edit the resume text on the right; the requirements map shows what evidence is present or unclear.</div>';
  root
    .querySelectorAll("[data-apply]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          window.resolveTailorSuggestion(Number(b.dataset.apply), "apply")),
    );
  root
    .querySelectorAll("[data-undo]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          window.resolveTailorSuggestion(Number(b.dataset.undo), "undo")),
    );
  root
    .querySelectorAll("[data-skip]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          window.resolveTailorSuggestion(Number(b.dataset.skip), "skip")),
    );
  root
    .querySelectorAll("[data-review]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          window.resolveTailorSuggestion(Number(b.dataset.review), "review")),
    );
}
window.resolveTailorSuggestion = function (index, action) {
  let s = window.tailorSuggestions?.[index],
    body = document.getElementById("tailored-body"),
    job =
      data.jobs.find((x) => x.id === window.tailorJobId) ||
      (liveListings || []).find((x) => x.id === window.tailorJobId);
  if (!s || !body || !job) return;
  if (action === "skip") {
    s.skipped = true;
    renderTailoringSuggestions();
    return;
  }
  if (action === "review") {
    s.skipped = false;
    renderTailoringSuggestions();
    return;
  }
  let lines = body.value.split(/\r?\n/),
    expected = action === "undo" ? s.afterLines : s.beforeLines,
    replacement = action === "undo" ? s.beforeLines : s.afterLines,
    start = s.start,
    found = -1;
  function fits(at) {
    return (
      at >= 0 &&
      at + expected.length <= lines.length &&
      expected.every((x, j) => lines[at + j] === x)
    );
  }
  if (fits(start)) found = start;
  else
    for (let i = 0; i <= lines.length - expected.length; i++)
      if (fits(i)) {
        found = i;
        break;
      }
  if (found < 0) {
    toast(
      "This section has changed in the editor. Re-open the suggestion or reset the draft before applying it.",
    );
    return;
  }
  lines.splice(found, expected.length, ...replacement);
  body.value = lines.join("\n");
  s.accepted = action === "apply";
  s.skipped = false;
  updateTailoredPreview(job, window.tailorOriginalText || "");
  renderTailoringSuggestions();
};
window.applyAllTailorSuggestions = function () {
  let list = window.tailorSuggestions || [];
  [...list.keys()]
    .filter((i) => !list[i].accepted && !list[i].skipped)
    .sort((a, b) => list[b].start - list[a].start)
    .forEach((i) => window.resolveTailorSuggestion(i, "apply"));
  toast(
    "Safe suggestions applied. Review the edited text and evidence before saving.",
  );
};
window.tailorResume = function (id) {
  let job =
    data.jobs.find((x) => x.id === id) ||
    (liveListings || []).find((x) => x.id === id);
  if (!job) return;
  let r = jobResume(job),
    base = r?.baseResumeId
      ? data.resumes.find((x) => x.id === r.baseResumeId)
      : r,
    sourceType = base?.originalType || r?.originalType,
    sourceId = base?.id || r?.id;
  window.tailorJobId = id;
  window.tailorRoleForJob =
    job.targetRoles || r?.targetRoles || data.profile.role || "";
  window.confirmedResumeKeywords = [];
  openWithJobResume(job, () => {
    let b = jobMatchExplanation(job),
      original = r?.text || data.profile.resume || "",
      area = document.getElementById("tailor-area");
    if (!area) return;
    window.tailorOriginalText = original;
    window.tailorMatchExplanation = b;
    window.tailorSuggestions = buildTailoringSuggestions(job, original, b);
    let isPdf = sourceType === "pdf",
      layoutClass = isPdf ? " preserve-layout" : "",
      originalPane = '<pre class="' + layoutClass.trim() + '">' + esc(original) + "</pre>";
    area.innerHTML =
      '<div class="tailor-box"><div class="tailor-heading"><div><div class="eyebrow">JOB-SPECIFIC RESUME EDITOR</div><h3>Tailor for ' +
      esc(job.title || "this role") +
      '</h3><p class="help">Suggestions are based on this job and evidence already in your resume. Review or edit every change before saving.</p></div><div class="tailor-match"><span>Current match</span><b>' +
      (score(job) === null ? "—" : score(job) + "%") +
      '</b><small>Estimate only</small></div></div><div class="tailor-step-row"><span class="step-active">1 · Compare requirements</span><span>2 · Review edits</span><span>3 · Export version</span></div><h4 class="tailor-section-title">Job requirements and resume evidence</h4>' +
      '<div id="tailored-requirement-map">' +
      renderRequirementMap(job, original, b) +
      '</div><div class="suggestions-head"><div><h4 class="tailor-section-title">Suggested edits</h4><p class="help">Accept or skip each change. Only verified resume evidence is moved or clarified; no qualification or metric is invented.</p></div><button class="btn btn-sm" id="apply-all-tailor">Apply all safe suggestions</button></div><div id="suggestion-list"></div><div class="resume-compare"><section class="resume-side"><h4>Original resume · ' +
      esc(resumeDisplayName(r)) +
      "</h4>" +
      originalPane +
      '</section><section class="resume-side"><div class="resume-side-head"><h4>Tailored draft · ' + (isPdf ? "PDF" : "DOCX") + '</h4><button class="btn btn-sm" id="edit-tailored-resume" type="button">Edit draft</button></div><textarea id="tailored-summary" hidden></textarea><div class="tailor-score">Current match ' +
      (score(job) === null ? "—" : score(job) + "%") +
      ' · Draft match <span id="tailored-preview-score">' +
      (score(job) === null ? "—" : score(job) + "%") +
      '</span></div><div id="tailored-score-note" class="help"></div><div class="tailor-breakdown" id="tailored-breakdown"></div><div class="field" style="margin-top:9px"><label>Resume text · edit this draft</label><textarea id="tailored-body" class="' + layoutClass.trim() + '" spellcheck="false" aria-label="Edit tailored resume draft">' +
      esc(original) +
      '</textarea></div></section></div><h4 class="tailor-section-title">Change review · RGB</h4><div class="resume-actions"><span class="tag diff-added">Green · added</span><span class="tag diff-removed">Red · removed</span><span class="tag diff-kept">Blue · unchanged</span></div><div class="resume-compare"><section class="resume-side"><h4>Previous text</h4><pre class="diff-box' + layoutClass + '" id="resume-diff-old"></pre></section><section class="resume-side"><h4>Updated text</h4><pre class="diff-box' + layoutClass + '" id="resume-diff-new"></pre></section></div><div id="resume-diff-count" class="resume-history"></div><div class="analysis-note">' +
      (sourceType === "docx"
        ? "Download tailored .docx edits your original Word file in place: every unchanged line keeps its exact formatting, and edited or added lines use the same fonts, sizes, spacing, and bullet styles as the lines around them."
        : isPdf
          ? "Download tailored .pdf keeps your original PDF pages: unchanged lines are untouched, and each edited line is redrawn in the same position and size with the closest standard font. Added lines can’t fit a fixed PDF layout, so use DOCX or TXT if you add lines."
          : "This saved resume is used as the source text; exports are provided as DOCX and TXT files.") +
      '</div><div class="resume-actions" style="margin-top:11px">' +
      '<button class="btn btn-sm" onclick="downloadTailoredPdf(decodeURIComponent(\'' +
      encodeURIComponent(sourceId || "") +
      "'))\">Download tailored .pdf</button>" +
      '<button class="btn btn-sm" onclick="downloadTailoredDocx(decodeURIComponent(\'' +
      encodeURIComponent(sourceId || "") +
      "'))\">Download tailored .docx</button>" +
      '<button class="btn btn-sm" onclick="downloadTailoredTxt(decodeURIComponent(\'' +
      encodeURIComponent(sourceId || "") +
      "'))\">Download .txt</button>" +
      (sourceType === "docx"
        ? '<button class="btn btn-sm" onclick="downloadRebuiltDocx(decodeURIComponent(\'' +
          encodeURIComponent(sourceId || "") +
          "'))\">Download rebuilt .docx</button>"
        : "") +
      '<button class="btn btn-primary btn-sm" onclick="saveTailoredResume(decodeURIComponent(\'' +
      encodeURIComponent(job.id) +
      "'))\">Save tailored version for this job</button></div></div>";
    renderTailoringSuggestions();
    document.getElementById("apply-all-tailor").onclick =
      window.applyAllTailorSuggestions;
    document.getElementById("edit-tailored-resume").onclick = () => {
      let editor = document.getElementById("tailored-body");
      editor.focus({ preventScroll: true });
      editor.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("edit-tailored-resume").textContent =
        "Editing draft";
    };
    document.getElementById("tailored-body").oninput = () =>
      updateTailoredPreview(job, original);
    updateTailoredPreview(job, original);
  });
};
