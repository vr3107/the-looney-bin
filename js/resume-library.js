const RESUME_DB = "jobloom-original-files";
function openResumeDb() {
  return new Promise((resolve, reject) => {
    let req = indexedDB.open(RESUME_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function storeResumeFile(id, file) {
  try {
    let db = await openResumeDb();
    await new Promise((resolve, reject) => {
      let tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn(
      "Original resume file could not be retained in this browser",
      e,
    );
  }
}
async function getResumeFile(id) {
  let db = await openResumeDb();
  return new Promise((resolve, reject) => {
    let req = db.transaction("files", "readonly").objectStore("files").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function deleteResumeFile(id) {
  try {
    let db = await openResumeDb();
    await new Promise((resolve, reject) => {
      let tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}
function resumeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function resumeDisplayName(r) {
  let name = String(r?.name || "Resume");
  return r?.originalType === "docx"
    ? name.replace(/\.docx$/i, "")
    : name.replace(/\.[^.]+$/, "");
}
function ensureResumeLibrary() {
  if (!Array.isArray(data.resumes)) data.resumes = [];
  if (!data.resumes.length && data.profile?.resume?.trim())
    data.resumes.push({
      id: "resume-primary",
      name: "Primary resume",
      text: data.profile.resume,
      targetRoles: data.profile.role || "",
      createdAt: Date.now(),
    });
  if (
    data.resumes.length &&
    !data.resumes.some((r) => r.id === data.activeResumeId)
  )
    data.activeResumeId = data.resumes[0].id;
  let active = data.resumes.find((r) => r.id === data.activeResumeId);
  if (active) data.profile.resume = active.text || "";
}
function activeResume() {
  ensureResumeLibrary();
  return data.resumes.find((r) => r.id === data.activeResumeId) || null;
}
window.activeResume = activeResume;
function renderResumeLibrary() {
  return window.renderResumeLibrary?.();
}
window.fillProfile = function () {
  ensureResumeLibrary();
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
  let a = activeResume(),
    n = (p.resume || "").trim().split(/\s+/).filter(Boolean).length;
  let label = document.getElementById("resume-label");
  if (label)
    label.textContent = a
      ? `${a.name} · ${n.toLocaleString()} words`
      : "Add a resume";
  renderResumeInsights(p.resume || "");
  renderResumeLibrary();
};
window.saveProfile = function () {
  ensureResumeLibrary();
  for (let k of ["name", "email", "role", "location", "salary", "details"])
    data.profile[k] = document.getElementById("p-" + k).value.trim();
  data.profile.resume = document.getElementById("p-resume").value.trim();
  let a = activeResume();
  if (a) {
    a.text = data.profile.resume;
    a.targetRoles = data.profile.role || a.targetRoles || "";
  } else if (data.profile.resume) {
    let id = resumeId();
    data.resumes.push({
      id,
      name: "Primary resume",
      text: data.profile.resume,
      targetRoles: data.profile.role || "",
      createdAt: Date.now(),
    });
    data.activeResumeId = id;
  }
  persist();
  toast("Profile and selected resume saved.");
};
window.setResumeRoles = function (id, value) {
  let r = data.resumes.find((x) => x.id === id);
  if (!r) return;
  r.targetRoles = value.trim();
  if (r.id === data.activeResumeId) {
    data.profile.role = r.targetRoles;
    let field = document.getElementById("p-role");
    if (field) field.value = r.targetRoles;
  }
  localStorage.setItem(KEY, JSON.stringify(data));
  renderResumeLibrary();
};
window.activateResume = function (id) {
  window.saveProfile();
  let r = data.resumes.find((x) => x.id === id);
  if (!r) return;
  data.activeResumeId = id;
  data.profile.resume = r.text || "";
  data.profile.role = r.targetRoles || "";
  persist();
  toast(`${r.name} selected.`);
};
window.removeResume = function (id) {
  deleteResumeFile(id);
  data.resumes = data.resumes.filter((r) => r.id !== id);
  if (data.activeResumeId === id)
    data.activeResumeId = data.resumes[0]?.id || null;
  let r = activeResume();
  data.profile.resume = r?.text || "";
  data.profile.role = r?.targetRoles || "";
  persist();
  toast("Resume removed from your local library.");
};
window.searchResume = async function (id) {
  window.saveProfile();
  let r = data.resumes.find((x) => x.id === id);
  if (!r) return;
  data.activeResumeId = id;
  data.profile.resume = r.text || "";
  data.profile.role = r.targetRoles || "";
  persist();
  navigate("discover");
  document.getElementById("query").value = r.targetRoles || "";
  document.getElementById("location").value = data.profile.location || "";
  await window.searchBoards();
};
document.getElementById("resume-file").onchange = async (e) => {
  let files = [...(e.target.files || [])];
  if (!files.length) return;
  let imported = [],
    failures = [];
  for (let file of files) {
    try {
      let { text, type } = await window.readResumeFile(file);
      let r = {
        id: resumeId(),
        name: file.name,
        text: window.trimResumeText(text),
        targetRoles: data.profile.role || "",
        createdAt: Date.now(),
        originalType: type,
        originalFileName: file.name,
      };
      await storeResumeFile(r.id, file);
      data.resumes.push(r);
      imported.push(r);
    } catch (err) {
      failures.push(`${file.name}: ${err.message}`);
    }
  }
  if (imported.length) {
    let r = imported[imported.length - 1];
    data.activeResumeId = r.id;
    data.profile.resume = r.text;
    data.profile.role = r.targetRoles;
    window.saveProfile();
    if (imported.length === 1) toast(`${r.name} imported and analyzed.`);
    else
      toast(
        `${imported.length} resumes imported; ${failures.length} could not be read.`,
      );
  }
  if (failures.length)
    document.getElementById("resume-analysis").textContent =
      failures.join(" · ");
  e.target.value = "";
};
document.getElementById("p-resume").oninput = () => {
  let a = activeResume();
  document.getElementById("resume-label").textContent = a
    ? `${a.name} · unsaved edits`
    : "Resume text edited";
  renderResumeInsights(document.getElementById("p-resume").value);
};
function jobResume(job) {
  return (
    data.resumes?.find((r) => r.id === (job.resumeId || data.activeResumeId)) ||
    activeResume()
  );
}
function openWithJobResume(job, fn) {
  let oldText = data.profile.resume,
    oldRole = data.profile.role,
    r = jobResume(job);
  if (r) {
    data.profile.resume = r.text || "";
    data.profile.role = job.targetRoles || r.targetRoles || oldRole;
  }
  try {
    return fn(r);
  } finally {
    data.profile.resume = oldText;
    data.profile.role = oldRole;
  }
}
window.renderResumeLibrary = function () {
  let box = document.getElementById("resume-library");
  if (!box) return;
  ensureResumeLibrary();
  if (!data.resumes.length) {
    box.innerHTML =
      '<div class="empty" style="padding:18px"><strong>No resumes saved yet.</strong><p>Upload one or more Word (.docx) resumes. Each gets its own match search.</p></div>';
    return;
  }
  box.className = "resume-library";
  box.innerHTML = data.resumes
    .map((r) => {
      let base = r.baseResumeId
          ? data.resumes.find((x) => x.id === r.baseResumeId)
          : r,
        sourceName =
          base?.originalType === "docx" || base?.originalType === "pdf"
            ? base.originalFileName || "Resume." + base.originalType
            : "",
        isCopy = !!r.baseResumeId;
      return (
        '<div class="resume-entry ' +
        (r.id === data.activeResumeId ? "active" : "") +
        '"><div class="resume-entry-top"><div><b>' +
        esc(resumeDisplayName(r)) +
        '</b><div class="resume-entry-meta">' +
        (r.text || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .length.toLocaleString() +
        " words " +
        (r.id === data.activeResumeId ? "· currently selected" : "") +
        (isCopy
          ? " · tailored copy of " +
            esc(resumeDisplayName(base) || "source resume")
          : "") +
        '</div></div></div><div class="field"><label>Target roles for this resume (separate roles with commas)</label><input value="' +
        esc(r.targetRoles || "") +
        '" placeholder="e.g. Data Analyst, Product Manager" onchange="setResumeRoles(decodeURIComponent(\'' +
        encodeURIComponent(r.id) +
        '\'),this.value)"></div><div class="resume-actions"><button class="btn btn-primary btn-sm" onclick="searchResume(decodeURIComponent(\'' +
        encodeURIComponent(r.id) +
        "'))\">Find jobs for this resume</button>" +
        (r.id !== data.activeResumeId
          ? '<button class="btn btn-sm" onclick="activateResume(decodeURIComponent(\'' +
            encodeURIComponent(r.id) +
            "'))\">Select</button>"
          : "") +
        (sourceName
          ? '<button class="btn btn-sm" onclick="downloadOriginalResume(decodeURIComponent(\'' +
            encodeURIComponent(base.id) +
            "'))\">Download original " +
            esc(sourceName.split(".").pop().toUpperCase()) +
            "</button>"
          : "") +
        '<button class="btn btn-sm" onclick="removeResume(decodeURIComponent(\'' +
        encodeURIComponent(r.id) +
        "'))\">Remove</button></div></div>"
      );
    })
    .join("");
};
window.downloadOriginalResume = async function (id) {
  let r = data.resumes.find((x) => x.id === id);
  if (!r) {
    toast("Resume record not found.");
    return;
  }
  if (r.originalType !== "docx" && r.originalType !== "pdf") {
    toast("Original-file downloads are available for uploaded DOCX and PDF resumes.");
    return;
  }
  let blob = await getResumeFile(id);
  if (!blob) {
    toast(
      "Original file is not available in this browser. Upload it again to restore the downloadable copy.",
    );
    return;
  }
  let a = document.createElement("a"),
    u = URL.createObjectURL(blob);
  a.href = u;
  a.download = r.originalFileName || r.name || "original-resume";
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
};
