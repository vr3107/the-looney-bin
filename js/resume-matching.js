let liveListings = null,
  liveMode = false;
function resumeTerms(
  resumeText = data.profile.resume,
  roleText = data.profile.role,
) {
  let stop = new Set(
    "about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other ought our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves years year experienced experience ability ability including include including required preferred about team role company candidate job jobs work position careers looking. mailing marketing brand passionate strong join based seeking across using used use both process business support responsibilities requirements will new great. designer design engineer engineering developer development product user users ux ui software data manager management engineer analysis analyst research researcher market strategy sales project".split(
      /\s+/,
    ),
  );
  let counts = new Map();
  for (let w of (resumeText || "")
    .toLowerCase()
    .match(/[a-z][a-z0-9+#.-]{2,}/g) || []) {
    if (!stop.has(w) && !/^\d/.test(w)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  let role = (
    (roleText || "").toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []
  ).filter((w) => !stop.has(w));
  return [
    ...new Set([
      ...role,
      ...[...counts].sort((a, b) => b[1] - a[1]).map((a) => a[0]),
    ]),
  ].slice(0, 10);
}
function score(job) {
  let associated = data.resumes?.find((r) => r.id === job.resumeId),
    resume = associated?.text || data.profile.resume,
    role = job.targetRoles || associated?.targetRoles || data.profile.role,
    terms = [
      ...new Set([
        ...resumeTerms(resume, role),
        ...(associated?.confirmedKeywords || []),
      ]),
    ].slice(0, 14);
  if (!terms.length) return null;
  let text = (
    job.title +
    " " +
    job.company +
    " " +
    job.description +
    " " +
    (job.tags || []).join(" ")
  ).toLowerCase();
  let hits = terms.filter((w) => text.includes(w)).length;
  return Math.round((100 * hits) / terms.length);
}
async function searchBoards() {
  if (!String(data.profile.resume || "").trim()) {
    toast("Add your resume in My profile before searching for matches.");
    navigate("profile");
    return;
  }
  liveMode = true;
  let box = document.getElementById("jobs");
  box.innerHTML =
    '<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>Finding current remote openings…</strong><p>Loading the listings once, then ranking by resume keyword overlap.</p></div>';
  let query = (document.getElementById("query").value || "")
      .trim()
      .toLowerCase(),
    loc = (
      document.getElementById("location").value ||
      data.profile.location ||
      ""
    )
      .trim()
      .toLowerCase();
  try {
    if (!liveListings) {
      try {
        liveListings = JSON.parse(
          sessionStorage.getItem("jobloom.remotive.cache") || "null",
        );
      } catch {}
    }
    if (!liveListings) {
      let res = await fetch("https://remotive.com/api/remote-jobs", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("Listings source returned " + res.status);
      let payload = await res.json();
      if (!Array.isArray(payload.jobs))
        throw new Error("Unexpected listings response");
      liveListings = payload.jobs.map((j) => ({
        id: "remotive-" + j.id,
        sourceId: String(j.id),
        source: "Remotive",
        title: j.title || "Untitled role",
        company: j.company_name || "Company",
        location: j.candidate_required_location || "Remote",
        salary: j.salary || "",
        url: j.url || "",
        description: (j.description || "")
          .replace(/<\/(p|div|li|h[1-6])>/gi, " $& ")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'"),
        tags: [j.category, j.job_type].filter(Boolean),
        status: "Saved",
        added: Date.now(),
        published: j.publication_date || "",
      }));
      try {
        sessionStorage.setItem(
          "jobloom.remotive.cache",
          JSON.stringify(liveListings),
        );
      } catch {}
    }
    let qwords = query.split(/\s+/).filter(Boolean);
    let savedUrls = new Set(data.jobs.map((j) => j.url).filter(Boolean));
    let results = liveListings
      .filter(
        (j) =>
          !savedUrls.has(j.url) &&
          (!qwords.length ||
            qwords.some((w) =>
              (j.title + " " + j.company + " " + j.description)
                .toLowerCase()
                .includes(w),
            )) &&
          jobMatchesLocation(loc, j.location, j.tags, j.source),
      )
      .map((j) => ({ ...j, match: score(j) }))
      .filter((j) => j.match > 0)
      .sort(
        (a, b) =>
          b.match - a.match || new Date(b.published) - new Date(a.published),
      );
    window.liveResults = results;
    document.getElementById("boardlinks").innerHTML = "";
    document.getElementById("jobcount").textContent =
      `${results.length} remote listing${results.length === 1 ? "" : "s"} · ranked by resume overlap`;
    renderJobs();
  } catch (err) {
    window.liveResults = [];
    document.getElementById("boardlinks").innerHTML = "";
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="bigico">↯</div><strong>Couldn’t load live listings.</strong><p>${esc(err.message || "Check your internet connection and try again.")}</p><button class="btn btn-sm" style="margin-top:13px" onclick="searchBoards()">Try again</button></div>`;
    document.getElementById("jobcount").textContent = "";
  }
}
function renderJobs() {
  let box = document.getElementById("jobs");
  if (!box) return;
  if (liveMode) {
    let arr = window.liveResults || [],
      f = document.getElementById("matchfilter")?.value || "all";
    if (f === "high") arr = arr.filter((x) => x.match >= 70);
    if (document.getElementById("sortfilter")?.value === "recent")
      arr = [...arr].sort(
        (a, b) => new Date(b.published) - new Date(a.published),
      );
    else arr = [...arr].sort((a, b) => b.match - a.match);
    if (!arr.length) {
      box.innerHTML =
        '<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>No matching remote listings found.</strong><p>Try clearing the optional filter, or add more skills and experience to your resume profile.</p></div>';
      return;
    }
    box.innerHTML = arr
      .map(
        (x) =>
          `<article class="card job"><div class="jobtop"><div style="display:flex;gap:11px"><div class="companylogo">${esc((x.company || "?")[0].toUpperCase())}</div><div><h3>${esc(x.title)}</h3><div class="company">${esc(x.company)} · ${esc(x.location || "Remote")}</div></div></div><span class="score">${x.match}% resume match</span></div><div class="tags">${x.salary ? `<span class="tag">${esc(x.salary)}</span>` : ""}${(
            x.tags || []
          )
            .slice(0, 3)
            .map((t) => `<span class="tag">${esc(t)}</span>`)
            .join(
              "",
            )}${x.published ? `<span class="tag">Listed ${new Date(x.published).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>` : ""}</div><div class="jobfoot"><span>Source: <a href="https://remotive.com/remote-jobs" target="_blank" rel="noopener" style="color:var(--green)">Remotive</a></span><div style="display:flex;gap:7px"><button class="btn btn-sm" onclick="saveLive(decodeURIComponent('${encodeURIComponent(x.sourceId)}'))">Save role</button><a class="btn btn-sm btn-primary" style="text-decoration:none" href="${esc(x.url)}" target="_blank" rel="noopener">View & apply ↗</a></div></div></article>`,
      )
      .join("");
    return;
  }
  let arr = [...data.jobs],
    f = document.getElementById("matchfilter")?.value || "all";
  if (f === "high") arr = arr.filter((x) => (score(x) ?? 0) >= 70);
  if (document.getElementById("sortfilter")?.value === "match")
    arr.sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0));
  else arr.sort((a, b) => b.added - a.added);
  document.getElementById("jobcount").textContent =
    `${arr.length} saved role${arr.length === 1 ? "" : "s"}`;
  box.innerHTML = arr.length
    ? arr
        .map((x) => {
          let s = score(x);
          return `<article class="card job"><div class="jobtop"><div style="display:flex;gap:11px"><div class="companylogo">${esc((x.company || "?")[0].toUpperCase())}</div><div><h3>${esc(x.title)}</h3><div class="company">${esc(x.company)}${x.location ? " · " + esc(x.location) : ""}</div></div></div><span class="score">${s === null ? "Add resume" : s + "% match"}</span></div><div class="tags">${
            (x.tags || [])
              .slice(0, 4)
              .map((t) => `<span class="tag">${esc(t)}</span>`)
              .join("") || '<span class="tag">Added by you</span>'
          }</div><div class="jobfoot"><span>${x.salary ? esc(x.salary) + " · " : ""}${statusPill(x.status)}</span><div style="display:flex;gap:7px"><button class="btn btn-sm" onclick="openDetails(decodeURIComponent('${encodeURIComponent(x.id)}'))">Details</button>${x.url ? `<a class="btn btn-sm" style="text-decoration:none" href="${esc(x.url)}" target="_blank" rel="noopener">Open role ↗</a>` : ""}</div></div></article>`;
        })
        .join("")
    : `<div class="empty" style="grid-column:1/-1"><div class="bigico">⌕</div><strong>No saved roles yet.</strong><p>Find live resume matches above, then save openings to track your next steps.</p><button class="btn btn-sm" style="margin-top:13px" onclick="openModal('job')">＋ Add a role manually</button></div>`;
}
function saveLive(sourceId) {
  let x = (liveListings || []).find((j) => j.sourceId === sourceId);
  if (!x) return;
  if (data.jobs.some((j) => j.url === x.url)) {
    toast("This role is already in your tracker.");
    return;
  }
  data.jobs.push({
    ...x,
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    added: Date.now(),
  });
  persist();
  toast("Role saved to your application tracker.");
}
