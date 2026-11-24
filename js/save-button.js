// "Save to Looney Bin" browser button (a bookmarklet). The user clicks it while viewing a job
// posting or a search-results page on Dice, LinkedIn, Indeed, ZipRecruiter, Glassdoor or a
// company careers page. It reads only the page they're viewing, opens The Looney Bin, and
// hands over the jobs; the user confirms which to save. Nothing runs unless they click it.

// The code that runs on the job site (kept small and self-contained; "__APP__" = this site).
function looneySaveButtonCode() {
  var APP = "__APP__";
  var clean = function (s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  };
  var htmlText = function (h) {
    try {
      var t = new DOMParser().parseFromString(String(h || ""), "text/html").body.textContent;
      return /<[a-z][\s\S]*>/i.test(t) ? new DOMParser().parseFromString(t, "text/html").body.textContent : t;
    } catch (e) {
      return String(h || "");
    }
  };
  var place = function (x) {
    var locs = [].concat(x.jobLocation || []).map(function (l) {
      var a = (l && l.address) || {};
      return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(", ");
    });
    if (/TELECOMMUTE/i.test(x.jobLocationType || "")) locs.push("Remote");
    return locs.filter(Boolean).join(" / ");
  };
  var pay = function (x) {
    var b = x.baseSalary || x.estimatedSalary,
      v = b && (b.value || b);
    if (!v) return "";
    var lo = v.minValue || v.value,
      hi = v.maxValue;
    return lo ? (b.currency || "") + " " + lo + (hi && hi !== lo ? "–" + hi : "") + (v.unitText ? " / " + String(v.unitText).toLowerCase() : "") : "";
  };
  var jobs = [];
  // 1. A job posting page: most job sites describe it in standard JobPosting data.
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
    try {
      var d = JSON.parse(s.textContent);
      [].concat(d["@graph"] || d).forEach(function (x) {
        if (x && /JobPosting/.test([].concat(x["@type"]).join(" ")))
          jobs.push({
            title: clean(x.title),
            company: clean((x.hiringOrganization && (x.hiringOrganization.name || x.hiringOrganization)) || ""),
            location: place(x),
            description: clean(htmlText(x.description)).slice(0, 12000),
            url: location.href.split("#")[0],
            published: x.datePosted || "",
            salary: pay(x),
            type: [].concat(x.employmentType || []).join(", "),
          });
      });
    } catch (e) {}
  });
  // 2. A search-results page: the job links listed on it, with the text of each job card.
  if (!jobs.length) {
    var pattern = /dice\.com\/job-detail\/|linkedin\.com\/jobs\/view\/|indeed\.com\/(viewjob|rc\/clk|pagead\/clk)|[?&]jk=[a-z0-9]|ziprecruiter\.com\/(c|jobs|k)\/|glassdoor\.com\/job-listing\/|adzuna\.[a-z.]+\/(details|land\/ad)\//i,
      seen = {};
    document.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.href;
      if (!pattern.test(href)) return;
      var key = (href.match(/jk=([a-z0-9]+)/i) || [])[1] || href.split("?")[0].replace(/\/$/, "");
      var title = clean(a.innerText || a.textContent);
      if (seen[key] || title.length < 3 || title.length > 160) return;
      var card = a.closest("li, article, [data-testid*=card i], [class*=card i], [class*=result i], [class*=job i]") || a.parentElement;
      seen[key] = 1;
      jobs.push({
        title: title,
        url: href,
        lines: String(card.innerText || "")
          .split("\n")
          .map(clean)
          .filter(Boolean)
          .slice(0, 14),
      });
    });
  }
  if (!jobs.length) {
    alert("Save to Looney Bin: no job postings found on this page.\nOpen a job posting, or a search-results page on Dice, LinkedIn or Indeed, and click it again.");
    return;
  }
  var payload = { type: "looney-import", site: location.hostname, page: location.href, jobs: jobs.slice(0, 100) };
  var win = window.open(APP + "/#import", "looneybin");
  if (!win) {
    alert("Save to Looney Bin: allow pop-ups for this site, then click it again.");
    return;
  }
  var sent = false;
  window.addEventListener("message", function onReady(e) {
    if (e.origin === APP && e.data === "looney-ready" && !sent) {
      sent = true;
      win.postMessage(payload, APP);
      window.removeEventListener("message", onReady);
    }
  });
}
function looneySaveButtonHref() {
  let code = `(${looneySaveButtonCode.toString()})()`.replace('"__APP__"', JSON.stringify(location.origin));
  // One line for the bookmark: drop whole-line comments first, or they'd swallow the code after them.
  code = code
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.trim())
    .join(" ");
  return "javascript:" + encodeURIComponent(code);
}
window.looneySaveButtonHref = looneySaveButtonHref;

