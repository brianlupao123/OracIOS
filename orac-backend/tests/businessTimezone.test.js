import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessDate,
  getBusinessTimezone,
  isValidBusinessTimezone
} from "../src/businessTimezone.js";

test("business timezone accepts trimmed IANA zone identifiers only", () => {
  assert.equal(isValidBusinessTimezone(" Africa/Harare "), true);
  assert.equal(isValidBusinessTimezone("CAT"), false);
  assert.equal(isValidBusinessTimezone("EST"), false);
  assert.equal(isValidBusinessTimezone("+02:00"), false);
  assert.equal(isValidBusinessTimezone("Invalid/Zone"), false);
});

test("business timezone trims valid configuration and safely falls back outside strict production", () => {
  assert.equal(getBusinessTimezone({ ORAC_BUSINESS_TIMEZONE: " Africa/Harare " }), "Africa/Harare");
  assert.equal(getBusinessTimezone({ ORAC_BUSINESS_TIMEZONE: "Invalid/Zone" }), DEFAULT_BUSINESS_TIMEZONE);
});

test("strict production timezone rejects invalid configuration", () => {
  assert.throws(
    () => getBusinessTimezone({
      NODE_ENV: "production",
      ORAC_STRICT_TIMEZONE: "true",
      ORAC_BUSINESS_TIMEZONE: "Invalid/Zone"
    }),
    /Invalid ORAC_BUSINESS_TIMEZONE/
  );
});

test("business dates validate calendar dates and reject zone-less datetimes", () => {
  assert.equal(formatBusinessDate("2026-02-28"), "2026-02-28");
  assert.equal(formatBusinessDate("2024-02-29"), "2024-02-29");
  assert.equal(formatBusinessDate("2026-02-31"), "");
  assert.equal(formatBusinessDate("0000-00-00"), "");
  assert.equal(formatBusinessDate("2026-11-24T20:00:00"), "");
  assert.equal(formatBusinessDate("2026-11-24 20:00:00"), "");
});

test("business dates use configured timezone for explicit instants and safe per-call fallback", () => {
  assert.equal(formatBusinessDate("2026-12-31T22:30:00.000Z", "Africa/Harare"), "2027-01-01");
  assert.equal(formatBusinessDate("2026-12-31T22:30:00.000Z", "Invalid/Zone"), "2027-01-01");
});
