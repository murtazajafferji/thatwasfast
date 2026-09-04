// Vapi ↔ Cal.com booking bridge
// Deploy: wrangler deploy
// Secret: wrangler secret put CAL_API_KEY

const CAL_API = "https://api.cal.com/v2";
const CAL_API_VERSION = "2024-08-13"; // bookings v2 needs this
const EVENT_TYPE_ID = 6940618; // 30min meeting on cal.com/thatwasfast
const OWNER_EMAIL = "murtazajafferji@gmail.com";
const OWNER_TZ = "America/Los_Angeles";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Vapi wraps function calls in this envelope. Reply shape:
// { results: [{ toolCallId, result: <string or object the LLM sees> }] }
function vapiReply(toolCallId, result) {
  return json({
    results: [{ toolCallId, result: typeof result === "string" ? result : JSON.stringify(result) }],
  });
}

async function calGet(path, env, params = {}) {
  const url = new URL(`${CAL_API}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.CAL_API_KEY}`,
      "cal-api-version": "2024-09-04",
    },
  });
  return await res.json();
}

async function calPost(path, env, body, apiVersion = CAL_API_VERSION) {
  const res = await fetch(`${CAL_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CAL_API_KEY}`,
      "cal-api-version": apiVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Get next N open slots — for Sarah to read as options
async function checkAvailability(args, env) {
  const daysAhead = Math.min(parseInt(args.daysAhead || 7), 14);
  const now = new Date();
  const start = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2h from now
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const data = await calGet("/slots", env, {
    eventTypeId: EVENT_TYPE_ID,
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: OWNER_TZ,
  });

  if (data.status !== "success") {
    return { ok: false, error: "Could not fetch availability right now." };
  }

  const slotsByDay = data.data || {};
  const allSlots = [];
  for (const day of Object.keys(slotsByDay).sort()) {
    for (const slot of slotsByDay[day]) {
      allSlots.push(slot.start);
      if (allSlots.length >= 3) break;
    }
    if (allSlots.length >= 3) break;
  }

  if (allSlots.length === 0) {
    return { ok: false, error: "No open slots in the next " + daysAhead + " days." };
  }

  const options = allSlots.map((iso) => {
    const d = new Date(iso);
    return {
      iso,
      spoken: d.toLocaleString("en-US", {
        timeZone: OWNER_TZ,
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    };
  });

  return { ok: true, options };
}

async function createBooking(args, env) {
  const { start, attendeeName, attendeeEmail, notes } = args;
  if (!start || !attendeeName || !attendeeEmail) {
    return { ok: false, error: "Missing name, email, or start time." };
  }

  const body = {
    start,
    eventTypeId: EVENT_TYPE_ID,
    attendee: {
      name: attendeeName,
      email: attendeeEmail,
      timeZone: OWNER_TZ,
      language: "en",
    },
    bookingFieldsResponses: {
      notes: notes || "Booked via That Was Fast AI voice demo",
    },
    metadata: {
      source: "vapi-voice-demo",
    },
  };

  const { status, body: resp } = await calPost("/bookings", env, body);
  if (status >= 200 && status < 300 && resp.status === "success") {
    const b = resp.data;
    return {
      ok: true,
      confirmationCode: b.uid,
      confirmedTime: b.start,
      message: `Booked! Confirmation code ${b.uid}. Confirmation email sent to ${attendeeEmail}.`,
    };
  }
  return {
    ok: false,
    error: resp.message || resp.error?.message || "Booking failed",
    detail: resp,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({ ok: true, service: "vapi-cal-bridge" });
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    // Vapi function-call envelope: { message: { type:'tool-calls', toolCallList:[{id,function:{name,arguments}}] } }
    const msg = payload.message || payload;
    const toolCalls = msg.toolCallList || msg.toolCalls || [];
    if (!toolCalls.length) {
      return json({ error: "no toolCalls" }, 400);
    }

    // Handle first tool call (Vapi sends one at a time for our use case)
    const tc = toolCalls[0];
    const fn = tc.function || {};
    const name = fn.name;
    let args = fn.arguments;
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    args = args || {};

    let result;
    try {
      if (name === "check_availability") {
        result = await checkAvailability(args, env);
      } else if (name === "create_booking") {
        result = await createBooking(args, env);
      } else {
        result = { ok: false, error: `unknown tool ${name}` };
      }
    } catch (err) {
      result = { ok: false, error: String(err) };
    }

    return vapiReply(tc.id, result);
  },
};
