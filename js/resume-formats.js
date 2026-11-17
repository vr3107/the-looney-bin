// PDF resume import and format-preserving exports (PDF, DOCX, TXT).
// The uploaded file itself is always kept unchanged in IndexedDB; these helpers
// extract its text with line breaks, indentation and spacing preserved.
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    let s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error("PDF reader did not load"));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("Could not load PDF support"));
    document.head.appendChild(s);
  });
}
function loadPdfLib() {
  return new Promise((resolve, reject) => {
    if (window.PDFLib) return resolve(window.PDFLib);
    let s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
    s.onload = () =>
      window.PDFLib ? resolve(window.PDFLib) : reject(new Error("PDF writer did not load"));
    s.onerror = () => reject(new Error("Could not load PDF export support"));
    document.head.appendChild(s);
  });
}
// Rebuild one page's text from positioned text items, keeping indentation,
// gaps between columns and blank lines between blocks.
function pdfPageLayout(items) {
  return pdfPageLines(items).map((l) => l.text);
}
// Lines with geometry: text plus position, size, and the text pieces that form it.
function pdfPageLines(items) {
  let parts = items
    .filter((it) => typeof it.str === "string" && it.str.length)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: Math.abs(it.transform[3]) || it.height || 10,
      fontName: it.fontName,
    }));
  if (!parts.length) return [];
  let widths = parts.filter((p) => p.str.trim() && p.w > 0),
    charW = widths.length
      ? widths.reduce((a, p) => a + p.w, 0) / widths.reduce((a, p) => a + p.str.length, 0)
      : 5;
  if (!(charW > 0)) charW = 5;
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  let lines = [];
  for (let p of parts) {
    let line = lines.find((l) => Math.abs(l.y - p.y) <= Math.max(2, p.h * 0.45));
    if (line) line.parts.push(p);
    else lines.push({ y: p.y, h: p.h, parts: [p] });
  }
  lines.sort((a, b) => b.y - a.y);
  let left = Math.min(...parts.filter((p) => p.str.trim()).map((p) => p.x)),
    heights = lines.map((l) => l.h).sort((a, b) => a - b),
    lineH = heights[Math.floor(heights.length / 2)] * 1.2 || 12,
    out = [],
    prevY = null;
  for (let line of lines) {
    if (prevY !== null) {
      let gaps = Math.round((prevY - line.y) / lineH) - 1;
      for (let i = 0; i < Math.min(Math.max(gaps, 0), 2); i++) out.push({ text: "", blank: true });
    }
    prevY = line.y;
    line.parts.sort((a, b) => a.x - b.x);
    let text = "",
      cursor = left;
    for (let p of line.parts) {
      // pdf.js reports a wide gap as one whitespace item whose width spans the gap.
      if (!p.str.trim()) {
        let n = Math.max(1, Math.min(Math.round((p.w || charW) / charW), 60));
        if (text) text += " ".repeat(n);
        cursor = p.x + (p.w || charW);
        continue;
      }
      let gap = p.x - cursor,
        spaces = Math.round(gap / charW);
      if (!text) spaces = Math.max(0, Math.min(spaces, 40));
      else if (gap > charW * 0.25) {
        let have = (text.match(/ *$/) || [""])[0].length + (p.str.match(/^ */) || [""])[0].length;
        spaces = Math.max(have ? 0 : 1, Math.min(spaces, 60) - have);
      } else spaces = 0;
      text += " ".repeat(spaces) + p.str;
      cursor = p.x + (p.w || p.str.length * charW);
    }
    let ink = line.parts.filter((p) => p.str.trim());
    out.push({
      text: text.replace(/\s+$/, ""),
      y: line.y,
      h: line.h,
      parts: ink,
      x0: ink.length ? Math.min(...ink.map((p) => p.x)) : left,
      x1: ink.length ? Math.max(...ink.map((p) => p.x + p.w)) : left,
      charW,
    });
  }
  return out;
}
async function readPdfText(file) {
  let pdfjs = await loadPdfJs(),
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise,
    pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    let page = await pdf.getPage(n),
      content = await page.getTextContent();
    pages.push(pdfPageLayout(content.items).join("\n"));
  }
  return pages.join("\n\n").replace(/\n{4,}/g, "\n\n\n");
}
window.readResumeFile = async function (file) {
  let name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".docx")) {
    let text = await readWordDocxText(file);
    if (text.trim().length < 80) throw new Error("Too little text was extracted from this DOCX.");
    return { text, type: "docx" };
  }
  if (name.endsWith(".pdf") || file?.type === "application/pdf") {
    let text = await readPdfText(file);
    if (text.trim().length < 80)
      throw new Error("Too little text was found in this PDF. Scanned (image-only) PDFs can’t be read; upload a text-based PDF or DOCX.");
    return { text, type: "pdf" };
  }
  throw new Error("Upload a Word (.docx) or PDF resume.");
};
// Trim only outer blank lines, keeping each line's own indentation.
window.trimResumeText = function (text) {
  return String(text || "").replace(/\r/g, "").replace(/^\s*\n/, "").replace(/\n\s*$/, "").replace(/[ \t]+$/gm, "");
};
const RESUME_HEADING_RE =
  /^(summary|professional summary|profile|skills|technical skills|experience|professional experience|work experience|projects|education|certifications|awards|publications)$/i;
