const KEY = "jobloom.v1";
let data = load();
function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { profile: {}, jobs: [] };
  } catch {
    return { profile: {}, jobs: [] };
  }
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(data));
  updateUI();
}
function esc(x = "") {
  return String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function toast(s) {
  const r = document.getElementById("toastroot");
  r.innerHTML = `<div class="toast">${esc(s)}</div>`;
  setTimeout(() => (r.innerHTML = ""), 2600);
}
function navigate(p) {
  document
    .querySelectorAll('[id^="page-"]')
    .forEach((e) => e.classList.toggle("hidden", e.id !== "page-" + p));
  document
    .querySelectorAll("[data-page]")
    .forEach((e) => e.classList.toggle("active", e.dataset.page === p));
  document.getElementById("crumb").textContent = {
    home: "Overview",
    discover: "Find roles",
    tracker: "Applications",
    profile: "My profile",
  }[p];
  if (p === "discover") renderJobs();
  if (p === "tracker") renderTracker();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document
  .querySelectorAll("[data-page]")
  .forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
function profileReady() {
  let p = data.profile;
  return (
    [p.name, p.role, p.resume].filter((x) => String(x || "").trim()).length / 3
  );
}
function score(job) {
  let resume = (data.profile.resume || "").toLowerCase(),
    text = (
      job.title +
      " " +
      job.company +
      " " +
      job.description +
      " " +
      job.tags
    ).toLowerCase();
  let words = [
    ...new Set(
      (resume.match(/[a-z][a-z0-9+#.-]{2,}/g) || []).filter(
        (w) =>
          ![
            "with",
            "from",
            "that",
            "this",
            "your",
            "have",
            "will",
            "their",
            "work",
            "the",
            "and",
            "for",
            "you",
            "our",
            "are",
            "was",
            "has",
            "who",
            "all",
            "can",
            "not",
            "but",
            "job",
            "role",
            "team",
            "use",
            "using",
          ].includes(w),
      ),
    ),
  ];
  if (!words.length) return null;
  let hit = words.filter((w) => text.includes(w));
  return Math.min(
    96,
    Math.round(
      28 + (72 * hit.length) / Math.max(6, Math.min(18, words.length * 0.28)),
    ),
  );
}
function updateUI() {
  let j = data.jobs,
    p = data.profile;
  document.getElementById("navcount").textContent = j.length;
  document.getElementById("stat-app").textContent = j.length;
  document.getElementById("stat-progress").textContent = j.filter((x) =>
    ["Applied", "Interview"].includes(x.status),
  ).length;
  document.getElementById("stat-interview").textContent = j.filter(
    (x) => x.status === "Interview",
  ).length;
  let ready = Math.round(profileReady() * 100);
  document.getElementById("stat-ready").textContent = ready + "%";
  document.getElementById("setupbar").style.width = ready + "%";
  if (p.name) {
    document.getElementById("welcome").textContent =
      `Good to see you, ${p.name.split(" ")[0]}.`;
    document.getElementById("avatar").textContent = p.name
      .trim()[0]
      .toUpperCase();
    document.getElementById("profiletitle").textContent =
      `Your profile, ${p.name.split(" ")[0]}.`;
  }
  let recent = [...j].sort((a, b) => b.added - a.added).slice(0, 4),
    r = document.getElementById("recent");
  r.innerHTML = recent.length
    ? `<div class="table-wrap"><table class="tracker"><thead><tr><th>Role</th><th>Status</th><th>Added</th></tr></thead><tbody>${recent.map((x) => `<tr><td class="role-cell"><b>${esc(x.title)}</b><span>${esc(x.company)}</span></td><td>${statusPill(x.status)}</td><td>${new Date(x.added).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty"><div class="bigico">✦</div><strong>Your next chapter starts here.</strong><p>Save a role you like and it’ll show up here, along with your application progress.</p></div>`;
  fillProfile();
  renderJobs();
  renderTracker();
}
function fillProfile() {
  let p = data.profile;
  for (let k of [
    "name",
    "email",
    "role",
    "location",
    "salary",
    "details",
    "resume",
  ]) {
    let e = document.getElementById("p-" + k);
    if (e && document.activeElement !== e) e.value = p[k] || "";
  }
  document.getElementById("resume-label").textContent = p.resume
    ? "Resume added · " + p.resume.trim().split(/\s+/).length + " words"
    : "Add your resume text";
}
function saveProfile() {
  for (let k of [
    "name",
    "email",
    "role",
    "location",
    "salary",
    "details",
    "resume",
  ])
    data.profile[k] = document.getElementById("p-" + k).value.trim();
  persist();
  toast("Profile saved in this browser.");
}
document.getElementById("resume-file").onchange = async (e) => {
  let f = e.target.files[0];
  if (f) {
    document.getElementById("p-resume").value = await f.text();
    toast("Resume text imported. Save your profile to keep it.");
  }
};
document.getElementById("p-resume").oninput = () =>
  (document.getElementById("resume-label").textContent =
    "Resume text ready · save profile to keep it");
function searchBoards() {
  let q =
      document.getElementById("query").value.trim() || data.profile.role || "",
    loc =
      document.getElementById("location").value.trim() ||
      data.profile.location ||
      "";
  if (!q) {
    toast("Add a role or skill to start your search.");
    document.getElementById("query").focus();
    return;
  }
  let full = [q, loc].filter(Boolean).join(" "),
    enc = encodeURIComponent(full);
  let links = [
    ["Google Jobs", `https://www.google.com/search?q=${enc}&ibp=htl;jobs`],
    [
      "LinkedIn",
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=${encodeURIComponent(loc)}`,
    ],
    [
      "Indeed",
      `https://www.indeed.com/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(loc)}`,
    ],
    ["Wellfound", `https://wellfound.com/jobs`],
  ];
  document.getElementById("boardlinks").innerHTML = links
    .map(
      ([a, u]) =>
        `<a href="${u}" target="_blank" rel="noopener">↗ &nbsp;${a}</a>`,
    )
    .join("");
  toast("Search links are ready. Open a board, then save roles here.");
}
function renderJobs() {
  let arr = [...data.jobs],
    f = document.getElementById("matchfilter")?.value || "all";
  if (f === "high") arr = arr.filter((x) => (score(x) ?? 0) >= 70);
  if (document.getElementById("sortfilter")?.value === "match")
    arr.sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0));
  else arr.sort((a, b) => b.added - a.added);
  document.getElementById("jobcount").textContent =
    `${arr.length} saved role${arr.length === 1 ? "" : "s"}`;
  let box = document.getElementById("jobs");
  if (!box) return;
  box.innerHTML = arr.length
    ? arr
        .map((x) => {
          let s = score(x);
          return `<article class="card job"><div class="jobtop"><div style="display:flex;gap:11px"><div class="companylogo">${esc((x.company || "?")[0].toUpperCase())}</div><div><h3>${esc(x.title)}</h3><div class="company">${esc(x.company)}${x.location ? " · " + esc(x.location) : ""}</div></div></div><span class="score">${s === null ? "Add resume" : s + "% match"}</span></div><div class="tags">${
            (x.tags || [])
              .slice(0, 4)
              .map((t) => `<span class="tag">${esc(t)}</span>`)
              .join("") || '<span class="tag">Added by you</span>'
          }</div><div class="jobfoot"><span>${x.salary ? esc(x.salary) + " · " : ""}${statusPill(x.status)}</span><div style="display:flex;gap:7px"><button class="btn btn-sm" onclick="openDetails('${x.id}')">Details</button>${x.url ? `<a class="btn btn-sm" style="text-decoration:none" href="${esc(x.url)}" target="_blank" rel="noopener">Open role ↗</a>` : ""}</div></div></article>`;
        })
        .join("")
    : `<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>No saved roles yet.</strong><p>Search a job board above, then use “Add a job” to save a role and compare it to your resume.</p><button class="btn btn-sm" style="margin-top:13px" onclick="openModal('job')">＋ Add your first role</button></div>`;
}
function statusPill(s) {
  return `<span class="status s-${(s || "Saved").toLowerCase()}">${esc(s || "Saved")}</span>`;
}
function renderTracker() {
  let box = document.getElementById("trackerwrap");
  if (!box) return;
  let f = document.getElementById("statusfilter")?.value || "all",
    arr = [...data.jobs]
      .filter((x) => f === "all" || x.status === f)
      .sort((a, b) => b.added - a.added);
  box.innerHTML = arr.length
    ? `<table class="tracker"><thead><tr><th>Role</th><th>Status</th><th>Match</th><th>Follow-up</th><th>Added</th><th></th></tr></thead><tbody>${arr.map((x) => `<tr><td class="role-cell"><b>${esc(x.title)}</b><span>${esc(x.company)}</span></td><td><select class="status s-${x.status.toLowerCase()}" onchange="setStatus('${x.id}',this.value)">${["Saved", "Applied", "Interview", "Offer", "Rejected", "Archived"].map((s) => `<option ${x.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td><td>${score(x) === null ? "—" : score(x) + "%"}</td><td>${x.follow ? esc(new Date(x.follow + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "—"}</td><td>${new Date(x.added).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td><td><button class="textlink" onclick="openDetails('${x.id}')">Open →</button></td></tr>`).join("")}</tbody></table>`
    : `<div class="empty"><div class="bigico">▤</div><strong>Nothing in the tracker yet.</strong><p>Add a job you’re considering or already applied to. You can update its status any time.</p></div>`;
}
function setStatus(id, s) {
  let x = data.jobs.find((j) => j.id === id);
  x.status = s;
  persist();
  toast("Application status updated.");
}
function openModal(mode) {
  if (mode === "job")
    document.getElementById("modalroot").innerHTML =
      `<div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modalhead"><div><h2>Add a role to your search</h2><div class="sub">Save a job to compare it with your profile and track next steps.</div></div><button class="x" onclick="closeModal()">×</button></div><form onsubmit="saveJob(event)"><div class="field"><label>Job title *</label><input name="title" required placeholder="e.g. Senior Product Designer"></div><div class="field"><label>Company *</label><input name="company" required placeholder="Company name"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label>Location</label><input name="location" placeholder="Remote, New York…"></div><div class="field"><label>Salary (optional)</label><input name="salary" placeholder="$100k–$130k"></div></div><div class="field"><label>Job posting URL</label><input name="url" type="url" placeholder="https://…"></div><div class="field"><label>Job description / skills</label><textarea name="description" placeholder="Paste the job description to get a more useful match estimate."></textarea></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label>Status</label><select name="status"><option>Saved</option><option>Applied</option><option>Interview</option><option>Offer</option><option>Rejected</option></select></div><div class="field"><label>Follow-up date</label><input type="date" name="follow"></div></div><div class="modalactions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary">Save role</button></div></form></div></div>`;
}
function closeModal() {
  document.getElementById("modalroot").innerHTML = "";
}
function saveJob(e) {
  e.preventDefault();
  let f = new FormData(e.target);
  let x = Object.fromEntries(f.entries());
  x.id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  x.added = Date.now();
  x.tags = [
    ...new Set(
      x.description.match(
        /\b(remote|hybrid|onsite|python|javascript|typescript|react|product|design|research|marketing|sales|data|sql|leadership|management|strategy|finance|engineering|ux|ui)\b/gi,
      ) || [],
    ),
  ].slice(0, 4);
  data.jobs.push(x);
  persist();
  closeModal();
  toast("Role saved to your pipeline.");
}
function openDetails(id) {
  let x = data.jobs.find((a) => a.id === id);
  if (!x) return;
  let sc = score(x),
    p = data.profile;
  let sal = p.salary ? `I’m targeting a salary range of ${p.salary}.` : "";
  let details = p.details || "";
  document.getElementById("modalroot").innerHTML =
    `<div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modalhead"><div><div class="eyebrow">ROLE DETAILS</div><h2>${esc(x.title)}</h2><div class="sub">${esc(x.company)}${x.location ? " · " + esc(x.location) : ""}</div></div><button class="x" onclick="closeModal()">×</button></div><div class="detail"><span>Match estimate</span><b>${sc === null ? "Add resume to estimate" : sc + "% keyword overlap"}</b></div><div class="detail"><span>Current status</span><b>${esc(x.status)}</b></div>${x.follow ? `<div class="detail"><span>Follow up</span><b>${esc(new Date(x.follow + "T12:00").toLocaleDateString())}</b></div>` : ""}<div class="applybox"><b>Application prep</b><br>${p.name ? `Candidate: ${esc(p.name)}. ` : ""}${p.email ? `Contact: ${esc(p.email)}. ` : ""}${p.role ? `Target roles: ${esc(p.role)}. ` : ""}${sal} ${details ? esc(details) : "Add work authorization, availability, or other details in your profile."}<br><br>Review every detail and tailor your application to the role before you submit.</div>${x.description ? `<div class="field"><label>Saved job description</label><div class="help" style="max-height:120px;overflow:auto;white-space:pre-wrap">${esc(x.description)}</div></div>` : ""}<div class="modalactions"><button class="btn" onclick="deleteJob('${x.id}')">Remove</button><button class="btn" onclick="closeModal()">Done</button>${x.url ? `<a class="btn btn-primary" style="text-decoration:none" href="${esc(x.url)}" target="_blank" rel="noopener">Open application ↗</a>` : ""}</div></div></div>`;
}
function deleteJob(id) {
  data.jobs = data.jobs.filter((x) => x.id !== id);
  persist();
  closeModal();
  toast("Role removed.");
}
document.getElementById("today").textContent = new Date().toLocaleDateString(
  undefined,
  { weekday: "short", month: "short", day: "numeric" },
);
document.getElementById("query").value = data.profile.role || "";
document.getElementById("location").value = data.profile.location || "";
updateUI();
