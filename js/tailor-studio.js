// Tailoring page: one full-screen view with the ATS score before/after,
// the job's skills, one Tailor button, the change list, the resume editor,
// and download/save/cover-letter actions. Builds on the existing editor state
// (window.tailorOriginalText, #tailored-body, renderTailoringSuggestions).
const TS_PARTS = [
  ["skills", "Required skills"],
  ["keywords", "Job keywords"],
  ["title", "Job title"],
  ["experience", "Years of experience"],
  ["education", "Education"],
  ["format", "ATS-friendly format"],
];
function tsState() {
  return window.tailorStudio || null;
}
// The tailored resume always aims for 90–100%: the chosen target (90% or 95%),
// and never below the original resume's own score.
const TS_TARGETS = [90, 95];
const TS_MAX_ROUNDS = 3;
// How suggestions are applied after tailoring: all at once, or one by one by the user.
function tsApplyMode() {
  return window.aiTailorApplyMode === "review" ? "review" : "auto";
}
function tsChosenTarget() {
  let v = Number(window.aiTailorTarget);
  return TS_TARGETS.includes(v) ? v : 90;
}
function tsTarget(st) {
  let before = atsBreakdown(st.job, st.original)?.score ?? 0;
  return Math.min(100, Math.max(tsChosenTarget(), before));
}
function tsDraft() {
  return composedResume(document.getElementById("tailored-summary")?.value || "", document.getElementById("tailored-body")?.value || "");
}
function tsPct(x) {
  return x === null || x === undefined ? "—" : Math.round(100 * x) + "%";
}
function tsTips(b) {
  if (!b) return [];
  let tips = [],
    p = b.parts,
    confirmed = new Set(window.aiConfirmedKeywords || []);
  let unconfirmed = p.skills.missing.filter((t) => !confirmed.has(t));
  if (unconfirmed.length) tips.push(`Required skills not in your resume: <b>${unconfirmed.slice(0, 6).map((t) => esc(skillLabel(t))).join(", ")}</b>. Select the ones you have under “Skills this job wants” (or <b>Add all</b>), then press <b>Update resume with selected skills</b>.`);
  if (p.title.pct < 1) tips.push(`Use the job title <b>${esc(coreJobTitle(p.title.title) || p.title.title)}</b> in your headline or summary.`);
  if (p.keywords.pct !== null && p.keywords.pct < 0.8 && p.keywords.missing.length) tips.push(`Job keywords to work in where they’re true for you: ${p.keywords.missing.slice(0, 6).map((w) => `<b>${esc(w)}</b>`).join(", ")}.`);
  if (p.experience.need && p.experience.pct < 1) tips.push(`The job asks for ${p.experience.need}+ years; your resume shows about ${p.experience.have}. Make sure every role has its date range.`);
  if (p.education.pct < 1) tips.push("The job lists a degree requirement your resume doesn’t clearly show — check your Education section.");
  if (p.format.missing.length) tips.push(`ATS format: add ${p.format.missing.map(esc).join(", ")}.`);
  return tips;
}
function tsRefresh() {
  let st = tsState();
  if (!st || !document.getElementById("tailor-studio")) return;
  let draft = tsDraft(),
    before = atsBreakdown(st.job, st.original),
    after = atsBreakdown(st.job, draft),
    $ = (id) => document.getElementById(id);
  $("ts-old").textContent = before ? before.score + "%" : "—";
  $("ts-new").textContent = after ? after.score + "%" : "—";
  let delta = before && after ? after.score - before.score : 0,
    newCard = $("ts-new-card");
  let target = tsTarget(st);
  newCard.classList.toggle("good", !!after && after.score >= target);
  newCard.classList.toggle("below", !!after && draft !== st.original && after.score < target);
  $("ts-new-note").textContent =
    (delta > 0 ? `+${delta} points · ` : delta < 0 ? `${delta} points · ` : draft === st.original ? "" : "No change · ") + `Target ${target}%+`;
  $("ts-bars").innerHTML = TS_PARTS.map(([k, label]) => {
    let a = before?.parts[k].pct,
      z = after?.parts[k].pct,
      w = after?.weights[k] || 0;
    if (!w) return "";
    return `<div class="ts-bar-row"><span>${label}</span><div class="ts-bar"><i class="was" style="width:${Math.round(100 * (a || 0))}%"></i><i class="now" style="width:${Math.round(100 * (z || 0))}%"></i></div><b>${tsPct(a)} → ${tsPct(z)}</b></div>`;
  }).join("");
  let tips = after && after.score < target ? tsTips(after) : [];
  $("ts-tips").innerHTML = after && after.score >= target ? `<div class="ts-tip-good">✓ Tailored resume ATS score: ${after.score}% — strong ATS match for this job.</div>` : tips.length ? `<b>To reach ${target}%+</b><ul>${tips.map((t) => `<li>${t}</li>`).join("")}</ul>` : "";
  let count = (window.tailorSuggestions || []).length,
    applied = (window.tailorSuggestions || []).filter((s) => s.accepted).length;
  let all = window.tailorSuggestions || [],
    pending = all.filter((s) => !s.accepted && !s.skipped && !s.needsReview && !s.lowersScore).length,
    held = all.filter((s) => !s.accepted && (s.needsReview || s.lowersScore)).length;
  $("ts-change-count").textContent = count ? `${applied} of ${count} applied` : "";
  $("ts-apply-all").hidden = !pending;
  $("ts-apply-all").textContent = pending ? `Apply all (${pending})` : "Apply all";
  $("ts-undo-all").hidden = !applied;
  $("ts-bulk-note").hidden = !held;
  $("ts-bulk-note").textContent = held ? `${held} flagged change${held === 1 ? " isn’t" : "s aren’t"} included in Apply all — review ${held === 1 ? "it" : "them"} one by one below and press Apply if ${held === 1 ? "it’s" : "they’re"} true for you.` : "";
  if (typeof paintResumeDiff === "function") paintResumeDiff(st.original, draft);
}
// Estimated ATS score of the current draft if these skills were added to it.
function tsEstimateWith(st, terms) {
  let draft = tsDraft();
  return atsBreakdown(st.job, terms.length ? draft + "\n" + terms.map(skillLabel).join(", ") : draft)?.score ?? null;
}
function tsChips(st) {
  let profile = atsJobProfile(st.job),
    tok = atsTokStr(st.original),
    confirmed = new Set(window.aiConfirmedKeywords || []),
    have = profile.skills.filter((s) => atsHas(tok, s.term)),
    miss = profile.skills.filter((s) => !atsHas(tok, s.term));
  if (!profile.skills.length) return '<p class="ts-help">No specific skills were detected in this job description.</p>';
  let picked = miss.filter((s) => confirmed.has(s.term)),
    all = tsEstimateWith(st, miss.map((s) => s.term)),
    now = tsEstimateWith(st, picked.map((s) => s.term)),
    haveHtml = have.length ? `<div class="ts-skill-label">Already in your resume</div><div class="ts-chips">${have.map((s) => `<span class="ai-chip have">✓ ${esc(skillLabel(s.term))}</span>`).join("")}</div>` : "";
  if (!miss.length) return haveHtml + '<p class="ts-help">Your resume already covers every skill listed in this job.</p>';
  return `${haveHtml}
<div class="ts-skill-head"><div class="ts-skill-label">Missing from your resume · <b>${picked.length} of ${miss.length} selected</b></div>
<div class="ts-skill-actions"><button type="button" class="btn btn-sm" data-ts-all="add">Add all</button><button type="button" class="btn btn-sm" data-ts-all="clear" ${picked.length ? "" : "disabled"}>Clear</button></div></div>
<div class="ts-chips">${miss
    .map((s) => {
      let on = confirmed.has(s.term);
      return `<button type="button" class="ai-chip miss${on ? " on" : ""}" data-ts-kw="${esc(s.term)}" aria-pressed="${on}">${on ? "✓" : "+"} ${esc(skillLabel(s.term))}${s.weight >= 2 ? '<small class="ts-req">required</small>' : ""}</button>`;
    })
    .join("")}</div>
<p class="ts-help">Select only the skills you have real experience with, or <b>Add all</b> if you have them all. Selected skills are added to your Skills section and worked into your summary and bullets where your experience fits. Unselected skills are never added.</p>
${all !== null ? `<p class="ts-estimate">ATS score with ${picked.length ? "your selected skills" : "none selected"}: <b>about ${now}%</b>${picked.length < miss.length ? ` · with all of them: about ${all}%` : ""}</p>` : ""}
${st.ran && st.ranWith !== [...confirmed].sort().join("|") ? '<button type="button" class="btn btn-primary btn-sm ts-retailor" data-ts-retailor>✦ Update resume with selected skills</button>' : ""}`;
}
async function tsTailor() {
  let st = tsState(),
    $ = (id) => document.getElementById(id),
    editor = $("tailored-body"),
    status = $("ts-status"),
    btn = $("ts-go");
  if (!st || !editor) return;
  if (!String(st.job.description || "").trim()) {
    status.textContent = "This job has no description to tailor against.";
    return;
  }
  let useAI = data.aiConsent === true,
    lines = st.original.split("\n"),
    confirmed = window.aiConfirmedKeywords || [];
  editor.value = st.original;
  window.tailorSuggestions = [];
  btn.disabled = true;
  btn.textContent = useAI ? "Tailoring with AI…" : "Applying ATS fixes…";
  status.textContent = useAI ? "Rewriting your whole resume for this job. Each round can take 30 seconds to 2 minutes." : "";
  let suggestions = [],
    rejected = 0,
    note = "",
    rounds = 0,
    target = tsTarget(st),
    before = atsBreakdown(st.job, st.original)?.score ?? 0,
    userDirection = $("ts-direction").value.trim(),
    opts = {
      target,
      // The PDF download is rebuilt from the text, so edits aren't tied to fixed PDF line slots.
      format: st.format === "pdf" ? "docx" : st.format,
      notes: $("ts-facts").value.trim(),
      confirmed,
      intensity: document.querySelector('[name="ts-intensity"]:checked')?.value || "balanced",
    },
    draftScore = () => atsBreakdown(st.job, appliedDraftLines(lines, suggestions).join("\n"))?.score ?? 0,
    settle = () => {
      suggestions = atsBoostSuggestions(st.job, lines, suggestions, confirmed, st.format === "pdf" ? "docx" : st.format);
      protectAtsScore(st.job, lines, suggestions);
    };
  try {
    if (useAI) {
      let r = await aiTailorRun(st.job, st.original, { ...opts, direction: userDirection });
      rounds = 1;
      suggestions = r.suggestions;
      rejected = r.rejected;
      st.overview = r.overview;
      settle();
      // Keep tailoring the current draft until it reaches the target score.
      while (rounds < TS_MAX_ROUNDS && draftScore() < target) {
        let draft = appliedDraftLines(lines, suggestions).join("\n"),
          gap = atsGapDirection(st.job, draft, confirmed);
        status.textContent = `Round ${rounds + 1}: ATS score is ${draftScore()}% — tailoring again to reach ${target}%+…`;
        let more;
        try {
          more = await aiTailorRun(st.job, draft, { ...opts, intensity: "full", direction: (gap + (userDirection ? " Candidate direction: " + userDirection : "")).slice(0, 1200) });
        } catch (e) {
          note = e.message + " ";
          break;
        }
        rounds++;
        rejected += more.rejected;
        let prev = draftScore();
        suggestions = mergeRoundSuggestions(lines, suggestions, more.suggestions);
        settle();
        if (draftScore() <= prev) break; // No further progress is possible from this resume.
      }
    }
  } catch (e) {
    note = e.message + " ";
  }
  if (!rounds) settle();
  window.tailorSuggestions = suggestions;
  st.ran = true;
  st.ranWith = [...confirmed].sort().join("|");
  document.getElementById("ts-skillbox").innerHTML = tsChips(st);
  renderTailoringSuggestions();
  let reviewMode = tsApplyMode() === "review";
  if (!reviewMode) window.applyAllTailorSuggestions(true);
  tsRefresh();
  let after = atsBreakdown(st.job, tsDraft())?.score,
    ready = suggestions.filter((s) => !s.needsReview && !s.lowersScore).length,
    potential = atsBreakdown(st.job, appliedDraftLines(lines, suggestions).join("\n"))?.score,
    applied = suggestions.filter((s) => s.accepted).length,
    flagged = suggestions.filter((s) => s.needsReview && !s.accepted).length,
    lowering = suggestions.filter((s) => s.lowersScore && !s.accepted).length;
  status.innerHTML =
    (note ? `<span class="ts-warn">${esc(note)}${rounds ? "" : "Applied quick ATS fixes instead."}</span> ` : "") +
    (reviewMode
      ? `<span class="ts-final">${ready} suggestion${ready === 1 ? "" : "s"} ready — ATS score <b>${potential ?? "—"}%</b> if you apply all (now ${before}%) · ${potential >= target ? `✓ reaches the ${target}%+ target` : `below the ${target}% target`}</span> Review them below and press <b>Apply</b> on each one, or <b>Apply all</b>.`
      : `<span class="ts-final">Tailored resume ATS score: <b>${after ?? "—"}%</b> (was ${before}%) · ${after >= target ? `✓ reached the ${target}%+ target` : `below the ${target}% target`}</span> ` +
        (applied ? `Applied ${applied} change${applied === 1 ? "" : "s"}${rounds > 1 ? ` over ${rounds} tailoring rounds` : ""}. Undo any of them below, or <b>Undo all</b>.` : "No changes were needed or possible from your resume as written.")) +
    ((reviewMode ? potential : after) < target ? " The rest of the gap needs skills or experience your resume doesn’t show yet — see below." : "") +
    (flagged ? ` ${flagged} flagged change${flagged === 1 ? " needs" : "s need"} your review below.` : "") +
    (lowering ? ` ${lowering} change${lowering === 1 ? " was" : "s were"} left out because ${lowering === 1 ? "it" : "they"} would lower the score.` : "") +
    (rejected ? ` ${rejected} AI edit${rejected === 1 ? " was" : "s were"} discarded for changing protected details or adding numbers not in your resume.` : "") +
    (st.overview ? `<span class="ts-overview">${esc(st.overview)}</span>` : "");
  btn.disabled = false;
  tsSetGoLabel();
}
function tsSetGoLabel() {
  let btn = document.getElementById("ts-go");
  if (btn) btn.textContent = data.aiConsent === true ? "✦ Tailor my resume" : "Apply quick ATS fixes (no AI)";
}
function tsClose() {
  document.getElementById("tailor-studio")?.remove();
  document.body.classList.remove("ts-open");
  window.tailorStudio = null;
}
function tsOpen(jobId) {
  let job = data.jobs.find((x) => x.id === jobId) || (liveListings || []).find((x) => x.id === jobId);
  let editor = document.getElementById("tailored-body");
  if (!job || !editor) return;
  tsClose();
  let srcId = window.tailorSourceResumeId || job.resumeId || data.activeResumeId,
    r = data.resumes.find((x) => x.id === srcId) || (typeof jobResume === "function" ? jobResume(job) : null),
    base = r?.baseResumeId ? data.resumes.find((x) => x.id === r.baseResumeId) || r : r,
    st = {
      jobId,
      job,
      original: window.tailorOriginalText || editor.value,
      baseId: base?.id || "",
      format: base?.originalType === "pdf" ? "pdf" : base?.originalType === "docx" ? "docx" : "text",
      resumeName: typeof resumeDisplayName === "function" && r ? resumeDisplayName(r) : r?.name || "Resume",
    };
  // A PDF is read as visual lines: join wrapped lines back into whole bullets and paragraphs,
  // so the AI rewrites complete bullets and nothing is duplicated or left as a fragment.
  if (st.format === "pdf" && typeof joinWrappedLines === "function") {
    st.original = joinWrappedLines(st.original);
    window.tailorOriginalText = st.original;
  }
  window.tailorStudio = st;
  window.tailorSuggestions = [];
  document.querySelector("#tailor-area")?.classList.add("ts-legacy");
  let id = encodeURIComponent(st.baseId),
    dl = (fn, label) => `<button class="btn btn-sm" onclick="${fn}(decodeURIComponent('${id}'))">${label}</button>`,
    downloads =
      st.format === "pdf"
        ? dl("downloadTailoredPdf", "Download .pdf") + dl("downloadTailoredDocx", ".docx") + dl("downloadTailoredTxt", ".txt")
        : dl("downloadTailoredDocx", "Download .docx") + dl("downloadTailoredPdf", ".pdf") + dl("downloadTailoredTxt", ".txt"),
    consented = data.aiConsent === true;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="tailor-studio" class="ts-overlay" role="dialog" aria-modal="true" aria-labelledby="ts-title">
<div class="ts-shell">
  <header class="ts-head">
    <button class="btn btn-sm" id="ts-back">← Back to job</button>
    <div class="ts-headtext"><div class="eyebrow">TAILOR RESUME</div><h2 id="ts-title">${esc(job.title || "This job")}</h2><span>${esc(job.company || "")}${job.company ? " · " : ""}from ${esc(st.resumeName)}</span></div>
  </header>
  <section class="ts-scores">
    <div class="ts-score"><span>Before</span><b id="ts-old">—</b><small>Original resume</small></div>
    <div class="ts-arrow" aria-hidden="true">→</div>
    <div class="ts-score new" id="ts-new-card"><span>After</span><b id="ts-new">—</b><small id="ts-new-note"></small></div>
    <div class="ts-bars" id="ts-bars"></div>
  </section>
  <div class="ts-body">
    <aside class="ts-left">
      <div class="ts-card"><h3>Skills this job wants</h3><div id="ts-skillbox">${tsChips(st)}</div></div>
      <div class="ts-card">
        <h3>Tailor</h3>
        <div class="ts-target-row"><span>Target ATS score</span><div class="ai-seg" role="radiogroup" aria-label="Target ATS score">${TS_TARGETS.map((v) => `<label><input type="radio" name="ts-target" value="${v}" ${tsChosenTarget() === v ? "checked" : ""}><span>${v}%+</span></label>`).join("")}</div></div>
        <div class="ai-seg" role="radiogroup" aria-label="How much to change">${[["light", "Light"], ["balanced", "Balanced"], ["full", "Full rewrite"]].map(([v, l]) => `<label><input type="radio" name="ts-intensity" value="${v}" ${(window.aiTailorIntensity || "balanced") === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
        <div class="ts-target-row"><span>Apply changes</span><div class="ai-seg" role="radiogroup" aria-label="How to apply changes">${[["auto", "All at once"], ["review", "One by one"]].map(([v, l]) => `<label><input type="radio" name="ts-apply-mode" value="${v}" ${tsApplyMode() === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div></div>
        <details class="ai-more"><summary>Add true facts or direction (optional)</summary>
          <textarea id="ts-facts" rows="3" maxlength="4000" placeholder="Facts that are true but missing from your resume, e.g. Built Looker dashboards for sales.">${esc(window.aiTailorNotes || "")}</textarea>
          <textarea id="ts-direction" rows="2" maxlength="1200" placeholder="Direction, e.g. Emphasize LLM and RAG work.">${esc(window.aiTailorDirection || "")}</textarea>
        </details>
        <label class="ai-consent"><input id="ts-consent" type="checkbox" ${consented ? "checked" : ""}><span>Use AI (sends this resume and job to the AI provider — Groq, or Cloudflare Workers AI as backup — to write suggestions; nothing is stored)</span></label>
        <button class="btn btn-primary ts-go" id="ts-go"></button>
        <div id="ts-status" class="ts-status" role="status" aria-live="polite"></div>
        <div id="ts-tips" class="ts-tips"></div>
      </div>
      <div class="ts-card"><div class="ts-card-head"><h3>Changes</h3><span id="ts-change-count" class="ts-help"></span><div class="ts-bulk"><button class="btn btn-primary btn-sm" id="ts-apply-all" hidden>Apply all</button><button class="btn btn-sm" id="ts-undo-all" hidden>Undo all</button></div></div><p id="ts-bulk-note" class="ts-help" hidden></p><div id="ts-changes"></div></div>
    </aside>
    <main class="ts-right">
      <div class="ts-tabs" role="tablist"><button class="on" data-ts-tab="edit">Tailored resume</button><button data-ts-tab="orig">Original</button><button data-ts-tab="diff">Highlight changes</button></div>
      <div class="ts-pane" data-ts-pane="edit"></div>
      <div class="ts-pane" data-ts-pane="orig" hidden><pre class="ts-pre${st.format === "pdf" ? " preserve-layout" : ""}">${esc(st.original)}</pre></div>
      <div class="ts-pane" data-ts-pane="diff" hidden></div>
    </main>
  </div>
  <footer class="ts-foot"><div class="ts-dl">${downloads}</div><div class="ts-actions"><button class="btn btn-sm" id="ts-cover">✦ Cover letter</button><button class="btn btn-primary btn-sm" id="ts-save">Save for this job</button></div></footer>
</div></div>`,
  );
  document.body.classList.add("ts-open");
  let root = document.getElementById("tailor-studio"),
    $ = (sel) => root.querySelector(sel);
  // Reuse the existing editor, change list, and diff view inside the new layout.
  editor.value = st.original;
  editor.classList.add("ts-editor");
  $('[data-ts-pane="edit"]').appendChild(editor);
  let summary = document.getElementById("tailored-summary");
  if (summary) $('[data-ts-pane="edit"]').appendChild(summary);
  let list = document.getElementById("suggestion-list");
  if (list) $("#ts-changes").appendChild(list);
  let diff = document.getElementById("resume-diff-new");
  if (diff) $('[data-ts-pane="diff"]').appendChild(diff);
  renderTailoringSuggestions();
  tsSetGoLabel();
  editor.addEventListener("input", tsRefresh);
  $("#ts-back").onclick = tsClose;
  $("#ts-go").onclick = tsTailor;
  $("#ts-apply-all").onclick = () => {
    window.applyAllTailorSuggestions(true);
    tsRefresh();
  };
  $("#ts-undo-all").onclick = () => {
    let list = window.tailorSuggestions || [];
    [...list.keys()].filter((i) => list[i].accepted).sort((a, b) => list[b].start - list[a].start).forEach((i) => window.resolveTailorSuggestion(i, "undo"));
    tsRefresh();
  };
  root.querySelectorAll('[name="ts-apply-mode"]').forEach((r) => (r.onchange = () => (window.aiTailorApplyMode = r.value)));
  $("#ts-consent").onchange = (e) => {
    data.aiConsent = e.target.checked;
    persist();
    tsSetGoLabel();
  };
  $("#ts-facts").oninput = (e) => (window.aiTailorNotes = e.target.value);
  $("#ts-direction").oninput = (e) => (window.aiTailorDirection = e.target.value);
  root.querySelectorAll('[name="ts-target"]').forEach(
    (r) =>
      (r.onchange = () => {
        window.aiTailorTarget = Number(r.value);
        tsRefresh();
      }),
  );
  root.querySelectorAll('[name="ts-intensity"]').forEach((r) => (r.onchange = () => (window.aiTailorIntensity = r.value)));
  root.querySelector("#ts-skillbox").onclick = (e) => {
    if (e.target.closest("[data-ts-retailor]")) return tsTailor();
    let chip = e.target.closest("[data-ts-kw]"),
      bulk = e.target.closest("[data-ts-all]");
    if (!chip && !bulk) return;
    let set = new Set(window.aiConfirmedKeywords || []);
    if (bulk) {
      let tok = atsTokStr(st.original),
        missing = atsJobProfile(st.job).skills.filter((s) => !atsHas(tok, s.term)).map((s) => s.term);
      missing.forEach((t) => (bulk.dataset.tsAll === "add" ? set.add(t) : set.delete(t)));
    } else {
      let t = chip.dataset.tsKw;
      set.has(t) ? set.delete(t) : set.add(t);
    }
    window.aiConfirmedKeywords = [...set];
    root.querySelector("#ts-skillbox").innerHTML = tsChips(st);
    tsRefresh();
  };
  root.querySelectorAll("[data-ts-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        root.querySelectorAll("[data-ts-tab]").forEach((x) => x.classList.toggle("on", x === b));
        root.querySelectorAll("[data-ts-pane]").forEach((p) => (p.hidden = p.dataset.tsPane !== b.dataset.tsTab));
      }),
  );
  $("#ts-save").onclick = () => {
    window.saveTailoredResume(jobId);
  };
  $("#ts-cover").onclick = () => {
    tsClose();
    window.makeDraft(jobId);
  };
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") tsClose();
  });
  tsRefresh();
  $("#ts-go").focus();
}
// Keep the score in sync whenever a change is applied or undone.
const tsBaseResolve = window.resolveTailorSuggestion;
window.resolveTailorSuggestion = function () {
  let out = tsBaseResolve.apply(this, arguments);
  tsRefresh();
  return out;
};
const tsBaseRender = window.renderTailoringSuggestions;
window.renderTailoringSuggestions = function () {
  let out = tsBaseRender.apply(this, arguments),
    list = document.getElementById("suggestion-list");
  if (tsState() && list && !(window.tailorSuggestions || []).length)
    list.innerHTML = '<p class="ts-help">Press <b>Tailor</b> to rewrite your resume for this job. Each change appears here, and you can undo any of them.</p>';
  return out;
};
const tsBaseTailorResume = window.tailorResume;
window.tailorResume = function (jobId, sourceResumeId) {
  let out = tsBaseTailorResume.apply(this, arguments);
  tsOpen(jobId);
  return out;
};
window.closeTailorStudio = tsClose;
