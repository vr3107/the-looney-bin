const US_STATES = [
  ["Alabama", "AL"], ["Alaska", "AK"], ["Arizona", "AZ"],
  ["Arkansas", "AR"], ["California", "CA"], ["Colorado", "CO"],
  ["Connecticut", "CT"], ["Delaware", "DE"], ["Florida", "FL"],
  ["Georgia", "GA"], ["Hawaii", "HI"], ["Idaho", "ID"],
  ["Illinois", "IL"], ["Indiana", "IN"], ["Iowa", "IA"],
  ["Kansas", "KS"], ["Kentucky", "KY"], ["Louisiana", "LA"],
  ["Maine", "ME"], ["Maryland", "MD"], ["Massachusetts", "MA"],
  ["Michigan", "MI"], ["Minnesota", "MN"], ["Mississippi", "MS"],
  ["Missouri", "MO"], ["Montana", "MT"], ["Nebraska", "NE"],
  ["Nevada", "NV"], ["New Hampshire", "NH"], ["New Jersey", "NJ"],
  ["New Mexico", "NM"], ["New York", "NY"], ["North Carolina", "NC"],
  ["North Dakota", "ND"], ["Ohio", "OH"], ["Oklahoma", "OK"],
  ["Oregon", "OR"], ["Pennsylvania", "PA"], ["Rhode Island", "RI"],
  ["South Carolina", "SC"], ["South Dakota", "SD"], ["Tennessee", "TN"],
  ["Texas", "TX"], ["Utah", "UT"], ["Vermont", "VT"],
  ["Virginia", "VA"], ["Washington", "WA"], ["West Virginia", "WV"],
  ["Wisconsin", "WI"], ["Wyoming", "WY"],
];

function normalizeLocation(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/u\.s\.a?\.?/g, "usa")
    .replace(/u\.s\.?/g, "us")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function locationHasPhrase(value, phrase) {
  const text = ` ${normalizeLocation(value)} `;
  const target = ` ${normalizeLocation(phrase)} `;
  return text.includes(target);
}

function isRemoteJob(location, tags, source) {
  const text = normalizeLocation([location, ...(tags || [])].join(" "));
  return /\b(remote|telecommute|work from home|work from anywhere|distributed)\b/.test(text) ||
    source === "Remote OK" || source === "Remotive";
}

function isHybridJob(location, tags) {
  return /\bhybrid\b/.test(normalizeLocation([location, ...(tags || [])].join(" ")));
}

function matchingState(location) {
  const text = normalizeLocation(location);
  const foreignCountry = /\b(canada|india|china|japan|singapore|germany|france|united kingdom|uk|ireland|netherlands|spain|italy|sweden|norway|denmark|finland|poland|portugal|australia|new zealand|mexico|brazil|argentina|colombia|south africa|nigeria|philippines|indonesia|malaysia|thailand|vietnam|israel|united arab emirates|uae|saudi arabia|romania|ukraine|switzerland|belgium|austria|greece|czech republic|hungary|croatia|serbia|egypt|kenya)\b/.test(text);
  const byName = US_STATES.find(([name]) => locationHasPhrase(text, name));
  if (byName && !foreignCountry) return byName;
  if (foreignCountry) return null;

  // Abbreviations are considered state evidence only as a distinct comma-style
  // location component (for example, "Austin, TX"), not as arbitrary text.
  const components = String(location || "")
    .split(/[,|·;/]+|\s+-\s+/)
    .map((part) => normalizeLocation(part));
  if (components.length < 2) return null;
  return US_STATES.find(([, code]) =>
    components.some((part) => part === code.toLowerCase()),
  ) || null;
}

function isWorldwideRemote(location, tags, source) {
  const text = normalizeLocation(location);
  const global = /\b(worldwide|anywhere|global|work from anywhere)\b/.test(text);
  return global && isRemoteJob(location, tags, source);
}

function hasUSLocation(location, tags, source) {
  const evidence = [location, ...(tags || [])].join(" ");
  const text = normalizeLocation(evidence);
  if (/\b(canada|india|china|japan|singapore|germany|france|united kingdom|uk|ireland|netherlands|spain|italy|sweden|norway|denmark|finland|poland|portugal|australia|new zealand|mexico|brazil|argentina|colombia|south africa|nigeria|philippines|indonesia|malaysia|thailand|vietnam|israel|united arab emirates|uae|saudi arabia|romania|ukraine|switzerland|belgium|austria|greece|czech republic|hungary|croatia|serbia|egypt|kenya)\b/.test(text)) {
    return false;
  }
  return /\b(united states|usa|us|america)\b/.test(text) ||
    Boolean(matchingState(location) || matchingState(evidence)) ||
    isWorldwideRemote(location, tags, source);
}

function requestedUSState(query) {
  const normalized = normalizeLocation(query)
    .replace(/\s+(usa|us)$/g, "")
    .trim();
  return US_STATES.find(([name, code]) =>
    normalized === normalizeLocation(name) || normalized === code.toLowerCase(),
  ) || null;
}

function jobMatchesLocation(query, location, tags = [], source = "") {
  const requested = normalizeLocation(query);
  if (!requested) return true;

  const isRemote = isRemoteJob(location, tags, source);
  const isHybrid = isHybridJob(location, tags);
  const remoteUS = /^(remote us|us remote|remote usa|remote united states|remote from us|remote from usa|remote from united states)$/.test(requested);
  const hybridUS = /^(hybrid us|us hybrid|hybrid usa|hybrid united states|hybrid in us|hybrid in usa|hybrid in united states)$/.test(requested);
  if (remoteUS) return isRemote && (hasUSLocation(location, tags, source) || isWorldwideRemote(location, tags, source));
  if (hybridUS) return isHybrid && hasUSLocation(location, tags, source) && !isWorldwideRemote(location, tags, source);

  const state = requestedUSState(requested);
  if (state) {
    const evidence = [location, ...(tags || [])].join(" ");
    const locatedInState = (matchingState(location) || matchingState(evidence))?.[0] === state[0] ||
      locationHasPhrase(evidence, state[0]);
    return locatedInState || (isRemote && (hasUSLocation(location, tags, source) || isWorldwideRemote(location, tags, source)));
  }

  if (/^(united states|usa|us|america)$/.test(requested)) {
    return hasUSLocation(location, tags, source) || isWorldwideRemote(location, tags, source);
  }
  if (/^remote$/.test(requested)) return isRemote;
  if (/^hybrid$/.test(requested)) return isHybrid;

  // Free-text searches remain useful (city, metro area, or another country),
  // while globally remote roles are eligible from any selected location.
  const normalizedLocation = normalizeLocation(location);
  return normalizedLocation.includes(requested) || isWorldwideRemote(location, tags, source);
}

const usLocationOptions = document.getElementById("us-location-options");
if (usLocationOptions) {
  US_STATES.forEach(([name, code]) => {
    const option = document.createElement("option");
    option.value = name;
    option.label = code;
    usLocationOptions.append(option);
  });
  ["Remote from USA", "Hybrid in USA"].forEach((label) => {
    const option = document.createElement("option");
    option.value = label;
    usLocationOptions.append(option);
  });
}
