// The job window's "Resume used for this application" box: upload a resume for this job, and
// download whichever resume is selected (a source resume or a version tailored for this job)
// as .docx, .pdf or .txt.
(function () {
  const opener = window.openDetails;
  window.openDetails = function (id) {
    opener(id);
    const root = document.getElementById("modalroot"),
      actions = root?.querySelector(".job-resume-record .resume-actions"),
      job = data.jobs.find((x) => x.id === id);
    if (!actions || !job || actions.querySelector("[data-job-resume-tools]")) return;
    const key = encodeURIComponent(job.id),
      dl = (fmt, label) => `<button type="button" class="btn btn-sm" onclick="downloadJobResume(decodeURIComponent('${key}'),'${fmt}')">${label}</button>`;
    actions.insertAdjacentHTML(
      "afterend",
      `<div class="resume-actions" data-job-resume-tools style="margin-top:8px">
<label class="btn btn-sm" style="cursor:pointer" title="Add a .docx or .pdf resume and use it for this job">⤒ Upload resume<input type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden data-job-resume-upload></label>
<span class="help" style="margin:0 2px 0 6px">Download selected:</span>${dl("docx", ".docx")}${dl("pdf", ".pdf")}${dl("txt", ".txt")}
</div>`,
    );
    actions.parentElement.querySelector("[data-job-resume-upload]").onchange = async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      if (!files.length) return;
      toast("Reading your resume…");
      const { imported, failures } = await window.importResumeFiles(files.slice(0, 1));
      if (!imported.length) return toast(failures[0] ? `Couldn’t read ${failures[0]}` : "That resume couldn’t be read.");
      // Used for this job; the resume you search with elsewhere stays the same.
      job.resumeId = imported[0].id;
      delete job.appliedResumeId;
      persist();
      window.openDetails(job.id);
      toast(`${imported[0].name} added to your resumes and selected for this job.`);
    };
  };

  window.downloadJobResume = async function (jobId, fmt) {
    const select = document.getElementById(`application-resume-${jobId}`),
      r = data.resumes.find((x) => x.id === select?.value);
    if (!r) return toast("Choose a resume first.");
    const tailored = Boolean(r.baseResumeId || r.jobId),
      baseId = r.baseResumeId || r.id,
      text = r.text || composedResume(r.tailoredSummary || "", r.tailoredBody || "");
    if (!String(text).trim()) return toast("This resume has no text to download.");
    window.resumeDownloadOverride = { text, suffix: tailored ? "-tailored" : "" };
    try {
      if (fmt === "docx") await window.downloadTailoredDocx(baseId);
      else if (fmt === "pdf") await window.downloadTailoredPdf(baseId);
      else window.downloadTailoredTxt(baseId);
    } finally {
      window.resumeDownloadOverride = null;
    }
  };
})();
