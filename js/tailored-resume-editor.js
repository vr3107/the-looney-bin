// Keep every tailored version with its own role, and make the selected version editable.
window.resumesForJob = function (job) {
  let versionIds = new Set(
    (job.resumeHistory || []).map((v) => v.updatedResumeId).filter(Boolean),
  );
  return data.resumes.filter(
    (r) =>
      (!r.baseResumeId && !r.jobId) ||
      r.jobId === job.id ||
      versionIds.has(r.id),
  );
};
window.editSelectedJobResume = function (jobId) {
  let select = document.getElementById("application-resume-" + jobId);
  if (!select || !select.value) {
    toast("Select a saved resume first.");
    return;
  }
  if (typeof window.tailorResume !== "function") {
    toast(
      "The resume editor could not be opened. Reload Jobloom and try again.",
    );
    return;
  }
  window.tailorResume(jobId, select.value);
  document
    .getElementById("tailor-area")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};
const jobloomBaseTailorResume = window.tailorResume;
window.tailorResume = function (jobId, sourceResumeId) {
  let job =
    data.jobs.find((x) => x.id === jobId) ||
    (liveListings || []).find((x) => x.id === jobId);
  if (!job) {
    toast("This job posting is no longer available.");
    return;
  }
  let originalId = job.resumeId,
    selected = sourceResumeId
      ? data.resumes.find((r) => r.id === sourceResumeId)
      : null;
  if (sourceResumeId && !selected) {
    toast("That resume version is no longer available.");
    return;
  }
  let source = selected || jobResume(job) || activeResume();
  window.tailorSourceResumeId = source?.id || data.activeResumeId || null;
  if (selected) job.resumeId = selected.id;
  try {
    return jobloomBaseTailorResume(jobId);
  } finally {
    if (selected && job.resumeId === selected.id) job.resumeId = originalId;
  }
};
const jobloomBaseSaveTailoredResume = window.saveTailoredResume;
window.saveTailoredResume = function (jobId) {
  let job =
      data.jobs.find((x) => x.id === jobId) ||
      (liveListings || []).find((x) => x.id === jobId),
    priorId = job?.resumeId,
    sourceId = window.tailorSourceResumeId;
  if (job && sourceId) job.resumeId = sourceId;
  try {
    return jobloomBaseSaveTailoredResume(jobId);
  } finally {
    if (job && job.resumeId === sourceId) job.resumeId = priorId;
    window.tailorSourceResumeId = null;
  }
};
window.makeDraft = function (id) {
  let job =
      data.jobs.find((x) => x.id === id) ||
      (liveListings || []).find((x) => x.id === id),
    area = document.querySelector("#modalroot #draftarea");
  if (!job) {
    toast("Save this role before preparing a cover letter.");
    return;
  }
  if (!area) {
    toast("Open the role details first, then choose Draft cover letter.");
    return;
  }
  let profile = data.profile || {},
    select = document.getElementById("application-resume-" + id),
    resume = select?.value
      ? data.resumes.find((r) => r.id === select.value)
      : null;
  resume = resume || (typeof jobResume === "function" ? jobResume(job) : null);
  let resumeText = resume?.text || profile.resume || "",
    description = String(job.description || ""),
    stop = new Set(
      "about above after again all also and any are as at be been but by can could did do does down each for from had has have he her here his how into is it its just more most my no not of on or our out over she so such than that the their them then there these they this those through to too under up us was we were what when where which who will with you your year years job role team company work position required preferred experience looking candidate strong".split(
        /\s+/,
      ),
    ),
    terms = [
      ...new Set(
        (
          description.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []
        ).filter((w) => !stop.has(w)),
      ),
    ],
    sentences = resumeText
      .replace(/\r/g, "")
      .split(/\n+/)
      .flatMap((line) => line.match(/[^.!?]+[.!?]*/g) || [])
      .map((x) => x.trim())
      .filter((x) => x.length > 35),
    relevant = sentences
      .map((s) => ({
        s,
        n: terms.filter((w) => s.toLowerCase().includes(w)).length,
      }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((x) => x.s),
    parts = [
      `Dear ${job.company || "Hiring"} hiring team,`,
      `I’m applying for the ${job.title || "open"} position${job.company ? " at " + job.company : ""}.`,
    ];
  if (relevant.length)
    parts.push(`My relevant experience includes: ${relevant.join(" ")}`);
  else if (profile.role)
    parts.push(
      `My background is focused on ${profile.role}. Please see my resume for the experience and skills most relevant to this position.`,
    );
  if (profile.details)
    parts.push(`Additional application details: ${profile.details}`);
  parts.push(
    `I would welcome the opportunity to discuss how my experience can contribute to your team.`,
    `Thank you for your consideration,`,
    profile.name || "[Your name]",
  );
  area.innerHTML =
    '<div class="tailor-box cover-letter-editor"><div class="resume-side-head"><h3>Editable cover letter draft</h3><span class="tag">For ' +
    esc(job.title || "this role") +
    '</span></div><p class="help">This is a cover letter, not a resume. It uses your selected resume and profile details. Review every statement before sending.</p><div class="field"><label>Draft text · edit before using</label><textarea id="drafttext" aria-label="Edit cover letter draft" style="min-height:230px">' +
    esc(parts.join("\n\n")) +
    '</textarea></div><div class="resume-actions"><button class="btn btn-sm" onclick="copyDraft()">Copy letter</button><button class="btn btn-primary btn-sm" onclick="saveCoverLetterDraft(decodeURIComponent(\'' +
    encodeURIComponent(job.id) +
    "'))\">Save draft to this job</button></div></div>";
};
window.saveCoverLetterDraft = function (id) {
  let job = data.jobs.find((x) => x.id === id);
  if (!job) {
    toast("Save this role before saving its cover letter.");
    return;
  }
  let editor = document.getElementById("drafttext");
  if (!editor) {
    toast("Prepare the cover letter draft before saving.");
    return;
  }
  job.coverLetterDraft = editor.value;
  job.coverLetterSavedAt = Date.now();
  persist();
  toast("Cover letter draft saved with this job.");
};
window.copyDraft = function () {
  let editor = document.getElementById("drafttext");
  if (!editor) return;
  editor.focus();
  editor.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {}
  if (copied) {
    toast("Cover letter copied.");
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(editor.value)
      .then(() => toast("Cover letter copied."))
      .catch(() => toast("Select the draft text and copy it."));
  } else toast("Select the draft text and copy it.");
};
const jobloomOpenDetailsWithResumePanel = window.openDetails;
window.openDetails = function (id) {
  jobloomOpenDetailsWithResumePanel(id);
  let root = document.getElementById("modalroot"),
    draftButton = [...root.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Prepare draft",
    );
  if (draftButton) {
    draftButton.textContent = "Draft cover letter";
    draftButton.title = "Create an editable cover letter for this job";
  }
  let record = root.querySelector(".job-resume-record .resume-actions"),
    job = data.jobs.find((x) => x.id === id);
  if (record && job && !record.querySelector("[data-edit-selected-resume]")) {
    let select = record.querySelector("select");
    if (select) {
      let button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-sm";
      button.dataset.editSelectedResume = "true";
      button.textContent = "Edit selected resume";
      button.title =
        "Open the selected source or job-specific tailored resume in the editor";
      button.onclick = () => window.editSelectedJobResume(id);
      select.insertAdjacentElement("afterend", button);
    }
  }
};
