import { verifyBadgeToken } from "./badge.js";
import { verifyPin, lockRemainingSeconds, registerPinFailure, registerPinSuccess } from "./pin.js";

// The ONE place that decides "is this badge + PIN good?". Clock actions (and nothing else) call it.
//
// Uniform refusals: an unreadable, forged, expired, withdrawn or unknown badge, an inactive technician and a wrong
// PIN all return the same code and message, so the answer does not say which part was wrong. Only a badge that
// is genuinely valid can reach the "PIN not set" or "PIN locked" answers (the holder needs those to act).
//
// A wrong PIN changes stored state (attempt counter / lock). The caller MUST set req.persistOnFailure = true when
// `persist` is true, because persistenceMiddleware otherwise discards the write of a non-2xx response and the
// counter would never advance.
export const INVALID = { ok: false, status: 403, code: "ATTENDANCE_CREDENTIALS_INVALID", message: "Badge or PIN not accepted.", persist: false };

export async function authenticateBadgeAndPin(db, { badgeToken, pin }, nowMs) {
  const token = verifyBadgeToken(badgeToken, nowMs);
  if (!token.ok) return INVALID;
  const badge = (db.attendance_badges || []).find((row) => row.id === token.badgeId);
  if (!badge || badge.status !== "active" || !(Date.parse(badge.expires_at) > nowMs)) return INVALID;
  const technician = (db.users || []).find((user) => user.id === badge.technician_id);
  if (!technician || technician.is_active === false || technician.role !== "Technician") return INVALID;

  const credential = (db.attendance_pin_credentials || []).find((row) => row.technician_id === technician.id);
  if (!credential) {
    return { ok: false, status: 409, code: "ATTENDANCE_PIN_NOT_SET", message: "This technician has not set an attendance PIN yet.", persist: false };
  }
  const remaining = lockRemainingSeconds(credential, nowMs);
  if (remaining > 0) {
    return { ok: false, status: 423, code: "ATTENDANCE_PIN_LOCKED", message: "PIN entry is locked for this badge. Try again later or ask Operations to reset the PIN.", retry_after_seconds: remaining, persist: false };
  }
  if (credential.locked_until) credential.locked_until = null; // a finished lock is cleared; counter already restarted

  if (!(await verifyPin(credential, technician.id, pin))) {
    const outcome = registerPinFailure(credential, nowMs);
    if (outcome.locked) {
      return { ok: false, status: 423, code: "ATTENDANCE_PIN_LOCKED", message: "Too many wrong PINs. PIN entry is locked for this badge.", retry_after_seconds: lockRemainingSeconds(credential, nowMs), persist: true, technician, failure: "locked" };
    }
    return { ok: false, status: 403, code: INVALID.code, message: INVALID.message, attempts_remaining: outcome.attemptsRemaining, persist: true, technician, failure: "wrong_pin" };
  }
  registerPinSuccess(credential);
  return { ok: true, technician, badge, credential };
}