// ---------- receiving jobs in The Looney Bin ----------
const SITE_NAMES = [
  [/dice\.com$/, "Dice"],
  [/linkedin\.com$/, "LinkedIn"],
  [/indeed\.com$/, "Indeed"],
  [/ziprecruiter\.com$/, "ZipRecruiter"],
  [/glassdoor\.com$/, "Glassdoor"],
  [/adzuna\.[a-z.]+$/, "Adzuna"],
  [/greenhouse\.io$/, "Company sites"],
  [/lever\.co$/, "Company sites"],
  [/ashbyhq\.com$/, "Company sites"],
];
function siteName(host) {
  let h = String(host || "").replace(/^www\./, "");
  return (SITE_NAMES.find(([re]) => re.test(h)) || [])[1] || h;
}
// A search-results card's lines → company, location, posted, salary, type.
function parseCardLines(lines, title) {
  let rest = (lines || []).filter((l) => l !== title && l.length < 200),
    out = { company: "", location: "", published: "", salary: "", type: "" },
    ago = /\b(today|yesterday|just now|\d+\s*(minute|min|hour|hr|day|week|month)s?\s*ago|\d+[mhdw]\b)/i;
  for (let line of rest) {
    for (let part of line.split(/\s+[•·|]\s+/)) {
      let matched = false;
      if (ago.test(part)) {
        if (!out.published) out.published = relativeDate(part);
        matched = true;
        part = part.replace(ago, "").replace(/[\s•·|,-]+$/, "").trim();
        if (!part) continue;
      }
      if (!out.salary && /\$|usd|per hour|\/hr|\/yr|\d{2,3}k\b|\b\d{5,6}\b/i.test(part)) out.salary = part;
      else if (!out.type && /full[- ]time|part[- ]time|contract|third party|internship|temporary/i.test(part)) out.type = part;
      else if (!out.location && /remote|hybrid|on-?site|,\s*[A-Z]{2}\b|united states|\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i.test(part)) out.location = part;
      else if (!matched && !out.company && part.length <= 80 && !/apply|save|easy|promoted|new|viewed|actively|alumni|applicants?/i.test(part)) out.company = part;
    }
  }
  return out;
}
function relativeDate(s) {
  let t = String(s).toLowerCase();
  if (/today|just now/.test(t)) return new Date().toISOString();
  if (/yesterday/.test(t)) return new Date(Date.now() - 864e5).toISOString();
  let m = t.match(/(\d+)\s*(minute|min|m\b|hour|hr|h\b|day|d\b|week|w\b|month)/);
  if (!m) return "";
  let unit = { minute: 6e4, min: 6e4, m: 6e4, hour: 36e5, hr: 36e5, h: 36e5, day: 864e5, d: 864e5, week: 6048e5, w: 6048e5, month: 2592e6 }[m[2]];
  return new Date(Date.now() - Number(m[1]) * unit).toISOString();
}
function importedJob(j, site) {
  site = j.site || site;
  let card = j.lines ? parseCardLines(j.lines, j.title) : {},
    source = siteName(site),
    id = (String(j.url).match(/jk=([a-z0-9]+)/i) || [])[1] || String(j.url).split("?")[0].split("/").filter(Boolean).pop();
  let job = baseJob(
    source,
    id || String(Date.now()),
    String(j.title || "").slice(0, 200),
    String(j.company || card.company || "").slice(0, 160),
    String(j.location || card.location || "").slice(0, 200),
    String(j.url || ""),
    String(j.description || (j.lines || []).join(" · ")).slice(0, 12000),
    [j.type || card.type, "Saved from " + source].filter(Boolean),
    j.published || card.published || "",
    String(j.salary || card.salary || "").slice(0, 120),
  );
  job.sources = [{ name: source, url: job.url }];
  job.importedFrom = site;
  return job;
}
function showImportDialog(payload) {
  let site = siteName(payload.site),
    jobs = (Array.isArray(payload.jobs) ? payload.jobs : []).slice(0, 100).map((j) => importedJob(j, payload.site)).filter((j) => /^https?:/i.test(j.url) && j.title),
    known = new Set(data.jobs.filter((x) => x.url).map((x) => postingKey(x.url)));
  document.getElementById("import-dialog")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="import-dialog" class="docx-ask" role="dialog" aria-modal="true" aria-labelledby="import-title"><div class="docx-ask-box import-box">
<h3 id="import-title">Save ${jobs.length} job${jobs.length === 1 ? "" : "s"} from ${esc(site)}?</h3>
<p class="help">${payload.pasted ? "From the search results you pasted." : `From the page you were viewing on ${esc(payload.site)}.`} Untick any you don’t want.${jobs.some((j) => !j.description || j.description.length < 300) ? " Jobs saved from a search-results page include the card’s details; open a posting and save it again to add its full description." : ""}</p>
<div class="import-list">${jobs
      .map(
        (j, i) => `<label class="import-row"><input type="checkbox" data-import="${i}" ${known.has(postingKey(j.url)) ? "disabled" : "checked"}><span><b>${esc(j.title)}</b><small>${esc([j.company, j.location, j.salary].filter(Boolean).join(" · "))}${known.has(postingKey(j.url)) ? " · already in your tracker" : ""}</small></span></label>`,
      )
      .join("")}</div>
<div class="docx-ask-actions"><button class="btn btn-primary btn-sm" data-save>Save to tracker</button><button class="btn btn-sm" data-cancel>Cancel</button></div>
</div></div>`,
  );
  let box = document.getElementById("import-dialog");
  box.querySelector("[data-cancel]").onclick = () => box.remove();
  box.querySelector("[data-save]").onclick = () => {
    let picked = [...box.querySelectorAll("[data-import]:checked")].map((c) => jobs[Number(c.dataset.import)]);
    // Skips postings already tracked (also under another link), and repeats within this list.
    for (let j of picked)
      if (!trackedPosting(j.url))
        data.jobs.push({ ...j, id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), added: Date.now(), status: "Saved", resumeId: data.activeResumeId });
    persist();
    box.remove();
    toast(`Saved ${picked.length} job${picked.length === 1 ? "" : "s"} from ${site} to your tracker.`);
    if (typeof navigate === "function") navigate("tracker");
  };
}
window.showImportDialog = showImportDialog;
// Opened by the button: tell the job-site tab we're ready, then accept its jobs.
if (location.hash === "#import" && window.opener) {
  window.addEventListener("message", (e) => {
    if (e.source !== window.opener || e.data?.type !== "looney-import") return;
    history.replaceState(null, "", location.pathname + location.search);
    let show = () => showImportDialog({ ...e.data, site: (() => { try { return new URL(e.origin).hostname; } catch { return e.data.site; } })() });
    document.readyState === "complete" ? show() : window.addEventListener("load", show);
  });
  window.opener.postMessage("looney-ready", "*");
}

// ---------- pasting a copied search-results page ----------
const JOB_LINK = /dice\.com\/job-detail\/|linkedin\.com\/(comm\/)?jobs\/view\/|indeed\.com\/(viewjob|rc\/clk|pagead\/clk)|[?&]jk=[a-z0-9]|ziprecruiter\.com\/(c|jobs|k)\/|glassdoor\.com\/(job-listing|partner\/jobListing)|adzuna\.[a-z.]+\/(details|land\/ad)\/|greenhouse\.io\/[^/]+\/jobs\/|jobs\.lever\.co\/|jobs\.ashbyhq\.com\/|smartrecruiters\.com\/[^/]+\/\d|myworkdayjobs\.com\/.+\/job\/|\/(job|jobs|careers|positions?|openings?)\/[^?#]*[a-z0-9-]{6,}/i;
const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TD", "SECTION", "ARTICLE", "HEADER", "FOOTER", "BR", "DD", "DT", "TABLE"]);
// Text of an element split into its visual lines (a parsed, unrendered page has no innerText).
function blockLines(el) {
  let lines = [],
    cur = "",
    flush = () => {
      let t = cur.replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
      cur = "";
    };
  (function walk(n) {
    for (let c of n.childNodes) {
      if (c.nodeType === 3) cur += c.textContent;
      else if (c.nodeType === 1 && !/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(c.tagName)) {
        let block = BLOCK_TAGS.has(c.tagName);
        if (block) flush();
        walk(c);
        if (block) flush();
      }
    }
  })(el);
  flush();
  return lines;
}
// Jobs in pasted HTML: each link to a job posting, with the text of its card.
function jobsFromPastedHtml(html) {
  let doc = new DOMParser().parseFromString(String(html || ""), "text/html"),
    seen = new Set(),
    jobs = [];
  for (let a of doc.querySelectorAll("a[href]")) {
    let href = a.getAttribute("href") || "";
    if (!/^https?:/i.test(href) || !JOB_LINK.test(href)) continue;
    let title = (a.textContent || "").replace(/\s+/g, " ").trim(),
      key = (href.match(/jk=([a-z0-9]+)/i) || [])[1] || href.split(/[?#]/)[0].replace(/\/$/, "");
    if (seen.has(key) || title.length < 6 || title.length > 160 || /^(jobs?|careers?|apply( now)?|view (job|details)|see more|learn more)$/i.test(title)) continue;
    seen.add(key);
    let card = a.closest("li, article, tr, [data-testid*=card i], [class*=card i], [class*=result i], [class*=listing i]") || a.parentElement?.parentElement || a.parentElement;
    let host = "";
    try {
      host = new URL(href).hostname;
    } catch {}
    jobs.push({ title, url: href, lines: blockLines(card).slice(0, 14), site: host });
  }
  return jobs;
}
window.importPastedResults = function (html, text) {
  let jobs = jobsFromPastedHtml(html);
  if (!jobs.length && text) {
    // Plain text only: keep any job links in it.
    jobs = [...new Set(String(text).match(/https?:\/\/\S+/g) || [])].filter((u) => JOB_LINK.test(u)).map((u) => ({ title: u.split(/[?#]/)[0].split("/").filter(Boolean).pop().replace(/[-_]+/g, " "), url: u, site: new URL(u).hostname }));
  }
  if (!jobs.length) return false;
  let hosts = jobs.map((j) => j.site),
    site = hosts.sort((a, b) => hosts.filter((h) => h === b).length - hosts.filter((h) => h === a).length)[0];
  showImportDialog({ site, jobs, pasted: true });
  return true;
};

// ---------- the "Save to Looney Bin" panel on Find jobs ----------
window.renderSaveButtonPanel = function () {
  let box = document.getElementById("savebuttonpanel");
  if (!box) return;
  box.innerHTML = `<details class="company-panel"><summary><b>Save jobs from Dice, LinkedIn &amp; Indeed</b> · a one-click button for your browser</summary>
<div class="save-steps">
  <a class="save-bookmarklet" data-lb-bookmarklet href="${esc(looneySaveButtonHref())}" onclick="event.preventDefault(); toast('Drag this button to your bookmarks bar, then click it on a job page.')" title="Drag me to your bookmarks bar">＋ Save to Looney Bin</a>
  <ol class="help">
    <li><b>Drag</b> the green button to your browser’s bookmarks bar (once). No bookmarks bar? Press Ctrl/⌘+Shift+B.</li>
    <li>Browse <b>Dice, LinkedIn, Indeed, ZipRecruiter or Glassdoor</b> as usual, signed in, with any filters. The “on Dice ↗ / on LinkedIn ↗” links above open your search there.</li>
    <li>Click <b>Save to Looney Bin</b> on a job posting (saves it with the full description) or a search-results page (saves every job listed). You confirm before anything is saved.</li>
  </ol>
  <p class="help">It reads only the page you’re looking at, only when you click it.</p>
  <h4 class="paste-title">No bookmark? Paste a search-results page</h4>
  <p class="help">On Dice, LinkedIn, Indeed or any job site’s search results, press <b>Ctrl/⌘+A</b> then <b>Ctrl/⌘+C</b>, click the box below and press <b>Ctrl/⌘+V</b>. Every job comes in with its official link.</p>
  <div id="pastebox" class="paste-box" contenteditable="true" role="textbox" aria-label="Paste copied search results here" data-placeholder="Paste copied search results here"></div>
  <p class="help" id="pastestatus" role="status" aria-live="polite"></p>
</div></details>`;
  let box2 = document.getElementById("pastebox");
  if (box2)
    box2.addEventListener("paste", (e) => {
      e.preventDefault();
      let html = e.clipboardData?.getData("text/html") || "",
        text = e.clipboardData?.getData("text/plain") || "",
        ok = window.importPastedResults(html, text);
      document.getElementById("pastestatus").textContent = ok
        ? ""
        : "No job links found in what you pasted. Copy the whole search-results page (Ctrl/⌘+A, then Ctrl/⌘+C) and paste again.";
    });
};
document.addEventListener("DOMContentLoaded", () => window.renderSaveButtonPanel());
if (document.readyState !== "loading") window.renderSaveButtonPanel();
