import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { roles, permissions, effectivePermissionRoles, hasPermission } from "../src/permissions.js";
import { SCHEMA_COLLECTIONS, normalizeDb } from "../src/store.js";
import { attendanceEnabled, ATTENDANCE_FLAG } from "../src/attendance/flag.js";
import { ATTENDANCE_POLICY } from "../src/attendance/policy.js";
import { attendanceSecret, deriveAttendanceKey, validateAttendanceRuntime } from "../src/attendance/secret.js";
import { issueBadgeToken, verifyBadgeToken } from "../src/attendance/badge.js";
import { validatePinFormat, isWeakPin, createPinCredential, verifyPin, registerPinFailure, registerPinSuccess, lockRemainingSeconds } from "../src/attendance/pin.js";
import { authenticateBadgeAndPin, INVALID } from "../src/attendance/credentials.js";
import { encodeQr, qrToSvg, formatBits, versionBits, reedSolomonRemainder, QR_MAX_VERSION } from "../src/attendance/qrEncode.js";

// Attendance commit 1: QR/PIN security foundations. Synthetic data only; no secrets.
const NOW = Date.parse("2026-11-24T08:00:00.000Z");
const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test("flag is ON only for the exact value 'enabled' (default off)", () => {
  assert.equal(ATTENDANCE_FLAG, "ORAC_ATTENDANCE_ENABLED");
  for (const v of [undefined, "", "true", "1", "ENABLED", "on", " enabled", "enabled "]) assert.equal(attendanceEnabled({ ORAC_ATTENDANCE_ENABLED: v }), false, String(v));
  assert.equal(attendanceEnabled({ ORAC_ATTENDANCE_ENABLED: "enabled" }), true);
  assert.equal(attendanceEnabled({}), false);
});

test("secret: dev fallback outside production; production without a secret refuses; flag-on production needs 32+ chars", async () => {
  await withEnv({ NODE_ENV: "development", ORAC_ATTENDANCE_SECRET: undefined }, () => assert.ok(attendanceSecret().length > 20));
  await withEnv({ NODE_ENV: "production", ORAC_ATTENDANCE_SECRET: undefined }, () => assert.throws(() => attendanceSecret(), /ORAC_ATTENDANCE_SECRET/));
  // flag off: never blocks start-up, even in production without a secret
  validateAttendanceRuntime({ NODE_ENV: "production" });
  validateAttendanceRuntime({ NODE_ENV: "production", ORAC_ATTENDANCE_ENABLED: "disabled" });
  assert.throws(() => validateAttendanceRuntime({ NODE_ENV: "production", ORAC_ATTENDANCE_ENABLED: "enabled" }), /ORAC_ATTENDANCE_SECRET/);
  assert.throws(() => validateAttendanceRuntime({ NODE_ENV: "production", ORAC_ATTENDANCE_ENABLED: "enabled", ORAC_ATTENDANCE_SECRET: "short" }), /at least 32/);
  validateAttendanceRuntime({ NODE_ENV: "production", ORAC_ATTENDANCE_ENABLED: "enabled", ORAC_ATTENDANCE_SECRET: "x".repeat(32) });
  validateAttendanceRuntime({ NODE_ENV: "development", ORAC_ATTENDANCE_ENABLED: "enabled" });
});

test("secret: badge key and PIN pepper are different keys derived from one secret", () => {
  const badge = deriveAttendanceKey("badge-v1", { ORAC_ATTENDANCE_SECRET: "s".repeat(40) });
  const pin = deriveAttendanceKey("pin-v1", { ORAC_ATTENDANCE_SECRET: "s".repeat(40) });
  const other = deriveAttendanceKey("badge-v1", { ORAC_ATTENDANCE_SECRET: "t".repeat(40) });
  assert.notDeepEqual(badge, pin);
  assert.notDeepEqual(badge, other);
  assert.equal(badge.length, 32);
});

