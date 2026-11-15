// Keeps the signed-in person's data saved to their account: pushes changes
// shortly after they're made, loads changes from other devices, stores original
// resume files, brings in data saved in this browser before accounts existed,
// and provides the account menu (settings, invites, sign out).
(function () {
  const user = window.LB_USER;
  if (!user) return;
  const metaKey = lbMetaKey(user.id);
  let meta = lbReadJson(metaKey, { rev: 0, hashes: {} }),
    pushing = null,
    timer = null,
    dirty = false,
    offline = false;
  const el = (id) => document.getElementById(id);
  function setState(text, cls) {
    let s = el("syncstate");
    if (!s) return;
    s.textContent = text;
    s.className = "syncstate " + (cls || "");
  }
  function leave() {
    localStorage.removeItem(LB_USER_KEY);
    location.replace("/signin");
  }
  function pending() {
    let docs = lbDocsFromData(data),
      hashes = lbHashes(docs),
      upserts = docs.filter((d) => meta.hashes[d.kind + ":" + d.id] !== hashes[d.kind + ":" + d.id]),
      removes = Object.keys(meta.hashes)
        .filter((k) => !(k in hashes))
        .map((k) => ({ kind: k.slice(0, k.indexOf(":")), id: k.slice(k.indexOf(":") + 1) }));
    return { hashes, upserts, removes };
  }
  async function push() {
    if (pushing) {
      dirty = true;
      return pushing;
    }
    pushing = (async () => {
      try {
        let { hashes, upserts, removes } = pending();
        if (!upserts.length && !removes.length) return setState("✓ Saved to your account", "ok");
        setState("Saving…");
        // Send in batches of about 900 KB so large libraries don't hit request limits.
        let batches = [],
          cur = { upserts: [], removes, size: 0 };
        for (let u of upserts) {
          let size = JSON.stringify(u.v).length;
          if (cur.upserts.length && (cur.size + size > 900_000 || cur.upserts.length >= 400)) {
            batches.push(cur);
            cur = { upserts: [], removes: [], size: 0 };
          }
          cur.upserts.push(u);
          cur.size += size;
        }
        batches.push(cur);
        let stale = false;
        for (let b of batches) {
          let r = await lbApi("/api/state", { method: "POST", body: { baseRev: meta.rev, upserts: b.upserts, removes: b.removes } });
          if (r.status === 401) return leave();
          if (!r.ok) {
            if (r.data.error === "item_too_large") toast("One item is too large to save to your account. It stays on this device.");
            throw new Error(r.data.error || "save_failed");
          }
          stale = stale || r.data.stale;
          meta.rev = r.data.rev;
          for (let u of b.upserts) meta.hashes[u.kind + ":" + u.id] = hashes[u.kind + ":" + u.id];
          for (let x of b.removes) delete meta.hashes[x.kind + ":" + x.id];
          Storage.prototype.setItem.call(localStorage, metaKey, JSON.stringify(meta));
        }
        offline = false;
        setState("✓ Saved to your account", "ok");
        if (stale) offerLatest();
      } catch (e) {
        offline = true;
        setState("Not saved yet — will retry", "warn");
        clearTimeout(timer);
        timer = setTimeout(push, 15000);
      }
    })().finally(() => {
      pushing = null;
      if (dirty) {
        dirty = false;
        schedule();
      }
    });
    return pushing;
  }
  function schedule() {
    clearTimeout(timer);
    setState("Saving…");
    timer = setTimeout(push, 1200);
  }
  // Every save in the app writes this key, so watching it catches all changes.
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key) {
    setItem.apply(this, arguments);
    if (this === localStorage && key === window.LB_STORAGE_KEY) schedule();
  };
  function offerLatest() {
    if (el("lb-latest")) return;
    document.body.insertAdjacentHTML("beforeend", '<div id="lb-latest" class="lb-banner" role="status">Your account was updated on another device. <button class="btn btn-sm btn-primary" id="lb-latest-go">Load latest</button></div>');
    el("lb-latest-go").onclick = async () => {
      await push();
      if (await lbPullToLocal(user.id)) location.reload();
    };
  }

  // ---- Original resume files ----
  const localStore = window.storeResumeFile,
    localGet = window.getResumeFile,
    localDelete = window.deleteResumeFile;
  async function upload(id, file) {
    if (!file || file.size > 1_900_000) return false;
    let r = await lbApi("/api/files/" + encodeURIComponent(id), { method: "PUT", raw: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || "") } }).catch(() => null);
    return !!r?.ok;
  }
  window.storeResumeFile = async function (id, file) {
    await localStore(id, file);
    if (file && file.size > 1_900_000) toast("This file is over 1.9 MB, so the original is kept on this device only. Its text is still saved to your account.");
    else upload(id, file);
  };
  window.getResumeFile = async function (id) {
    let file = await localGet(id).catch(() => null);
    if (file) return file;
    let r = await lbApi("/api/files/" + encodeURIComponent(id), { blob: true }).catch(() => null);
    if (!r?.ok) return null;
    let name = "";
    try {
      name = decodeURIComponent(r.headers.get("X-File-Name") || "");
    } catch {}
    file = new File([r.data], name || "resume", { type: r.headers.get("X-File-Type") || "" });
    await localStore(id, file);
    return file;
  };
  window.deleteResumeFile = async function (id) {
    await localDelete(id);
    lbApi("/api/files/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
  };

  // ---- Data saved in this browser before accounts existed ----
  function idbAll(name) {
    return new Promise((resolve) => {
      let req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        let out = [],
          cur = req.result.transaction("files", "readonly").objectStore("files").openCursor();
        cur.onsuccess = () => {
          let c = cur.result;
          if (!c) return resolve(out);
          out.push([c.key, c.value]);
          c.continue();
        };
        cur.onerror = () => resolve(out);
      };
    });
  }
  async function importFiles() {
    if (localStorage.getItem("lb.import.files") !== user.id) return;
    let ids = new Set((data.resumes || []).map((r) => r.id));
    for (let [id, file] of await idbAll("jobloom-original-files")) {
      if (!ids.has(id) || !file) continue;
      await localStore(id, file);
      await upload(id, file);
    }
    localStorage.removeItem("lb.import.files");
  }

  // ---- Start-up ----
  async function start() {
    let me = await lbApi("/api/auth/me").catch(() => null);
    if (!me) return setState("Offline — changes are kept on this device", "warn");
    if (me.status === 401 || (me.ok && !me.data.user)) return leave();
    if (!me.ok) return setState("Account service unavailable — changes are kept on this device", "warn");
    Object.assign(user, me.data.user);
    Storage.prototype.setItem.call(localStorage, LB_USER_KEY, JSON.stringify(user));
    paintAccount();
    await importFiles();
    let p = pending(),
      hasLocal = p.upserts.length || p.removes.length;
    if (me.data.rev !== meta.rev) {
      if (hasLocal) await push();
      let before = localStorage.getItem(window.LB_STORAGE_KEY);
      let pulled = await lbPullToLocal(user.id);
      if (pulled) {
        meta = lbReadJson(metaKey, meta);
        if (pulled.count && localStorage.getItem(window.LB_STORAGE_KEY) !== before && !sessionStorage.getItem("lb.reloaded")) {
          sessionStorage.setItem("lb.reloaded", "1");
          return location.reload();
        }
      }
    } else if (hasLocal) await push();
    sessionStorage.removeItem("lb.reloaded");
    if (!data.profile.name && user.name) {
      data.profile.name = user.name;
      if (!data.profile.email) data.profile.email = user.email;
      persist();
      if (typeof fillProfile === "function") fillProfile();
    }
    setState(offline ? "Not saved yet — will retry" : "✓ Saved to your account", offline ? "warn" : "ok");
  }
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      push();
    } else {
      let me = await lbApi("/api/auth/me").catch(() => null);
      if (me?.status === 401 || (me?.ok && !me.data.user)) leave();
      else if (me?.ok && me.data.rev !== meta.rev && !pushing) offerLatest();
    }
  });
  window.addEventListener("online", () => push());

  // ---- Account menu and settings ----
  function paintAccount() {
    let a = el("avatar");
    if (a) a.title = `${user.name} · ${user.email}`;
  }
  function closeMenu() {
    el("lb-menu")?.remove();
  }
  function openMenu() {
    if (el("lb-menu")) return closeMenu();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="lb-menu" class="lb-menu" role="menu"><div class="lb-menu-who"><b>${esc(user.name)}${user.role === "owner" ? ' <i class="lb-badge">Admin</i>' : ""}</b><span>${esc(user.email)}</span></div><button role="menuitem" data-act="settings">Account settings</button>${user.role === "owner" ? '<button role="menuitem" data-act="invites">Admin: people and invites</button>' : ""}<button role="menuitem" data-act="signout">Sign out</button></div>`,
    );
    el("lb-menu").onclick = (e) => {
      let act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === "signout") signOut();
      else openSettings(act);
    };
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#avatar")) openMenu();
    else if (!e.target.closest("#lb-menu")) closeMenu();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());
  async function signOut() {
    clearTimeout(timer);
    await push();
    if (offline && !confirm("Some changes haven’t been saved to your account yet. Sign out anyway? They’ll stay on this device until you sign in again.")) return;
    await lbApi("/api/auth/signout", { method: "POST", body: {} }).catch(() => {});
    if (!offline) {
      // Remove this person's copy from the browser so the next person can't see it.
      localStorage.removeItem(window.LB_STORAGE_KEY);
      localStorage.removeItem(metaKey);
      try {
        indexedDB.deleteDatabase(window.LB_FILES_DB);
      } catch {}
    }
    leave();
  }
  const ERR = {
    credentials_invalid: "That password isn’t right.",
    rate_limited: "Too many attempts. Wait a few minutes and try again.",
    owner_cannot_delete: "As the owner, you can’t delete your account while other people still have accounts.",
    name_required: "Enter your name.",
    cannot_suspend_admin: "The admin account can’t be suspended.",
  };
  const msg = (r) => r.data.message || ERR[r.data.error] || "Something went wrong. Please try again.";
  const when = (t) => (t ? new Date(t * 1000).toLocaleDateString() : "—");
  async function openSettings(tab) {
    let admin = user.role === "owner" ? (await lbApi("/api/admin/overview")).data : null;
    el("modalroot").innerHTML = `<div class="modalback" id="lb-settings-back"><div class="modal lb-settings"><div class="modalhead"><div><div class="eyebrow">ACCOUNT</div><h2>${tab === "invites" ? "People and invites" : "Account settings"}</h2><div class="sub">${esc(user.email)}</div></div><button class="x" id="lb-x" aria-label="Close">×</button></div>
${
  tab === "invites" && admin
    ? `<div class="lb-sec"><h3>Who can create an account</h3><div class="lb-row"><select id="lb-mode"><option value="invite">Only people with an invite code</option><option value="open">Anyone (public sign-up)</option><option value="closed">No one (sign-up closed)</option></select><button class="btn btn-sm" id="lb-mode-save">Save</button></div></div>
<div class="lb-sec"><h3>Create an invite</h3><div class="lb-row"><input id="lb-inv-label" placeholder="Who is it for? (optional)" maxlength="80"><select id="lb-inv-uses"><option value="1">1 person</option><option value="5">5 people</option><option value="20">20 people</option></select><button class="btn btn-sm btn-primary" id="lb-inv-make">Create invite</button></div><div id="lb-inv-new"></div>
<div class="lb-list">${admin.invites.length ? admin.invites.map((i) => `<div><span><b>${esc(i.label || "Invite")}</b> · used ${i.uses} of ${i.max_uses} · expires ${when(i.expires_at)}</span><button class="btn btn-sm" data-revoke="${esc(i.id)}">Revoke</button></div>`).join("") : '<p class="help">No invites yet.</p>'}</div></div>
<div class="lb-sec"><h3>People with accounts · ${admin.users.length}</h3><div class="lb-list">${admin.users.map((u) => `<div><span><b>${esc(u.name)}</b> · ${esc(u.email)}${u.role === "owner" ? ' · <i class="lb-badge">Admin</i>' : ""}${u.disabled ? ' · <i class="lb-badge off">Suspended</i>' : ""}<br><span class="help">joined ${when(u.created_at)} · last sign-in ${when(u.last_login)}</span></span>${u.role === "owner" ? "" : `<button class="btn btn-sm" data-suspend="${esc(u.id)}" data-on="${u.disabled ? 0 : 1}">${u.disabled ? "Restore access" : "Suspend"}</button>`}</div>`).join("")}</div><p class="help">As admin you manage who has access. You can’t see other people’s resumes, jobs or files.</p></div>`
    : `<div class="lb-sec"><h3>Your name</h3><div class="lb-row"><input id="lb-name" value="${esc(user.name)}" maxlength="80" autocomplete="name"><button class="btn btn-sm" id="lb-name-save">Save</button></div></div>
<div class="lb-sec"><h3>${user.hasPassword ? "Change password" : "Set a password"}</h3>${user.hasPassword ? '<input id="lb-pw-cur" type="password" placeholder="Current password" autocomplete="current-password">' : ""}<input id="lb-pw-new" type="password" placeholder="New password (at least 10 characters)" autocomplete="new-password"><div class="lb-row"><button class="btn btn-sm" id="lb-pw-save">Update password</button><span class="help">Other devices will be signed out.</span></div></div>
<div class="lb-sec"><h3>Sign-in activity</h3><div id="lb-activity" class="lb-list lb-activity"><p class="help">Loading…</p></div><div class="lb-row"><button class="btn btn-sm" id="lb-others">Sign out all other devices</button><span class="help" id="lb-devices"></span></div></div>
<div class="lb-sec"><h3>Your data</h3><div class="lb-row"><button class="btn btn-sm" id="lb-export">Download a copy of my data</button></div></div>
<div class="lb-sec lb-danger"><h3>Delete account</h3><p class="help">Permanently deletes your account and everything saved in it. This can’t be undone.</p>${user.hasPassword ? '<input id="lb-del-pw" type="password" placeholder="Your password" autocomplete="current-password">' : ""}<div class="lb-row"><input id="lb-del-confirm" placeholder="Type DELETE to confirm" autocomplete="off"><button class="btn btn-sm" id="lb-del">Delete my account</button></div></div>`
}
<div id="lb-set-status" class="lb-status" role="status" aria-live="polite"></div></div></div>`;
    let status = (t, bad) => {
        el("lb-set-status").textContent = t;
        el("lb-set-status").classList.toggle("bad", !!bad);
      },
      on = (id, fn) => el(id) && (el(id).onclick = fn);
    el("lb-settings-back").onclick = (e) => e.target.id === "lb-settings-back" && closeModal();
    on("lb-x", closeModal);
    if (el("lb-mode")) el("lb-mode").value = admin.signupMode;
    on("lb-mode-save", async () => {
      let r = await lbApi("/api/admin/signup-mode", { method: "POST", body: { mode: el("lb-mode").value } });
      status(r.ok ? "Saved." : msg(r), !r.ok);
    });
    on("lb-inv-make", async () => {
      let r = await lbApi("/api/admin/invite", { method: "POST", body: { label: el("lb-inv-label").value, maxUses: Number(el("lb-inv-uses").value) } });
      if (!r.ok) return status(msg(r), true);
      let link = `${location.origin}/signup?invite=${encodeURIComponent(r.data.code)}`;
      document.querySelector(".lb-list .help")?.remove();
      el("lb-inv-new").innerHTML = `<div class="lb-code"><b>${esc(r.data.code)}</b><span>Share this link — the code is shown only once:</span><input readonly value="${esc(link)}" id="lb-inv-link"><button class="btn btn-sm" id="lb-inv-copy">Copy link</button></div>`;
      on("lb-inv-copy", async () => {
        await navigator.clipboard.writeText(link).catch(() => el("lb-inv-link").select());
        status("Invite link copied.");
      });
    });
    document.querySelectorAll("[data-revoke]").forEach(
      (b) =>
        (b.onclick = async () => {
          let r = await lbApi("/api/admin/revoke", { method: "POST", body: { id: b.dataset.revoke } });
          if (r.ok) openSettings("invites");
          else status(msg(r), true);
        }),
    );
    document.querySelectorAll("[data-suspend]").forEach(
      (b) =>
        (b.onclick = async () => {
          let r = await lbApi("/api/admin/suspend", { method: "POST", body: { id: b.dataset.suspend, suspended: b.dataset.on === "1" } });
          if (r.ok) openSettings("invites");
          else status(msg(r), true);
        }),
    );
    async function loadActivity() {
      if (!el("lb-activity")) return;
      let r = await lbApi("/api/auth/security");
      if (!r.ok) return (el("lb-activity").innerHTML = '<p class="help">Couldn’t load activity.</p>');
      const LABEL = { account_created: "Account created", signin: "Signed in", signin_google: "Signed in with Google", signin_failed: "Failed sign-in attempt (wrong password)", password_changed: "Password changed", signed_out_other_devices: "Signed out other devices", suspended_by_admin: "Access suspended by admin", restored_by_admin: "Access restored by admin" },
        device = (ua) => (/iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Unknown device") + (/Edg\//.test(ua) ? " · Edge" : /Chrome\//.test(ua) ? " · Chrome" : /Firefox\//.test(ua) ? " · Firefox" : /Safari\//.test(ua) ? " · Safari" : "");
      el("lb-activity").innerHTML = r.data.events.length ? r.data.events.map((e) => `<div class="${e.type === "signin_failed" ? "warn" : ""}"><span><b>${esc(LABEL[e.type] || e.type)}</b><br><span class="help">${esc(device(e.ua))} · ${esc(e.ip)}</span></span><span class="help">${esc(new Date(e.at * 1000).toLocaleString())}</span></div>`).join("") : '<p class="help">No activity recorded yet.</p>';
      let n = r.data.sessions.length;
      el("lb-devices").textContent = `Signed in on ${n} device${n === 1 ? "" : "s"} right now.`;
    }
    loadActivity();
    on("lb-others", async () => {
      let r = await lbApi("/api/auth/signout-others", { method: "POST", body: {} });
      status(r.ok ? `Signed out ${r.data.removed} other device${r.data.removed === 1 ? "" : "s"}.` : msg(r), !r.ok);
      loadActivity();
    });
    on("lb-name-save", async () => {
      let r = await lbApi("/api/auth/profile", { method: "POST", body: { name: el("lb-name").value } });
      if (!r.ok) return status(msg(r), true);
      user.name = r.data.name;
      Storage.prototype.setItem.call(localStorage, LB_USER_KEY, JSON.stringify(user));
      paintAccount();
      status("Name updated.");
    });
    on("lb-pw-save", async () => {
      let r = await lbApi("/api/auth/password", { method: "POST", body: { current: el("lb-pw-cur")?.value || "", next: el("lb-pw-new").value } });
      if (!r.ok) return status(msg(r), true);
      user.hasPassword = true;
      status("Password updated.");
      if (el("lb-pw-cur")) el("lb-pw-cur").value = "";
      el("lb-pw-new").value = "";
    });
    on("lb-export", () => {
      let a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "the-looney-bin-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    on("lb-del", async () => {
      if (el("lb-del-confirm").value.trim() !== "DELETE") return status("Type DELETE to confirm.", true);
      let r = await lbApi("/api/auth/delete", { method: "POST", body: { confirm: "DELETE", password: el("lb-del-pw")?.value || "" } });
      if (!r.ok) return status(msg(r), true);
      localStorage.removeItem(window.LB_STORAGE_KEY);
      localStorage.removeItem(metaKey);
      try {
        indexedDB.deleteDatabase(window.LB_FILES_DB);
      } catch {}
      leave();
    });
  }
  paintAccount();
  start();
})();
