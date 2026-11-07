const DICE_ENDPOINT = "https://mcp.dice.com/mcp";
const MAX_KEYWORDS = 5;
const requestsByIp = new Map();

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function withinRateLimit(ip) {
  const now = Date.now();
  const current = requestsByIp.get(ip);
  if (current && now - current.startedAt < 60_000) {
    if (current.count >= 4) return false;
    current.count += 1;
  } else {
    requestsByIp.set(ip, { startedAt: now, count: 1 });
  }
  if (requestsByIp.size > 5000) {
    for (const [key, value] of requestsByIp) {
      if (now - value.startedAt >= 60_000) requestsByIp.delete(key);
    }
  }
  return true;
}

function sseMessage(text) {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (data.length) return JSON.parse(data.join("\n"));
  return JSON.parse(text);
}

function structuredResult(result) {
  if (result?.structuredContent?.data) return result.structuredContent;
  if (result?.structured_content?.data) return result.structured_content;
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.find((part) => part.type === "text")?.text || "";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { data: parsed };
    return parsed;
  } catch {
    return null;
  }
}

async function diceRequest(payload, sessionId = "", protocolVersion = "") {
  const response = await fetch(DICE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  const session = response.headers.get("Mcp-Session-Id") || sessionId;
  const text = await response.text();
  if (!response.ok) throw new Error("Dice request failed");
  if (!text.trim()) return { session, rpc: null };
  return { session, rpc: sseMessage(text) };
}

async function initializeDice() {
  const { session, rpc } = await diceRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "the-looney-bin", version: "1.0.0" },
    },
  });
  if (rpc?.error) throw new Error("Dice connection unavailable");
  await diceRequest({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }, session, rpc?.result?.protocolVersion || "2025-06-18");
  return { session, protocolVersion: rpc?.result?.protocolVersion || "2025-06-18" };
}

async function searchDice(args, connection, id) {
  const { rpc } = await diceRequest({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "search_jobs", arguments: args },
  }, connection.session, connection.protocolVersion);
  if (rpc?.error || rpc?.result?.isError) {
    const reason = rpc?.error?.message || (rpc?.result?.content || []).map((c) => c.text || "").join(" ");
    throw new Error(String(reason || "Dice search unavailable").slice(0, 200));
  }
  const result = structuredResult(rpc?.result);
  if (!Array.isArray(result?.data)) throw new Error("Dice response unavailable");
  return result;
}

function diceFilters(location, postedHours) {
  const normalized = String(location || "").toLowerCase().replace(/[()]/g, "");
  const args = {};
  if (/^(remote us|remote from usa|remote from united states|us remote|remote usa)$/.test(normalized)) {
    args.location = "United States";
    args.workplace_types = ["Remote"];
  } else if (/^(hybrid us|hybrid in usa|hybrid in united states|us hybrid|hybrid usa)$/.test(normalized)) {
    args.location = "United States";
    args.workplace_types = ["Hybrid"];
  } else if (normalized === "remote") {
    args.location = "Remote";
    args.workplace_types = ["Remote"];
  } else if (location) {
    args.location = location;
  }

  const hours = Number(postedHours);
  if (hours > 0 && hours <= 24) args.posted_date = "ONE";
  else if (hours > 24 && hours <= 72) args.posted_date = "THREE";
  else if (hours > 72 && hours <= 168) args.posted_date = "SEVEN";
  return args;
}

export async function onRequestPost({ request }) {
  if (!allowedOrigin(request)) return json({ error: "same_origin_required" }, 403);
  if (Number(request.headers.get("Content-Length") || 0) > 4000) {
    return json({ error: "request_too_large" }, 413);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!withinRateLimit(ip)) return json({ error: "rate_limited" }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const roleQueries = [...new Set(query.split(",").map((role) => role.trim()).filter(Boolean))].slice(0, MAX_KEYWORDS);
  if (!roleQueries.length) return json({ jobs: [], error: "keyword_required" }, 400);
  if (query.length > 500 || location.length > 120) {
    return json({ error: "input_too_long" }, 413);
  }

  try {
    const filters = diceFilters(location, body?.postedHours);
    const connection = await initializeDice();
    let requestId = 2;
    const results = await Promise.allSettled(roleQueries.map(async (keyword) => {
      const pages = [];
      let pageCount = 1;
      for (let page = 1; page <= Math.min(pageCount, 3); page++) {
        const result = await searchDice({
          keyword,
          ...filters,
          jobs_per_page: 50,
          page_number: page,
          sort: "datePosted",
        }, connection, requestId++);
        pages.push(result);
        pageCount = Number(result.meta?.pageCount || result.metadata?.pageCount || pageCount);
      }
      return pages;
    }));
    const successful = results.filter((result) => result.status === "fulfilled").flatMap((result) => result.value);
    if (!successful.length) throw new Error(results.find((r) => r.status === "rejected")?.reason?.message || "Dice search unavailable");
    const jobs = successful.flatMap((result) => result.data || []);
    return json({ jobs, resultCount: successful.reduce((total, result) => total + (result.meta?.totalResults || result.metadata?.totalResults || result.data.length), 0) });
  } catch (error) {
    // e.g. "Job search failed: DSP login did not return an access token" — a problem on Dice's side.
    return json({ error: "dice_temporarily_unavailable", detail: String(error?.message || "").slice(0, 200) }, 502);
  }
}