test("badge token: round trip, no personal data in it, tamper and expiry detection", () => {
  const exp = NOW + 86400000;
  const token = issueBadgeToken("bdg_Abcdefgh1234", exp);
  assert.match(token, /^ORAC-B1\.bdg_Abcdefgh1234\.\d{10}\.[0-9a-f]{32}$/);
  const ok = verifyBadgeToken(token, NOW);
  assert.deepEqual({ ok: ok.ok, badgeId: ok.badgeId }, { ok: true, badgeId: "bdg_Abcdefgh1234" });
  assert.equal(ok.expiresAt, new Date(Math.floor(exp / 1000) * 1000).toISOString());
  const [v, id, e, mac] = token.split(".");
  const flip = (s) => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
  assert.equal(verifyBadgeToken([v, id, e, flip(mac)].join("."), NOW).reason, "bad_signature");
  assert.equal(verifyBadgeToken([v, "bdg_Otherbadge99", e, mac].join("."), NOW).reason, "bad_signature");
  assert.equal(verifyBadgeToken([v, id, String(Number(e) + 100000), mac].join("."), NOW).reason, "bad_signature", "a forged later expiry must not verify");
  assert.equal(verifyBadgeToken(token, exp + 1000).reason, "expired");
  assert.equal(verifyBadgeToken(token, exp).reason, "expired", "expiry is exclusive");
  for (const bad of [undefined, null, 42, {}, "", "ORAC-B1", "ORAC-B2.bdg_Abcdefgh1234." + e + "." + mac, token + "x", token.toLowerCase().replace("orac-b1", "orac-b1"), "x".repeat(500)]) {
    assert.equal(verifyBadgeToken(bad, NOW).ok, false, String(bad).slice(0, 30));
  }
});

test("badge token signed under another secret does not verify (rotation invalidates every badge)", async () => {
  const token = await withEnv({ ORAC_ATTENDANCE_SECRET: "a".repeat(40) }, () => issueBadgeToken("bdg_Abcdefgh1234", NOW + 1e9));
  assert.equal(await withEnv({ ORAC_ATTENDANCE_SECRET: "a".repeat(40) }, () => verifyBadgeToken(token, NOW).ok), true);
  assert.equal(await withEnv({ ORAC_ATTENDANCE_SECRET: "b".repeat(40) }, () => verifyBadgeToken(token, NOW).reason), "bad_signature");
});

test("badge token refuses an invalid id or expiry at issue time", () => {
  assert.throws(() => issueBadgeToken("short", NOW + 1e9));
  assert.throws(() => issueBadgeToken("bad id with spaces!", NOW + 1e9));
  assert.throws(() => issueBadgeToken("bdg_Abcdefgh1234", NaN));
});

test("PIN format: exactly six digits, nothing else", () => {
  assert.equal(ATTENDANCE_POLICY.pin_length, 6);
  assert.equal(validatePinFormat("123456"), null);
  for (const bad of ["12345", "1234567", "12345a", "12 456", "", " 123456", "123456 ", "１２３４５６", 123456, null, undefined, "12345\n"]) assert.ok(validatePinFormat(bad), String(bad));
});

test("weak PINs are refused: repeats, runs, well-known values", () => {
  for (const weak of ["000000", "111111", "123456", "234567", "987654", "654321", "123123", "121212"]) assert.equal(isWeakPin(weak), true, weak);
  for (const fine of ["482915", "730184", "100200"]) assert.equal(isWeakPin(fine), false, fine);
});

test("PIN credential: stored as a bcrypt hash, never the PIN; bound to the technician", async () => {
  const cred = await createPinCredential("u_tech", "482915", "2026-11-24T08:00:00.000Z", "u_tech");
  assert.match(cred.pin_hash, /^\$2[aby]\$10\$/);
  assert.equal(JSON.stringify(cred).includes("482915"), false);
  assert.equal(await verifyPin(cred, "u_tech", "482915"), true);
  assert.equal(await verifyPin(cred, "u_tech", "482916"), false);
  assert.equal(await verifyPin(cred, "u_other", "482915"), false, "the same PIN must not work for a different technician id");
  assert.equal(await verifyPin(null, "u_tech", "482915"), false);
  assert.equal(await verifyPin(cred, "u_tech", undefined), false);
  const again = await createPinCredential("u_tech", "482915", "x", "u_tech");
  assert.notEqual(again.pin_hash, cred.pin_hash, "salted");
});

