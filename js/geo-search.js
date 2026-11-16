// Location search, part 1: the place data and the distance maths (no page elements here, so this
// file also runs in Node for tests). Jobs are kept when they are within a mile radius of a US city,
// town or ZIP code, or of the visitor's own position ("near me"). Job locations are free text
// ("Austin, TX", "US-CA-San Francisco", "Greater Boston Area"), so each is matched to a place with
// coordinates and the distance is measured in the browser, between town centres.
// Place data: data/us-places.json and data/us-zips.json (built by scripts/build-places.mjs).
// Part 2, the search boxes on the page, is js/place-search.js.
(function (root) {
  "use strict";
  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida",
    GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
    MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  };
  const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
  // Longest names first, so "west virginia" is tried before "virginia".
  const STATE_NAME_LIST = [...STATE_BY_NAME.keys()].sort((a, b) => b.length - a.length);
  const RADII = [0, 10, 15, 20, 25, 35, 50, 75, 100];
  const DEFAULT_RADIUS = 25;
  const SAME_PLACE_MILES = 2; // "Only this place" also accepts points this close to the centre

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  // Keep in sync with placeKey() in scripts/build-places.mjs.
  function placeKey(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\bsainte\b|\bste\b\.?/g, "ste")
      .replace(/\bsaint\b|\bst\b\.?/g, "st")
      .replace(/\bfort\b|\bft\b\.?/g, "ft")
      .replace(/\bmount\b|\bmt\b\.?/g, "mt")
      .replace(/\btwp\b\.?/g, "township")
      .replace(/^\s*the\s+/, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  // Words that mean "the United States" (no place), and words that mean somewhere else.
  const US_WORDS = new Set(["usa", "us", "u s", "u s a", "united states", "united states of america", "america", "north america", "americas", "amer", "us only", "usa only", "us based", "nationwide"]);
  const FOREIGN = new Set(
    (
      "canada|mexico|uk|u k|united kingdom|great britain|england|scotland|wales|ireland|northern ireland|germany|deutschland|france|spain|italy|portugal|netherlands|the netherlands|holland|belgium|switzerland|austria|sweden|norway|denmark|finland|iceland|poland|czech republic|czechia|slovakia|hungary|romania|bulgaria|greece|turkey|turkiye|ukraine|russia|serbia|croatia|slovenia|estonia|latvia|lithuania|luxembourg|cyprus|malta|" +
      "israel|uae|united arab emirates|saudi arabia|qatar|bahrain|kuwait|oman|egypt|morocco|tunisia|south africa|nigeria|kenya|ghana|ethiopia|tanzania|uganda|india|pakistan|bangladesh|sri lanka|nepal|china|japan|south korea|korea|taiwan|hong kong|singapore|malaysia|indonesia|thailand|vietnam|philippines|australia|new zealand|" +
      "brazil|brasil|argentina|chile|colombia|peru|costa rica|panama|uruguay|paraguay|ecuador|venezuela|bolivia|dominican republic|jamaica|guatemala|el salvador|honduras|nicaragua|" +
      "ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|emea|apac|latam|europe|asia|africa|middle east|eu|dach|anz|benelux|nordics|" +
      "new south wales|queensland|western australia|bavaria|catalonia|greater london"
    ).split("|"),
  );
  const CANADA_CODES = new Set(["ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE"]);
  // Not places: how or where the work happens.
  const NOT_PLACES = new Set(["remote", "hybrid", "onsite", "on site", "in office", "virtual", "anywhere", "telecommute", "work from home", "wfh", "field", "various", "multiple", "flexible", "global", "worldwide", "tbd", "na", "n a", "none", "unspecified", "not specified", "home", "home based"]);
  // Words around a town's name that aren't part of it ("Austin Office", "Greater Boston Area").
  const NOISE = /\b(remote|hybrid|on-?site|in-?office|office|hq|headquarters|campus|wfh|flexible|greater|metro(?:politan)?|area|region|metroplex|downtown|based|store|branch|plant|warehouse|facility|airport|corporate|main|locations?|site)\b/gi;
  const DIRECTION = /^(north|south|east|west|northeast|northwest|southeast|southwest|central|northern|southern|eastern|western|uptown|midtown|downtown|greater|metro)\s+/i;
  // Other names for well-known places. pairOnly: only when the state is written too ("LA, CA").
  const ALIASES = {
    nyc: ["New York", "NY"], newyorkcity: ["New York", "NY"], sf: ["San Francisco", "CA"], sanfran: ["San Francisco", "CA"], bayarea: ["San Francisco", "CA"], sfbayarea: ["San Francisco", "CA"],
    sfbay: ["San Francisco", "CA"], sanfranciscobayarea: ["San Francisco", "CA"], sanfranciscobay: ["San Francisco", "CA"], siliconvalley: ["San Jose", "CA"], santaclara: ["Santa Clara", "CA"], sanmateo: ["San Mateo", "CA"], la: ["Los Angeles", "CA", true], washingtondc: ["Washington", "DC"], washdc: ["Washington", "DC"],
    philly: ["Philadelphia", "PA"], stlouis: ["St. Louis", "MO"], vegas: ["Las Vegas", "NV"], nola: ["New Orleans", "LA"], slc: ["Salt Lake City", "UT"], okc: ["Oklahoma City", "OK"], kansascity: ["Kansas City", "MO"],
    dfw: ["Dallas", "TX"], dallasftworth: ["Dallas", "TX"], twincities: ["Minneapolis", "MN"], minneapolisstpaul: ["Minneapolis", "MN"], rtp: ["Research Triangle Park", "NC"],
    researchtriangle: ["Research Triangle Park", "NC"], raleighdurham: ["Raleigh", "NC"], tampabay: ["Tampa", "FL"], pugetsound: ["Seattle", "WA"], daytona: ["Daytona Beach", "FL"],
  };
  // City names that are also ordinary words: never taken as a place without a state.
  const BARE_BLOCKED = new Set("mobile enterprise paradise surprise independence hollywood orange corona sunrise plantation university normal mission summit union liberty central carolina kent essex cheshire".split(" "));
  // A name written without a state ("Austin") is accepted only when it clearly means one US town:
  const BARE_MIN_POP = 10000; // a town of some size,
  const BARE_LEAD = 4; // this many times larger than any other US place with the name,
  const BARE_TWIN_MIN = 5000; // and with no place abroad of this size sharing the name that is at least
  const BARE_TWIN_SHARE = 4; // a quarter as large as the US town (half as large for US cities of 100,000+).
  const BARE_BIG_CITY = 100000;
  const COMPASS = { n: "North", s: "South", e: "East", w: "West" };
  // "Only this place" for New York also takes postings that name one of its five boroughs.
  const INSIDE = { "NY|newyork": new Set(["manhattan", "brooklyn", "queens", "bronx", "statenisland"]) };
  const ADDRESS_TOWN_POP = 10000; // "MHC Nashville, TN": a town named after other words needs this many residents

  // ---------- place data ----------
  let gaz = null,
    gazPromise = null,
    zipData = null,
    zipPromise = null;
  function buildGazetteer(json) {
    const byState = {},
      byKey = new Map(),
      list = [];
    for (const [st, packed] of Object.entries(json.places || {})) {
      const m = (byState[st] = new Map());
      for (const rec of packed.split(";")) {
        const [name, lat, lng, pop, part] = rec.split("|");
        if (!name) continue;
        // part: a neighbourhood of a larger place (Gramercy Park, Koreatown)
        const p = { name, st, lat: lat / 1000, lng: lng / 1000, pop: (Number(pop) || 0) * 100, key: placeKey(name), part: part === "x" };
        if (!p.key || m.has(p.key)) continue;
        m.set(p.key, p);
        list.push(p);
        const same = byKey.get(p.key);
        if (same) same.push(p);
        else byKey.set(p.key, [p]);
      }
    }
    for (const arr of byKey.values()) arr.sort((a, b) => b.pop - a.pop);
    const twins = {};
    for (const [key, pop] of Object.entries(json.twins || {})) twins[key] = pop * 100;
    return { byState, byKey, list, twins };
  }
  function usePlaces(json) {
    gaz = buildGazetteer(json);
    locationCache.clear();
    return gaz;
  }
  function ensurePlaces() {
    if (gaz) return Promise.resolve(gaz);
    gazPromise ||= fetch("data/us-places.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(usePlaces)
      .catch((e) => {
        gazPromise = null;
        throw e;
      });
    return gazPromise;
  }
  function useZips(json) {
    const map = new Map();
    let zip = 0,
      lat = 0,
      lng = 0;
    const d = json.d || [];
    for (let i = 0; i + 2 < d.length; i += 3) {
      zip += d[i];
      lat += d[i + 1];
      lng += d[i + 2];
      map.set(String(zip).padStart(5, "0"), [lat / 1000, lng / 1000]);
    }
    return (zipData = map);
  }
  function ensureZips() {
    if (zipData) return Promise.resolve(zipData);
    zipPromise ||= fetch("data/us-zips.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(useZips)
      .catch((e) => {
        zipPromise = null;
        throw e;
      });
    return zipPromise;
  }

  // ---------- finding a place by name ----------
  function aliasPlace(key, st, bare) {
    const a = ALIASES[key];
    if (!a || (bare && a[2]) || (st && a[1] !== st)) return null;
    return gaz.byState[a[1]]?.get(placeKey(a[0])) || null;
  }
  const stripNoise = (t) =>
    String(t)
      .replace(/#\s*\d+/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(NOISE, " ")
      .replace(/\s+/g, " ")
      .trim();
  function exactInState(text, st) {
    const key = placeKey(text);
    if (!key) return null;
    return gaz.byState[st]?.get(key) || aliasPlace(key, st, false);
  }
  // A place name next to a known state, allowing for extra words around it.
  function findInState(text, st, splitParts = true) {
    if (!gaz.byState[st]) return null;
    let p = exactInState(text, st);
    if (p) return p;
    const cleaned = stripNoise(text);
    if (cleaned && cleaned !== text && (p = exactInState(cleaned, st))) return p;
    const base = cleaned || text;
    if (DIRECTION.test(base) && (p = exactInState(base.replace(DIRECTION, ""), st))) return p;
    const town = base.match(/^(.+?)\s+(?:charter\s+)?(?:township|twp\.?)$/i);
    if (town && (p = exactInState(town[1] + " Township", st) || exactInState(town[1], st))) return p;
    if (splitParts && /\s-\s|:|[A-Za-z]-[A-Za-z0-9]/.test(text)) {
      // "Headquarters - Katy" → "Katy"; "Store 186 - Collierville - Collierville" → "Collierville"
      const parts = text.split(/\s+-\s+|:|(?<=[A-Za-z.])-(?=[A-Za-z0-9])/).map((x) => x.trim()).filter(Boolean);
      for (let i = parts.length - 1; i >= 0 && parts.length > 1; i--) if ((p = findInState(parts[i], st, false))) return p;
    }
    // A street address or a building's name run into the town: "43 New Scotland Avenue Albany",
    // "302 Silver Ave. San Francisco", "MHC Nashville". The longest ending that is a town wins; without
    // a number in front, only a sizeable town counts (so "Fort Bliss Main Post" is not Post, TX), and an
    // army post's own name is left alone ("Fort Sam Houston" is not Houston).
    const words = String(text).trim().split(/\s+/);
    if (/^(fort|ft\.?|camp)$/i.test(words[0])) return null;
    for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
      const tail = words.slice(-n).join(" "),
        before = words.slice(0, -n),
        // "N. Charleston" is North Charleston, a different town from Charleston
        compass = COMPASS[before[before.length - 1].replace(".", "").toLowerCase()];
      if (compass && (p = exactInState(`${compass} ${tail}`, st))) return p;
      p = exactInState(tail, st);
      if (p && (p.pop >= ADDRESS_TOWN_POP || /\d/.test(before.join(" ")))) return p;
    }
    return null;
  }
  // A name written without a state: only when it clearly means one US town (see BARE_* above).
  // inUS: the text itself says the job is in the United States, so places abroad don't compete.
  function bestBare(text, inUS) {
    for (const t of [text, stripNoise(text)]) {
      const key = placeKey(t);
      if (!key) continue;
      if (key === "newyork") return gaz.byState.NY.get("newyork"); // on its own it usually means the city
      const alias = aliasPlace(key, "", true);
      if (alias) return alias;
      if (BARE_BLOCKED.has(key) || STATE_BY_NAME.has(norm(t))) continue;
      const same = gaz.byKey.get(key);
      if (!same || same[0].pop < BARE_MIN_POP || (same[1] && same[0].pop < BARE_LEAD * same[1].pop)) continue;
      const twin = inUS ? 0 : gaz.twins[key] || 0;
      if (twin >= BARE_TWIN_MIN && twin >= same[0].pop / (same[0].pop >= BARE_BIG_CITY ? 2 : BARE_TWIN_SHARE)) continue;
      return same[0];
    }
    return null;
  }
  function stateCode(text, anyCase) {
    const t = String(text || "").trim();
    if (/^[A-Za-z]{2}$/.test(t) && (anyCase || t === t.toUpperCase()) && STATE_NAMES[t.toUpperCase()]) return t.toUpperCase();
    return STATE_BY_NAME.get(norm(t)) || "";
  }
  // "Baltimore Maryland", "Wilmington DE", "Washington DC" → { city, st }
  function splitCityState(text) {
    const m = text.match(/^(.+?)[\s.]+([A-Z]{2})$/);
    if (m && STATE_NAMES[m[2]]) return { city: m[1], st: m[2] };
    const n = norm(text);
    for (const name of STATE_NAME_LIST) {
      if (n.length > name.length + 1 && n.endsWith(" " + name)) {
        const words = text.trim().split(/\s+/),
          keep = words.length - name.split(" ").length;
        if (keep > 0) return { city: words.slice(0, keep).join(" "), st: STATE_BY_NAME.get(name) };
      }
    }
    return null;
  }
  function tokenInfo(raw) {
    const whole = String(raw).replace(/\s+/g, " ").trim();
    const clean = whole
      .replace(/[\s,]+\d{5}(?:-\d{4})?$/, "") // trailing ZIP
      .replace(/\s+(?:United States(?: of America)?|USA|US)$/i, "") // "MA USA", "CT United States"
      .replace(/^(?:United States(?: of America)?|USA|US)\s*[-:]\s*(?=\S)/i, "") // "US - El Segundo"
      .replace(/[\s:-]+$/, "") // "CA - US" → "CA"
      .replace(/(?<=[A-Za-z])\s+#?\d{1,4}$/, "") // a store or site number: "MO 1648"
      .trim();
    const n = norm(clean),
      us = US_WORDS.has(n),
      foreign = !us && (FOREIGN.has(n) || CANADA_CODES.has(clean)),
      skip = !n || us || foreign || /^\d[\d\s-]*$/.test(clean) || NOT_PLACES.has(n),
      // "US-Toledo", "Melbourne, United States": the text itself says which country.
      saysUS = us || /(?:^|[\s-])(?:United States(?: of America)?|USA|US)(?:$|[\s:-])/.test(whole),
      state = skip ? "" : stateCode(clean, true),
      // A state with a label after it: "MA University Campus", "NJ - Main Campus".
      lead = state || skip ? null : clean.match(/^([A-Z]{2})(?:\s+-\s+|\s+)(\S.*)$/),
      stateLead = lead && STATE_NAMES[lead[1]] ? lead[1] : "";
    return { whole, clean, n, us, saysUS, foreign, skip, state, stateLead, leadRest: stateLead ? lead[2] : "" };
  }
  const LABEL_LIKE = new RegExp(NOISE.source + "|\\d", "i"); // an office, campus or street address
  // Reads the pieces of one location (split on commas, or on dashes when `dashed`) and adds the places found.
  function readTokens(toks, out, dashed, inUS) {
    const foreign = toks.some((t) => t.foreign),
      bare = [];
    let unknown = 0; // names that are neither a place nor an office label, e.g. the county in "Norwich, Norfolk"
    for (let i = 0; i < toks.length; ) {
      const t = toks[i],
        next = toks[i + 1];
      // "Ontario, CA", "Mexico, MO", "Holland, MI": a US town that shares a name with somewhere abroad.
      const abroadName = t.foreign && i === 0 && !CANADA_CODES.has(t.clean);
      if (t.skip && !(abroadName && next && next.state)) {
        i++;
        continue;
      }
      // "Austin, TX"; also "Worcester, MA University Campus"
      if (next && (next.state || next.stateLead)) {
        const p = findInState(t.clean, next.state || next.stateLead);
        if (p) {
          out.push(p);
          // "Denver, CO - Louisville": a second town in the same state
          if (next.leadRest) out.push(exactInState(next.leadRest, next.stateLead));
          i += 2;
          continue;
        }
      }
      if (t.skip) {
        i++;
        continue;
      }
      if (t.state) {
        // "VA, Henrico" (state first), unless the next piece starts another "City, ST" pair
        if (next && !next.skip && !next.state && !(toks[i + 2] && toks[i + 2].state)) {
          const p = findInState(next.clean, t.state);
          if (p) {
            out.push(p);
            i += 2;
            continue;
          }
        }
        // A state on its own isn't a point, except DC, and "New York" which usually means the city.
        if (t.state === "DC") out.push(gaz.byState.DC.get("washington"));
        else if (t.n === "new york" && !foreign) bare.push(gaz.byState.NY.get("newyork"));
        i++;
        continue;
      }
      i++;
      // "Austin TX", "Baltimore Maryland"
      const pair = splitCityState(t.clean);
      let p = pair ? findInState(pair.city, pair.st) : null;
      if (p) {
        out.push(p);
        continue;
      }
      if (!foreign && (p = bestBare(t.clean, inUS))) {
        bare.push(p);
        continue;
      }
      if (!dashed && /\s-\s|:|[A-Za-z]-[A-Za-z0-9]/.test(t.clean)) {
        // "United States - Ohio - Columbus", "US-CA-San Francisco", "Miami-Fort Lauderdale Area"
        const parts = stripNoiseKeepDashes(t.clean)
            .split(/\s+-\s+|:|(?<=[A-Za-z.])-(?=[A-Za-z0-9])/)
            .map((x) => x.trim())
            .filter(Boolean),
          before = out.length;
        if (parts.length > 1) readTokens(parts.map(tokenInfo), out, true, inUS);
        if (out.length > before) continue;
      }
      if (!LABEL_LIKE.test(t.whole)) unknown++;
    }
    // In a comma list, a name without a state counts only if nothing else in the list is unexplained
    // ("Lincoln, Lincolnshire" and "Norwich, Norfolk" are not Lincoln, NE or Norfolk, VA).
    if (bare.length && (dashed || !unknown)) out.push(...bare);
  }
  const stripNoiseKeepDashes = (t) => t.replace(/\b(greater|metro(?:politan)?|area|region|metroplex)\b/gi, " ").replace(/\s+/g, " ").trim();

  const locationCache = new Map();
  // Every US place a job-location text names. Empty when it names none (remote, a state, a country…).
  function placesIn(text) {
    if (!gaz) return [];
    const raw = String(text || "").slice(0, 300);
    let hit = locationCache.get(raw);
    if (hit) return hit;
    const s = raw
      .replace(/\bD\.\s?C\.?(?=\W|$)/g, "DC")
      .replace(/\bU\.\s?S\.\s?A\.?(?=\W|$)|\bU\.\s?S\.(?=\W|$)/g, "USA")
      .replace(/\s*[–—]\s*/g, " - ");
    const out = [];
    // Several locations in one text: "New York, NY / Austin, TX", "Charlotte, NC +1 more", "A or B"
    const groups = s
      .split(/[\/;|•·()\[\]+\n]|\s&\s|\s+or\s+|\s+OR\s+(?=[A-Za-z])(?!(?:United|USA|US)\b)/)
      .map((group) => group.split(",").map((x) => x.trim()).filter(Boolean).map(tokenInfo))
      .filter((toks) => toks.length);
    const inUS = groups.some((toks) => toks.some((t) => t.saysUS)) && !groups.some((toks) => toks.some((t) => t.foreign));
    for (const toks of groups) readTokens(toks, out, false, inUS);
    hit = [...new Set(out.filter(Boolean))];
    if (locationCache.size > 60000) locationCache.clear();
    locationCache.set(raw, hit);
    return hit;
  }
  function milesBetween(aLat, aLng, bLat, bLng) {
    const R = 3958.8,
      rad = Math.PI / 180,
      dLat = (bLat - aLat) * rad,
      dLng = (bLng - aLng) * rad,
      h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function nearestPlace(lat, lng, minPop = 0) {
    let best = null,
      bestD = Infinity;
    for (const p of gaz.list) {
      if (p.pop < minPop || Math.abs(p.lat - lat) > 1.5) continue;
      const d = milesBetween(lat, lng, p.lat, p.lng);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { place: best, miles: bestD } : null;
  }

  // A search area: a centre, a radius, and tests for jobs.
  // centre: { kind: "place" | "zip" | "me", name, st, key, lat, lng, label, query, town, queryLong, offset }
  //   name/st/key  the town at the centre (for "only this place", and for asking job boards)
  //   label        how the centre reads in "within 25 miles of …"
  //   query        what job boards are asked for: a town's name or the ZIP code typed, never coordinates
  function makeArea(center, radius) {
    const limit = radius > 0 ? radius : SAME_PLACE_MILES,
      padded = Math.min(100, radius + Math.ceil(center.offset || 0));
    const inside = (radius === 0 && center.key && INSIDE[`${center.st}|${center.key}`]) || null;
    function distanceOfText(text) {
      let best = null;
      for (const p of placesIn(text)) {
        if (radius === 0 && center.key && p.st === center.st && (p.key === center.key || (inside && inside.has(p.key)))) return 0;
        const d = milesBetween(center.lat, center.lng, p.lat, p.lng);
        if (best === null || d < best) best = d;
      }
      return best;
    }
    const keepText = (text) => {
      const d = distanceOfText(text);
      return d !== null && d <= limit;
    };
    return {
      center,
      radius,
      label: center.label,
      // What job boards are asked for. Boards that understand ZIP codes get `query` (the ZIP for a ZIP
      // search, otherwise the town) with `queryRadius`; the rest get the town with `townRadius`.
      // A board measures from the centre of the town it is given, which for a ZIP code or "near me"
      // is a little way from the real centre, so that gap is added to the distance asked for (the
      // results are narrowed to the real distance afterwards).
      query: center.query,
      queryRadius: center.exact ? radius : padded,
      town: center.town || center.query,
      townLong: center.queryLong || center.query,
      townRadius: padded,
      distance: (job) => distanceOfText(job && job.location),
      within: (job) => keepText(job && job.location),
      keepLocation: keepText,
      // The largest towns inside the area, the centre's own town first (for boards that take a list of cities).
      towns(max = 6, minPop = 25000) {
        const own = center.key ? gaz.byState[center.st]?.get(center.key) : null,
          rest = gaz.list
            .filter((p) => p !== own && !p.part && p.pop >= minPop && Math.abs(p.lat - center.lat) < 2 && milesBetween(center.lat, center.lng, p.lat, p.lng) <= limit)
            .sort((a, b) => b.pop - a.pop);
        return [own, ...rest].filter(Boolean).slice(0, max).map(placeLabel);
      },
      describe: () => (radius > 0 ? `within ${radius} miles of ${center.label}` : `in ${center.onlyLabel || center.label} only`),
    };
  }
  const placeLabel = (p) => `${p.name}, ${p.st}`;
  const placeLong = (p) => `${p.name}, ${STATE_NAMES[p.st]}`;
  const centerFromPlace = (p) => ({ kind: "place", name: p.name, st: p.st, key: p.key, lat: p.lat, lng: p.lng, label: placeLabel(p), query: placeLabel(p), queryLong: placeLong(p) });
  // The town a point belongs to: the nearest one job boards will know (with residents on record), else
  // the nearest of any kind. When that is a neighbourhood of a big city ("Gramercy Park", "Chinatown"),
  // the city itself is used if its centre is about as close: postings and job boards name the city.
  function townAt(lat, lng, within = 30) {
    const known = nearestPlace(lat, lng, 1),
      any = nearestPlace(lat, lng);
    let best = known && (!any || known.miles <= any.miles + 6) ? known : any;
    if (!best || best.miles > within) return null;
    if (best.place.part) {
      const part = best.place,
        reach = Math.max(3, best.miles + 2);
      for (const p of gaz.byState[part.st].values()) {
        if (p.part || p.pop < part.pop * 3 || p.pop <= best.place.pop || Math.abs(p.lat - lat) > 0.3) continue;
        const miles = milesBetween(lat, lng, p.lat, p.lng);
        if (miles <= reach) best = { place: p, miles };
      }
    }
    return best;
  }
  // A centre at an exact point: a ZIP code's middle, or the visitor's position ("me").
  // ask: text job boards can be given for the point itself (the ZIP code); without it they get the town.
  function centerFromPoint(kind, lat, lng, label, ask = "") {
    const near = townAt(lat, lng);
    if (!near) return null;
    const p = near.place,
      town = placeLabel(p);
    return {
      kind,
      // "Only this place" means the town the point is in (when the point is inside or beside it).
      name: p.name,
      st: p.st,
      key: near.miles <= 5 ? p.key : "",
      lat,
      lng,
      label: label(town),
      onlyLabel: town,
      town,
      query: ask || town,
      exact: Boolean(ask),
      queryLong: placeLong(p),
      // Miles from the point to the centre of the town job boards are asked about.
      offset: near.miles,
    };
  }
  // Text in the place box that is not a town: a state ("Ohio", "TX"), the whole country, or a way of
  // working ("remote"). Returns "state", "country", "remote" or "".
  function notATown(text) {
    const t = String(text || "").trim(),
      n = norm(t);
    if (!n) return "";
    if (US_WORDS.has(n)) return "country";
    if (NOT_PLACES.has(n) || /^(remote|hybrid)\b/.test(n)) return "remote";
    // "New York" and "Washington" mean the cities here, "DC" is one, and "LA" is Los Angeles.
    if (n === "new york" || n === "washington" || stateCode(t, true) === "DC" || ALIASES[placeKey(t)]) return "";
    return stateCode(t, true) ? "state" : "";
  }

  // What someone typed → a centre point. preferState: the state box, used when a name exists in several states.
  async function resolveText(text, preferState) {
    await ensurePlaces();
    const t = String(text || "")
      .trim()
      .replace(/\bD\.\s?C\.?(?=\W|$)/gi, "DC");
    if (!t || notATown(t)) return null;
    if (stateCode(t, true) === "DC") return centerFromPlace(gaz.byState.DC.get("washington"));
    const zip = t.match(/^(\d{5})(?:-\d{4})?$/);
    if (zip) {
      const pt = (await ensureZips()).get(zip[1]);
      return pt ? centerFromPoint("zip", pt[0], pt[1], (town) => `ZIP ${zip[1]} (${town})`, zip[1]) : null;
    }
    const pieces = t.split(",").map((x) => x.trim()).filter(Boolean),
      st = pieces.length > 1 ? stateCode(pieces[1].replace(/\s+\d{5}.*$/, "").replace(/\s+(USA|US|United States)$/i, ""), true) : "";
    let p = st ? findInState(pieces[0], st) : null;
    if (!p && pieces.length === 1) {
      const pair = splitCityState(t) || (/\s[a-z]{2}$/i.test(t) && stateCode(t.slice(-2), true) ? { city: t.slice(0, -3), st: stateCode(t.slice(-2), true) } : null);
      if (pair) p = findInState(pair.city, pair.st);
    }
    if (!p && preferState) p = findInState(pieces[0], preferState);
    if (!p) {
      const key = placeKey(pieces[0]);
      p = aliasPlace(key, "", false) || (gaz.byKey.get(key) || [])[0] || suggest(t, preferState)[0] || null;
    }
    return p ? centerFromPlace(p) : null;
  }
  // Places to offer while typing: best name matches, larger towns first.
  function suggest(text, preferState, limit = 8) {
    if (!gaz) return [];
    const t = String(text || "").trim();
    if (t.length < 2) return [];
    let name = t,
      st = "",
      stPrefix = "";
    const comma = t.indexOf(",");
    if (comma > 0) {
      name = t.slice(0, comma);
      const rest = norm(t.slice(comma + 1));
      st = stateCode(rest, true) || "";
      // A partly typed state: "springfield, ill"
      if (!st) stPrefix = rest;
    } else {
      const m = t.match(/^(.+)\s+([A-Za-z]{2})$/);
      if (m && STATE_NAMES[m[2].toUpperCase()] && gaz.byState[m[2].toUpperCase()]) {
        const inState = suggestIn(m[1], m[2].toUpperCase(), "", preferState, limit);
        if (inState.length) return inState;
      }
    }
    return suggestIn(name, st, stPrefix, preferState, limit);
  }
  function suggestIn(name, st, stPrefix, preferState, limit) {
    const key = placeKey(name);
    if (!key) return [];
    const starts = [],
      contains = [];
    for (const p of gaz.list) {
      if (st && p.st !== st) continue;
      if (stPrefix && !STATE_NAMES[p.st].toLowerCase().startsWith(stPrefix) && !p.st.toLowerCase().startsWith(stPrefix)) continue;
      if (p.key.startsWith(key)) starts.push(p);
      else if (key.length >= 4 && p.key.includes(key)) contains.push(p);
    }
    const rank = (a, b) => (b.key === key) - (a.key === key) || (b.st === preferState) - (a.st === preferState) || b.pop - a.pop || a.name.length - b.name.length || a.name.localeCompare(b.name);
    starts.sort(rank);
    if (starts.length < limit) contains.sort(rank);
    return [...starts, ...contains].slice(0, limit);
  }

  root.geoCore = { bestBare: (t, inUS) => (gaz ? bestBare(t, inUS) : null), placeKey, usePlaces, useZips, ensurePlaces, ensureZips, placesIn, milesBetween, nearestPlace, makeArea, resolveText, notATown, suggest, centerFromPlace, centerFromPoint, placeLabel, stateCode, RADII, DEFAULT_RADIUS, STATE_NAMES };
})(typeof window !== "undefined" ? window : globalThis);
