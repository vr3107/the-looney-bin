function loadJSZip() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    let s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload = () =>
      window.JSZip
        ? resolve(window.JSZip)
        : reject(new Error("JSZip did not load"));
    s.onerror = () => reject(new Error("Could not load DOCX export support"));
    document.head.appendChild(s);
  });
}
const WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function wordParagraphText(p) {
  let out = "";
  function walk(n) {
    for (let c of n.childNodes || []) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === WNS && c.localName === "t")
        out += c.textContent || "";
      else if (c.namespaceURI === WNS && c.localName === "tab") out += "\t";
      else if (
        c.namespaceURI === WNS &&
        (c.localName === "br" || c.localName === "cr")
      )
        out += "\n";
      // Paragraph/run properties hold tab-stop definitions, not text.
      else if (!(c.namespaceURI === WNS && (c.localName === "pPr" || c.localName === "rPr"))) walk(c);
    }
  }
  walk(p);
  return out;
}
async function readWordDocxText(file) {
  let JSZip = await loadJSZip(),
    zip = await JSZip.loadAsync(file),
    xml = await zip.file("word/document.xml")?.async("text");
  if (!xml) throw new Error("The Word document body could not be read.");
  let doc = new DOMParser().parseFromString(xml, "application/xml"),
    body = doc.getElementsByTagNameNS(WNS, "body")[0];
  if (doc.getElementsByTagName("parsererror").length || !body)
    throw new Error("The Word document structure could not be read.");
  return Array.from(body.getElementsByTagNameNS(WNS, "p"))
    .map(wordParagraphText)
    .join("\n");
}
function newWordRun(doc, text, rPr) {
  let run = doc.createElementNS(WNS, "w:r");
  if (rPr) run.appendChild(rPr.cloneNode(true));
  let pieces = String(text).split("\n");
  pieces.forEach((part, i) => {
    if (i) {
      let br = doc.createElementNS(WNS, "w:br");
      run.appendChild(br);
    }
    let t = doc.createElementNS(WNS, "w:t");
    t.textContent = part;
    if (/^\s|\s$/.test(part))
      t.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace",
        "xml:space",
        "preserve",
      );
    run.appendChild(t);
  });
  return run;
}
function replaceWordParagraph(p, text) {
  let keep = null;
  for (let n = p.firstChild; n; n = n.nextSibling)
    if (n.nodeType === 1 && n.namespaceURI === WNS && n.localName === "pPr") {
      keep = n;
      break;
    }
  let rPr = p.getElementsByTagNameNS(WNS, "rPr")[0] || null;
  for (let n = p.firstChild; n;) {
    let next = n.nextSibling;
    if (n !== keep) p.removeChild(n);
    n = next;
  }
  let run = newWordRun(p.ownerDocument, text, rPr);
  p.appendChild(run);
}
function summaryWordParagraph(doc, text, template) {
  let p = template ? template.cloneNode(true) : doc.createElementNS(WNS, "w:p");
  for (let a of Array.from(p.attributes || []))
    if (a.localName === "paraId" || a.localName === "textId")
      p.removeAttributeNS(a.namespaceURI, a.localName);
  replaceWordParagraph(p, text);
  return p;
}
function addSummaryToWord(doc, body, summary) {
  let paragraphs = Array.from(body.getElementsByTagNameNS(WNS, "p")),
    summaryRe =
      /^(professional\s+)?(summary|profile|objective|career summary)\s*:?\s*$/i,
    experienceRe =
      /^(professional\s+)?(work\s+)?(experience|employment history|career history)\s*:?\s*$/i,
    anchor =
      paragraphs.find((p) => summaryRe.test(wordParagraphText(p).trim())) ||
      paragraphs.find((p) => experienceRe.test(wordParagraphText(p).trim())) ||
      paragraphs[Math.min(1, paragraphs.length - 1)] ||
      null,
    template =
      anchor?.nextElementSibling?.namespaceURI === WNS &&
      anchor.nextElementSibling.localName === "p"
        ? anchor.nextElementSibling
        : anchor || paragraphs[0] || null,
    parent = anchor?.parentNode || body,
    reference = anchor ? anchor.nextSibling : body.firstChild,
    lines = summary.split(/\r?\n/).filter((x) => x.trim());
  lines.forEach((line) =>
    parent.insertBefore(summaryWordParagraph(doc, line, template), reference),
  );
}
function xmlEscape(x) {
  return String(x)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
// Rebuild a resume as a Word document that follows the usual resume layout:
// centered bold name, centered contact line, bold section headings with a rule,
// bold "Label:" prefixes, job titles in bold with dates right-aligned, and real
// Word bullets. Used only when the original .docx isn't available.
const DOCX_HEADING_RE =
  /^(?:(?:professional|career|executive|personal|technical|core|relevant|work|selected|academic|key)\s+)?(?:summary|profile|objective|about me|skills|competencies|core competencies|technologies|tools|experience|work experience|employment history|history|projects?|education|certifications?|licenses?|awards?(?: and honors?)?|honors?|publications?|leadership|volunteer(?:ing)?(?: experience)?|languages|interests|activities|accomplishments?)$/i;
const DOCX_DATE_RE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b(?:19|20)\d{2})\s*(?:[-–—]|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b(?:19|20)\d{2}|present|current)\s*$/i;
function docxRun(text, opts = {}) {
  let rp = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' + (opts.bold ? "<w:b/>" : "") + '<w:sz w:val="' + (opts.size || 21) + '"/></w:rPr>';
  return String(text)
    .split("\t")
    .map((part, i) => "<w:r>" + rp + (i ? "<w:tab/>" : "") + (part ? '<w:t xml:space="preserve">' + xmlEscape(part) + "</w:t>" : "") + "</w:r>")
    .join("");
}
function docxPara(runs, ppr = "") {
  return "<w:p><w:pPr>" + ppr + "</w:pPr>" + runs + "</w:p>";
}
// ---------------------------------------------------------------------------
// Shared resume layout: what each line is (name, contact, heading, job title,
// bullet, "Label: details", text). Used by the rebuilt .docx and the PDF.
// ---------------------------------------------------------------------------
const RESUME_BULLET_RE = /^(\s*)[•●▪◦*-](?:\s*[•●▪◦])*\s+/;
const RESUME_LABEL_RE = /^([A-Z][A-Za-z0-9 &/,.+()'-]{1,45}:)\s*(.*)$/;
function resumeHeadingOf(t) {
  let bare = String(t).trim().replace(/[:\s]+$/, "");
  return DOCX_HEADING_RE.test(bare) && bare.length < 45 ? bare : "";
}
// A job title line: "Title | Company<tab or wide gap>Location | Dates", or ending in a date range.
function resumeTitleParts(line, inRoles) {
  let t = String(line).trim();
  if (RESUME_BULLET_RE.test(line)) return null;
  if (line.includes("\t")) {
    let [left, ...rest] = t.split("\t");
    return { left: left.trim(), right: rest.join(" ").trim() };
  }
  // Split at the first wide gap: "Title | Company      Location      Dates" → left | "Location | Dates".
  let cols = t.split(/\s{3,}/);
  if (cols.length > 1 && (inRoles || DOCX_DATE_RE.test(cols[cols.length - 1])))
    return { left: cols[0].trim(), right: cols.slice(1).map((c) => c.trim()).join("  |  ").replace(/\s*\|\s*\|\s*/g, "  |  ") };
  let date = t.match(DOCX_DATE_RE);
  if (date && inRoles && date.index > 0) return { left: t.slice(0, date.index).replace(/[\s,|–—-]+$/, ""), right: date[0].trim() };
  return null;
}
function resumeLayout(text) {
  let lines = String(text || "").replace(/\r/g, "").split("\n"),
    items = [],
    first = lines.findIndex((l) => l.trim()),
    section = "",
    afterTitle = false,
    // Resumes read from a PDF or plain text carry bullet symbols; Word resumes don't.
    useMarkers = lines.filter((l) => RESUME_BULLET_RE.test(l)).length >= 3;
  lines.forEach((raw, i) => {
    let line = raw.replace(/\s+$/, ""),
      t = line.trim();
    if (!t) return items.push({ kind: "blank" });
    if (i === first) return items.push({ kind: "name", text: t });
    let heading = resumeHeadingOf(t);
    if (!section && !heading && (/@|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|linkedin|github|https?:|\|/i.test(t) || i <= first + 2))
      return items.push({ kind: "contact", text: t.replace(/\s{2,}/g, "  ") });
    if (heading) {
      section = heading.toLowerCase();
      afterTitle = false;
      return items.push({ kind: "heading", text: heading.toUpperCase() });
    }
    let bullet = RESUME_BULLET_RE.test(line),
      body = t.replace(RESUME_BULLET_RE, ""),
      inRoles = /experience|employment|history|projects?|volunteer|leadership/.test(section),
      title = resumeTitleParts(line, inRoles),
      label = !bullet && body.match(RESUME_LABEL_RE);
    if (title) {
      afterTitle = true;
      return items.push({ kind: "title", left: title.left, right: title.right });
    }
    if (afterTitle && !bullet && !(useMarkers && label)) {
      afterTitle = false;
      return items.push({ kind: "sub", text: body });
    }
    afterTitle = false;
    // Word resumes keep bullets as list formatting, so inside roles plain lines are bullets.
    if (bullet || (!useMarkers && inRoles && body.length > 25)) return items.push({ kind: "bullet", text: body });
    if (label) return items.push({ kind: "label", label: label[1], text: label[2] });
    return items.push({ kind: "text", text: body });
  });
  return items;
}
window.resumeLayout = resumeLayout;
// A PDF is read as visual lines, so a bullet that wraps becomes two lines. Join each wrapped
// line back onto the bullet or paragraph it belongs to (one bullet = one line), and collapse
// doubled bullet symbols ("•• ").
function joinWrappedLines(text) {
  let lines = String(text || "").replace(/\r/g, "").split("\n"),
    out = [],
    section = "",
    prev = null;
  for (let raw of lines) {
    let line = raw.replace(/\s+$/, ""),
      t = line.trim();
    if (!t) {
      out.push("");
      prev = null;
      continue;
    }
    let heading = resumeHeadingOf(t);
    if (heading) {
      section = heading.toLowerCase();
      out.push(line);
      prev = null;
      continue;
    }
    let indent = (line.match(/^ */) || [""])[0].length,
      mark = line.match(RESUME_BULLET_RE),
      inRoles = /experience|employment|history|projects?|volunteer|leadership/.test(section),
      isTitle = !!resumeTitleParts(line, inRoles),
      isLabel = RESUME_LABEL_RE.test(t);
    if (mark) {
      let rest = line.slice(mark[0].length).trim();
      // A "bullet" that starts mid-sentence (lowercase) is the second half of the bullet above.
      if (prev?.kind === "bullet" && (/^[a-z]/.test(rest) || /[,&]$|\b(and|or|with|of|to|for)$/.test(out[out.length - 1].trim()))) {
        out[out.length - 1] = out[out.length - 1].replace(/\s+$/, "") + " " + rest;
        continue;
      }
      out.push(mark[1] + "• " + rest);
      prev = { kind: "bullet", indent };
      continue;
    }
    if (prev && section && !isTitle && !isLabel && prev.kind !== "title") {
      let last = out[out.length - 1].trim(),
        ended = /[.;!?]$/.test(last),
        lower = /^[a-z(]/.test(t),
        joins =
          prev.kind === "bullet" ? indent > prev.indent || lower || !ended : /summary|profile|objective|about/.test(section) || lower || !ended;
      if (joins) {
        out[out.length - 1] = out[out.length - 1].replace(/\s+$/, "") + " " + t;
        continue;
      }
    }
    out.push(line);
    prev = { kind: isTitle ? "title" : isLabel ? "label" : "text", indent };
  }
  return out.join("\n");
}
window.joinWrappedLines = joinWrappedLines;
function resumeDocxBody(text) {
  let spacing = (b, a) => '<w:spacing w:before="' + b + '" w:after="' + a + '" w:line="264" w:lineRule="auto"/>',
    RIGHT_TAB = '<w:tabs><w:tab w:val="right" w:pos="10440"/></w:tabs>';
  return resumeLayout(text)
    .map((it) => {
      switch (it.kind) {
        case "blank":
          return docxPara("", spacing(0, 0));
        case "name":
          return docxPara(docxRun(it.text, { bold: true, size: 32 }), '<w:jc w:val="center"/>' + spacing(0, 40));
        case "contact":
          return docxPara(docxRun(it.text), '<w:jc w:val="center"/>' + spacing(0, 60));
        case "heading":
          return docxPara(docxRun(it.text, { bold: true, size: 23 }), '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>' + spacing(160, 80));
        case "title":
          return docxPara(docxRun(it.left, { bold: true }) + docxRun("\t" + it.right, { bold: true }), RIGHT_TAB + "<w:keepNext/>" + spacing(100, 0));
        case "sub":
          return docxPara(docxRun(it.text), "<w:keepNext/>" + spacing(0, 40));
        case "bullet":
          return docxPara(docxRun(it.text), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="360" w:hanging="270"/>' + spacing(0, 30));
        case "label":
          return docxPara(docxRun(it.label, { bold: true }) + docxRun(" " + it.text), spacing(0, 30));
        default:
          return docxPara(docxRun(it.text), spacing(0, 40));
      }
    })
    .join("");
}
async function makeTextDocx(JSZip, text) {
  let zip = new JSZip(),
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W + "><w:body>" +
      resumeDocxBody(text) +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="900" w:bottom="720" w:left="900" w:header="450" w:footer="450" w:gutter="0"/></w:sectPr></w:body></w:document>',
    numbering =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ' + W +
      '><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="270"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + W +
      '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
    types =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  zip.file("[Content_Types].xml", types);
  zip.file("_rels/.rels", rels);
  zip.file("word/_rels/document.xml.rels", docRels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/numbering.xml", numbering);
  zip.file("word/styles.xml", styles);
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
window.downloadRebuiltDocx = async function (baseId) {
  try {
    let base = data.resumes.find((x) => x.id === baseId),
      summary = document.getElementById("tailored-summary")?.value || "",
      body = document.getElementById("tailored-body")?.value || "",
      text = composedResume(summary, body),
      JSZip = await loadJSZip(),
      blob = await makeTextDocx(JSZip, text),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download =
      (base?.originalFileName || "jobloom-resume").replace(/\.[^.]+$/, "") +
      "-edited.docx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(
      "Rebuilt DOCX includes all current edits; its formatting is a clean text layout.",
    );
  } catch (e) {
    toast(e.message || "DOCX export failed. Review the resume and try again.");
  }
};
window.downloadTailoredDocx = async function (baseId) {
  try {
    let base = data.resumes.find((x) => x.id === baseId),
      editedBody = document.getElementById("tailored-body")?.value || "",
      summary = document.getElementById("tailored-summary")?.value || "",
      text = composedResume(summary, editedBody),
      JSZip = await loadJSZip(),
      out,
      sourceStyle = false;
    if (base?.originalType === "docx") {
      let blob = await getResumeFile(baseId);
      if (!blob)
        throw new Error("Original DOCX is not available in this browser.");
      let zip = await JSZip.loadAsync(blob),
        file = zip.file("word/document.xml");
      if (!file) throw new Error("The DOCX document body could not be found.");
      let xml = await file.async("text"),
        doc = new DOMParser().parseFromString(xml, "application/xml");
      if (doc.getElementsByTagName("parsererror").length)
        throw new Error("The DOCX XML could not be read.");
      let body = doc.getElementsByTagNameNS(WNS, "body")[0];
      if (!body) throw new Error("The DOCX body could not be found.");
      let paragraphs = Array.from(body.getElementsByTagNameNS(WNS, "p")),
        parts = String(editedBody).replace(/\r/g, "").split("\n");
      if (paragraphs.length === parts.length) {
        paragraphs.forEach((p, i) => {
          if (wordParagraphText(p) !== parts[i])
            replaceWordParagraph(p, parts[i]);
        });
        out = await zip
          .file("word/document.xml", new XMLSerializer().serializeToString(doc))
          .generateAsync({
            type: "blob",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
        sourceStyle = true;
      } else out = await makeTextDocx(JSZip, text);
    } else out = await makeTextDocx(JSZip, text);
    let url = URL.createObjectURL(out),
      a = document.createElement("a");
    a.href = url;
    a.download =
      (base?.originalFileName || "jobloom-resume").replace(/\.[^.]+$/, "") +
      "-tailored.docx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(
      sourceStyle
        ? "Edited DOCX downloaded with the original document structure and paragraph styles."
        : "Rebuilt DOCX downloaded with all accepted edits; review its clean text layout.",
    );
  } catch (e) {
    toast(e.message || "DOCX export failed. Review the resume and try again.");
  }
};
