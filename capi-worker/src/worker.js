// Meta Conversions API relay for thatwasfast.ai
// Deploy: wrangler deploy
// Secrets: wrangler secret put META_ACCESS_TOKEN
// Env:  META_PIXEL_ID (in wrangler.toml as [vars])

const PIXEL_ID = "1116154840839854";
const META_API_VERSION = "v21.0";
const ALLOWED_ORIGINS = ["https://thatwasfast.ai", "https://www.thatwasfast.ai"];

// SHA-256 hex — Meta requires hashed PII (email, phone)
async function sha256(str) {
  const buf = new TextEncoder().encode(str.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const {
      event_name,
      event_id,           // shared with pixel for dedup
      event_source_url,
      custom_data = {},
      user_data = {},
    } = payload;

    if (!event_name || !event_id) {
      return new Response(JSON.stringify({ error: "event_name and event_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Build Meta CAPI event
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";
    const fbc = user_data.fbc || null; // click ID from _fbc cookie
    const fbp = user_data.fbp || null; // browser pixel ID cookie

    const hashedUser = {};
    if (user_data.email) hashedUser.em = [await sha256(user_data.email)];
    if (user_data.phone) hashedUser.ph = [await sha256(user_data.phone.replace(/\D/g, ""))];
    if (ip) hashedUser.client_ip_address = ip;
    if (ua) hashedUser.client_user_agent = ua;
    if (fbc) hashedUser.fbc = fbc;
    if (fbp) hashedUser.fbp = fbp;

    const metaEvent = {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id,
      action_source: "website",
      event_source_url: event_source_url || "https://thatwasfast.ai/",
      user_data: hashedUser,
      custom_data,
    };

    const url = `https://graph.facebook.com/${META_API_VERSION}/${PIXEL_ID}/events`;
    const body = {
      data: [metaEvent],
      access_token: env.META_ACCESS_TOKEN,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "meta_api_failed", detail: String(err) }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  },
};
