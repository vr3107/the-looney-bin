// Location search, part 2: the "City, town or ZIP code" box, the distance menu and the "Near me"
// button on the Find page. Together they describe a search area (see js/geo-search.js);
// js/job-search.js asks for it with geoSearch.prepare() and keeps only the jobs inside it.
//
// Privacy: "Near me" reads the browser's position once, rounds it to roughly half a mile, and
// keeps it in this tab's memory only. It is never saved to the account or sent anywhere: job
// boards are asked about the nearest town by name. A typed place and the chosen distance are
// saved with the rest of the person's settings (data.search) so they are still there next time.
(function () {
  "use strict";
  const G = window.geoCore,
    $ = (id) => document.getElementById(id),
    input = $("place"),
    listBox = $("placesuggest"),
    radiusSel = $("radius"),
    statusLine = $("placestatus"),
    nearBtn = $("nearme"),
    clearBtn = $("placeclear"),
    stateBox = $("location"),
    sortSel = $("sortfilter");
  if (!G || !input || !listBox || !radiusSel) return;

  let chosen = null; // { text, center }: the place behind the text in the box
  let me = null; // the "near me" centre, in memory only
  let options = []; // suggestions on show
  let active = -1; // highlighted suggestion
  let typed = 0; // counts keystrokes, so a slow lookup can't overwrite a newer one
  let problem = ""; // message when the place can't be used

  const radius = () => {
    const r = Number(radiusSel.value);
    return G.RADII.includes(r) ? r : G.DEFAULT_RADIUS;
  };
  // The state box helps choose between towns with the same name ("Springfield" + "Illinois").
  const preferState = () => G.stateCode(String(stateBox?.value || "").trim(), true);
  const hasSearched = () => typeof liveMode !== "undefined" && liveMode;
  const hasPlace = () => Boolean(me || input.value.trim());
  const rerun = () => {
    if (hasSearched() && typeof window.searchBoards === "function") window.searchBoards();
  };
  // Stepping through the distance menu with the arrow keys changes it several times in a row:
  // wait for it to settle before searching again.
  let settle = 0;
  const rerunSoon = () => {
    clearTimeout(settle);
    settle = setTimeout(rerun, 600);
  };

  // ---------- saving the typed place and distance with the person's settings ----------
  function remember() {
    const next = { place: me ? "" : input.value.trim().slice(0, 80), radius: radius() },
      old = data.search || {};
    if (old.place === next.place && old.radius === next.radius) return;
    data.search = next;
    // Saved directly (not through persist()), so the results on screen aren't redrawn mid-search.
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  }

  // ---------- the line under the search box ----------
  function showStatus() {
    if (!statusLine) return;
    const area = currentArea();
    let text = problem;
    if (!text && area)
      text = me
        ? `Jobs ${area.describe()}. Your position stays on this device; job boards are only asked about ${me.town}.`
        : `Jobs ${area.describe()}. Postings that don’t name a town (remote, state-wide or not given) are left out.`;
    statusLine.textContent = text;
    statusLine.classList.toggle("bad", Boolean(problem));
    statusLine.hidden = !text;
    if (clearBtn) clearBtn.hidden = !hasPlace();
    if (nearBtn) nearBtn.classList.toggle("on", Boolean(me));
    // "Nearest first" only means something while a place is set.
    const nearest = sortSel?.querySelector('option[value="nearest"]');
    if (nearest) {
      nearest.hidden = nearest.disabled = !hasPlace();
      if (!hasPlace() && sortSel.value === "nearest") sortSel.value = "match";
    }
  }
  // The area already known, without looking up new text.
  function currentArea() {
    if (me) return G.makeArea(me, radius());
    const text = input.value.trim();
    return chosen && chosen.text === text ? G.makeArea(chosen.center, radius()) : null;
  }
  function choose(center, text) {
    me = null;
    problem = "";
    chosen = { text, center };
    input.value = text;
  }

  // Called by the search: works out the area from what is in the box.
  // Returns { area } (null when no place is set) or { error, title } when the place can't be used.
  async function prepare() {
    problem = "";
    const text = input.value.trim();
    let area = null,
      title = "That place wasn’t found.";
    if (me) area = G.makeArea(me, radius());
    else if (text) {
      if (!chosen || chosen.text !== text) {
        chosen = null;
        let center = null;
        try {
          center = await G.resolveText(text, preferState());
        } catch {
          title = "The list of places didn’t load.";
          problem = "The list of U.S. places couldn’t be loaded. Check your connection and search again.";
        }
        if (!problem && !center) {
          // A state, the whole country or "remote" typed where a town belongs.
          const kind = G.notATown(text);
          if (kind) title = "That isn’t a city or town.";
          problem =
            kind === "state"
              ? `“${text}” is a state. Choose it in the state box and leave this box empty, or type a city, town or ZIP code here.`
              : kind === "country"
                ? "That’s the whole country. Leave this box empty to search all of the United States, or type a city, town or ZIP code."
                : kind === "remote"
                  ? `“${text}” isn’t a place. For remote or hybrid jobs choose Remote (US) or Hybrid (US) in the state box and leave this box empty.`
                  : `No U.S. city, town or ZIP code matches “${text}”. Check the spelling, or pick a place from the list as you type.`;
        }
        // ZIP codes stay as typed; a town is shown the way it was understood ("cleveland" → "Cleveland, OH").
        if (center) choose(center, center.kind === "zip" ? text : center.label);
      }
      if (chosen) area = G.makeArea(chosen.center, radius());
    } else chosen = null;
    closeList();
    showStatus();
    if (problem) {
      // Point at the box, unless the person is busy typing somewhere else (a timed refresh can land here too).
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) input.focus();
      return { error: problem, title };
    }
    remember();
    return { area };
  }

  // ---------- suggestions while typing ----------
  function closeList() {
    options = [];
    active = -1;
    listBox.hidden = true;
    listBox.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function drawList(note) {
    listBox.innerHTML = options.length
      ? options.map((o, i) => `<div class="place-option" role="option" id="placeopt-${i}" data-i="${i}" aria-selected="${i === active}"><span>${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</div>`).join("")
      : `<div class="place-none">${esc(note)}</div>`;
    listBox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `placeopt-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }
  async function suggest() {
    const turn = ++typed,
      text = input.value.trim();
    if (text.length < 2) return closeList();
    try {
      await G.ensurePlaces();
      if (/^\d+$/.test(text)) {
        const center = text.length === 5 ? await G.resolveText(text) : null;
        if (turn !== typed) return;
        options = center ? [{ label: center.label, center, text }] : [];
        active = -1;
        return drawList(text.length === 5 ? `ZIP code ${text} isn’t on the U.S. list.` : "Type all five digits of the ZIP code.");
      }
      if (turn !== typed) return;
      options = G.suggest(text, preferState()).map((p) => ({ label: G.placeLabel(p), sub: G.STATE_NAMES[p.st], center: G.centerFromPlace(p), text: G.placeLabel(p) }));
      active = -1;
      drawList(`No U.S. city or town matches “${text}”.`);
    } catch {
      closeList();
    }
  }
  function pick(i) {
    const o = options[i];
    if (!o) return;
    choose(o.center, o.text);
    closeList();
    showStatus();
    remember();
    rerun();
  }
  function move(step) {
    if (!options.length) return;
    active = (active + step + options.length) % options.length;
    drawList("");
    $(`placeopt-${active}`)?.scrollIntoView({ block: "nearest" });
  }
  input.addEventListener("input", () => {
    // Typing replaces whatever was set before, including "near me".
    me = null;
    chosen = null;
    problem = "";
    showStatus();
    suggest();
  });
  input.addEventListener("focus", () => {
    G.ensurePlaces().catch(() => {});
    if (me) input.select();
  });
  input.addEventListener("blur", () => setTimeout(closeList, 150));
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (listBox.hidden) return void suggest();
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!listBox.hidden && active >= 0) return pick(active);
      closeList();
      // Emptying the box and pressing Enter goes back to a search without a place.
      if (typeof window.searchBoards === "function") window.searchBoards();
    } else if (e.key === "Escape" && !listBox.hidden) {
      e.preventDefault();
      closeList();
    }
  });
  // Keep the box focused while a suggestion is clicked.
  listBox.addEventListener("mousedown", (e) => e.preventDefault());
  listBox.addEventListener("click", (e) => {
    const row = e.target.closest("[data-i]");
    if (row) pick(Number(row.dataset.i));
  });

  // ---------- distance, clear ----------
  radiusSel.addEventListener("change", () => {
    showStatus();
    remember();
    if (hasPlace()) rerunSoon();
  });
  function clear() {
    const had = hasPlace();
    me = null;
    chosen = null;
    problem = "";
    input.value = "";
    closeList();
    showStatus();
    remember();
    if (had) rerun();
  }
  clearBtn?.addEventListener("click", () => {
    clear();
    input.focus();
  });

  // ---------- near me ----------
  const position = () =>
    new Promise((resolve, reject) =>
      // City-level accuracy is plenty for a radius in miles; a position up to ten minutes old will do.
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }),
    );
  let locating = false;
  async function nearMe() {
    if (locating) return;
    const fail = (message) => {
      problem = message;
      showStatus();
    };
    if (!("geolocation" in navigator)) return fail("This browser can’t share its location. Type your city or ZIP code instead.");
    locating = true;
    problem = "";
    if (statusLine) {
      statusLine.textContent = "Finding where you are… your browser may ask for permission.";
      statusLine.classList.remove("bad");
      statusLine.hidden = false;
    }
    if (nearBtn) nearBtn.disabled = true;
    try {
      const [pos] = await Promise.all([position(), G.ensurePlaces()]);
      // Rounded to two decimals (about half a mile): all a search in miles needs.
      const lat = Math.round(pos.coords.latitude * 100) / 100,
        lng = Math.round(pos.coords.longitude * 100) / 100,
        center = G.centerFromPoint("me", lat, lng, (town) => `your location (near ${town})`);
      if (!center) return fail("You seem to be outside the United States, and this search covers U.S. jobs. Type a U.S. city or ZIP code instead.");
      me = center;
      chosen = null;
      input.value = `Near me · ${center.town}`;
      closeList();
      showStatus();
      remember();
      // Pressing "Near me" is a request to search there (once there is a resume to match against).
      if (typeof window.searchBoards === "function" && (hasSearched() || String(data.profile?.resume || "").trim())) window.searchBoards();
    } catch (e) {
      fail(
        e && e.code === 1
          ? "Location access is blocked for this site. Allow it in your browser’s site settings (the icon beside the address), or type your city or ZIP code."
          : e && e.code === 3
            ? "Finding your location took too long. Try again, or type your city or ZIP code."
            : e && e.code === 2
              ? "Your device couldn’t work out where you are. Type your city or ZIP code instead."
              : "Your location couldn’t be used just now. Type your city or ZIP code instead.",
      );
    } finally {
      locating = false;
      if (nearBtn) nearBtn.disabled = false;
    }
  }
  nearBtn?.addEventListener("click", nearMe);

  // Enter in the job-title box starts the search, like the button.
  $("query")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (typeof window.searchBoards === "function") window.searchBoards();
    }
  });

  // ---------- restore the last typed place and distance ----------
  const saved = data.search && typeof data.search === "object" ? data.search : {};
  if (G.RADII.includes(Number(saved.radius))) radiusSel.value = String(saved.radius);
  if (typeof saved.place === "string" && saved.place.trim()) {
    const text = saved.place.trim().slice(0, 80);
    input.value = text;
    G.resolveText(text, preferState())
      .then((center) => {
        if (center && !me && !chosen && input.value.trim() === text) chosen = { text, center };
        showStatus();
      })
      .catch(() => {});
  }
  showStatus();

  window.geoSearch = {
    prepare,
    nearMe,
    clear,
    active: hasPlace,
    // Used by the "no results" message: try a wider distance.
    widen(miles) {
      if (!G.RADII.includes(Number(miles))) return;
      radiusSel.value = String(miles);
      radiusSel.dispatchEvent(new Event("change"));
    },
  };
})();
