// The study site calls this function so that no Supabase key ever reaches the browser.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase at runtime.
// Participants are authorized by the study access value and the admin panel by its
// password. Both are checked inside the database functions.

const ALLOWED_ORIGIN = "https://amirhossein-razlighi.github.io";
const MAX_BODY_CHARS = 256_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Vary": "Origin",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function callDatabase(name: string, args: unknown) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

async function adminCall(name: string, password: unknown, extraArgs: Record<string, unknown> = {}) {
  if (typeof password !== "string" || password.length > 200) return reply(401, { status: "denied" });
  const res = await callDatabase(name, { p_password: password, ...extraArgs });
  if (!res.ok) {
    console.error("admin query failed", res.status, await res.text());
    return reply(500, { status: "error" });
  }
  const data = await res.json();
  if (data.status === "ok") return reply(200, data);
  return reply(data.status === "locked" ? 429 : 401, { status: data.status });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "method not allowed" });

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return reply(413, { error: "too large" });

  let body: { action?: string; access?: unknown; payload?: unknown; password?: unknown; submission_id?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid json" });
  }
  if (body.action === "admin") return await adminCall("study_admin_data", body.password);
  if (body.action === "admin_delete") {
    if (typeof body.submission_id !== "string" || !UUID_PATTERN.test(body.submission_id)) {
      return reply(400, { status: "invalid" });
    }
    return await adminCall("study_admin_delete_response", body.password, { p_submission_id: body.submission_id });
  }
  if (typeof body.access !== "string") return reply(400, { error: "missing access" });

  let res: Response;
  if (body.action === "check") {
    res = await callDatabase("study_check_access", { p_access: body.access });
  } else if (body.action === "submit") {
    res = await callDatabase("submit_study_response", { p_access: body.access, p_payload: body.payload });
  } else {
    return reply(400, { error: "unknown action" });
  }

  if (!res.ok) {
    console.error("database rejected request", res.status, await res.text());
    return reply(400, { error: "rejected" });
  }
  return reply(200, await res.json());
});