function saveBlob(blob, fileName) {
  let url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// Set while downloading a saved resume version from a job's window (not the open draft).
window.resumeDownloadOverride = null;
function tailoredDraftText() {
  if (window.resumeDownloadOverride) return window.resumeDownloadOverride.text;
  return composedResume(
    document.getElementById("tailored-summary")?.value || "",
    document.getElementById("tailored-body")?.value || "",
  );
}
function tailoredFileName(baseId, ext) {
  let base = data.resumes.find((x) => x.id === baseId);
  let suffix = window.resumeDownloadOverride ? window.resumeDownloadOverride.suffix : "-tailored";
  return (base?.originalFileName || base?.name || "the-looney-bin-resume").replace(/\.[^.]+$/, "") + suffix + "." + ext;
}
// Build a clean PDF in the usual resume layout (centered name and contact line, ruled
// headings, bold labels, bold job titles with dates on the right, wrapped bullets). Text is
// real and never runs past the margins, so ATS systems read exactly what is shown.
// `style` (from the original PDF, when there is one) sets margins, font family and size.
async function makeResumePdf(text, style = {}) {
  let { PDFDocument, StandardFonts, rgb } = await loadPdfLib(),
    doc = await PDFDocument.create(),
    serif = style.family === "serif",
    font = await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica),
    bold = await doc.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold),
    W = 612,
    H = 792,
    ML = Math.min(Math.max(style.left || 54, 36), 90),
    MR = ML,
    MT = Math.min(Math.max(style.top || 48, 30), 80),
    MB = 44,
    size = Math.min(Math.max(style.size || 10, 8.8), 11.5),
    nameSize = Math.min(Math.max(style.nameSize || size * 1.75, size * 1.3), 24),
    lead = size * 1.28,
    ink = rgb(0.08, 0.08, 0.08),
    page = doc.addPage([W, H]),
    y = H - MT;
  const CHARS = { "●": "•", "▪": "•", "◦": "•", "‑": "-", "‐": "-", "−": "-", "→": "->", "≥": ">=", "≤": "<=", "✓": "-", "\t": " " };
  let safe = (f, str) =>
    [...String(str)]
      .map((ch) => {
        ch = CHARS[ch] ?? ch;
        try {
          f.encodeText(ch);
          return ch;
        } catch {
          return "";
        }
      })
      .join("");
  let room = (h) => {
    if (y - h < MB) {
      page = doc.addPage([W, H]);
      y = H - MT;
    }
  };
  // Lay out runs of text ({ text, font }) as wrapped lines within [x, x + maxW].
  let wrapRuns = (runs, maxW, sz) => {
    let lines = [[]],
      lineW = 0;
    for (let run of runs)
      for (let word of safe(run.font, run.text).split(/(\s+)/)) {
        if (!word) continue;
        let w = run.font.widthOfTextAtSize(word, sz);
        if (/^\s+$/.test(word)) {
          if (lines[lines.length - 1].length) lines[lines.length - 1].push({ text: " ", font: run.font, w: run.font.widthOfTextAtSize(" ", sz) }), (lineW += run.font.widthOfTextAtSize(" ", sz));
          continue;
        }
        if (lineW + w > maxW && lines[lines.length - 1].length) {
          let cur = lines[lines.length - 1];
          while (cur.length && cur[cur.length - 1].text === " ") lineW -= cur.pop().w;
          lines.push([]);
          lineW = 0;
        }
        // A single word wider than the line (e.g. a long URL): shrink it to fit.
        let wsz = w > maxW ? (sz * maxW) / w : sz;
        lines[lines.length - 1].push({ text: word, font: run.font, w: Math.min(w, maxW), size: wsz });
        lineW += Math.min(w, maxW);
      }
    return lines.filter((l) => l.length);
  };
  let drawLine = (parts, x, sz, align = "left", maxW = W - ML - MR) => {
    let total = parts.reduce((a, p) => a + p.w, 0),
      cx = align === "center" ? ML + (maxW - total) / 2 : align === "right" ? x - total : x;
    // Draw runs of the same font and size as one string with real spaces, so text extractors
    // (and ATS systems) read "Data scientist with", not "Datascientistwith".
    let i = 0;
    while (i < parts.length) {
      let p = parts[i];
      if (p.text === " ") {
        cx += p.w;
        i++;
        continue;
      }
      let str = p.text,
        w = p.w,
        j = i + 1;
      while (j < parts.length && parts[j].font === p.font && (parts[j].size || sz) === (p.size || sz)) {
        // a trailing space only joins when another word of the same style follows
        if (parts[j].text === " " && !(parts[j + 1] && parts[j + 1].text !== " " && parts[j + 1].font === p.font && (parts[j + 1].size || sz) === (p.size || sz))) break;
        str += parts[j].text;
        w += parts[j].w;
        j++;
      }
      page.drawText(str, { x: cx, y, size: p.size || sz, font: p.font, color: ink });
      cx += w;
      i = j;
    }
  };
  let paragraph = (runs, { x = ML, indent = 0, sz = size, align = "left", gapAfter = 0, bulletChar = "" } = {}) => {
    let maxW = W - MR - x - indent,
      lines = wrapRuns(runs, maxW, sz);
    lines.forEach((parts, k) => {
      room(lead);
      y -= lead;
      if (k === 0 && bulletChar) page.drawText(bulletChar, { x, y, size: sz, font, color: ink });
      drawLine(parts, x + indent, sz, align, W - ML - MR);
    });
    y -= gapAfter;
  };
  let items = resumeLayout(text),
    prevKind = "";
  items.forEach((it, i) => {
    switch (it.kind) {
      case "blank":
        if (prevKind && prevKind !== "blank" && prevKind !== "heading") y -= lead * 0.35;
        break;
      case "name":
        room(nameSize * 1.3);
        y -= nameSize;
        drawLine(wrapRuns([{ text: it.text, font: bold }], W - ML - MR, nameSize)[0] || [], ML, nameSize, "center");
        y -= nameSize * 0.25;
        break;
      case "contact":
        paragraph([{ text: it.text, font }], { align: "center", sz: size * 0.98 });
        break;
      case "heading": {
        // Keep a heading with at least two lines of what follows it.
        room(lead * 4);
        y -= lead * (prevKind === "name" || prevKind === "contact" ? 0.9 : 0.7);
        y -= size * 1.1;
        page.drawText(safe(bold, it.text), { x: ML, y, size: size * 1.1, font: bold, color: ink });
        page.drawLine({ start: { x: ML, y: y - 3 }, end: { x: W - MR, y: y - 3 }, thickness: 0.7, color: rgb(0.25, 0.25, 0.25) });
        y -= 5;
        break;
      }
      case "title": {
        room(lead * 3);
        y -= lead * 0.35;
        let right = wrapRuns([{ text: it.right, font }], (W - ML - MR) * 0.45, size)[0] || [],
          rightW = right.reduce((a, p) => a + p.w, 0),
          left = wrapRuns([{ text: it.left, font: bold }], W - ML - MR - rightW - 12, size);
        left.forEach((parts, k) => {
          y -= lead;
          drawLine(parts, ML, size);
          if (k === 0) drawLine(right, W - MR, size, "right");
        });
        break;
      }
      case "sub":
        paragraph([{ text: it.text, font }]);
        break;
      case "bullet":
        paragraph([{ text: it.text, font }], { x: ML + size * 0.9, indent: size * 1.1, bulletChar: "•" });
        break;
      case "label":
        paragraph([{ text: it.label + " ", font: bold }, { text: it.text, font }]);
        break;
      default:
        paragraph([{ text: it.text, font }]);
    }
    prevKind = it.kind;
  });
  return new Blob([await doc.save()], { type: "application/pdf" });
}
// The original PDF's look: left/top margin, body and name size, serif or sans-serif.
async function pdfStyleOf(blob) {
  try {
    let lines = (await readPdfGeometry(new Uint8Array(await blob.arrayBuffer()))).filter((l) => !l.blank && l.text.trim()),
      first = lines.filter((l) => l.page === 0),
      sizes = lines.map((l) => l.h).sort((a, b) => a - b),
      median = sizes[Math.floor(sizes.length / 2)],
      { PDFDocument, StandardFonts } = await loadPdfLib(),
      probe = await PDFDocument.create(),
      family = /Times/.test(standardFontKey(lines[Math.floor(lines.length / 2)]?.font)) ? "serif" : "sans",
      ref = await probe.embedFont(family === "serif" ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
    // Match the original font's width: e.g. Calibri/Carlito is narrower than Helvetica.
    let ratios = lines
      .filter((l) => Math.abs(l.h - median) < 0.6 && l.text.trim().length > 40 && l.parts.length)
      .map((l) => (l.x1 - l.x0) / ref.widthOfTextAtSize(l.text.trim().replace(/\s{2,}/g, " ").replace(/[^\x20-\x7e]/g, "-"), l.h))
      .filter((r) => r > 0.6 && r < 1.4)
      .sort((a, b) => a - b),
      ratio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
    return {
      family,
      left: Math.min(...lines.map((l) => l.x0)),
      top: first.length ? 792 - Math.max(...first.map((l) => l.y + l.h)) : 48,
      size: median * Math.min(Math.max(ratio, 0.82), 1.05),
      nameSize: (first[0]?.h || median * 1.8) * Math.min(Math.max(ratio, 0.82), 1.05),
    };
  } catch {
    return {};
  }
}
// The Word file's look for a PDF made from it: margins, body and name size, serif or sans-serif.
async function docxStyleOf(blob) {
  try {
    let JSZip = await loadJSZip(),
      zip = await JSZip.loadAsync(blob),
      doc = await zip.file("word/document.xml")?.async("text"),
      styles = (await zip.file("word/styles.xml")?.async("text")) || "",
      theme = (await zip.file("word/theme/theme1.xml")?.async("text")) || "";
    if (!doc) return {};
    let num = (re, src) => {
        let m = src.match(re);
        return m ? Number(m[1]) : null;
      },
      left = num(/<w:pgMar[^>]*w:left="(\d+)"/, doc),
      top = num(/<w:pgMar[^>]*w:top="(\d+)"/, doc),
      defaults = (styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/) || [""])[0],
      normal = (styles.match(/<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/) || [""])[0],
      defaultSize = num(/<w:sz w:val="(\d+)"/, normal) || num(/<w:sz w:val="(\d+)"/, defaults) || 22,
      // Body size: the size used for the most text in the document.
      counts = new Map();
    for (let m of doc.matchAll(/<w:r>([\s\S]*?)<\/w:r>|<w:r [^>]*>([\s\S]*?)<\/w:r>/g)) {
      let run = m[1] || m[2] || "",
        sz = num(/<w:sz w:val="(\d+)"/, run) || defaultSize,
        len = (run.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).join("").replace(/<[^>]+>/g, "").length;
      counts.set(sz, (counts.get(sz) || 0) + len);
    }
    let body = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || defaultSize,
      firstPara = (doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).find((p) => /<w:t[^>]*>[^<]*\S/.test(p)) || "",
      nameSize = Math.max(...[...firstPara.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1])), body),
      font =
        (doc.match(/<w:rFonts [^>]*w:ascii="([^"]+)"/) || normal.match(/<w:rFonts [^>]*w:ascii="([^"]+)"/) || defaults.match(/<w:rFonts [^>]*w:ascii="([^"]+)"/) || theme.match(/<a:minorFont>\s*<a:latin typeface="([^"]+)"/) || [])[1] || "";
    return {
      family: /times|garamond|georgia|cambria|book antiqua|palatino|bookman|century|baskerville|serif/i.test(font) && !/sans/i.test(font) ? "serif" : "sans",
      left: left ? left / 20 : undefined,
      top: top ? top / 20 : undefined,
      size: body / 2,
      nameSize: nameSize / 2,
    };
  } catch {
    return {};
  }
}
window.docxStyleOf = docxStyleOf;
window.makeResumePdf = makeResumePdf;
window.downloadTailoredPdf = async function (baseId) {
  try {
    saveBlob(await makeResumePdf(tailoredDraftText()), tailoredFileName(baseId, "pdf"));
    toast("Tailored PDF downloaded with your edits, line breaks and spacing. Fonts and graphics from the original PDF aren’t reproduced.");
  } catch (e) {
    toast(e.message || "PDF export failed. Review the resume and try again.");
  }
};
window.downloadTailoredTxt = function (baseId) {
  saveBlob(new Blob([tailoredDraftText()], { type: "text/plain;charset=utf-8" }), tailoredFileName(baseId, "txt"));
  toast("Tailored resume text downloaded with its original spacing.");
};

