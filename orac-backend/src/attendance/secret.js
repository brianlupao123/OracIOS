import { createHmac } from "node:crypto";

// One server secret, ORAC_ATTENDANCE_SECRET, from which the badge-signing key and the PIN pepper are derived with
// distinct labels, so neither can stand in for the other. The value is never logged, returned or stored.
//
// Development and test fall back to a fixed, obviously-local value (same idea as DEV_JWT_SECRET in config.js).
// With the flag ON in production the secret is mandatory and must be strong; validateAttendanceRuntime() is
// called from validateRuntimeConfig() so a mis-configured deployment fails at start-up, not at first use.
// Rotating the secret invalidates every issued badge and every PIN: badges are re-issued and technicians set a new PIN.
const DEV_ATTENDANCE_SECRET = "orac-local-development-attendance-secret-not-for-production";
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

const isProduction = (env) => (env.NODE_ENV || "development") === "production";

export function attendanceSecret(env = process.env) {
  const value = env.ORAC_ATTENDANCE_SECRET;
  if (value) return value;
  if (isProduction(env)) {
    throw new Error("ORAC_ATTENDANCE_SECRET must be set before attendance badges or PINs can be used in production.");
  }
  return DEV_ATTENDANCE_SECRET;
}

export function deriveAttendanceKey(label, env = process.env) {
  return createHmac("sha256", attendanceSecret(env)).update(`orac-attendance|${label}`).digest();
}

// Start-up check. Nothing to validate while the feature is off.
export function validateAttendanceRuntime(env = process.env) {
  if (env.ORAC_ATTENDANCE_ENABLED !== "enabled" || !isProduction(env)) return;
  const value = env.ORAC_ATTENDANCE_SECRET;
  if (!value || value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(`Production ORAC_ATTENDANCE_SECRET must be set to a strong value of at least ${MIN_PRODUCTION_SECRET_LENGTH} characters when ORAC_ATTENDANCE_ENABLED=enabled.`);
  }
}
