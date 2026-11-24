import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, normalizeDb } from "../src/store.js";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import attendanceRoutes from "../src/attendance/routes.js";
import { ATTENDANCE_POLICY } from "../src/attendance/policy.js";
import { verifyBadgeToken } from "../src/attendance/badge.js";
import { authenticateBadgeAndPin } from "../src/attendance/credentials.js";

// Attendance commit 1 over HTTP: the real persistence middleware and the real JSON store, so "a wrong PIN is saved
// even though the answer is an error" is proven, not assumed. The test app replaces ONLY authMiddleware (which needs
// modules outside the packet) with a stub that trusts an x-test-user header. Synthetic data only.
const PINS = { good: "482915", other: "730184" };
let server, base, dir, store, file;

async function api(method, path, { user, body } = {}) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, body: await res.json() };
}
const disk = () => JSON.parse(readFileSync(file, "utf8"));

test.before(async () => {
  process.env.ORAC_ATTENDANCE_ENABLED = "enabled";
  dir = mkdtempSync(join(tmpdir(), "attendance-"));
  file = join(dir, "db.json");
  store = createStore(file);
  const app = express();
  app.use(express.json());
  app.use(persistenceMiddleware(store));
  app.use((req, res, next) => { // stand-in for authMiddleware
    const id = req.headers["x-test-user"];
    const user = req.db.users.find((u) => u.id === id && u.is_active);
    if (!user) return res.status(401).json({ success: false, message: "Unauthorized." });
    req.user = { id: user.id, role: user.role, is_active: true };
    next();
  });
  app.use(attendanceRoutes);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ success: false, message: err.message }));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); delete process.env.ORAC_ATTENDANCE_ENABLED; });

let tokenA;
test("flag OFF: every attendance route answers 409 FEATURE_DISABLED to a permitted role (and 403 to others)", async () => {
  delete process.env.ORAC_ATTENDANCE_ENABLED;
  try {
    for (const [method, path, user, body] of [
      ["POST", "/attendance/badges", "u_admin", { technician_id: "u_tech" }],
      ["GET", "/attendance/badges", "u_ops"],
      ["POST", "/attendance/badges/x/withdraw", "u_admin", { reason: "testing" }],
      ["GET", "/attendance/pin/status", "u_tech"],
      ["POST", "/attendance/pin", "u_tech", { pin: PINS.good }],
      ["POST", "/attendance/technicians/u_tech/pin/clear", "u_ops", { reason: "testing" }]
    ]) {
      const r = await api(method, path, { user, body });
      assert.equal(r.status, 409, `${method} ${path}`); assert.equal(r.body.code, "FEATURE_DISABLED");
    }
    assert.equal((await api("POST", "/attendance/badges", { user: "u_tech", body: { technician_id: "u_tech" } })).status, 403, "no permission: 403 not 409, so the flag is not revealed");
    assert.deepEqual((await api("GET", "/attendance/status", { user: "u_tech" })).body.data, { enabled: false, pin_length: 6 });
    assert.equal((disk().attendance_badges || []).length, 0, "nothing was written while dark");
  } finally { process.env.ORAC_ATTENDANCE_ENABLED = "enabled"; }
});

test("routes need a signed-in user", async () => {
  assert.equal((await api("GET", "/attendance/status")).status, 401);
  assert.equal((await api("GET", "/attendance/status", { user: "u_unknown" })).status, 401);
});

test("role gates: who may issue, list, withdraw, clear and set PINs", async () => {
  for (const user of ["u_tech", "u_supervisor", "u_finance", "u_sales", "u_management", "u_client", "u_hse"]) {
    assert.equal((await api("POST", "/attendance/badges", { user, body: { technician_id: "u_tech" } })).status, 403, `issue ${user}`);
    assert.equal((await api("GET", "/attendance/badges", { user })).status, 403, `list ${user}`);
    assert.equal((await api("POST", "/attendance/technicians/u_tech/pin/clear", { user, body: { reason: "testing" } })).status, 403, `clear ${user}`);
  }
  for (const user of ["u_admin", "u_ops", "u_supervisor", "u_finance"]) {
    assert.equal((await api("POST", "/attendance/pin", { user, body: { pin: PINS.good } })).status, 403, `only a Technician sets a PIN: ${user}`);
  }
});

