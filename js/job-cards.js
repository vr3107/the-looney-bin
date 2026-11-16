// Job result cards and filter chips for the Find page.
// Derives workplace, job type, level, and years required from each posting so
// results can be filtered and summarized consistently across sources.
const REMOTE_ONLY_SOURCES = ["Remotive", "Remote OK", "Jobicy", "Himalayas"];
function jobFacetText(j) {
  return `${j.title || ""} ${j.location || ""} ${(j.tags || []).join(" ")}`.toLowerCase();
}
function jobWorkplace(j) {
  let t = jobFacetText(j);
  if (/\bhybrid\b/.test(t)) return "Hybrid";
  if (/\bremote\b|anywhere|worldwide/.test(t)) return "Remote";
  if (/\bon-?site\b|\bin[- ]office\b/.test(t)) return "On-site";
  if (REMOTE_ONLY_SOURCES.includes(j.source)) return "Remote";
  let d = String(j.description || "").slice(0, 2500).toLowerCase();
  if (/\bhybrid\b/.test(d)) return "Hybrid";
  if (/\b(fully|100%) remote\b|\bremote (role|position|job)\b/.test(d)) return "Remote";
  if (/\bon-?site\b/.test(d)) return "On-site";
  return "";
}
function jobType(j) {
  let tags = (j.tags || []).join(" ").toLowerCase(),
    head = `${j.title || ""} ${tags} ${String(j.description || "").slice(0, 1500)}`.toLowerCase();
  for (let text of [tags, head]) {
    if (/intern(ship)?\b/.test(text)) return "Internship";
    if (/contract|third_party|freelance|\bc2c\b|\bw2\b/.test(text)) return "Contract";
    if (/part[\s_-]?time/.test(text)) return "Part-time";
    if (/full[\s_-]?time|fulltime|permanent/.test(text)) return "Full-time";
  }
  return "";
}
const YEARS_RE =
  /\b(?:at least\s+|minimum(?: of)?\s+|over\s+)?(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+|professional\s+|work\s+|industry\s+|hands-on\s+)?experience\b/gi;
