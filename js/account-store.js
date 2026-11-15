// Shared by the sign-in pages and the app: where each person's data is kept in
// this browser, and how it converts to and from the items saved in their account.
const LB_ANON_KEY = "jobloom.v1"; // data saved before accounts existed
const LB_USER_KEY = "lb.user";
const lbDataKey = (uid) => `jobloom.v1.u.${uid}`;
const lbMetaKey = (uid) => `lb.sync.${uid}`;
const lbFilesDb = (uid) => `jobloom-original-files.u.${uid}`;
function lbReadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function lbCurrentUser() {
  let u = lbReadJson(LB_USER_KEY, null);
  return u && typeof u.id === "string" && /^[0-9a-f]{8,64}$/.test(u.id) ? u : null;
}
function lbHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + "." + text.length.toString(36);
}
function lbItemId(item, prefix) {
  if (!item.id) item.id = prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return String(item.id).slice(0, 160);
}
// Split the app's data into account items: one "core" (profile, settings, ordering), one per job, one per resume.
function lbDocsFromData(data) {
  let jobs = Array.isArray(data.jobs) ? data.jobs : [],
    resumes = Array.isArray(data.resumes) ? data.resumes : [],
    core = { ...data, jobOrder: jobs.map((j) => lbItemId(j, "job")), resumeOrder: resumes.map((r) => lbItemId(r, "resume")) };
  delete core.jobs;
  delete core.resumes;
  let docs = [{ kind: "core", id: "core", v: core }];
  for (let j of jobs) docs.push({ kind: "job", id: lbItemId(j, "job"), v: j });
  for (let r of resumes) docs.push({ kind: "resume", id: lbItemId(r, "resume"), v: r });
  return docs;
}
function lbDataFromDocs(docs) {
  let core = docs.find((d) => d.kind === "core")?.v || {},
    order = (list, ids) => {
      let pos = new Map((ids || []).map((id, i) => [id, i]));
      return list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)).map((d) => d.v);
    },
    data = { profile: {}, ...core, jobs: order(docs.filter((d) => d.kind === "job"), core.jobOrder), resumes: order(docs.filter((d) => d.kind === "resume"), core.resumeOrder) };
  delete data.jobOrder;
  delete data.resumeOrder;
  if (!data.profile || typeof data.profile !== "object") data.profile = {};
  return data;
}
function lbHashes(docs) {
  let out = {};
  for (let d of docs) out[d.kind + ":" + d.id] = lbHash(JSON.stringify(d.v));
  return out;
}
async function lbApi(path, options = {}) {
  let init = { method: options.method || "GET", credentials: "same-origin", headers: { ...(options.headers || {}) }, keepalive: !!options.keepalive };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  if (options.raw !== undefined) init.body = options.raw;
  let res = await fetch(path, init),
    out = options.blob && res.ok ? await res.blob() : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: out, headers: res.headers };
}
// Load everything from the account into this browser.
async function lbPullToLocal(uid) {
  let r = await lbApi("/api/state");
  if (!r.ok) return null;
  let docs = r.data.docs || [];
  if (docs.length) localStorage.setItem(lbDataKey(uid), JSON.stringify(lbDataFromDocs(docs)));
  localStorage.setItem(lbMetaKey(uid), JSON.stringify({ rev: r.data.rev, hashes: lbHashes(docs) }));
  return { rev: r.data.rev, count: docs.length };
}
function lbAnonHasData() {
  let d = lbReadJson(LB_ANON_KEY, null);
  return !!d && ((d.jobs || []).length > 0 || (d.resumes || []).length > 0 || Object.values(d.profile || {}).some((v) => String(v || "").trim()));
}
