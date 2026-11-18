// Orac-IOS Base HTTP Client & Session Management
// Transport layer: JWT injection, 401 interceptor, error parsing, UAT test mode

export const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

export function getToken() {
  return localStorage.getItem("orac_token") || "";
}

export function setSession(user, token) {
  localStorage.setItem("orac_token", token);
  localStorage.setItem("orac_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("orac_token");
  localStorage.removeItem("orac_user");
}

export function getCachedUser() {
  const raw = localStorage.getItem("orac_user");
  try { return raw ? JSON.parse(raw) : null; }
  catch { clearSession(); return null; }
}

const sessionExpiredListeners = new Set();

export function notifySessionExpired() {
  clearSession();
  for (const listener of sessionExpiredListeners) {
    try { listener(); } catch { /* One UI listener must not affect another. */ }
  }
}

export function onSessionExpired(listener) {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

// --- Test-only UAT state gate (UAT Closure phase) ------------------------
const UAT_STATE_MODE_ENABLED = import.meta.env.VITE_UAT_STATE_MODE === "true";

const UAT_EMPTY_ARRAY_PATH_PREFIXES = ["/notifications", "/inventory/stock_items", "/inventory/suppliers", "/access_requests"];
export function isKnownArrayReadPath(path) {
  return UAT_EMPTY_ARRAY_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function uatStateFromUrl() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("uatState");
}

export const uatState = {
  isEnabled() { return UAT_STATE_MODE_ENABLED; },
  mode() { return UAT_STATE_MODE_ENABLED ? uatStateFromUrl() : null; },
  simulateSessionExpired() {
    if (!UAT_STATE_MODE_ENABLED) return;
    notifySessionExpired();
  }
};

export async function request(path, options = {}) {
  if (UAT_STATE_MODE_ENABLED) {
    const mode = uatStateFromUrl();
    if (mode === "error") {
      throw new Error("Simulated UAT error state (test-only; no backend contact was made).");
    }
    if (mode === "empty" && (!options.method || options.method === "GET") && isKnownArrayReadPath(path)) {
      return [];
    }
  }
  if (import.meta.env.PROD && !import.meta.env.VITE_API_BASE_URL) {
    throw new Error("The service is not connected yet. Please try again later.");
  }
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch (cause) {
    const error = new Error("Could not reach the server. Check your connection and try again.");
    error.network = true;
    error.cause = cause;
    throw error;
  }
  const contentType = res.headers?.get?.("content-type") || "";
  const canReadText = typeof res.text === "function";
  const rawBody = canReadText ? await res.text() : "";
  let body;
  try {
    body = canReadText ? (rawBody ? JSON.parse(rawBody) : null) : await res.json();
  } catch {
    body = null;
  }

  const isJsonContent = !contentType || contentType.toLowerCase().includes("application/json");
  if (!isJsonContent || !body) {
    const responseKind = rawBody.trimStart().startsWith("<") ? "HTML" : "non-JSON data";
    throw new Error(`The service returned ${responseKind} instead of API data. Check the service connection and try again.`);
  }

  if (!res.ok || body.success !== true) {
    const message = body.message || `Request failed (${res.status})`;
    if (res.status === 401) {
      if (!options.authFlow) notifySessionExpired();
      const error = new Error(message);
      if (!options.authFlow) error.sessionExpired = true;
      error.status = res.status;
      throw error;
    }
    const error = new Error(message);
    error.status = res.status;
    if (body.code) error.code = body.code;
    throw error;
  }
  return body.data;
}