test("PIN lock: Nth consecutive wrong PIN locks, counter restarts, success clears, lock expires", () => {
  const cred = { failed_attempts: 0, locked_until: null };
  const max = ATTENDANCE_POLICY.pin_max_failures;
  for (let i = 1; i < max; i += 1) {
    const r = registerPinFailure(cred, NOW + i);
    assert.deepEqual([r.locked, r.attemptsRemaining], [false, max - i]);
  }
  const last = registerPinFailure(cred, NOW + 100);
  assert.equal(last.locked, true);
  assert.equal(cred.failed_attempts, 0);
  assert.equal(lockRemainingSeconds(cred, NOW + 100), ATTENDANCE_POLICY.pin_lock_minutes * 60);
  assert.equal(lockRemainingSeconds(cred, NOW + 100 + ATTENDANCE_POLICY.pin_lock_minutes * 60000), 0);
  registerPinFailure(cred, NOW + 200); registerPinSuccess(cred);
  assert.deepEqual([cred.failed_attempts, cred.locked_until, cred.last_failed_at], [0, null, null]);
});

// ---- authenticateBadgeAndPin: the single badge+PIN decision ----
async function world() {
  const exp = NOW + 30 * 86400000;
  const db = {
    users: [
      { id: "u_tech", role: "Technician", is_active: true, name: "Tech One" },
      { id: "u_tech2", role: "Technician", is_active: true, name: "Tech Two" },
      { id: "u_sup", role: "Supervisor", is_active: true }
    ],
    attendance_badges: [
      { id: "bdg_active0001", technician_id: "u_tech", status: "active", expires_at: new Date(exp).toISOString() },
      { id: "bdg_withdrawn1", technician_id: "u_tech", status: "withdrawn", expires_at: new Date(exp).toISOString() },
      { id: "bdg_expireddb1", technician_id: "u_tech", status: "active", expires_at: new Date(NOW - 1000).toISOString() },
      { id: "bdg_suprole001", technician_id: "u_sup", status: "active", expires_at: new Date(exp).toISOString() }
    ],
    attendance_pin_credentials: [await createPinCredential("u_tech", "482915", "x", "u_tech")]
  };
  const token = (id, at = exp) => issueBadgeToken(id, at);
  return { db, token, exp };
}

test("authenticate: good badge + good PIN", async () => {
  const { db, token } = await world();
  const r = await authenticateBadgeAndPin(db, { badgeToken: token("bdg_active0001"), pin: "482915" }, NOW);
  assert.equal(r.ok, true); assert.equal(r.technician.id, "u_tech");
});

test("authenticate: every bad-badge case gives the SAME uniform refusal and writes nothing", async () => {
  const { db, token, exp } = await world();
  const before = JSON.stringify(db);
  const cases = {
    forged: "ORAC-B1.bdg_active0001." + String(Math.floor(exp / 1000)) + "." + "0".repeat(32),
    garbage: "hello",
    unknownBadge: token("bdg_neverissued"),
    withdrawn: token("bdg_withdrawn1"),
    expiredRow: token("bdg_expireddb1", NOW + 1e9),
    notATechnician: token("bdg_suprole001"),
    expiredToken: token("bdg_active0001", NOW - 5000)
  };
  for (const [name, badgeToken] of Object.entries(cases)) {
    const r = await authenticateBadgeAndPin(db, { badgeToken, pin: "482915" }, NOW);
    assert.deepEqual(r, INVALID, name);
  }
  assert.equal(JSON.stringify(db), before, "no state change for bad badges");
});

test("authenticate: inactive technician is refused like any other bad badge", async () => {
  const { db, token } = await world();
  db.users.find((u) => u.id === "u_tech").is_active = false;
  assert.deepEqual(await authenticateBadgeAndPin(db, { badgeToken: token("bdg_active0001"), pin: "482915" }, NOW), INVALID);
});

