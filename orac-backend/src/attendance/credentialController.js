import { randomBytes } from "node:crypto";
import { requirePermission, roles } from "../permissions.js";
import { requestNowMs } from "../idempotency.js";
import { attendanceEnabled, featureDisabled } from "./flag.js";
import { ATTENDANCE_POLICY } from "./policy.js";
import { issueBadgeToken } from "./badge.js";
import { qrToSvg } from "./qrEncode.js";
import { validatePinFormat, isWeakPin, createPinCredential, verifyPin, lockRemainingSeconds, registerPinFailure, registerPinSuccess } from "./pin.js";

// Badge and PIN lifecycle. Every handler: permission first, then the dark flag, then the work.
// Audit rows carry ids, actions and reasons only: never a PIN, a PIN hash, a badge token or a signature.
const DAY_MS = 86400000;

function getActor(req) {
  return req.user?.id ? req.db.users.find((user) => user.id === req.user.id) : null;
}

// The ONLY shape in which a badge leaves the server (and goes into the audit trail). No token, no MAC.
export function badgeView(db, badge) {
  const technician = (db.users || []).find((user) => user.id === badge.technician_id);
  return {
    id: badge.id,
    technician_id: badge.technician_id,
    technician_name: technician?.name || null,
    status: badge.status,
    issued_at: badge.issued_at,
    issued_by: badge.issued_by,
    expires_at: badge.expires_at,
    withdrawn_at: badge.withdrawn_at || null,
    withdrawn_by: badge.withdrawn_by || null,
    withdrawn_reason: badge.withdrawn_reason || null
  };
}

function ensureCollections(db) {
  if (!Array.isArray(db.attendance_badges)) db.attendance_badges = [];
  if (!Array.isArray(db.attendance_pin_credentials)) db.attendance_pin_credentials = [];
}

// GET /attendance/status - lets the app decide whether to show attendance at all. Reveals nothing else.
export function getAttendanceStatus(req, res) {
  requirePermission(getActor(req), "viewAttendanceStatus");
  res.json({ success: true, data: { enabled: attendanceEnabled(), pin_length: ATTENDANCE_POLICY.pin_length } });
}

// POST /attendance/badges { technician_id, valid_days? } -> the badge token and QR SVG, shown exactly once.
export function issueAttendanceBadge(req, res) {
  const actor = getActor(req); requirePermission(actor, "manageAttendanceBadges");
  if (!attendanceEnabled()) return featureDisabled(res);
  ensureCollections(req.db);
  const technician = req.db.users.find((user) => user.id === req.body.technician_id && user.role === roles.TECHNICIAN);
  if (!technician) return res.status(400).json({ success: false, message: "A valid Technician is required." });
  if (technician.is_active === false) return res.status(400).json({ success: false, message: "Cannot issue a badge to an inactive Technician." });

  const nowMs = requestNowMs(req);
  const validDays = Math.min(req.body.valid_days ?? ATTENDANCE_POLICY.badge_default_valid_days, ATTENDANCE_POLICY.badge_max_valid_days);
  const nowIso = new Date(nowMs).toISOString();
  // One live badge per technician: issuing a new one withdraws the old one in the same save.
  for (const old of req.db.attendance_badges) {
    if (old.technician_id === technician.id && old.status === "active") {
      Object.assign(old, { status: "withdrawn", withdrawn_at: nowIso, withdrawn_by: actor.id, withdrawn_reason: "replaced by a newly issued badge" });
      req.store.audit(req.db, actor, "attendance_badge", old.id, "ATTENDANCE_BADGE_WITHDRAWN", { status: "active" }, badgeView(req.db, old));
    }
  }
  const badge = {
    id: `bdg_${randomBytes(12).toString("base64url")}`,
    technician_id: technician.id,
    status: "active",
    issued_at: nowIso,
    issued_by: actor.id,
    expires_at: new Date(nowMs + validDays * DAY_MS).toISOString(),
    withdrawn_at: null, withdrawn_by: null, withdrawn_reason: null
  };
  req.db.attendance_badges.push(badge);
  req.store.audit(req.db, actor, "attendance_badge", badge.id, "ATTENDANCE_BADGE_ISSUED", null, badgeView(req.db, badge));

  const token = issueBadgeToken(badge.id, Date.parse(badge.expires_at));
  res.set("Cache-Control", "no-store");
  res.status(201).json({ success: true, data: { badge: badgeView(req.db, badge), token, qr_svg: qrToSvg(token, { label: `Attendance badge for ${technician.name || "technician"}` }) } });
}

// GET /attendance/badges[?technician_id=] - never includes a token.
export function listAttendanceBadges(req, res) {
  requirePermission(getActor(req), "manageAttendanceBadges");
  if (!attendanceEnabled()) return featureDisabled(res);
  const wanted = req.query?.technician_id;
  const data = (req.db.attendance_badges || [])
    .filter((badge) => !wanted || badge.technician_id === wanted)
    .map((badge) => badgeView(req.db, badge))
    .sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)))
    .slice(0, 500);
  res.json({ success: true, data });
}

