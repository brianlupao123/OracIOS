// Attendance Part 4 UI model: pure helpers, no React, no browser storage, no logging.
//
// Contract source: orac-backend/src/attendance/{routes,schemas,clockController,flag,policy,badge}.js
//   GET  /attendance/status     -> { enabled, pin_length }            (viewAttendanceStatus: A, O, V, T)
//   POST /attendance/clock-in   -> body { badge_token, pin, client_event_id }   (clockAttendance: T, V)
//   POST /attendance/clock-out  -> same body
// The server derives the technician from the badge and the capture channel from the signed-in actor.
// There is no technician id, time, hours, channel or location field in the request, so this module never builds one.
//
// SECURITY: badge tokens, PINs and QR payloads live only in the caller's in-memory component state. Nothing in this
// file reads or writes localStorage, sessionStorage, cookies, the URL or any outbox, and nothing logs.

export const ATTENDANCE_ROUTE = "/attendance";
export const DISABLED_MESSAGE = "Attendance is not enabled yet."; // identical to the backend FEATURE_DISABLED message
export const DEFAULT_PIN_LENGTH = 6; // owner-fixed rule (policy.js); the live value comes from GET /attendance/status
export const MAX_BADGE_TOKEN_LENGTH = 128; // ClockActionSchema badge_token max
// Shape of a badge token as issued by badge.js. Used only to accept a SCANNED payload; the server remains the judge.
export const BADGE_TOKEN_SHAPE = /^ORAC-B1\.[A-Za-z0-9_-]{8,64}\.\d{10}\.[0-9a-f]{32}$/;
export const CLOCK_ACTIONS = Object.freeze(["clock_in", "clock_out"]);
export const CLOCK_PAYLOAD_KEYS = Object.freeze(["badge_token", "pin", "client_event_id"]);

// Mirrors permissions.js clockAttendance: [Technician, Supervisor]. The server still decides every request.
const ROLE_MODES = Object.freeze({ Technician: "own", Supervisor: "kiosk" });

export function attendanceModeFor(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_MODES, role) ? ROLE_MODES[role] : null;
}

export function pinLengthFrom(status) {
  const n = Number(status?.pin_length);
  return Number.isInteger(n) && n >= 4 && n <= 12 ? n : DEFAULT_PIN_LENGTH;
}

export function describeStatus(data) {
  return data?.enabled === true
    ? { enabled: true, pinLength: pinLengthFrom(data) }
    : { enabled: false, pinLength: pinLengthFrom(data), message: DISABLED_MESSAGE };
}

export function isValidPin(pin, length = DEFAULT_PIN_LENGTH) {
  return typeof pin === "string" && new RegExp(`^[0-9]{${length}}$`).test(pin);
}

export function sanitizePinInput(raw, length = DEFAULT_PIN_LENGTH) {
  return String(raw ?? "").replace(/\D/g, "").slice(0, length);
}

// Manual entry: trim only. Anything odd is left for the server's uniform refusal.
export function normalizeBadgeToken(raw) {
  if (typeof raw !== "string") return "";
  const token = raw.trim();
  return token.length > MAX_BADGE_TOKEN_LENGTH || /\s/.test(token) ? "" : token;
}

// Scanned payload: must already look like a badge token. A URL, text or another QR kind is rejected and never kept.
export function acceptScannedPayload(raw) {
  const token = normalizeBadgeToken(raw);
  return BADGE_TOKEN_SHAPE.test(token) ? { ok: true, token } : { ok: false };
}

// Browser QR scanning needs getUserMedia and the BarcodeDetector API. Never assumed.
export function scannerSupport(env = globalThis) {
  const hasCamera = Boolean(env?.navigator?.mediaDevices && typeof env.navigator.mediaDevices.getUserMedia === "function");
  const hasDetector = typeof env?.BarcodeDetector === "function";
  return { supported: hasCamera && hasDetector, hasCamera, hasDetector };
}

