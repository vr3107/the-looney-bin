// Fetching addresses that came from users: public web addresses only, every redirect checked.
// Only ordinary public web addresses: a careers page is never an IP address, a local or internal
// name, a non-standard port, or an address with a user name or password in it.
export function isPublicUrl(u) {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  if (u.port && !((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80"))) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host.startsWith("[") || host.includes(":")) return false;
  if (/^[\d.]+$/.test(host) || /^0x/i.test(host)) return false; // IPv4 in any written form
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|private|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$/.test(host)) return false;
  return /^[a-z0-9.-]+$/.test(host) && /\.[a-z][a-z0-9-]*[a-z0-9]$/.test(host);
}
// Fetch a page, following up to 5 redirects and checking every address on the way.
export async function fetchChecked(url, accept = "text/html", ms = 10_000) {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    if (!isPublicUrl(current)) throw new Error("bad_url");
    const r = await fetch(current, { headers: { Accept: accept, "User-Agent": "Mozilla/5.0 (compatible; TheLooneyBin/1.0; +https://the-looney-bin.pages.dev)" }, redirect: "manual", signal: AbortSignal.timeout(ms) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("Location")) {
      current = new URL(r.headers.get("Location"), current);
      continue;
    }
    return { r, finalUrl: current.href };
  }
  throw new Error("too_many_redirects");
}
// Read at most `limit` characters of the page.
export async function readCapped(r, limit = 600_000) {
  if (!r.body) return "";
  const reader = r.body.getReader(),
    decoder = new TextDecoder();
  let text = "";
  while (text.length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text.slice(0, limit);
}