function jobYears(j) {
  let found = [...String(j.description || "").matchAll(YEARS_RE)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n <= 20);
  return found.length ? Math.min(...found) : null;
}
function jobLevel(j) {
  let title = String(j.title || "").toLowerCase(),
    tags = (j.tags || []).join(" ").toLowerCase();
  if (/\bintern(ship)?\b/.test(title)) return "Internship";
  if (/\b(director|head of|vp|vice president|manager)\b/.test(title)) return "Manager";
  if (/\b(staff|principal|lead|architect|distinguished)\b/.test(title)) return "Lead / Staff";
  if (/\b(senior|sr\.?)\b|\b(iii|iv)\b/.test(title)) return "Senior";
  if (/\b(junior|jr\.?|entry|graduate|new grad|associate)\b|\bi\b/.test(title)) return "Entry level";
  if (/senior/.test(tags)) return "Senior";
  if (/mid|midweight/.test(tags)) return "Mid level";
  if (/junior|entry/.test(tags)) return "Entry level";
  let y = jobYears(j);
  if (y === null) return "";
  return y <= 2 ? "Entry level" : y <= 5 ? "Mid level" : "Senior";
}
function resumeYearsFor() {
  let text = (window.activeResume && window.activeResume()?.text) || data.profile?.resume || "",
    found = [...String(text).matchAll(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 0 && n <= 40);
  return found.length ? Math.max(...found) : null;
}
function postedAgo(published) {
  let t = Date.parse(published || "");
  if (!Number.isFinite(t)) return "";
  let mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return mins <= 1 ? "Just now" : `${mins} minutes ago`;
  let h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  let d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function jobKey(j) {
  return j.url || j.id;
}
function hiddenJobs() {
  if (!Array.isArray(data.hiddenJobs)) data.hiddenJobs = [];
  return data.hiddenJobs;
}
window.showHiddenJobs = false;
function chipValue(id) {
  return document.getElementById(id)?.value || "all";
}
window.jobPassesFilters = function (j) {
  let hidden = hiddenJobs().includes(jobKey(j));
  if (window.showHiddenJobs ? !hidden : hidden) return false;
  let wp = chipValue("workplacefilter"),
    type = chipValue("typefilter"),
    level = chipValue("levelfilter"),
    years = chipValue("yearsfilter"),
    q = (document.getElementById("resultsearch")?.value || "").trim().toLowerCase();
  if (wp !== "all" && jobWorkplace(j) !== wp) return false;
  if (type !== "all" && jobType(j) !== type) return false;
  if (level !== "all" && jobLevel(j) !== level) return false;
  if (years !== "all") {
    let y = jobYears(j),
      [lo, hi] = years.split("-").map(Number);
    if (y === null || y < lo || y > hi) return false;
  }
  if (q && !(window.quickJobMatch ? window.quickJobMatch(j, q) : `${j.title} ${j.company}`.toLowerCase().includes(q))) return false;
  return true;
};
window.refreshFilterChips = function () {
  document.querySelectorAll(".filters select").forEach((s) => {
    let def = s.id === "sortfilter" ? "match" : "all";
    s.classList.toggle("chip-on", s.value !== def);
  });
  let btn = document.getElementById("hiddentoggle");
  if (btn) {
    let n = hiddenJobs().length;
    btn.textContent = window.showHiddenJobs ? `Back to results` : `Hidden jobs${n ? " · " + n : ""}`;
    btn.classList.toggle("chip-on", window.showHiddenJobs);
  }
};
window.applyJobFilters = function () {
  liveShown = 60;
  renderJobs();
};
window.toggleHiddenJobs = function () {
  window.showHiddenJobs = !window.showHiddenJobs;
  window.applyJobFilters();
};
window.toggleHideJob = function (id) {
  let j = (window.liveResults || []).find((x) => x.id === id) || (liveListings || []).find((x) => x.id === id);
  if (!j) return;
  let list = hiddenJobs(),
    key = jobKey(j),
    i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  else list.push(key);
  persist();
  toast(i >= 0 ? "Job restored to your results." : "Job hidden. Use “Hidden jobs” to see it again.");
  renderJobs();
};
window.saveLiveCard = function (id) {
  let j = (window.liveResults || []).find((x) => x.id === id);
  if (j && data.jobs.some((s) => s.url && s.url === j.url)) {
    toast("This role is already in your tracker.");
    return;
  }
  window.saveLive(id);
  renderJobs();
};
function matchLabel(m) {
  return m >= 75 ? "Strong match" : m >= 55 ? "Good match" : m >= 35 ? "Fair match" : "Low match";
}
function logoHue(name) {
  let h = 0;
  for (let ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
const JC_ICONS = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  cash: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v11"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  hide: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
};
// "· 7 mi away" beside the location, for place searches (distance is between town centres).
function distanceNote(x) {
  if (typeof x.distance !== "number") return "";
  return x.distance < 0.5 ? "" : x.distance < 1.5 ? " · about 1 mi away" : ` · ${Math.round(x.distance)} mi away`;
}
window.jobCardHtml = function (x) {
  let id = encodeURIComponent(x.id),
    m = Math.max(0, Math.min(100, Number(x.match) || 0)),
    ring = 2 * Math.PI * 34,
    wp = jobWorkplace(x),
    type = jobType(x),
    level = jobLevel(x),
    years = jobYears(x),
    mine = resumeYearsFor(),
    saved = data.jobs.some((s) => s.url && s.url === x.url),
    hidden = hiddenJobs().includes(jobKey(x)),
    ago = postedAgo(x.published),
    isDice = x.source === "Dice",
    sources = x.sources || [{ name: x.source, url: x.sourceHome }],
    diceExtra = !isDice && sources.find((s) => s.name === "Dice" && s.url),
    checks = [
      x.roleLabel,
      x.matchTerms?.length ? `${x.matchTerms.length} resume keyword${x.matchTerms.length === 1 ? "" : "s"} found` : "",
      years !== null && mine !== null && mine >= years ? `Meets ${years}+ yrs exp` : "",
      x.salary ? "Salary listed" : "",
    ].filter(Boolean).slice(0, 3),
    detail = (icon, text) => (text ? `<span class="jc-detail">${JC_ICONS[icon]}${esc(text)}</span>` : ""),
    badges = [
      ago ? `<span class="jc-badge jc-badge-time">${esc(ago)}</span>` : "",
      x.roleLabel ? `<span class="jc-badge jc-badge-role">${esc(x.roleLabel)}</span>` : "",
      ...sources.map((s) => `<span class="jc-badge">${esc(s.name)}</span>`),
    ].join("");
  return `<article class="card job jc">
  <div class="jc-main">
    <div class="jc-head">
      <div class="jc-logo" style="--h:${logoHue(x.company)}">${esc((x.company || "?").trim()[0]?.toUpperCase() || "?")}</div>
      <div class="jc-titles">
        <div class="jc-badges">${badges}</div>
        <h3>${esc(x.title)}</h3>
        <div class="jc-company">${esc(x.company)}</div>
      </div>
    </div>
    <div class="jc-details">
      ${detail("pin", (x.location || "Location not listed") + distanceNote(x))}
      ${detail("home", wp)}
      ${detail("clock", type)}
      ${detail("bag", level)}
      ${detail("cash", x.salary)}
      ${detail("cal", years !== null ? `${years}+ years exp` : "")}
    </div>
    ${x.matchTerms?.length ? `<div class="jc-skills">${x.matchTerms.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="jc-foot">
      <span class="jc-src">${sources.map((s) => `<a href="${esc(s.url || "")}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(" · ")}</span>
      <div class="jc-actions">
        <button class="jc-icon${hidden ? " on" : ""}" title="${hidden ? "Show this job again" : "Hide this job"}" aria-label="${hidden ? "Unhide job" : "Hide job"}" onclick="toggleHideJob(decodeURIComponent('${id}'))">${JC_ICONS.hide}</button>
        <button class="jc-icon${saved ? " on" : ""}" title="${saved ? "Saved to your tracker" : "Save to your tracker"}" aria-label="Save job" onclick="saveLiveCard(decodeURIComponent('${id}'))">${JC_ICONS.heart}</button>
        <button class="jc-pill" onclick="openDetails(decodeURIComponent('${id}'))">${JC_ICONS.spark}Match details</button>
        ${diceExtra ? `<a class="jc-pill" href="${esc(diceExtra.url)}" target="_blank" rel="noopener">Dice posting ↗</a>` : ""}
        ${x.url ? `<a class="jc-apply" href="${esc(x.url)}" target="_blank" rel="noopener">${isDice ? "Apply on Dice ↗" : "Apply now ↗"}</a>` : ""}
      </div>
    </div>
  </div>
  <aside class="jc-score" aria-label="${m}% resume match">
    <svg class="jc-ring" viewBox="0 0 80 80"><circle cx="40" cy="40" r="34"/><circle class="jc-ring-fill" cx="40" cy="40" r="34" stroke-dasharray="${((ring * m) / 100).toFixed(1)} ${ring.toFixed(1)}"/></svg>
    <div class="jc-pct">${m}<small>%</small></div>
    <div class="jc-label">${matchLabel(m)}</div>
    ${checks.length ? `<ul>${checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
  </aside>
</article>`;
};
