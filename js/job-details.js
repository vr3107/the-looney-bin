function openDetails(id) {
  let x = data.jobs.find((a) => a.id === id);
  if (!x) return;
  let sc = score(x),
    p = data.profile;
  document.getElementById("modalroot").innerHTML =
    `<div class="modalback" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modalhead"><div><div class="eyebrow">ROLE DETAILS</div><h2>${esc(x.title)}</h2><div class="sub">${esc(x.company)}${x.location ? " · " + esc(x.location) : ""}</div></div><button class="x" onclick="closeModal()">×</button></div><div class="detail"><span>Match estimate</span><b>${sc === null ? "Add resume to estimate" : sc + "% keyword overlap"}</b></div><div class="detail"><span>Current status</span><b>${esc(x.status)}</b></div>${x.follow ? `<div class="detail"><span>Follow up</span><b>${esc(new Date(x.follow + "T12:00").toLocaleDateString())}</b></div>` : ""}<div class="applybox"><b>Application prep</b><br>${p.name ? `Candidate: ${esc(p.name)}. ` : ""}${p.email ? `Contact: ${esc(p.email)}. ` : ""}${p.role ? `Target roles: ${esc(p.role)}. ` : ""}${p.details ? esc(p.details) : "Add work authorization, availability, or other details in your profile."}<br><br>Prepare a cover letter draft from your profile, then review it before sending.</div>${x.description ? `<div class="field"><label>Saved job description</label><div class="help" style="max-height:120px;overflow:auto;white-space:pre-wrap">${esc(x.description)}</div></div>` : ""}<div id="draftarea"></div><div class="modalactions"><button class="btn" onclick="deleteJob(decodeURIComponent('${encodeURIComponent(x.id)}'))">Remove</button><button class="btn" onclick="closeModal()">Done</button><button class="btn" onclick="makeDraft(decodeURIComponent('${encodeURIComponent(x.id)}'))">Prepare draft</button>${x.url ? `<a class="btn btn-primary" style="text-decoration:none" href="${esc(x.url)}" target="_blank" rel="noopener">Open application ↗</a>` : ""}</div></div></div>`;
}
function makeDraft(id) {
  let x = data.jobs.find((a) => a.id === id),
    p = data.profile;
  if (!x) return;
  let resume = (p.resume || "").replace(/\s+/g, " ").trim(),
    desc = (x.description || "").toLowerCase(),
    sentences = resume.match(/[^.!?]+[.!?]*/g) || [],
    words = [
      ...new Set(
        (desc.match(/[a-z][a-z0-9+#.-]{3,}/g) || []).filter(
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
              "role",
              "team",
              "about",
              "what",
              "which",
              "when",
              "where",
              "more",
              "than",
              "into",
              "looking",
              "company",
              "strong",
              "years",
            ].includes(w),
        ),
      ),
    ],
    relevant = sentences
      .map((s) => ({
        s: s.trim(),
        n: words.filter((w) => s.toLowerCase().includes(w)).length,
      }))
      .filter((a) => a.s.length > 30)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .filter((a) => a.n > 0)
      .map((a) => a.s),
    parts = [
      `Dear ${x.company} hiring team,`,
      `I’m writing to apply for the ${x.title} position at ${x.company}.`,
    ];
  if (relevant.length)
    parts.push(`My relevant experience includes: ${relevant.join(" ")}`);
  else if (p.role)
    parts.push(`My background and interests are focused on ${p.role}.`);
  if (p.details) parts.push(`Additional details: ${p.details}`);
  parts.push(
    `I’d welcome the opportunity to discuss how my experience could contribute to your team.`,
    `Thank you for your consideration,`,
    p.name || "[Your name]",
  );
  document.getElementById("draftarea").innerHTML =
    `<div class="field"><label>Editable cover letter draft</label><textarea id="drafttext" style="min-height:230px">${esc(parts.join("\n\n"))}</textarea><div class="help">Draft assembled from your saved profile and matching resume sentences. Review and edit it carefully before sending.</div><button class="btn btn-sm" onclick="copyDraft()">Copy draft</button></div>`;
}
function copyDraft() {
  let e = document.getElementById("drafttext");
  if (!e) return;
  navigator.clipboard
    ?.writeText(e.value)
    .then(() => toast("Draft copied to clipboard."))
    .catch(() => toast("Select and copy the draft text."));
}