test("authenticate: valid badge but no PIN set -> 409 PIN_NOT_SET; valid badge and wrong PIN -> persisted failure", async () => {
  const { db, token } = await world();
  db.attendance_badges.push({ id: "bdg_tech2badge", technician_id: "u_tech2", status: "active", expires_at: new Date(NOW + 1e9).toISOString() });
  const noPin = await authenticateBadgeAndPin(db, { badgeToken: token("bdg_tech2badge", NOW + 1e9), pin: "482915" }, NOW);
  assert.deepEqual([noPin.ok, noPin.status, noPin.code, noPin.persist], [false, 409, "ATTENDANCE_PIN_NOT_SET", false]);

  const wrong = await authenticateBadgeAndPin(db, { badgeToken: token("bdg_active0001"), pin: "000001" }, NOW);
  assert.deepEqual([wrong.ok, wrong.status, wrong.code, wrong.persist, wrong.attempts_remaining], [false, 403, INVALID.code, true, ATTENDANCE_POLICY.pin_max_failures - 1]);
  assert.equal(db.attendance_pin_credentials[0].failed_attempts, 1);
});

test("authenticate: lock after N wrong PINs, no counting while locked, correct PIN refused while locked, works after expiry", async () => {
  const { db, token } = await world();
  const badgeToken = token("bdg_active0001");
  const max = ATTENDANCE_POLICY.pin_max_failures;
  let last;
  for (let i = 0; i < max; i += 1) last = await authenticateBadgeAndPin(db, { badgeToken, pin: "000001" }, NOW + i);
  assert.deepEqual([last.status, last.code, last.persist], [423, "ATTENDANCE_PIN_LOCKED", true]);
  const during = await authenticateBadgeAndPin(db, { badgeToken, pin: "482915" }, NOW + 1000);
  assert.deepEqual([during.ok, during.status, during.persist], [false, 423, false], "the right PIN is refused during the lock and nothing is rewritten");
  assert.equal(db.attendance_pin_credentials[0].failed_attempts, 0);
  const after = await authenticateBadgeAndPin(db, { badgeToken, pin: "482915" }, NOW + ATTENDANCE_POLICY.pin_lock_minutes * 60000 + 5000);
  assert.equal(after.ok, true);
  assert.equal(db.attendance_pin_credentials[0].locked_until, null);
});

test("authenticate: a success clears earlier wrong attempts", async () => {
  const { db, token } = await world();
  const badgeToken = token("bdg_active0001");
  await authenticateBadgeAndPin(db, { badgeToken, pin: "000001" }, NOW);
  await authenticateBadgeAndPin(db, { badgeToken, pin: "000002" }, NOW);
  assert.equal(db.attendance_pin_credentials[0].failed_attempts, 2);
  assert.equal((await authenticateBadgeAndPin(db, { badgeToken, pin: "482915" }, NOW)).ok, true);
  assert.equal(db.attendance_pin_credentials[0].failed_attempts, 0);
});

// ---- QR encoder ----
const rowsOf = (qr) => qr.modules.map((r) => r.map((d) => (d ? "1" : "0")).join(""));
const sha = (rows) => createHash("sha256").update(rows.join("\n")).digest("hex");

test("QR: golden symbols equal the reference encoder's output (segno, ISO 18004 padding, level M, mask 2)", () => {
  const a = encodeQr("ORAC-B1.bdg_abcd1234.1795602975.e4600ff868688ed40f2fa716bac043d1", { mask: 2 });
  assert.deepEqual([a.version, a.size, a.mask], [5, 37, 2]);
  assert.equal(sha(rowsOf(a)), "fd710d8b58aa071059142561ed648907302821f05da7bbe0d4f483c44f748fe8");
  const b = encodeQr("ORAC-B1.bdg_Zz09-_Zz09-_.1795602975.0123456789abcdef0123456789abcdef", { mask: 2 });
  assert.equal(sha(rowsOf(b)), "032b2d1fa7b6ab1e8bd6a1f4407439b115caed15b38f3605e407cd35ced6ac6f");
});