export function newClientEventId(cryptoImpl = globalThis.crypto) {
  if (cryptoImpl && typeof cryptoImpl.randomUUID === "function") return cryptoImpl.randomUUID();
  if (cryptoImpl && typeof cryptoImpl.getRandomValues === "function") {
    const b = cryptoImpl.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error("This browser cannot create a secure submission reference.");
}

// One client_event_id per intent (action + badge). A retry after "no answer from the server" reuses the id, so the
// backend returns the original event instead of recording twice. Any definite server answer ends the intent.
// Held in memory only; never written anywhere.
export function createAttemptTracker(makeId = newClientEventId) {
  let current = null;
  return {
    idFor(action, badgeToken) {
      const key = `${action}\u0000${badgeToken}`;
      if (!current || current.key !== key) current = { key, id: makeId() };
      return current.id;
    },
    settle() { current = null; }
  };
}

export function buildClockPayload({ badgeToken, pin, clientEventId, pinLength = DEFAULT_PIN_LENGTH }) {
  const token = normalizeBadgeToken(badgeToken);
  if (!token) throw new Error("A badge is required.");
  if (!isValidPin(pin, pinLength)) throw new Error(`The PIN must be exactly ${pinLength} digits.`);
  if (typeof clientEventId !== "string" || !clientEventId) throw new Error("A submission reference is required.");
  return { badge_token: token, pin, client_event_id: clientEventId };
}

const MESSAGES = Object.freeze({
  FEATURE_DISABLED: DISABLED_MESSAGE,
  ATTENDANCE_CREDENTIALS_INVALID: "Badge or PIN not accepted.",
  ATTENDANCE_PIN_NOT_SET: "This technician has not set an attendance PIN yet.",
  ATTENDANCE_PIN_LOCKED: "PIN entry is locked for this badge. Try again later or ask Operations to reset the PIN.",
  ATTENDANCE_ALREADY_CLOCKED_IN: "This technician is already clocked in. Clock out first.",
  ATTENDANCE_NOT_CLOCKED_IN: "This technician is not clocked in.",
  ATTENDANCE_OPEN_SHIFT_OVERDUE: "The open shift is older than the allowed maximum and cannot be closed here. Ask a Supervisor to review it.",
  ATTENDANCE_SERVER_CLOCK_BEHIND: "Nothing was recorded because the server clock is behind the last recorded event.",
  ATTENDANCE_EVENT_ID_REUSED: "That submission could not be accepted. Please try again."
});
const GENERIC = "The attendance action could not be completed.";
const NETWORK = "No confirmation was received, so this action may or may not have been recorded. Check your connection and try again; retrying will not record it twice. Clock actions are never saved offline.";

// Fixed client wording by server code or status. The raw server message is never echoed (it can carry role or
// validation text), and the PIN, badge and request body are never part of any message.
export function describeAttendanceError(error) {
  if (error?.network) return { kind: "network", message: NETWORK, definite: false };
  if (error?.sessionExpired || error?.status === 401) return { kind: "session", message: "Your session has expired. Sign in again.", definite: true };
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "FEATURE_DISABLED") return { kind: "disabled", message: DISABLED_MESSAGE, definite: true };
  if (Object.prototype.hasOwnProperty.call(MESSAGES, code)) return { kind: "refused", code, message: MESSAGES[code], definite: true };
  if (error?.status === 403) return { kind: "forbidden", message: "Your account is not allowed to use attendance.", definite: true };
  if (error?.status === 400) return { kind: "invalid", message: "Check the badge and PIN and try again.", definite: true };
  if (error?.status === 429) return { kind: "busy", message: "Too many requests. Please wait a moment and try again.", definite: true };
  return { kind: "error", message: GENERIC, definite: typeof error?.status === "number" };
}

const EVENT_LABELS = Object.freeze({ clock_in: "Clock-in", clock_out: "Clock-out" });
const STATE_LABELS = Object.freeze({ in: "Clocked in", out: "Clocked out" });

// Reads only fields the backend returns (clockController respondOk). Anything unexpected is refused, not guessed.
export function summarizeClockResult(data, operator) {
  const type = data?.event?.event_type;
  if (!data || !EVENT_LABELS[type] || !STATE_LABELS[data.state] || !data.technician?.id) return null;
  return {
    replayed: data.replayed === true,
    eventLabel: EVENT_LABELS[type],
    serverTime: data.event.server_time || null,
    technicianName: data.technician.name || null,
    stateLabel: STATE_LABELS[data.state],
    state: data.state,
    openSince: data.open_since || null,
    channel: data.event.capture_channel === "shared_kiosk" ? "shared_kiosk" : data.event.capture_channel === "self_phone" ? "self_phone" : null,
    recordedBy: operator?.name || null,
    evidenceOnly: data.evidence_only === true
  };
}

// The whole clock call in one place so it can be tested without React. `api` is the attendance client.
export async function performClockAction({ api, action, badgeToken, pin, tracker, pinLength = DEFAULT_PIN_LENGTH, operator }) {
  if (!CLOCK_ACTIONS.includes(action)) throw new Error("Unknown attendance action.");
  const token = normalizeBadgeToken(badgeToken);
  let payload;
  try {
    payload = buildClockPayload({ badgeToken: token, pin, clientEventId: tracker.idFor(action, token), pinLength });
  } catch (error) {
    return { ok: false, info: { kind: "invalid", message: error.message, definite: true }, local: true };
  }
  try {
    const data = await (action === "clock_in" ? api.clockIn(payload) : api.clockOut(payload));
    tracker.settle();
    const summary = summarizeClockResult(data, operator);
    if (!summary) return { ok: false, info: { kind: "error", message: GENERIC, definite: true } };
    return { ok: true, summary };
  } catch (error) {
    const info = describeAttendanceError(error);
    if (info.definite) tracker.settle();
    return { ok: false, info };
  }
}