// POST /attendance/badges/:id/withdraw { reason } - takes effect on the very next scan.
export function withdrawAttendanceBadge(req, res) {
  const actor = getActor(req); requirePermission(actor, "manageAttendanceBadges");
  if (!attendanceEnabled()) return featureDisabled(res);
  const badge = (req.db.attendance_badges || []).find((row) => row.id === req.params.id);
  if (!badge) return res.status(404).json({ success: false, message: "Badge not found." });
  if (badge.status !== "active") return res.status(409).json({ success: false, message: "This badge is already withdrawn." });
  const before = badgeView(req.db, badge);
  Object.assign(badge, { status: "withdrawn", withdrawn_at: new Date(requestNowMs(req)).toISOString(), withdrawn_by: actor.id, withdrawn_reason: req.body.reason });
  req.store.audit(req.db, actor, "attendance_badge", badge.id, "ATTENDANCE_BADGE_WITHDRAWN", before, badgeView(req.db, badge));
  res.json({ success: true, data: badgeView(req.db, badge) });
}

// GET /attendance/pin/status - a technician's own PIN state.
export function getOwnPinStatus(req, res) {
  const actor = getActor(req); requirePermission(actor, "setOwnAttendancePin");
  if (!attendanceEnabled()) return featureDisabled(res);
  const credential = (req.db.attendance_pin_credentials || []).find((row) => row.technician_id === actor.id);
  const locked = lockRemainingSeconds(credential, requestNowMs(req)) > 0;
  res.json({ success: true, data: { has_pin: Boolean(credential), locked, pin_set_at: credential?.pin_set_at || null } });
}

// POST /attendance/pin { pin, current_pin? } - a technician sets or changes their OWN PIN on their own session.
// Nobody (Admin included) can set another person's PIN, so nobody but the technician ever knows it.
// Changing an existing PIN needs the current one, and a wrong current PIN counts toward the same lock.
export async function setOwnAttendancePin(req, res) {
  const actor = getActor(req); requirePermission(actor, "setOwnAttendancePin");
  if (!attendanceEnabled()) return featureDisabled(res);
  ensureCollections(req.db);
  const nowMs = requestNowMs(req); const nowIso = new Date(nowMs).toISOString();
  const formatError = validatePinFormat(req.body.pin);
  if (formatError) return res.status(400).json({ success: false, message: formatError });
  if (isWeakPin(req.body.pin)) return res.status(400).json({ success: false, code: "ATTENDANCE_PIN_TOO_WEAK", message: "That PIN is too easy to guess. Avoid repeated digits and simple runs." });

  const existing = req.db.attendance_pin_credentials.find((row) => row.technician_id === actor.id);
  if (existing) {
    const remaining = lockRemainingSeconds(existing, nowMs);
    if (remaining > 0) return res.status(423).json({ success: false, code: "ATTENDANCE_PIN_LOCKED", message: "PIN entry is locked. Try again later or ask Operations to reset your PIN.", retry_after_seconds: remaining });
    const currentFormatError = validatePinFormat(req.body.current_pin);
    if (currentFormatError) return res.status(400).json({ success: false, message: "Enter your current PIN to change it." });
    if (!(await verifyPin(existing, actor.id, req.body.current_pin))) {
      const outcome = registerPinFailure(existing, nowMs);
      req.persistOnFailure = true; // the attempt counter must be saved even though this answer is an error
      req.store.audit(req.db, actor, "attendance_pin", actor.id, outcome.locked ? "ATTENDANCE_PIN_LOCKED" : "ATTENDANCE_PIN_FAILED", null, { context: "change_pin" });
      return res.status(outcome.locked ? 423 : 403).json({ success: false, code: outcome.locked ? "ATTENDANCE_PIN_LOCKED" : "ATTENDANCE_CREDENTIALS_INVALID", message: outcome.locked ? "Too many wrong PINs. PIN entry is locked." : "Current PIN not accepted." });
    }
    registerPinSuccess(existing);
  }
  const credential = await createPinCredential(actor.id, req.body.pin, nowIso, actor.id);
  req.db.attendance_pin_credentials = req.db.attendance_pin_credentials.filter((row) => row.technician_id !== actor.id);
  req.db.attendance_pin_credentials.push(credential);
  req.store.audit(req.db, actor, "attendance_pin", actor.id, existing ? "ATTENDANCE_PIN_CHANGED" : "ATTENDANCE_PIN_SET", null, { technician_id: actor.id });
  res.json({ success: true, data: { has_pin: true, pin_set_at: nowIso } });
}

// POST /attendance/technicians/:id/pin/clear { reason } - Admin/Operations remove a forgotten or locked PIN.
// The technician then sets a new one themselves; the old value is gone, not reset to anything known.
export function clearAttendancePin(req, res) {
  const actor = getActor(req); requirePermission(actor, "clearAttendancePin");
  if (!attendanceEnabled()) return featureDisabled(res);
  ensureCollections(req.db);
  const technician = req.db.users.find((user) => user.id === req.params.id && user.role === roles.TECHNICIAN);
  if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
  if (!req.db.attendance_pin_credentials.some((row) => row.technician_id === technician.id)) {
    return res.status(409).json({ success: false, message: "This technician has no attendance PIN to clear." });
  }
  req.db.attendance_pin_credentials = req.db.attendance_pin_credentials.filter((row) => row.technician_id !== technician.id);
  req.store.audit(req.db, actor, "attendance_pin", technician.id, "ATTENDANCE_PIN_CLEARED", null, { technician_id: technician.id, reason: req.body.reason });
  res.json({ success: true, data: { technician_id: technician.id, has_pin: false } });
}