test("QR: Reed-Solomon, format and version information match published values", () => {
  assert.deepEqual(reedSolomonRemainder([32, 65, 205, 69, 41, 220, 46, 128, 236], 17), [42, 159, 74, 221, 244, 169, 239, 150, 138, 70, 237, 85, 224, 96, 74, 219, 61]);
  assert.equal(formatBits(0), 0b101010000010010); // level M, mask 0
  assert.equal(formatBits(5), 0b100000011001110); // level M, mask 5
  assert.equal(versionBits(7), 0x07c94);
  assert.equal(versionBits(10), 0x0a4d3);
});

test("QR: version selection and capacity limits (byte mode, level M)", () => {
  assert.equal(encodeQr("x".repeat(14)).version, 1);
  assert.equal(encodeQr("x".repeat(15)).version, 2);
  assert.equal(encodeQr("x".repeat(213)).version, QR_MAX_VERSION);
  assert.throws(() => encodeQr("x".repeat(214)), RangeError);
  assert.throws(() => encodeQr(""), TypeError);
  assert.throws(() => encodeQr(null), TypeError);
});

test("QR: structure is a valid symbol (finders, timing, dark module) and output is deterministic", () => {
  const q = encodeQr("ORAC-B1.structure.test", { mask: 3 });
  const m = q.modules; const n = q.size;
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let y = 0; y < 7; y += 1) for (let x = 0; x < 7; x += 1) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(m[oy + y][ox + x], ring !== 2, `finder ${ox},${oy} at ${x},${y}`);
    }
  }
  for (let i = 8; i < n - 8; i += 1) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
  assert.equal(m[n - 8][8], true, "always-dark module");
  assert.deepEqual(encodeQr("ORAC-B1.structure.test", { mask: 3 }).modules, m);
  assert.equal(encodeQr("same").mask, encodeQr("same").mask);
});

test("QR svg: black on white with quiet zone, label is escaped, no script or external reference", () => {
  const svg = qrToSvg("ORAC-B1.svg.test", { label: 'A "<b>&' });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
  assert.ok(svg.includes('fill="#fff"') && svg.includes('fill="#000"'));
  assert.equal(/<script|href=|xlink|javascript:|onload/i.test(svg), false);
  assert.equal(svg.includes("<b>"), false);
  const { size } = encodeQr("ORAC-B1.svg.test");
  assert.ok(svg.includes(`viewBox="0 0 ${size + 8} ${size + 8}"`), "4-module quiet zone on each side");
});

// ---- permissions, store, router, isolation ----
test("attendance permissions: defined, flag-independent in the table, minimal roles", () => {
  const expected = {
    viewAttendanceStatus: [roles.ADMIN, roles.OPERATIONS, roles.SUPERVISOR, roles.TECHNICIAN],
    manageAttendanceBadges: [roles.ADMIN, roles.OPERATIONS],
    clearAttendancePin: [roles.ADMIN, roles.OPERATIONS],
    setOwnAttendancePin: [roles.TECHNICIAN]
  };
  for (const [key, list] of Object.entries(expected)) {
    assert.deepEqual(effectivePermissionRoles(key), list, key);
    assert.equal(key in permissions, false, `${key} lives in the dark table, like the other flag-guarded permissions`);
  }
  assert.equal(hasPermission({ is_active: true, role: roles.ADMIN }, "setOwnAttendancePin"), false, "nobody but a Technician may set a PIN");
  assert.equal(hasPermission({ is_active: true, role: roles.TECHNICIAN }, "manageAttendanceBadges"), false);
  assert.equal(hasPermission({ is_active: false, role: roles.ADMIN }, "manageAttendanceBadges"), false);
  for (const role of [roles.CLIENT_VIEWER, roles.SALES, roles.FINANCE, roles.MANAGEMENT, roles.PUBLIC_PROSPECT, roles.HR]) {
    for (const key of Object.keys(expected)) assert.equal(hasPermission({ is_active: true, role }, key), false, `${role} ${key}`);
  }
});

