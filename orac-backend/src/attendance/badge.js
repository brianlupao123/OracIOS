import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveAttendanceKey } from "./secret.js";

// Attendance badge token: ORAC-B1.<badge_id>.<expiry_unix_seconds>.<mac>
//
// It is a bearer credential for ONE issued badge. It names no person: the server looks the badge up and finds
// the technician, so a photographed badge reveals no identity and nothing about the roster. The MAC covers the
// badge id and the expiry, so neither can be altered. It is a separate format from the generic QR bundle in
// services/qrCodeService.js (whose signature covers metadata that is not in its own URI, so it cannot be
// verified from what a scanner reads); that service is deliberately left unchanged. A token signed here is only
// useful if the same badge id is also an ACTIVE row in attendance_badges, so withdrawal works at once.
//
// The badge alone never clocks anyone: every clock event also needs the technician's PIN.
export const BADGE_TOKEN_VERSION = "ORAC-B1";
const TOKEN_PATTERN = /^ORAC-B1\.([A-Za-z0-9_-]{8,64})\.(\d{10})\.([0-9a-f]{32})$/;
const MAX_TOKEN_LENGTH = 128;

function mac(badgeId, expUnix) {
  return createHmac("sha256", deriveAttendanceKey("badge-v1"))
    .update(`ORAC-ATTENDANCE-BADGE|v1|${badgeId}|${expUnix}`).digest("hex").slice(0, 32); // 128-bit tag
}

export function issueBadgeToken(badgeId, expiresAtMs) {
  const exp = Math.floor(Number(expiresAtMs) / 1000);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(badgeId)) || !Number.isInteger(exp) || String(exp).length !== 10) {
    throw new Error("A badge token needs a valid badge id and a future expiry.");
  }
  return `${BADGE_TOKEN_VERSION}.${badgeId}.${exp}.${mac(badgeId, exp)}`;
}

// Never throws on hostile input. Signature is checked before expiry, so a forged expiry reads as invalid, not expired.
export function verifyBadgeToken(token, nowMs = Date.now()) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return { ok: false, reason: "malformed" };
  const [, badgeId, expText, tag] = match;
  const expected = Buffer.from(mac(badgeId, Number(expText)), "hex");
  if (!timingSafeEqual(expected, Buffer.from(tag, "hex"))) return { ok: false, reason: "bad_signature" };
  if (Number(expText) * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, badgeId, expiresAt: new Date(Number(expText) * 1000).toISOString() };
}