// ---------------------------------------------------------------------------
// Same-format exports: apply the edited text back onto the ORIGINAL file so
// fonts, sizes, spacing, bullets, and layout are kept for every unchanged line.
// ---------------------------------------------------------------------------

// Line-level diff (LCS) → [{type:"equal"|"replace"|"delete"|"insert", a, b}]
function alignResumeLines(a, b) {
  let n = a.length,
    m = b.length,
    dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let raw = [],
    i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) raw.push({ type: "equal", a: i++, b: j++ });
    else if (dp[i + 1][j] >= dp[i][j + 1]) raw.push({ type: "delete", a: i++ });
    else raw.push({ type: "insert", b: j++ });
  }
  while (i < n) raw.push({ type: "delete", a: i++ });
  while (j < m) raw.push({ type: "insert", b: j++ });
  // Pair deletes with inserts between equal lines as in-place replacements.
  let out = [],
    k = 0;
  while (k < raw.length) {
    if (raw[k].type === "equal") {
      out.push(raw[k++]);
      continue;
    }
    let dels = [],
      ins = [];
    while (k < raw.length && raw[k].type !== "equal") (raw[k].type === "delete" ? dels : ins).push(raw[k++]);
    let pairs = Math.min(dels.length, ins.length);
    for (let x = 0; x < pairs; x++) out.push({ type: "replace", a: dels[x].a, b: ins[x].b });
    for (let x = pairs; x < dels.length; x++) out.push(dels[x]);
    for (let x = pairs; x < ins.length; x++) out.push({ type: "insert", b: ins[x].b, after: dels.length ? dels[dels.length - 1].a : null });
  }
  return out;
}
const rtrimLine = (s) => String(s || "").replace(/[ \t]+$/, "");

