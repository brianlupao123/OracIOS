import crypto from "node:crypto";

export const DEFAULT_BUSINESS_TIMEZONE = "Africa/Harare";

const IANA_TIMEZONE = /^[A-Za-z][A-Za-z_-]*(?:\/[A-Za-z][A-Za-z_-]*)+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

export function isValidBusinessTimezone(value) {
  if (typeof value !== "string") return false;
  const timezone = value.trim();
  if (!IANA_TIMEZONE.test(timezone)) return false;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).resolvedOptions().timeZone === timezone;
  } catch {
    return false;
  }
}

function isRealIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function getBusinessTimezone(env = process.env) {
  const raw = env.ORAC_BUSINESS_TIMEZONE || env.BUSINESS_TIMEZONE || DEFAULT_BUSINESS_TIMEZONE;
  const timezone = typeof raw === "string" ? raw.trim() : "";
  if (isValidBusinessTimezone(timezone)) return timezone;
  if (env.NODE_ENV === "production" && env.ORAC_STRICT_TIMEZONE === "true") {
    throw new Error(`Invalid ORAC_BUSINESS_TIMEZONE: "${raw}"`);
  }
  return DEFAULT_BUSINESS_TIMEZONE;
}

/**
 * Format a Date or timestamp string as YYYY-MM-DD in the business timezone.
 * Calendar dates (already matching YYYY-MM-DD) are preserved directly without timezone shift.
 */
export function formatBusinessDate(dateInput, timezone = getBusinessTimezone()) {
  if (!dateInput) return "";
  const resolvedTimezone = isValidBusinessTimezone(timezone) ? timezone.trim() : getBusinessTimezone();
  if (typeof dateInput === "string") {
    if (ISO_DATE.test(dateInput)) return isRealIsoDate(dateInput) ? dateInput : "";
    // Never let Node interpret a zone-less timestamp in the host machine's timezone.
    if (ZONELESS_DATETIME.test(dateInput)) return "";
  }
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: resolvedTimezone }).format(d);
}

/**
 * Hash exact CSV string or Buffer using SHA-256
 */
export function hashCsv(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}