test("existing permission lists are unchanged and the permissions table still has no duplicate keys", () => {
  assert.deepEqual(permissions.viewTechnicianSettlementDetails, [roles.ADMIN, roles.FINANCE]);
  assert.deepEqual(permissions.submitKioskTimesheets, [roles.ADMIN, roles.OPERATIONS]);
  assert.deepEqual(permissions.reviewKioskTimesheet, [roles.SUPERVISOR]);
  const src = readFileSync(new URL("../src/permissions.js", import.meta.url), "utf8").replace(/\r/g, "");
  const start = src.indexOf("export const permissions = {"); const end = src.indexOf("\n};", start);
  const keys = [...src.slice(start, end).matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
});

test("store: attendance collections exist after normalise and are NOT exposed by the generic collection routes", () => {
  for (const name of ["attendance_badges", "attendance_pin_credentials"]) assert.ok(SCHEMA_COLLECTIONS.includes(name), name);
  const db = normalizeDb({}, { seedDemoRecords: false });
  assert.deepEqual([db.attendance_badges, db.attendance_pin_credentials], [[], []]);
  const admin = readFileSync(new URL("../src/modules/admin/routes.js", import.meta.url), "utf8");
  assert.equal(/attendance_/.test(admin), false, "PIN hashes must never be reachable through a generic GET /:collection");
});

test("router: attendance routes are mounted after the auth wall and the unauthenticated allowlist is unchanged", () => {
  const lines = readFileSync(new URL("../src/router.js", import.meta.url), "utf8").replace(/\r/g, "").split("\n");
  const authLine = lines.findIndex((l) => /^router\.use\(authMiddleware\);/.test(l));
  const mountLine = lines.findIndex((l) => /^router\.use\(attendanceRoutes\);/.test(l));
  assert.ok(authLine > 0 && mountLine > authLine);
  const before = lines.slice(0, authLine).join("\n");
  assert.equal(/attendance/i.test(before.replace(/^import .*attendance.*$/gim, "")), false);
  const found = [...before.matchAll(/^router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/gm)].map((m) => `${m[1].toUpperCase()} ${m[2]}`).sort();
  assert.deepEqual(found, ["POST /access-requests", "POST /auth/google", "POST /auth/login", "POST /auth/request-password-reset", "POST /auth/reset-password",
    "POST /auth/totp/enrollment/confirm", "POST /auth/totp/enrollment/start", "POST /auth/totp/verify", "POST /leads"].sort());
  const routes = readFileSync(new URL("../src/attendance/routes.js", import.meta.url), "utf8");
  assert.equal(/router\.use\(authMiddleware\)|app\./.test(routes), false);
});

test("evidence-only guard: attendance code imports nothing from payroll, invoice, Pastel, variance, review or stock code", () => {
  const forbidden = /(payroll|invoice|pastel|poVariance|timesheetReview|timesheetModel|timesheetWorkflow|inventoryLedger|dispatchController|stateMachine|exporter|reports|v5)/i;
  const dir = new URL("../src/attendance/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const text = readFileSync(new URL(file, dir), "utf8");
    for (const m of text.matchAll(/^import .* from "([^"]+)";/gm)) assert.equal(forbidden.test(m[1]), false, `${file} imports ${m[1]}`);
    assert.equal(/recalculateVariance|\.timesheets\b|db\.invoices|db\.material_usage|hourly_rate|hours_logged|jobActuals/.test(text.replace(/^\s*\/\/.*$/gm, "")), false, `${file} touches billing/payroll data`);
  }
});

test("the generic QR service is untouched by this work (its own tests keep guarding it)", () => {
  const text = readFileSync(new URL("../src/services/qrCodeService.js", import.meta.url), "utf8");
  // Pinned to the packet baseline (dcf78b9a). Normalised for line endings so a CRLF checkout compares equal.
  assert.equal(createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex"), "d404cf0fef3106a58240e6e9103cb4369de79098be70dd72b774c276d299c555");
  assert.ok(text.includes("signQrPayload") && text.includes("ARTISAN_BADGE"));
});
