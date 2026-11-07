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
  let n = (p.resume || "").trim().split(/\s+/).filter(Boolean).length;
  document.getElementById("resume-label").textContent = p.resume
    ? `Resume ready · ${n} words`
    : "Add your resume";
  renderResumeInsights(p.resume || "");
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
  toast("Profile saved. Resume scoring and job matches are updated.");
}
function renderResumeInsights(text) {
  let grid = document.getElementById("resume-insights"),
    note = document.getElementById("resume-analysis");
  if (!grid || !note) return;
  let clean = text.trim();
  if (!clean) {
    grid.innerHTML = ["ATS readiness", "Achievement impact", "Scanability"]
      .map(
        (x) =>
          `<div class="insight"><div class="insight-label">${x}</div><div class="insight-value">—</div></div>`,
      )
      .join("");
    note.textContent =
      "Add a resume to see a transparent heuristic review. These scores are coaching signals, not scores from a specific employer’s ATS.";
    return;
  }
  let lines = clean
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean),
    lower = clean.toLowerCase(),
    words = clean.match(/[\p{L}\p{N}+#.-]+/gu) || [],
    count = words.length,
    sections = [
      /\b(experience|employment|professional history|work history)\b/i,
      /\b(education|academic background)\b/i,
      /\b(skills|core competencies|technical skills)\b/i,
      /\b(summary|profile|objective)\b/i,
    ]
      .map((r) => r.test(clean))
      .filter(Boolean).length,
    bullets = lines.filter((x) => /^(?:[-*•▪◦‣]|\d+[.)])\s/.test(x)).length,
    hasEmail = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(clean),
    hasPhone = /(?:\+?\d[\d .()\-]{7,}\d)/.test(clean),
    lengthPoints = count >= 250 && count <= 1200 ? 10 : count >= 120 ? 5 : 0,
    ats = Math.min(
      100,
      (hasEmail ? 10 : 0) +
        (hasPhone ? 8 : 0) +
        sections * 15 +
        (bullets >= 3 ? 12 : bullets ? 6 : 0) +
        lengthPoints,
    ),
    action =
      /\b(built|led|improved|increased|reduced|delivered|generated|managed|launched|streamlined|designed|developed|grew|achieved|saved|created|optimized|implemented|owned|drove|automated|negotiated|trained|resolved|supported|coordinated|analyzed|analy[sz]ed|established|expanded|cut|raised)\b/i,
    claims = lines.filter(
      (x) =>
        x.length > 32 && (action.test(x) || /^(?:[-*•▪◦‣]|\d+[.)])\s/.test(x)),
    ),
    quantified = claims.filter((x) =>
      /\d|%|\$|\b(?:percent|million|thousand|revenue|users|clients|hours|days)\b/i.test(
        x,
      ),
    ).length,
    impact = claims.length ? Math.round((100 * quantified) / claims.length) : 0,
    avg = lines.length
      ? lines.reduce((n, x) => n + x.length, 0) / lines.length
      : 0,
    scan = Math.min(
      100,
      (sections >= 3 ? 35 : sections * 10) +
        Math.min(25, bullets * 5) +
        (avg < 110 ? 20 : avg < 180 ? 10 : 0) +
        (count >= 250 && count <= 1000 ? 20 : count > 120 ? 10 : 0),
    );
  let values = [ats, impact, scan],
    labels = ["ATS readiness", "Achievement impact", "Scanability"];
  grid.innerHTML = labels
    .map(
      (x, i) =>
        `<div class="insight"><div class="insight-label">${x}</div><div class="insight-value">${values[i]}%</div><div class="insight-meter"><i style="width:${values[i]}%"></i></div></div>`,
    )
    .join("");
  let suggestions = [];
  if (!hasEmail) suggestions.push("Add an email address");
  if (!hasPhone) suggestions.push("Add a phone number");
  if (sections < 3) suggestions.push("Use clear standard section headings");
  if (bullets < 3) suggestions.push("Use concise bullet points for experience");
  if (!quantified)
    suggestions.push("Add measurable outcomes to experience bullets");
  if (count < 250)
    suggestions.push("Add more detail about relevant experience and skills");
  if (count > 1200)
    suggestions.push("Consider trimming the resume for easier scanning");
  note.innerHTML = `<b>How these estimates work</b><br>ATS readiness checks contact details, common section headings, bullets, and text length. Achievement impact checks how many action-oriented lines include measurable results (${quantified}/${claims.length || 0}). Scanability checks headings, bullets, line length, and resume length.${suggestions.length ? `<br><br><b>Possible improvements:</b> ${esc(suggestions.join(" · "))}` : "<br><br>These structural checks look good. Tailor keywords to each specific opening."}`;
}
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
  document.getElementById("resume-label").textContent =
    "Resume text edited · save profile to update matches";
  renderResumeInsights(document.getElementById("p-resume").value);
};
fillProfile();
