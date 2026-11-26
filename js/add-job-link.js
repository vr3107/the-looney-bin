// "Add a job": paste a job link and the posting's details are filled in (title, company, location,
// salary, job ID, posting date, job type and the full description), as on Jobright.
// The server reads the posting: /api/job-from-link.
(function () {
  const baseOpenModal = window.openModal;
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  window.openModal = function (mode) {
    if (mode !== "job") return baseOpenModal(mode);
    document.getElementById("modalroot").innerHTML = `<div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modalhead"><div><h2>Add a role to your search</h2><div class="sub">Paste the job link and the details fill in. You can edit anything before saving.</div></div><button class="x" onclick="closeModal()" aria-label="Close">×</button></div>
<form id="addjob" onsubmit="saveJob(event)">
<div class="field"><label for="addjob-url">Job posting link</label><div style="display:flex;gap:8px"><input id="addjob-url" name="url" type="url" placeholder="Paste a link: company career site, Greenhouse, Lever, Workday, Dice…" autocomplete="off" style="flex:1"><button type="button" class="btn" id="addjob-fill">Fill from link</button></div><div class="help" id="addjob-status" role="status" aria-live="polite"></div></div>
${field("Job title *", `<input name="title" required placeholder="e.g. Senior Data Engineer">`)}
${field("Company *", `<input name="company" required placeholder="Company name">`)}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${field("Location", `<input name="location" placeholder="Remote, New York…">`)}${field("Salary (optional)", `<input name="salary" placeholder="$100k–$130k">`)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${field("Job ID", `<input name="jobId" placeholder="From the posting">`)}${field("Job type", `<input name="employmentType" placeholder="Full-time, contract…">`)}</div>
${field("Job description / skills", `<textarea name="description" rows="9" placeholder="Filled in from the link, or paste the job description to get a more useful match estimate."></textarea>`)}
<input type="hidden" name="published"><input type="hidden" name="source"><input type="hidden" name="workplace"><input type="hidden" name="skills">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${field("Status", `<select name="status"><option>Saved</option><option>Applied</option><option>Interview</option><option>Offer</option><option>Rejected</option></select>`)}${field("Follow-up date", `<input type="date" name="follow">`)}</div>
<div class="modalactions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary">Save role</button></div></form></div></div>`;
    const form = document.getElementById("addjob"),
      url = document.getElementById("addjob-url"),
      fillBtn = document.getElementById("addjob-fill"),
      status = document.getElementById("addjob-status");
    let lastRead = "";
    const say = (text, kind = "") => {
      status.textContent = text;
      status.style.color = kind === "bad" ? "var(--danger, #b42318)" : kind === "ok" ? "var(--accent, #2f6b4f)" : "";
    };
    async function fill() {
      const link = url.value.trim();
      if (!link) return say("Paste a job posting link first.", "bad");
      if (link === lastRead) return;
      const already = window.trackedPosting?.(link);
      if (already) say(`Already in your tracker: ${already.title} at ${already.company}. Saving again adds a second copy.`, "bad");
      lastRead = link;
      fillBtn.disabled = true;
      fillBtn.textContent = "Reading…";
      if (!already) say("Reading the posting…");
      try {
        const r = await fetch("/api/job-from-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link }) }),
          d = await r.json().catch(() => ({}));
        if (!r.ok || !d.job) throw new Error(d.message || "The job details couldn’t be read from this link. You can still fill them in below.");
        const j = d.job,
          set = (name, value) => {
            const el = form.elements[name];
            // Don't overwrite what the person already typed.
            if (el && value && !String(el.value).trim()) el.value = value;
          };
        if (j.url && /^https?:\/\//.test(j.url)) url.value = j.url;
        lastRead = url.value.trim();
        set("title", j.title);
        // Known names for boards whose ID is all the posting gives ("capitalone" → "Capital One").
        const wd = typeof workdayFromUrl === "function" && workdayFromUrl(j.url || link),
          known = wd && (typeof WORKDAY_COMPANIES !== "undefined" ? WORKDAY_COMPANIES : []).find((b) => b.tenant === wd.tenant);
        const board = typeof boardFromJobUrl === "function" && boardFromJobUrl(j.url || link),
          followed = board && (typeof companyBoards === "function" ? companyBoards() : []).find((b) => b.ats === board.ats && String(b.slug).toLowerCase() === board.slug.toLowerCase());
        set("company", known?.name || followed?.name || j.company);
        set("location", j.location);
        set("salary", j.salary);
        set("jobId", j.jobId);
        set("employmentType", j.employmentType);
        set("description", j.description);
        form.elements.published.value = j.posted || "";
        form.elements.source.value = j.source || "";
        form.elements.workplace.value = j.workplace || "";
        form.elements.skills.value = JSON.stringify(j.skills || []);
        const got = ["title", "company", "location", "salary", "description"].filter((k) => j[k]).length;
        if (!already) say(j.note ? j.note : `Filled from ${j.source || "the posting"} — check the details, then save.`, j.partial ? "" : "ok");
        if (!got && !j.note) say("No details were found at this link. Fill them in below.", "bad");
        (form.elements.title.value ? form.elements.status : form.elements.title).focus();
      } catch (e) {
        say(e.message || "The job details couldn’t be read. You can still fill them in below.", "bad");
        lastRead = "";
      } finally {
        fillBtn.disabled = false;
        fillBtn.textContent = "Fill from link";
      }
    }
    fillBtn.onclick = fill;
    url.addEventListener("paste", () => setTimeout(fill, 0));
    url.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        fill();
      }
    });
    url.focus();
  };

  // Save: the original fields plus the posting details read from the link.
  window.saveJob = function (e) {
    e.preventDefault();
    const x = Object.fromEntries(new FormData(e.target).entries());
    let skills = [];
    try {
      skills = JSON.parse(x.skills || "[]");
    } catch {}
    delete x.skills;
    for (const k of ["jobId", "employmentType", "published", "source", "workplace", "salary", "follow", "location", "url"]) if (!String(x[k] || "").trim()) delete x[k];
    x.id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    x.added = Date.now();
    const found = (x.description || "").match(/\b(remote|hybrid|onsite|python|javascript|typescript|react|product|design|research|marketing|sales|data|sql|leadership|management|strategy|finance|engineering|ux|ui)\b/gi) || [];
    x.tags = [...new Set([x.workplace, x.employmentType, ...skills, ...found].filter(Boolean))].slice(0, 6);
    data.jobs.push(x);
    persist();
    closeModal();
    toast("Role saved to your pipeline.");
  };
})();
