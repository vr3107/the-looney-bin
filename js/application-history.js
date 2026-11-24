function ensureTrackedJob(job) {
  let saved = data.jobs.find(
    (x) => x.id === job.id,
  ) || (job.url && trackedPosting(job.url));
  if (saved) return saved;
  let copy = {
    ...job,
    id: resumeId(),
    added: Date.now(),
    status: "Saved",
    resumeId:
      job.resumeId ||
      (window.activeResume && window.activeResume()?.id) ||
      data.activeResumeId,
  };
  delete copy.match;
  delete copy.matchTerms;
  delete copy.distance; // miles from a place search's centre: never stored with the job
  data.jobs.push(copy);
  return copy;
}
function snapshotResume(r) {
  return r
    ? {
        id: r.id,
        name: resumeDisplayName(r),
        fileName:
          r.originalType === "docx" || r.originalType === "pdf"
            ? r.originalFileName || "Resume." + r.originalType
            : "Resume record",
        fileType: r.originalType === "pdf" ? "pdf" : "docx",
        text: r.text || "",
        createdAt: r.createdAt || null,
      }
    : null;
}
function compareSnapshot(before, after) {
  let d = diffLines(before, after);
  return { added: d.added, removed: d.removed, unchanged: d.unchanged.length };
}
function resumeSnapshotHtml(before, after) {
  let d = diffLines(before, after);
  return (
    '<div class="resume-compare"><section class="resume-side"><h4>Previous</h4><pre>' +
    (before || "")
      .split(/\r?\n/)
      .map(
        (x, i) =>
          '<span class="' +
          (d.removedAt.has(i) ? "diff-removed" : "diff-kept") +
          '">' +
          (esc(x) || " ") +
          "</span>",
      )
      .join("\n") +
    '</pre></section><section class="resume-side"><h4>Updated / applied</h4><pre>' +
    (after || "")
      .split(/\r?\n/)
      .map(
        (x, i) =>
          '<span class="' +
          (d.addedAt.has(i) ? "diff-added" : "diff-kept") +
          '">' +
          (esc(x) || " ") +
          "</span>",
      )
      .join("\n") +
    "</pre></section></div>"
  );
}
function resumesForJob(job) {
  let versionIds = new Set(
      (job.resumeHistory || []).map((v) => v.updatedResumeId).filter(Boolean),
    ),
    currentIds = new Set(
      [job.tailoredResumeId, job.resumeId, job.appliedResumeId].filter(Boolean),
    );
  return data.resumes.filter(
    (r) =>
      (!r.baseResumeId && !r.jobId) ||
      (currentIds.has(r.id) && (r.jobId === job.id || versionIds.has(r.id))),
  );
}
function jobResumePanel(job) {
  let optionsForJob = resumesForJob(job),
    candidate =
      job.appliedResumeId ||
      job.resumeId ||
      jobResume(job)?.id ||
      data.activeResumeId,
    selected = optionsForJob.some((r) => r.id === candidate)
      ? candidate
      : optionsForJob.find((r) => r.id === job.resumeId)?.id ||
        optionsForJob.find((r) => r.id === data.activeResumeId)?.id ||
        optionsForJob[0]?.id ||
        "",
    selectedRecord = data.resumes.find((r) => r.id === selected),
    sourceRecord = selectedRecord
      ? data.resumes.find(
          (r) => r.id === (selectedRecord.baseResumeId || selectedRecord.id),
        )
      : null,
    sourceDownload =
      (sourceRecord?.originalType === "docx" || sourceRecord?.originalType === "pdf") && sourceRecord?.originalFileName
        ? '<button class="btn btn-sm" onclick="downloadOriginalResume(decodeURIComponent(\'' +
          encodeURIComponent(sourceRecord.id) +
          "'))\">Download original ." + sourceRecord.originalType + "</button>"
        : "",
    options = optionsForJob.length
      ? optionsForJob
          .map((r) => {
            let label =
              r.baseResumeId || r.jobId
                ? "Tailored for this job · " + resumeDisplayName(r)
                : "Source resume · " + resumeDisplayName(r);
            return (
              '<option value="' +
              esc(r.id) +
              '" ' +
              (r.id === selected ? "selected" : "") +
              ">" +
              esc(label) +
              "</option>"
            );
          })
          .join("")
      : '<option value="">No resume is saved</option>',
    apps = job.applicationHistory || [],
    versions = job.resumeHistory || [];
  return (
    '<div class="job-resume-record"><h3>Resume used for this application</h3><p class="help">' +
    (job.appliedResumeName
      ? "Last recorded: " +
        esc(resumeDisplayName({ name: job.appliedResumeName })) +
        " · " +
        (job.appliedAt ? new Date(job.appliedAt).toLocaleString() : "")
      : "Choose a source resume or a tailored version made for this job.") +
    ' Tailored versions from other jobs are kept with their own job records.</p><div class="resume-actions"><select id="application-resume-' +
    esc(job.id) +
    '" style="border:1px solid var(--line);border-radius:8px;padding:8px;min-width:210px">' +
    options +
    "</select>" +
    sourceDownload +
    '<button class="btn btn-primary btn-sm" onclick="recordAppliedResume(decodeURIComponent(\'' +
    encodeURIComponent(job.id) +
    '\'))">Mark applied with this resume</button></div><div class="resume-history">' +
    (versions.length
      ? "<div><b>Tailored versions for this job</b>" +
        versions
          .slice()
          .reverse()
          .map(
            (v) =>
              '<details class="resume-history-item"><summary>' +
              esc(v.updatedResumeName || "Tailored resume") +
              " · " +
              new Date(v.savedAt).toLocaleString() +
              "</summary><p>" +
              Number(v.changes?.added?.length || 0) +
              " added · " +
              Number(v.changes?.removed?.length || 0) +
              " removed · " +
              Number(v.changes?.unchanged || 0) +
              " unchanged lines</p>" +
              resumeSnapshotHtml(
                v.previousResumeSnapshot || "",
                v.updatedResumeSnapshot || "",
              ) +
              "</details>",
          )
          .join("") +
        "</div>"
      : "") +
    (apps.length
      ? "<div><b>Application history</b>" +
        apps
          .slice()
          .reverse()
          .map(
            (a) =>
              '<details class="resume-history-item"><summary>Applied ' +
              new Date(a.appliedAt).toLocaleString() +
              " using " +
              esc(resumeDisplayName(a.appliedResume) || "Resume") +
              "</summary><p>Source file: " +
              esc(
                resumeDisplayName({
                  name:
                    a.originalResume?.fileName ||
                    a.originalResume?.name ||
                    "Resume record",
                }),
              ) +
              "</p>" +
              resumeSnapshotHtml(
                a.originalResume?.text || a.previousResume?.text || "",
                a.appliedResume?.text || "",
              ) +
              "</details>",
          )
          .join("") +
        "</div>"
      : "") +
    "</div></div>"
  );
}
window.recordAppliedResume = function (id) {
  let found =
    data.jobs.find((x) => x.id === id) ||
    (liveListings || []).find((x) => x.id === id);
  if (!found) {
    toast("This job posting is no longer available.");
    return;
  }
  let select = document.getElementById("application-resume-" + id),
    resume = data.resumes.find(
      (r) => r.id === (select?.value || found.resumeId || data.activeResumeId),
    );
  if (!resume) {
    toast("Add or select a resume before recording the application.");
    return;
  }
  let job = ensureTrackedJob(found),
    base =
      data.resumes.find((r) => r.id === (resume.baseResumeId || resume.id)) ||
      resume,
    now = Date.now(),
    record = {
      appliedAt: now,
      appliedResume: snapshotResume(resume),
      originalResume: snapshotResume(base),
      previousResume: snapshotResume(jobResume(job)),
      jobTitle: job.title,
      company: job.company,
    };
  job.status = "Applied";
  job.appliedAt = now;
  job.appliedResumeId = resume.id;
  job.appliedResumeName = resumeDisplayName(resume);
  job.originalResumeId = base.id;
  job.appliedResumeSnapshot = resume.text || "";
  job.originalResumeSnapshot = base.text || "";
  job.applicationHistory = job.applicationHistory || [];
  job.applicationHistory.push(record);
  persist();
  toast("Application recorded with " + resume.name + ".");
  window.openDetails(job.id);
};
window.saveTailoredResume = function (jobId) {
  let found =
      data.jobs.find((x) => x.id === jobId) ||
      (liveListings || []).find((x) => x.id === jobId),
    summary = document.getElementById("tailored-summary")?.value,
    body = document.getElementById("tailored-body")?.value;
  if (!found || summary === undefined || body === undefined) return;
  let job = ensureTrackedJob(found),
    source = jobResume(job) || activeResume(),
    base =
      data.resumes.find((x) => x.id === (source?.baseResumeId || source?.id)) ||
      source,
    previousText = source?.text || "",
    text = composedResume(summary, body),
    role = job.title || "Target role",
    r = {
      id: resumeId(),
      name: role + " — tailored",
      text: text,
      targetRoles: role,
      createdAt: Date.now(),
      basedOn: source?.id || data.activeResumeId,
      baseResumeId: base?.id || null,
      tailoredSummary: summary,
      tailoredBody: body,
      confirmedKeywords: [...(window.confirmedResumeKeywords || [])],
      jobId: job.id,
    };
  data.resumes.push(r);
  let changes = compareSnapshot(previousText, text);
  job.resumeHistory = job.resumeHistory || [];
  job.resumeHistory.push({
    savedAt: Date.now(),
    updatedResumeId: r.id,
    updatedResumeName: r.name,
    previousResumeName: source?.name || "Resume",
    previousResumeSnapshot: previousText,
    updatedResumeSnapshot: text,
    originalResumeSnapshot: base?.text || previousText,
    changes: changes,
  });
  job.resumeId = r.id;
  job.tailoredResumeId = r.id;
  job.tailoredResumeName = r.name;
  job.targetRoles = role;
  persist();
  toast(
    "Tailored version saved with the job; previous and original versions remain in its history.",
  );
  window.openDetails(job.id);
};
const priorTrackerRender = window.renderTracker;
window.renderTracker = function () {
  priorTrackerRender();
  let table = document.querySelector("#trackerwrap table.tracker");
  if (!table) return;
  let head = table.querySelector("thead tr"),
    rows = table.querySelectorAll("tbody tr");
  if (!head || head.querySelector("[data-resume-used]")) return;
  let th = document.createElement("th");
  th.dataset.resumeUsed = "true";
  th.textContent = "Resume used";
  head.insertBefore(th, head.lastElementChild);
  let f = document.getElementById("statusfilter")?.value || "all",
    arr = [...data.jobs]
      .filter((x) => f === "all" || x.status === f)
      .sort((a, b) => b.added - a.added);
  arr.forEach((job, i) => {
    let row = rows[i];
    if (!row) return;
    let td = document.createElement("td");
    td.textContent = job.appliedResumeName
      ? resumeDisplayName({ name: job.appliedResumeName })
      : "—";
    td.title = job.appliedResumeName
      ? "Applied using " + resumeDisplayName({ name: job.appliedResumeName })
      : "";
    row.insertBefore(td, row.lastElementChild);
  });
};
(() => {
  let prior = window.openDetails;
  window.openDetails = function (id) {
    let job =
      data.jobs.find((x) => x.id === id) ||
      (liveListings || []).find((x) => x.id === id);
    if (!job) {
      prior(id);
      return;
    }
    openWithJobResume(job, () => prior(id));
    let actions = document.querySelector("#modalroot .modalactions");
    if (actions) {
      let area = document.createElement("div");
      area.id = "tailor-area";
      let button = document.createElement("button");
      button.className = "btn btn-primary";
      button.textContent = "Update resume for this job";
      button.onclick = () => window.tailorResume(id);
      actions.parentElement.insertBefore(area, actions);
      actions.parentElement.insertBefore(
        document.createRange().createContextualFragment(jobResumePanel(job)),
        actions,
      );
      actions.prepend(button);
    }
  };
})();
ensureResumeLibrary();
window.fillProfile();
renderJobs();
renderTracker();