// Ordered text-bearing nodes of a Word paragraph: w:t, w:tab ("\t"), w:br/w:cr ("\n").
function wordTextNodes(p) {
  let out = [];
  (function walk(n) {
    for (let c of n.childNodes || []) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === WNS && c.localName === "t") out.push({ node: c, kind: "t", text: c.textContent || "" });
      else if (c.namespaceURI === WNS && c.localName === "tab" && c.parentNode?.localName === "r") out.push({ node: c, kind: "x", text: "\t" });
      else if (c.namespaceURI === WNS && (c.localName === "br" || c.localName === "cr")) out.push({ node: c, kind: "x", text: "\n" });
      else if (!(c.namespaceURI === WNS && (c.localName === "rPr" || c.localName === "pPr"))) walk(c);
    }
  })(p);
  return out;
}
function wordInlineNodes(doc, s) {
  let out = [],
    buf = "";
  let flush = () => {
    if (!buf) return;
    let t = doc.createElementNS(WNS, "w:t");
    t.textContent = buf;
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    out.push(t);
    buf = "";
  };
  for (let ch of s) {
    if (ch === "\t" || ch === "\n") {
      flush();
      out.push(doc.createElementNS(WNS, ch === "\t" ? "w:tab" : "w:br"));
    } else buf += ch;
  }
  flush();
  return out;
}
// Change a paragraph's text by editing only the characters that differ, so
// every untouched run keeps its exact font, size, bold/italic, and color.
function spliceWordParagraph(p, newText, labelDone) {
  let doc = p.ownerDocument,
    segs = wordTextNodes(p),
    old = segs.map((s) => s.text).join("");
  if (old === newText) return;
  // "Label: details" lines (e.g. "Cabling & Networking: ..." → "Data Engineering: ..."):
  // change the details first, then the label, so the label keeps the label's formatting
  // (usually bold) and the details keep the details' formatting.
  let LABEL = /^(\s*[^:\t\n]{1,60}:\s*)/,
    oldLabel = old.match(LABEL)?.[1],
    newLabel = String(newText).match(LABEL)?.[1];
  if (!labelDone && oldLabel && newLabel && oldLabel !== newLabel) {
    spliceWordParagraph(p, oldLabel + String(newText).slice(newLabel.length), true);
    spliceWordParagraph(p, newText, true);
    return;
  }
  let pre = 0;
  while (pre < old.length && pre < newText.length && old[pre] === newText[pre]) pre++;
  let suf = 0;
  while (suf < old.length - pre && suf < newText.length - pre && old[old.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  let delStart = pre,
    delEnd = old.length - suf,
    ins = newText.slice(pre, newText.length - suf),
    anchor = null,
    anchorOffset = 0,
    pos = 0;
  // New text takes the formatting of the run where the change starts. When the change
  // starts exactly where one run ends (e.g. right after a bold "Skills:" label), use the
  // next run, so the label's bold doesn't spread into the new text.
  {
    let at = 0,
      starts = segs.map((s) => ((at += s.text.length), at - s.text.length));
    let i = segs.findIndex((s, k) => s.kind === "t" && starts[k] <= delStart && delStart < starts[k] + s.text.length);
    if (i < 0) i = segs.map((s, k) => (s.kind === "t" && starts[k] + s.text.length === delStart ? k : -1)).filter((k) => k >= 0).pop() ?? -1;
    if (i < 0 && delStart === 0) i = segs.findIndex((s) => s.kind === "t");
    if (i >= 0) {
      anchor = segs[i];
      anchorOffset = delStart - starts[i];
    }
  }
  for (let seg of segs) {
    let start = pos,
      end = pos + seg.text.length;
    pos = end;
    if (seg.kind === "t") {
      let a = Math.max(delStart, start) - start,
        b = Math.min(delEnd, end) - start;
      if (a < b) {
        seg.text = seg.text.slice(0, a) + seg.text.slice(b);
        seg.node.textContent = seg.text;
        seg.node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
      }
    } else if (start >= delStart && end <= delEnd) seg.node.parentNode.removeChild(seg.node);
  }
  if (!ins) return;
  if (!anchor) {
    // No text run yet (empty paragraph): make one using the paragraph-mark formatting.
    let run = doc.createElementNS(WNS, "w:r"),
      markRpr = [...p.childNodes].find((n) => n.localName === "pPr")?.getElementsByTagNameNS(WNS, "rPr")[0];
    if (markRpr) run.appendChild(markRpr.cloneNode(true));
    wordInlineNodes(doc, ins).forEach((n) => run.appendChild(n));
    p.appendChild(run);
    return;
  }
  let node = anchor.node,
    before = anchor.text.slice(0, anchorOffset),
    after = anchor.text.slice(anchorOffset);
  node.textContent = before;
  node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  let ref = node.nextSibling,
    parent = node.parentNode;
  for (let n of [...wordInlineNodes(doc, ins), ...(after ? wordInlineNodes(doc, after) : [])]) parent.insertBefore(n, ref);
  if (!before) parent.removeChild(node);
}
function stripWordIds(p) {
  for (let el of [p, ...p.getElementsByTagName("*")])
    for (let a of [...(el.attributes || [])]) if (a.localName === "paraId" || a.localName === "textId") el.removeAttributeNS(a.namespaceURI, a.localName);
}
async function exportDocxPreserving(blob, editedText) {
  let JSZip = await loadJSZip(),
    zip = await JSZip.loadAsync(blob),
    file = zip.file("word/document.xml");
  if (!file) throw new Error("The DOCX document body could not be found.");
  let doc = new DOMParser().parseFromString(await file.async("text"), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("The DOCX XML could not be read.");
  let body = doc.getElementsByTagNameNS(WNS, "body")[0],
    paras = Array.from(body.getElementsByTagNameNS(WNS, "p")),
    parts = paras.map((p) => wordTextNodes(p).map((s) => s.text).join("").split("\n")),
    orig = [];
  parts.forEach((list, pi) => list.forEach((text, k) => orig.push({ text: rtrimLine(text), pi, k })));
  // Compare on trimmed text: resumes imported before a fix may carry a stray leading tab.
  let editedRaw = String(editedText || "").replace(/\r/g, "").split("\n").map(rtrimLine),
    ops = alignResumeLines(orig.map((o) => o.text.trim()), editedRaw.map((l) => l.trim())),
    lead = (s) => (s.match(/^\s*/) || [""])[0],
    edited = editedRaw,
    next = parts.map((list) => list.slice()),
    inserts = new Map(),
    lastA = -1,
    changed = 0;
  for (let op of ops) {
    if (op.type === "equal") lastA = op.a;
    else if (op.type === "replace") {
      next[orig[op.a].pi][orig[op.a].k] = lead(orig[op.a].text) + edited[op.b].trim();
      lastA = op.a;
      changed++;
    } else if (op.type === "delete") {
      // Blank spacer paragraphs are layout, not content: keep them.
      if (orig[op.a].text.trim()) {
        next[orig[op.a].pi][orig[op.a].k] = null;
        changed++;
      }
      lastA = op.a;
    } else {
      let anchor = op.after ?? lastA,
        pi = anchor >= 0 ? orig[anchor].pi : -1;
      if (!inserts.has(pi)) inserts.set(pi, []);
      inserts.get(pi).push(edited[op.b].trim());
      changed++;
    }
  }
  // Insert new lines as paragraphs cloned from the line they follow (same style/bullet).
  for (let [pi, lines] of inserts) {
    let template = pi >= 0 ? paras[pi] : paras[0];
    if (!template) continue;
    if (pi >= 0 && !wordParagraphText(template).trim()) {
      // A new line after a blank spacer (e.g. the first line of a section): copy the
      // section's first content line, not the heading above the spacer.
      let isHeading = (p) => {
          let t = wordParagraphText(p).trim();
          return typeof jobloomSectionKey === "function" && !!jobloomSectionKey(t) && !/[:\-–—]\s*\S/.test(t);
        },
        after = paras.slice(pi + 1).find((p) => wordParagraphText(p).trim()),
        nearby = after && !isHeading(after) ? after : paras.slice(0, pi).reverse().find((p) => wordParagraphText(p).trim());
      template = nearby || template;
    }
    let ref = pi >= 0 ? paras[pi] : null;
    for (let line of lines) {
      let clone = template.cloneNode(true);
      stripWordIds(clone);
      spliceWordParagraph(clone, line);
      if (ref) ref.parentNode.insertBefore(clone, ref.nextSibling);
      else paras[0].parentNode.insertBefore(clone, paras[0]);
      ref = clone;
    }
  }
  paras.forEach((p, pi) => {
    let list = next[pi],
      kept = list.filter((x) => x !== null),
      oldText = parts[pi].join("\n");
    if (!kept.length && oldText.trim()) {
      p.parentNode.removeChild(p);
      return;
    }
    let text = kept.join("\n");
    if (rtrimLine(text) !== rtrimLine(oldText)) spliceWordParagraph(p, text);
  });
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  return {
    changed,
    blob: await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  };
}

// Read every PDF line with its position, size, and font.
async function readPdfGeometry(bytes) {
  let pdfjs = await loadPdfJs(),
    pdf = await pdfjs.getDocument({ data: bytes }).promise,
    lines = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    let page = await pdf.getPage(n),
      content = await page.getTextContent();
    try {
      await page.getOperatorList();
    } catch {}
    let fontInfo = (id) => {
      let family = content.styles?.[id]?.fontFamily || "",
        name = "";
      try {
        name = page.commonObjs.get(id)?.name || "";
      } catch {}
      return { family, name };
    };
    if (n > 1) lines.push({ text: "", blank: true });
    for (let line of pdfPageLines(content.items)) {
      if (!line.blank) {
        line.page = n - 1;
        line.font = fontInfo(line.parts[0]?.fontName);
      }
      lines.push(line);
    }
  }
  return lines;
}
function standardFontKey(font) {
  let name = `${font?.name || ""} ${font?.family || ""}`,
    bold = /bold|black|heavy|semibold|demi/i.test(font?.name || ""),
    italic = /italic|oblique/i.test(font?.name || "");
  let base = /courier|mono|consolas|menlo/i.test(name)
    ? "Courier"
    : !/sans/i.test(name) && /times|georgia|garamond|cambria|book|palatino|serif|minion/i.test(name)
      ? "Times"
      : "Helvetica";
  if (base === "Times") return bold && italic ? "TimesRomanBoldItalic" : bold ? "TimesRomanBold" : italic ? "TimesRomanItalic" : "TimesRoman";
  return base + (bold && italic ? "BoldOblique" : bold ? "Bold" : italic ? "Oblique" : "");
}
// Group a line's text pieces into columns (e.g. "Job title" … "2021 – 2024").
function pdfColumns(line) {
  let cols = [];
  for (let p of line.parts) {
    let last = cols[cols.length - 1];
    if (last && p.x - last.x1 < line.charW * 2.5) last.x1 = p.x + p.w;
    else cols.push({ x: p.x, x1: p.x + p.w });
  }
  return cols;
}
async function exportPdfPreserving(blob, editedText) {
  let buf = await blob.arrayBuffer(),
    lines = await readPdfGeometry(new Uint8Array(buf.slice(0))),
    { PDFDocument, StandardFonts, rgb } = await loadPdfLib(),
    pdf = await PDFDocument.load(buf.slice(0)),
    pages = pdf.getPages(),
    fonts = {},
    getFont = async (key) => (fonts[key] ||= await pdf.embedFont(StandardFonts[key] || StandardFonts.Helvetica)),
    edited = String(editedText || "").replace(/\r/g, "").split("\n").map(rtrimLine),
    ops = alignResumeLines(lines.map((l) => rtrimLine(l.text)), edited),
    rightEdge = {},
    skipped = 0,
    changed = 0;
  // Usable text width per page: up to the right margin mirrored from the left margin.
  for (let l of lines) if (!l.blank) rightEdge[l.page] = Math.max(rightEdge[l.page] || 0, l.x1);
  let leftEdge = {};
  for (let l of lines) if (!l.blank) leftEdge[l.page] = Math.min(leftEdge[l.page] ?? Infinity, l.x0);
  for (let k of Object.keys(rightEdge)) {
    let pw = pages[k]?.getWidth?.() || 612;
    rightEdge[k] = Math.max(rightEdge[k], pw - (leftEdge[k] ?? 54));
  }
  let safe = (font, s) =>
    [...s]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return ch === "\t" ? " " : "-";
        }
      })
      .join("");
  for (let op of ops) {
    if (op.type === "insert") {
      if (edited[op.b].trim()) skipped++;
      continue;
    }
    if (op.type === "equal") continue;
    let line = lines[op.a];
    if (line.blank || !line.parts?.length) {
      if (op.type === "replace" && edited[op.b].trim()) skipped++;
      continue;
    }
    let page = pages[line.page],
      size = line.h,
      pad = size * 0.3;
    // Cover the original line, then draw the new text in the same place and size.
    page.drawRectangle({ x: line.x0 - 1, y: line.y - pad, width: line.x1 - line.x0 + 2, height: size + pad * 1.4, color: rgb(1, 1, 1) });
    changed++;
    if (op.type === "delete") continue;
    let font = await getFont(standardFontKey(line.font)),
      text = edited[op.b].trim(),
      origCols = pdfColumns(line),
      newCols = text.split(/\s{3,}|\t+/).filter(Boolean),
      draw = (str, x, maxW, align) => {
        str = safe(font, str);
        let s = size,
          w = font.widthOfTextAtSize(str, s);
        if (w > maxW) {
          s = Math.max(size * 0.88, (size * maxW) / w);
          w = font.widthOfTextAtSize(str, s);
        }
        page.drawText(str, { x: align === "right" ? x - w : x, y: line.y, size: s, font, color: rgb(0.08, 0.08, 0.08) });
      };
    if (newCols.length > 1 && newCols.length === origCols.length) {
      newCols.forEach((col, i) => {
        let oc = origCols[i],
          right = i === origCols.length - 1 && rightEdge[line.page] - oc.x1 < 4;
        let maxW = i < origCols.length - 1 ? origCols[i + 1].x - oc.x - 6 : rightEdge[line.page] - oc.x + 2;
        draw(col, right ? oc.x1 : oc.x, maxW, right ? "right" : "left");
      });
    } else draw(text.replace(/\s{2,}/g, " "), line.x0, rightEdge[line.page] - line.x0 + 2, "left");
  }
  return { changed, skipped, blob: new Blob([await pdf.save()], { type: "application/pdf" }) };
}

