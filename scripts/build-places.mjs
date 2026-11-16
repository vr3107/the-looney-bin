// Builds the US places data used by location search (js/geo-search.js):
//   data/us-places.json  cities, towns and named places with coordinates, grouped by state
//   data/us-zips.json    ZIP code → coordinates (loaded only when someone types a ZIP)
//
// Sources (run `npm i all-the-cities zipcodes` in a scratch folder first):
//   all-the-cities  GeoNames places with 1,000+ residents (GeoNames data, CC BY 4.0)
//   zipcodes        US ZIP codes with their post-office place name and centre point
//
// Usage: node scripts/build-places.mjs <folder containing node_modules> [outDir=data]

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const modulesAt = resolve(process.argv[2] || ".");
const outDir = process.argv[3] || "data";
const require = createRequire(join(modulesAt, "noop.js"));
const cities = require("all-the-cities");
const zipcodes = require("zipcodes");

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const isState = new Set(STATES);

// Keep in sync with placeKey() in js/geo-search.js.
export function placeKey(name) {
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
const titleCase = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Of|The|And|In|On|At|De|Del|La|Las|Los|El)\b/g, (w, _1, at) => (at === 0 ? w : w.toLowerCase()))
    .replace(/\bMc ([A-Z])/g, "Mc$1")
    .replace(/\bO ([A-Z])/g, "O'$1");

// Renames so the common way of writing a place matches (the long forms stay as aliases in the app).
const RENAME = { "NY|New York City": "New York", "DC|Washington, D.C.": "Washington" };
// Well-known job locations that are not towns of their own.
const EXTRA = [
  ["NC", "Research Triangle Park", 35.899, -78.863],
  ["VA", "Tysons", 38.918, -77.231],
  ["VA", "Crystal City", 38.857, -77.05],
  ["VA", "Rosslyn", 38.896, -77.072],
  ["TX", "Las Colinas", 32.887, -96.949],
  ["MA", "Hanscom AFB", 42.459, -71.279],
  ["FL", "Kennedy Space Center", 28.524, -80.651],
  ["TX", "Starbase", 25.997, -97.157],
  ["NV", "McCarran", 39.55, -119.5],
  ["NV", "Primm", 35.613, -115.388],
  ["RI", "Quonset", 41.587, -71.412],
  ["RI", "Quonset Point", 41.587, -71.412],
  ["MD", "Fort Detrick", 39.436, -77.428],
  ["GA", "Fort Gordon", 33.417, -82.141],
  ["IL", "Scott AFB", 38.545, -89.85],
  ["IL", "Scott Air Force Base", 38.545, -89.85],
  ["CA", "Vandenberg", 34.742, -120.572],
  ["CA", "Point Loma", 32.72, -117.24],
  ["FL", "Medley", 25.841, -80.326],
  ["SC", "Indian Land", 34.98, -80.86],
  ["CA", "Vernon", 34.003, -118.23],
  ["CA", "Vandenberg SFB", 34.742, -120.572],
  ["NC", "Fort Liberty", 35.139, -79.006],
  ["AL", "Maxwell AFB", 32.38, -86.36],
  ["MD", "Aberdeen Proving Ground", 39.47, -76.13],
];

// Cities abroad that GeoNames lists under their local name, with the English name job posts use.
const ENGLISH_NAMES = {
  "Genève": ["Geneva"], "Köln": ["Cologne"], Hannover: ["Hanover"], Sevilla: ["Seville"], Bengaluru: ["Bangalore"], Odesa: ["Odessa"], Kyiv: ["Kiev"], "Zürich": ["Zurich"], Luzern: ["Lucerne"],
  Antwerpen: ["Antwerp"], Gent: ["Ghent"], Brugge: ["Bruges"], "Frankfurt am Main": ["Frankfurt"], "Den Haag": ["The Hague"], "Kraków": ["Cracow"], "Greater Sudbury": ["Sudbury"], "Panamá": ["Panama City", "Panama"],
  Mumbai: ["Bombay"], Chennai: ["Madras"], Kolkata: ["Calcutta"], Luimneach: ["Limerick"], Gaillimh: ["Galway"], "Enfield Town": ["Enfield"], "Kingston upon Hull": ["Hull"],
  "Newcastle upon Tyne": ["Newcastle"], "City of Westminster": ["Westminster"], "Stoke-on-Trent": ["Stoke"], "Stratford-upon-Avon": ["Stratford"],
};
const NOT_A_PLACE = /\b(services?|inc|corp|company|bank|insurance|irs|postal|annex|courthouse|brm|zip|firms?|dept|department|electric|publishers|clearing|mutual|lockbox|parcel|return|internal|revenue|treasury|customs|census|sweepstakes|reply|business|headquarters|hq|bldg|building)\b/i;
const byState = Object.fromEntries(STATES.map((s) => [s, new Map()]));
const abroad = new Map(); // name → population of the largest place outside the US with that name
let fromGeoNames = 0,
  fromZip = 0;