test("issue badge: returns token + QR once, stores no token, audit has no token, response not cacheable", async () => {
  const r = await api("POST", "/attendance/badges", { user: "u_ops", body: { technician_id: "u_tech", valid_days: 30 } });
  assert.equal(r.status, 201); assert.equal(r.headers.get("cache-control"), "no-store");
  tokenA = r.body.data.token;
  assert.equal(verifyBadgeToken(tokenA).ok, true);
  assert.ok(r.body.data.qr_svg.startsWith("<svg"));
  assert.equal(r.body.data.badge.status, "active");
  assert.equal(JSON.stringify(r.body.data.badge).includes(tokenA), false);
  const stored = disk();
  assert.equal(JSON.stringify(stored).includes(tokenA), false, "the token is never stored");
  assert.equal(JSON.stringify(stored.audit_logs).includes(tokenA.split(".")[3]), false, "nor its signature in the audit trail");
  assert.ok(stored.audit_logs.some((a) => a.action === "ATTENDANCE_BADGE_ISSUED" && a.actor_id === "u_ops"));
  const exp = Date.parse(r.body.data.badge.expires_at) - Date.parse(r.body.data.badge.issued_at);
  assert.equal(Math.round(exp / 86400000), 30);
});

test("issue badge validation: technicians only, active only, valid_days bounded", async () => {
  assert.equal((await api("POST", "/attendance/badges", { user: "u_admin", body: { technician_id: "u_supervisor" } })).status, 400);
  assert.equal((await api("POST", "/attendance/badges", { user: "u_admin", body: { technician_id: "nobody" } })).status, 400);
  assert.equal((await api("POST", "/attendance/badges", { user: "u_admin", body: { technician_id: "u_tech", valid_days: 366 } })).status, 400);
  assert.equal((await api("POST", "/attendance/badges", { user: "u_admin", body: { technician_id: "u_tech", valid_days: 0 } })).status, 400);
  assert.equal((await api("POST", "/attendance/badges", { user: "u_admin", body: {} })).status, 400);
});

test("PIN set: weak and malformed PINs are refused without echoing them; a good PIN is stored only as a hash", async () => {
  for (const pin of ["12345", "1234567", "abcdef", "111111", "123456"]) {
    const r = await api("POST", "/attendance/pin", { user: "u_tech", body: { pin } });
    assert.equal(r.status, 400, pin); assert.equal(JSON.stringify(r.body).includes(pin), false, "the PIN is never echoed");
  }
  assert.deepEqual((await api("GET", "/attendance/pin/status", { user: "u_tech" })).body.data.has_pin, false);
  const ok = await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.good } });
  assert.equal(ok.status, 200); assert.equal(JSON.stringify(ok.body).includes(PINS.good), false);
  const stored = disk();
  assert.equal(JSON.stringify(stored).includes(PINS.good), false, "the PIN is not stored anywhere");
  assert.equal(stored.attendance_pin_credentials.length, 1);
  assert.match(stored.attendance_pin_credentials[0].pin_hash, /^\$2[aby]\$/);
  const audit = JSON.stringify(stored.audit_logs);
  assert.ok(audit.includes("ATTENDANCE_PIN_SET")); assert.equal(audit.includes(stored.attendance_pin_credentials[0].pin_hash), false);
});

test("PIN change needs the current PIN; wrong current PINs are COUNTED AND SAVED although the answer is an error", async () => {
  assert.equal((await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.other } })).status, 400, "no current PIN");
  const wrong = await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.other, current_pin: "000001" } });
  assert.equal(wrong.status, 403);
  assert.equal(disk().attendance_pin_credentials[0].failed_attempts, 1, "persistOnFailure: the counter reached the disk");
  assert.ok(disk().audit_logs.some((a) => a.action === "ATTENDANCE_PIN_FAILED"));
  const changed = await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.other, current_pin: PINS.good } });
  assert.equal(changed.status, 200);
  assert.equal(disk().attendance_pin_credentials[0].failed_attempts, 0);
  const back = await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.good, current_pin: PINS.other } });
  assert.equal(back.status, 200);
});