// The original .docx to use as the template: this resume's stored file, or a
// stored .docx of the same resume (same name line at the top).
async function findOriginalDocx(base) {
  if (!base) return null;
  let topLine = (t) => (String(t || "").split("\n").find((l) => l.trim()) || "").trim().toLowerCase();
  let candidates = [base, ...data.resumes.filter((r) => r !== base && r.originalType === "docx" && topLine(r.text) && topLine(r.text) === topLine(base.text))];
  for (let r of candidates) {
    if (r.originalType !== "docx") continue;
    let file = await getResumeFile(r.id).catch(() => null);
    if (file) return file;
  }
  return null;
}
// Ask once for the original .docx so the download keeps its exact layout; it is
// remembered for this resume. Resolves to the File, or null for the standard layout.
function askForOriginalDocx(base) {
  return new Promise((resolve) => {
    document.getElementById("docx-original-ask")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="docx-original-ask" class="docx-ask" role="dialog" aria-modal="true" aria-labelledby="docx-ask-title"><div class="docx-ask-box">
<h3 id="docx-ask-title">Keep your resume’s exact formatting?</h3>
<p>“${esc(base?.name || "This resume")}” was added as text, so this browser doesn’t have its original Word file. Choose your original <b>.docx</b> and the tailored resume will keep its layout exactly: centered name and contact line, bold labels, bullets, spacing, and right-aligned dates. It’s remembered for next time.</p>
<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>
<div class="docx-ask-actions"><button class="btn btn-primary btn-sm" data-pick>Choose original .docx</button><button class="btn btn-sm" data-plain>Download standard layout</button><button class="btn btn-sm" data-cancel>Cancel</button></div>
</div></div>`,
    );
    let box = document.getElementById("docx-original-ask"),
      input = box.querySelector("input"),
      done = (v) => {
        box.remove();
        resolve(v);
      };
    box.querySelector("[data-pick]").onclick = () => input.click();
    box.querySelector("[data-plain]").onclick = () => done(null);
    box.querySelector("[data-cancel]").onclick = () => done(false);
    input.onchange = async () => {
      let file = input.files?.[0];
      if (!file) return;
      if (!/\.docx$/i.test(file.name)) return toast("Please choose a .docx file.");
      if (base) {
        await storeResumeFile(base.id, file);
        base.originalType = "docx";
        base.originalFileName = file.name;
        localStorage.setItem(KEY, JSON.stringify(data));
      }
      done(file);
    };
  });
}
// Download the tailored resume in the original file's own format and styling.
window.downloadTailoredDocx = async function (baseId) {
  try {
    let base = data.resumes.find((x) => x.id === baseId),
      text = tailoredDraftText(),
      original = await findOriginalDocx(base);
    if (!original && base?.originalType !== "pdf") {
      original = await askForOriginalDocx(base);
      if (original === false) return;
    }
    if (original) {
      let { blob } = await exportDocxPreserving(original, text);
      saveBlob(blob, tailoredFileName(baseId, "docx"));
      toast("Tailored DOCX downloaded in your original document’s fonts, sizes, spacing, and bullet styles.");
      return;
    }
    let JSZip = await loadJSZip();
    saveBlob(await makeTextDocx(JSZip, text), tailoredFileName(baseId, "docx"));
    toast(base?.originalType === "pdf" ? "DOCX built from your PDF’s text with its spacing. For the original look, download the tailored PDF." : "Tailored DOCX downloaded.");
  } catch (e) {
    toast(e.message || "DOCX export failed. Review the resume and try again.");
  }
};
// Download the tailored resume as a PDF. It is rebuilt from the tailored text (not drawn over
// the original), so there is no hidden old text for an ATS to read and nothing runs off the
// page; margins, font and size follow the original PDF when there is one.
window.downloadTailoredPdf = async function (baseId) {
  try {
    let base = data.resumes.find((x) => x.id === baseId),
      text = tailoredDraftText(),
      original = base?.originalType === "pdf" ? await getResumeFile(baseId).catch(() => null) : null,
      word = !original ? await findOriginalDocx(base).catch(() => null) : null,
      style = original ? await pdfStyleOf(original) : word ? await docxStyleOf(word) : {};
    saveBlob(await makeResumePdf(text, style), tailoredFileName(baseId, "pdf"));
    toast(
      original
        ? "PDF downloaded in your resume’s layout, with clean text that ATS systems read correctly."
        : word
          ? "PDF downloaded with your Word resume’s margins, text size and font style (serif or sans-serif), as clean text ATS systems read correctly."
          : "PDF downloaded.",
    );
  } catch (e) {
    toast(e.message || "PDF export failed. Review the resume and try again.");
  }
};
window.exportPdfPreserving = exportPdfPreserving;
window.alignResumeLines = alignResumeLines;