for (const c of cities) {
  // GeoNames lists Puerto Rico as a country of its own; here it is a state like the others.
  const st = c.country === "PR" ? "PR" : c.country === "US" ? c.adminCode : "";
  if (!st) {
    for (const n of [c.name, ...String(c.altName || "").split(","), ...(ENGLISH_NAMES[c.name] || [])]) {
      const k = placeKey(n);
      if (k && (abroad.get(k) || 0) < c.population) abroad.set(k, c.population);
    }
    continue;
  }
  if (!isState.has(st) || /\(historical\)/i.test(c.name)) continue;
  // "City of Milford (balance)" → "Milford"; "Stambaugh, Iron River" → "Stambaugh".
  const name = (RENAME[`${st}|${c.name}`] || c.name).replace(/\s*\([^)]*\)/g, "").replace(/^City of /, "").split(",")[0].trim(),
    key = placeKey(name),
    [lng, lat] = c.loc.coordinates,
    have = byState[st].get(key);
  if (!key || (have && have.pop >= c.population)) continue;
  if (!have) fromGeoNames++;
  // PPLX: GeoNames' code for a section of a larger place (Gramercy Park, Koreatown, Hyde Park).
  byState[st].set(key, { name, lat, lng, pop: c.population || 0, part: c.featureCode === "PPLX" });
}
for (const [st, name, lat, lng] of EXTRA) if (!byState[st].has(placeKey(name))) byState[st].set(placeKey(name), { name, lat, lng, pop: 0 });

// ZIP place names fill in small towns GeoNames leaves out; their point is the average of their ZIP centres.
const zipGroups = new Map();
const zips = [];
for (const z of Object.values(zipcodes.codes)) {
  if (z.country !== "US" || !isState.has(z.state) || !/^\d{5}$/.test(z.zip)) continue;
  const lat = Number(z.latitude),
    lng = Number(z.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
  zips.push([Number(z.zip), Math.round(lat * 1000), Math.round(lng * 1000)]);
  const key = placeKey(z.city);
  // Some ZIPs belong to one organisation or building, not a place.
  if (!key || /\d|&/.test(z.city) || NOT_A_PLACE.test(z.city)) continue;
  const id = `${z.state}|${key}`;
  let g = zipGroups.get(id);
  if (!g) zipGroups.set(id, (g = { st: z.state, key, name: titleCase(z.city), lat: 0, lng: 0, n: 0 }));
  g.lat += lat;
  g.lng += lng;
  g.n++;
}
for (const g of zipGroups.values()) {
  if (byState[g.st].has(g.key)) continue;
  byState[g.st].set(g.key, { name: g.name, lat: g.lat / g.n, lng: g.lng / g.n, pop: 0 });
  fromZip++;
}

// "name|lat×1000|lng×1000|population÷100" joined by ";" — compact, and quick to read in the browser.
// A fifth field "x" marks a section of a larger place (a neighbourhood).
const places = {};
let total = 0;
for (const st of STATES) {
  const list = [...byState[st].values()].sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
  total += list.length;
  places[st] = list.map((p) => `${p.name.replace(/[|;]/g, " ")}|${Math.round(p.lat * 1000)}|${Math.round(p.lng * 1000)}|${Math.round(p.pop / 100)}${p.part ? "|x" : ""}`).join(";");
}
// Names shared with a sizeable place abroad ("Cambridge", "Vancouver"): when a job lists such a
// name without a state, the app can't tell which one is meant. Value: that place's population ÷ 100.
const twins = {};
for (const st of STATES)
  for (const [key, p] of byState[st]) {
    const pop = abroad.get(key) || 0;
    if (p.pop >= 5000 && pop >= 5000 && (twins[key] || 0) < Math.round(pop / 100)) twins[key] = Math.round(pop / 100);
  }
const placesJson = JSON.stringify({
  about: "US cities, towns and named places for The Looney Bin location search.",
  credit: "Place names and coordinates: GeoNames (geonames.org), CC BY 4.0. ZIP-code place names: zipcodes npm package.",
  places,
  twins,
});
writeFileSync(join(outDir, "us-places.json"), placesJson);

// ZIPs sorted and stored as differences from the previous one (small numbers compress well).
zips.sort((a, b) => a[0] - b[0]);
const d = [];
let prev = [0, 0, 0];
for (const z of zips) {
  d.push(z[0] - prev[0], z[1] - prev[1], z[2] - prev[2]);
  prev = z;
}
const zipsJson = JSON.stringify({ about: "US ZIP code centre points as running differences: zip, lat×1000, lng×1000.", d });
writeFileSync(join(outDir, "us-zips.json"), zipsJson);

const kb = (s) => `${(s.length / 1024).toFixed(0)} KB (${(gzipSync(Buffer.from(s)).length / 1024).toFixed(0)} KB compressed)`;
console.log(`${Object.keys(twins).length} names shared with a place abroad.`);
console.log(`${total.toLocaleString()} places (${fromGeoNames.toLocaleString()} from GeoNames, ${fromZip.toLocaleString()} more from ZIP names): ${kb(placesJson)}`);
console.log(`${zips.length.toLocaleString()} ZIP codes: ${kb(zipsJson)}`);
