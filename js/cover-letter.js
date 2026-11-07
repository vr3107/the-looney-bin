// Cover letters: written by AI (Cloudflare Workers AI) from the chosen resume
// version and the job, editable, saved with the job, and downloadable in the
// same font and size as the resume.
function clJob(id) {
  return data.jobs.find((x) => x.id === id) || (liveListings || []).find((x) => x.id === id);
}
function clResumeOptions(job) {
  let list = typeof window.resumesForJob === "function" ? window.resumesForJob(job) : data.resumes || [];
  return list.filter(Boolean);
}
function clBase(r) {
  return r?.baseResumeId ? data.resumes.find((x) => x.id === r.baseResumeId) || r : r;
}
function clName(resumeText) {
  let first = String(resumeText || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return data.profile?.name || (first.length < 60 && !/@|\d{3}/.test(first) ? first : "");
}
// Quick draft without AI: pick the resume lines that best match the job.
function clQuickDraft(job, resumeText, manager) {
  let terms = new Set(searchTokens(job.description || "").filter((w) => w.length > 3)),
    lines = String(resumeText || "")
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[•●▪*-]|\d+[.)])\s+/, "").trim())
      .filter((l) => l.length > 40 && !/@|https?:/.test(l)),
    best = lines
      .map((l) => ({ l, n: searchTokens(l).filter((w) => terms.has(w)).length }))
      .filter((x) => x.n)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((x) => x.l.replace(/\.$/, "")),
    name = clName(resumeText);
  return [
    `Dear ${manager || (job.company ? job.company + " Hiring Team" : "Hiring Team")},`,
    `I’m excited to apply for the ${job.title || "open"} role${job.company ? " at " + job.company : ""}. My background lines up closely with what your team is looking for, and I’d welcome the chance to contribute.`,
    best.length ? `In my recent work, I have:\n${best.map((b) => "• " + b + ".").join("\n")}` : "My resume details the experience most relevant to this position.",
    `I’d appreciate the opportunity to discuss how this experience can help ${job.company || "your team"}. Thank you for your time and consideration.`,
    `Sincerely,\n${name || "[Your name]"}`,
  ].join("\n\n");
}
// Highlight facts in the letter that don't appear in the resume or notes.
function clUnverified(letter, resumeText, notes, job) {
  let allowed = `${resumeText}\n${notes}\n${job.title}\n${job.company}\n${job.location}`.toLowerCase(),
    nums = (String(letter).match(/\d[\d,.]*\s?(?:%|\+|k|m)?/gi) || []).filter((n) => !allowed.includes(n.toLowerCase().replace(/\s/g, "").replace(/[.,]$/, ""))),
    named = [];
  for (let sentence of String(letter).split(/(?<=[.!?:])\s+|\n+/)) {
    let words = sentence.trim().split(/\s+/);
    words.forEach((w, i) => {
      let c = w.replace(/^[("'“]+|[)"'”.,;:!?]+$/g, "");
      if (i > 0 && c.length > 1 && /[A-Z].*[A-Z0-9]|[a-z][A-Z]|^[A-Z][a-z]+$/.test(c) && !/^(I|I’m|I'm|Dear|Sincerely|Thank|Hiring|Team|My|In|As|The|This|Your|With|At|And)$/.test(c) && !allowed.includes(c.toLowerCase()))
        named.push(c);
    });
  }
  return [...new Set([...nums, ...named])].slice(0, 12);
}
async function clDocxBodyFont(blob) {
  try {
    let zip = await (await loadJSZip()).loadAsync(blob),
      styles = await zip.file("word/styles.xml")?.async("text"),
      docXml = await zip.file("word/document.xml")?.async("text"),
      font = (styles?.match(/<w:docDefaults>[\s\S]*?w:ascii="([^"]+)"/) || [])[1] || "",
      size = Number((styles?.match(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/) || [])[1] || 0) / 2,
      normal = styles?.match(/<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)?.[0] || "";
    font = (normal.match(/w:ascii="([^"]+)"/) || [])[1] || font || (docXml?.match(/w:ascii="([^"]+)"/) || [])[1] || "";
    size = Number((normal.match(/<w:sz w:val="(\d+)"/) || [])[1] || 0) / 2 || size || 11;
    return { name: font, size };
  } catch {
    return { name: "", size: 11 };
  }
}
// DOCX letter built inside the resume's own document, so fonts, sizes, margins and theme match.
async function clLetterDocx(baseBlob, letter) {
  let zip = await (await loadJSZip()).loadAsync(baseBlob),
    doc = new DOMParser().parseFromString(await zip.file("word/document.xml").async("text"), "application/xml"),
    body = doc.getElementsByTagNameNS(WNS, "body")[0],
    paras = Array.from(body.getElementsByTagNameNS(WNS, "p")),
    candidates = paras.filter((p) => {
      let t = wordParagraphText(p).trim();
      return t.length > 40 && !p.getElementsByTagNameNS(WNS, "numPr").length && !p.getElementsByTagNameNS(WNS, "b").length && !(typeof jobloomSectionKey === "function" && jobloomSectionKey(t));
    }),
    template = candidates.sort((a, b) => wordParagraphText(b).length - wordParagraphText(a).length)[0] || paras.find((p) => wordParagraphText(p).trim()) || paras[0];
  template = template.cloneNode(true);
  for (let n of [...template.getElementsByTagNameNS(WNS, "numPr")]) n.parentNode.removeChild(n);
  stripWordIds(template);
  let sect = [...body.childNodes].find((n) => n.localName === "sectPr");
  for (let n of [...body.childNodes]) if (n !== sect) body.removeChild(n);
  let blocks = String(letter).replace(/\r/g, "").split(/\n\s*\n/);
  blocks.forEach((block, i) => {
    let p = template.cloneNode(true);
    replaceWordParagraph(p, block.trim());
    body.insertBefore(p, sect || null);
    if (i < blocks.length - 1) {
      let gap = template.cloneNode(true);
      replaceWordParagraph(gap, "");
      body.insertBefore(gap, sect || null);
    }
  });
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
async function clLetterPdf(letter, fontKey, size, margin) {
  let { PDFDocument, StandardFonts, rgb } = await loadPdfLib(),
    pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts[fontKey] || StandardFonts.Helvetica),
    W = 612,
    H = 792,
    M = Math.max(40, Math.min(90, margin || 72)),
    lead = size * 1.4,
    page = pdf.addPage([W, H]),
    y = H - M;
  let safe = (s) =>
    [...s]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return ch === "’" ? "'" : ch === "“" || ch === "”" ? '"' : "-";
        }
      })
      .join("");
  for (let para of String(letter).replace(/\r/g, "").split("\n")) {
    let words = safe(para).split(" "),
      line = "";
    let flush = () => {
      if (y - lead < M) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      y -= lead;
      if (line) page.drawText(line, { x: M, y, size, font, color: rgb(0.08, 0.08, 0.08) });
      line = "";
    };
    if (!para.trim()) {
      flush();
      continue;
    }
    for (let w of words) {
      if (line && font.widthOfTextAtSize(line + " " + w, size) > W - 2 * M) flush();
      line = line ? line + " " + w : w;
    }
    flush();
  }
  return new Blob([await pdf.save()], { type: "application/pdf" });
}
function clFileName(job, ext) {
  return `cover-letter-${String(job.company || job.title || "job").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.${ext}`;
}

window.makeDraft = function (id) {
  let job = clJob(id),
    area = document.querySelector("#modalroot #draftarea");
  if (!job) {
    toast("Save this role before preparing a cover letter.");
    return;
  }
  if (!area) {
    toast("Open the role details first, then choose Draft cover letter.");
    return;
  }
  let options = clResumeOptions(job),
    selected = job.coverLetterResumeId || job.tailoredResumeId || job.resumeId || data.activeResumeId || options[0]?.id,
    consented = data.aiConsent === true;
  area.innerHTML = `<div class="tailor-box cover-letter-editor cl-v2">
  <div class="resume-side-head"><h3>✦ Cover letter</h3><span class="tag">For ${esc(job.title || "this role")}${job.company ? " · " + esc(job.company) : ""}</span></div>
  <p class="help">Written from the resume you pick and this job’s description. It only uses facts from your resume or the notes you add; anything it can’t verify is flagged below the letter.</p>
  <div class="cl-grid">
    <label>Resume to use<select id="cl-resume">${options.map((r) => `<option value="${esc(r.id)}" ${r.id === selected ? "selected" : ""}>${esc(typeof resumeDisplayName === "function" ? resumeDisplayName(r) : r.name)}${r.baseResumeId ? " (tailored)" : ""}</option>`).join("")}</select></label>
    <label>Tone<select id="cl-tone"><option value="professional">Professional</option><option value="confident">Confident</option><option value="warm">Warm</option><option value="concise">Concise</option></select></label>
    <label>Length<select id="cl-length"><option value="short">Short (~200 words)</option><option value="standard" selected>Standard (~300 words)</option><option value="detailed">Detailed (~400 words)</option></select></label>
    <label>Hiring manager <span>(optional)</span><input id="cl-manager" placeholder="e.g. Jordan Lee" /></label>
  </div>
  <label class="cl-notes">Anything to mention <span>(optional, must be true)</span><textarea id="cl-notes" rows="2" placeholder="e.g. I use their product daily; open to relocating to Austin."></textarea></label>
  ${consented ? "" : '<label class="ai-consent"><input id="cl-consent" type="checkbox"><span>Send the chosen resume and this job description to Cloudflare Workers AI to write the letter. Nothing is stored on a server.</span></label>'}
  <div class="resume-actions"><button class="btn btn-primary btn-sm cl-ai" id="cl-generate" ${consented ? "" : "disabled"}>✦ Write with AI</button><button class="btn btn-sm" id="cl-quick">Quick draft (no AI)</button><span id="cl-status" class="help" role="status" aria-live="polite"></span></div>
  <div class="field"><label>Letter · edit freely</label><textarea id="drafttext" aria-label="Edit cover letter" style="min-height:300px">${esc(job.coverLetterDraft || "")}</textarea></div>
  <div id="cl-flags"></div>
  <div class="resume-actions"><button class="btn btn-sm" onclick="copyDraft()">Copy</button><button class="btn btn-sm" id="cl-docx">Download .docx</button><button class="btn btn-sm" id="cl-pdf">Download .pdf</button><button class="btn btn-sm" id="cl-txt">Download .txt</button><button class="btn btn-primary btn-sm" id="cl-save">Save to this job</button></div>
</div>`;
  let $ = (s) => area.querySelector(s),
    status = $("#cl-status"),
    resumeFor = () => data.resumes.find((r) => r.id === $("#cl-resume").value) || options[0],
    letter = () => $("#drafttext").value;
  if ($("#cl-consent"))
    $("#cl-consent").onchange = (e) => {
      $("#cl-generate").disabled = !e.target.checked;
      if (e.target.checked) {
        data.aiConsent = true;
        persist();
      }
    };
  let showFlags = () => {
    let r = resumeFor(),
      flags = clUnverified(letter(), r?.text || "", $("#cl-notes").value, job);
    $("#cl-flags").innerHTML = flags.length ? `<div class="ai-held cl-flags">Double-check these — they don’t appear in your resume or notes: ${flags.map((f) => `<b>${esc(f)}</b>`).join(", ")}</div>` : "";
  };
  $("#drafttext").oninput = showFlags;
  $("#cl-quick").onclick = () => {
    $("#drafttext").value = clQuickDraft(job, resumeFor()?.text || data.profile.resume || "", $("#cl-manager").value.trim());
    showFlags();
    status.textContent = "Quick draft ready. Edit it before sending.";
  };
  $("#cl-generate").onclick = async () => {
    let r = resumeFor(),
      btn = $("#cl-generate");
    if (!r?.text) {
      status.textContent = "Choose a resume first.";
      return;
    }
    if (!String(job.description || "").trim()) {
      status.textContent = "This job has no description to write from.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Writing…";
    status.textContent = "Writing your letter. This usually takes 10–25 seconds.";
    try {
      let res = await fetch("/api/tailor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "cover_letter",
            consent: true,
            resume: r.text,
            job: { title: job.title || "", company: job.company || "", location: job.location || "", description: (typeof plainText === "function" ? plainText(job.description) : job.description).slice(0, 20000) },
            tone: $("#cl-tone").value,
            length: $("#cl-length").value,
            hiringManager: $("#cl-manager").value.trim(),
            candidateName: clName(r.text),
            notes: $("#cl-notes").value.trim(),
          }),
        }),
        out = await res.json().catch(() => ({}));
      if (!res.ok || !out.letter)
        throw new Error(
          out.error === "ai_not_configured"
            ? "AI isn’t connected yet: add a Workers AI binding named AI to the Cloudflare Pages project. Use “Quick draft” meanwhile."
            : out.error === "rate_limited"
              ? "Too many AI requests in the last minute. Try again shortly."
              : out.error === "ai_busy"
                ? "The AI providers are busy (per-minute limit). Wait a minute and try again, or use “Quick draft”."
                : out.error === "ai_quota_exceeded"
                ? "Today’s AI allowance is used up on every connected provider. Try again later, or use “Quick draft” meanwhile."
                : "The letter couldn’t be written right now. Try again, or use “Quick draft”.",
        );
      $("#drafttext").value = out.letter;
      showFlags();
      status.textContent = "Letter ready. Review and personalize it before sending.";
    } catch (e) {
      status.textContent = e.message;
    } finally {
      btn.disabled = data.aiConsent !== true;
      btn.textContent = "✦ Write with AI";
    }
  };
  $("#cl-save").onclick = () => {
    let saved = data.jobs.find((x) => x.id === job.id);
    if (!saved) {
      toast("Save this role to your tracker before saving its cover letter.");
      return;
    }
    saved.coverLetterDraft = letter();
    saved.coverLetterResumeId = $("#cl-resume").value;
    saved.coverLetterSavedAt = Date.now();
    persist();
    toast("Cover letter saved with this job.");
  };
  let need = () => {
    if (!letter().trim()) {
      toast("Write or generate the letter first.");
      return false;
    }
    return true;
  };
  $("#cl-txt").onclick = () => need() && saveBlob(new Blob([letter()], { type: "text/plain;charset=utf-8" }), clFileName(job, "txt"));
  $("#cl-docx").onclick = async () => {
    if (!need()) return;
    try {
      let base = clBase(resumeFor()),
        blob = base?.originalType === "docx" ? await getResumeFile(base.id) : null;
      saveBlob(blob ? await clLetterDocx(blob, letter()) : await makeTextDocx(await loadJSZip(), letter()), clFileName(job, "docx"));
      toast(blob ? "Cover letter downloaded in your resume’s fonts, size, and margins." : "Cover letter downloaded.");
    } catch (e) {
      toast(e.message || "DOCX export failed.");
    }
  };
  $("#cl-pdf").onclick = async () => {
    if (!need()) return;
    try {
      let base = clBase(resumeFor()),
        blob = base ? await getResumeFile(base.id) : null,
        fontKey = "Helvetica",
        size = 11,
        margin = 72;
      if (blob && base.originalType === "pdf") {
        let lines = (await readPdfGeometry(new Uint8Array(await blob.arrayBuffer()))).filter((l) => !l.blank && l.text.trim().length > 30),
          tally = new Map();
        for (let l of lines) {
          let k = standardFontKey(l.font) + "|" + Math.round(l.h * 2) / 2;
          tally.set(k, (tally.get(k) || 0) + 1);
        }
        let top = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (top) [fontKey, size] = [top.split("|")[0].replace(/Bold|Oblique|Italic/g, "") || "Helvetica", Number(top.split("|")[1]) || 11];
        if (fontKey === "Times") fontKey = "TimesRoman";
        margin = Math.min(...lines.map((l) => l.x0)) || 72;
      } else if (blob && base.originalType === "docx") {
        let f = await clDocxBodyFont(blob);
        fontKey = standardFontKey({ name: f.name }).replace(/Bold|Oblique|Italic/g, "") || "Helvetica";
        if (fontKey === "Times") fontKey = "TimesRoman";
        size = f.size || 11;
      }
      saveBlob(await clLetterPdf(letter(), fontKey, size, margin), clFileName(job, "pdf"));
      toast("Cover letter PDF downloaded to match your resume’s font style and size.");
    } catch (e) {
      toast(e.message || "PDF export failed.");
    }
  };
  if (!job.coverLetterDraft) status.textContent = consented ? "Choose your options, then write the letter." : "Allow the AI request, or use Quick draft.";
  else showFlags();
  area.scrollIntoView({ behavior: "smooth", block: "start" });
};

// Add a "Write cover letter" shortcut to the resume tailoring view.
const clTailorResume = window.tailorResume;
window.tailorResume = function (jobId, sourceResumeId) {
  let out = clTailorResume.apply(this, arguments),
    actions = [...document.querySelectorAll("#tailor-area .resume-actions")].pop();
  if (actions && !actions.querySelector("[data-cl-shortcut]")) {
    let b = document.createElement("button");
    b.className = "btn btn-sm";
    b.dataset.clShortcut = "true";
    b.textContent = "✦ Write cover letter";
    b.onclick = () => window.makeDraft(jobId);
    actions.appendChild(b);
  }
  return out;
};
