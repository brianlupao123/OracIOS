import bcrypt from "bcrypt";
import { createHmac } from "node:crypto";
import { deriveAttendanceKey } from "./secret.js";
import { ATTENDANCE_POLICY } from "./policy.js";

// Six-digit attendance PIN. The PIN exists in memory for the length of one request. What is stored is
// bcrypt(HMAC-SHA256(server pepper, technician_id + ":" + PIN)): bcrypt is the hashing already used for passwords
// in this codebase, and the server-side pepper means a copy of the database alone cannot be used to enumerate the
// small six-digit space offline. The PIN is never logged, audited, returned, or placed in a draft.
const BCRYPT_COST = 10;
const PIN_FORMAT = new RegExp(`^[0-9]{${ATTENDANCE_POLICY.pin_length}}$`);

export function validatePinFormat(pin) {
  if (typeof pin !== "string" || !PIN_FORMAT.test(pin)) return `The PIN must be exactly ${ATTENDANCE_POLICY.pin_length} digits.`;
  return null;
}

function digest(technicianId, pin) {
  return createHmac("sha256", deriveAttendanceKey("pin-v1")).update(`${technicianId}:${pin}`).digest("hex");
}

export async function createPinCredential(technicianId, pin, nowIso, setBy) {
  return {
    technician_id: technicianId,
    pin_hash: await bcrypt.hash(digest(technicianId, pin), BCRYPT_COST),
    pin_set_at: nowIso,
    pin_set_by: setBy,
    failed_attempts: 0,
    locked_until: null,
    last_failed_at: null
  };
}

// Takes the same time whether or not a credential exists, so response time does not reveal who has a PIN.
let dummyHash;
export async function verifyPin(credential, technicianId, pin) {
  if (!dummyHash) dummyHash = await bcrypt.hash("no-such-credential", BCRYPT_COST);
  const candidate = digest(technicianId, typeof pin === "string" ? pin : "");
  const matches = await bcrypt.compare(candidate, credential?.pin_hash || dummyHash);
  return Boolean(credential?.pin_hash) && matches;
}

export function lockRemainingSeconds(credential, nowMs) {
  if (!credential?.locked_until) return 0;
  return Math.max(0, Math.ceil((Date.parse(credential.locked_until) - nowMs) / 1000));
}

// Counts one wrong PIN. After the Nth consecutive failure the PIN is locked and the counter restarts.
export function registerPinFailure(credential, nowMs) {
  credential.failed_attempts = Number(credential.failed_attempts || 0) + 1;
  credential.last_failed_at = new Date(nowMs).toISOString();
  if (credential.failed_attempts >= ATTENDANCE_POLICY.pin_max_failures) {
    credential.locked_until = new Date(nowMs + ATTENDANCE_POLICY.pin_lock_minutes * 60000).toISOString();
    credential.failed_attempts = 0;
    return { locked: true, attemptsRemaining: 0 };
  }
  return { locked: false, attemptsRemaining: ATTENDANCE_POLICY.pin_max_failures - credential.failed_attempts };
}

export function registerPinSuccess(credential) {
  credential.failed_attempts = 0;
  credential.locked_until = null;
  credential.last_failed_at = null;
}

// PINs that are trivially guessable are refused when a technician chooses one: all one digit, straight
// ascending/descending runs, and a handful of well-known values. The six-digit space is small, so this removes
// the first things anyone would try. It is advice to the technician, not a substitute for the lock above.
const COMMON_PINS = new Set(["123123", "121212", "112233", "654321", "159753", "696969", "123321", "246810", "000123", "202020"]);
export function isWeakPin(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  return COMMON_PINS.has(pin);
}
