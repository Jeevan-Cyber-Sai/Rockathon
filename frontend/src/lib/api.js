const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Thin wrapper so callers get a consistent shape: never throws on a
 * network failure without a message a shake/error UI can actually show. */
async function request(path, options) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (err) {
    throw new Error(`Could not reach the server (${err.message}).`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // response wasn't JSON - keep statusText
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

export function postBrief(text) {
  return request("/brief", { method: "POST", body: JSON.stringify({ text }) });
}

export function getRun(runId) {
  return request(`/runs/${runId}`);
}