test("PIN lock over HTTP: N wrong current PINs lock, the right one is refused during the lock, Operations clears, technician sets a new PIN", async () => {
  for (let i = 0; i < ATTENDANCE_POLICY.pin_max_failures; i += 1) {
    await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.other, current_pin: "000001" } });
  }
  assert.ok(disk().attendance_pin_credentials[0].locked_until, "lock was saved");
  const during = await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.other, current_pin: PINS.good } });
  assert.deepEqual([during.status, during.body.code], [423, "ATTENDANCE_PIN_LOCKED"]);
  assert.equal((await api("GET", "/attendance/pin/status", { user: "u_tech" })).body.data.locked, true);

  assert.equal((await api("POST", "/attendance/technicians/u_tech/pin/clear", { user: "u_ops", body: { reason: "x" } })).status, 400, "reason too short");
  const cleared = await api("POST", "/attendance/technicians/u_tech/pin/clear", { user: "u_ops", body: { reason: "Technician forgot the PIN" } });
  assert.equal(cleared.status, 200);
  assert.equal(disk().attendance_pin_credentials.length, 0);
  assert.equal((await api("POST", "/attendance/technicians/u_tech/pin/clear", { user: "u_ops", body: { reason: "again please" } })).status, 409);
  const entry = disk().audit_logs.find((a) => a.action === "ATTENDANCE_PIN_CLEARED");
  assert.equal(entry.new_values.reason, "Technician forgot the PIN");
  assert.equal((await api("POST", "/attendance/pin", { user: "u_tech", body: { pin: PINS.good } })).status, 200);
});

test("withdraw: takes effect at once; list never shows tokens; re-issue replaces the live badge", async () => {
  const listed = await api("GET", "/attendance/badges?technician_id=u_tech", { user: "u_admin" });
  assert.equal(listed.status, 200); assert.equal(JSON.stringify(listed.body).includes("ORAC-B1"), false);
  const badgeId = listed.body.data.find((b) => b.status === "active").id;
  const before = await authenticateBadgeAndPin(disk(), { badgeToken: tokenA, pin: PINS.good }, Date.now());
  assert.equal(before.ok, true, "the badge worked before withdrawal");
  assert.equal((await api("POST", `/attendance/badges/${badgeId}/withdraw`, { user: "u_admin", body: { reason: "Badge lost on site" } })).status, 200);
  assert.deepEqual(await authenticateBadgeAndPin(disk(), { badgeToken: tokenA, pin: PINS.good }, Date.now()).then((r) => [r.ok, r.code]), [false, "ATTENDANCE_CREDENTIALS_INVALID"]);
  assert.equal((await api("POST", `/attendance/badges/${badgeId}/withdraw`, { user: "u_admin", body: { reason: "Badge lost on site" } })).status, 409);
  assert.equal((await api("POST", "/attendance/badges/nope/withdraw", { user: "u_admin", body: { reason: "Badge lost on site" } })).status, 404);

  const second = await api("POST", "/attendance/badges", { user: "u_admin", body: { technician_id: "u_tech" } });
  const third = await api("POST", "/attendance/badges", { user: "u_admin", body: { technician_id: "u_tech" } });
  assert.equal(third.status, 201);
  const active = disk().attendance_badges.filter((b) => b.technician_id === "u_tech" && b.status === "active");
  assert.equal(active.length, 1, "only one live badge per technician");
  assert.equal(await authenticateBadgeAndPin(disk(), { badgeToken: second.body.data.token, pin: PINS.good }, Date.now()).then((r) => r.ok), false, "the replaced badge no longer works");
  assert.equal(await authenticateBadgeAndPin(disk(), { badgeToken: third.body.data.token, pin: PINS.good }, Date.now()).then((r) => r.ok), true);
});

test("nothing outside the attendance collections, the audit trail and notifications changed", async () => {
  const stored = disk();
  const d = mkdtempSync(join(tmpdir(), "attendance-base-"));
  try {
    createStore(join(d, "db.json")); // a fresh seed, written by the store itself
    const baseline = normalizeDb(JSON.parse(readFileSync(join(d, "db.json"), "utf8")));
    for (const key of Object.keys(baseline)) {
      if (["audit_logs", "notifications", "attendance_badges", "attendance_pin_credentials"].includes(key)) continue;
      assert.deepEqual(stored[key], baseline[key], `${key} must be untouched`);
    }
    assert.ok(stored.attendance_badges.length > 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
