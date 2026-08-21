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

/** `location` is optional and QuickCommerce-only - {lat, lon, pincode,
 * platforms}. Omitting it (the default) sends exactly {text}, identical to
 * every call site that existed before QuickCommerce did. */
export function postBrief(text, location) {
  const body = location ? { text, ...location } : { text };
  return request("/brief", { method: "POST", body: JSON.stringify(body) });
}

export function getRun(runId) {
  return request(`/runs/${runId}`);
}

export function listRuns(limit = 50) {
  return request(`/runs?limit=${limit}`);
}

export function approveRun(runId, chosenOption) {
  return request(`/runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify({ chosen_option: chosenOption }),
  });
}

export function checkoutRun(runId, checkoutData) {
  return request(`/runs/${runId}/checkout`, {
    method: "POST",
    body: JSON.stringify(checkoutData),
  });
}

export function getRunOrder(runId) {
  return request(`/runs/${runId}/order`);
}

export function listOrders(limit = 50) {
  return request(`/orders?limit=${limit}`);
}

