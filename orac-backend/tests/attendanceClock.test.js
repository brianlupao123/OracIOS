import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { clockIn, clockOut } from "../src/attendance/clockController.js";
import { ClockActionSchema } from "../src/attendance/schemas.js";
import { issueBadgeToken } from "../src/attendance/badge.js";
import { createPinCredential } from "../src/attendance/pin.js";
import { ATTENDANCE_POLICY } from "../src/attendance/policy.js";
import { verifyChain } from "../src/attendance/eventStore.js";
import { deriveSessions, clockState } from "../src/attendance/sessions.js";
import { effectivePermissionRoles, hasPermission, permissions, roles } from "../src/permissions.js";

// Attendance commit 3: clock-in / clock-out handlers. Real handlers, real event store, real badge+PIN code, real
// permission table; a stub store only collects audit rows. Synthetic data only. The HTTP persistence path
// (persistOnFailure) is already proven by attendanceCredentialsHttp.test.js; here the flag is asserted on the request.
const T0 = Date.parse("2026-11-24T06:00:00.000Z"); const H = 3600000;
const PIN = "482915";
let clockNow = T0;

async function world() {
  const db = {
    users: [
      { id: "u_tech", name: "Tech One", role: "Technician", is_active: true },
      { id: "u_tech2", name: "Tech Two", role: "Technician", is_active: true },
      { id: "u_supervisor", name: "Sup", role: "Supervisor", is_active: true },
      { id: "u_ops", name: "Ops", role: "Operations", is_active: true },
      { id: "u_admin", name: "Admin", role: "Admin", is_active: true }
    ],
    dispatch_cards: [{ id: "d1" }, { id: "d2" }],
    attendance_events: [], audit_logs: [],
    attendance_badges: [
      { id: "bdg_techone001", technician_id: "u_tech", status: "active", expires_at: new Date(T0 + 30 * 86400000).toISOString() },
      { id: "bdg_techtwo001", technician_id: "u_tech2", status: "active", expires_at: new Date(T0 + 30 * 86400000).toISOString() }
    ],
    attendance_pin_credentials: [await createPinCredential("u_tech", PIN, "x", "u_tech"), await createPinCredential("u_tech2", "730184", "x", "u_tech2")]
  };
  const token = (id) => issueBadgeToken(id, T0 + 30 * 86400000);
  return { db, tech: token("bdg_techone001"), tech2: token("bdg_techtwo001") };
}

function call(handler, db, userId, body, { at = clockNow } = {}) {
  const res = { code: 200, headers: {}, body: null,
    status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } };
  const req = { db, user: userId ? { id: userId, role: db.users.find((u) => u.id === userId)?.role, is_active: true } : undefined,
    body: { client_event_id: randomUUID(), ...body }, nowMs: () => at,
    store: { audit: (d, actor, type, id, action, o, n) => d.audit_logs.push({ actor_id: actor?.id, entity_type: type, entity_id: id, action, new_values: n }) } };
  return Promise.resolve(handler(req, res)).then(() => ({ req, res, status: res.code, body: res.body }), (error) => ({ req, res, status: error.status, thrown: error.message }));
}
const withFlag = async (value, fn) => { const saved = process.env.ORAC_ATTENDANCE_ENABLED; if (value === undefined) delete process.env.ORAC_ATTENDANCE_ENABLED; else process.env.ORAC_ATTENDANCE_ENABLED = value;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.ORAC_ATTENDANCE_ENABLED; else process.env.ORAC_ATTENDANCE_ENABLED = saved; } };
test.beforeEach(() => { process.env.ORAC_ATTENDANCE_ENABLED = "enabled"; clockNow = T0; });
test.after(() => { delete process.env.ORAC_ATTENDANCE_ENABLED; });

test("dark by default: flag off answers 409 FEATURE_DISABLED to a permitted role, 403 to others, and writes nothing", async () => {
  const { db, tech } = await world();
  await withFlag(undefined, async () => {
    const r = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN });
    assert.deepEqual([r.status, r.body.code], [409, "FEATURE_DISABLED"]);
    assert.equal((await call(clockIn, db, "u_ops", { badge_token: tech, pin: PIN })).status, 403, "no permission: 403, flag not revealed");
  });
  await withFlag("true", async () => assert.equal((await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN })).body.code, "FEATURE_DISABLED"));
  assert.deepEqual([db.attendance_events.length, db.audit_logs.length, db.attendance_pin_credentials[0].failed_attempts], [0, 0, 0]);
});

test("permission: clockAttendance is Technician + Supervisor only, lives in the dark table, no unauthenticated access", async () => {
  assert.deepEqual(effectivePermissionRoles("clockAttendance"), [roles.TECHNICIAN, roles.SUPERVISOR]);
  assert.equal("clockAttendance" in permissions, false);
  for (const role of [roles.ADMIN, roles.OPERATIONS, roles.MANAGEMENT, roles.SALES, roles.FINANCE, roles.CLIENT_VIEWER, roles.HR, roles.HSE, roles.PUBLIC_PROSPECT]) {
    assert.equal(hasPermission({ is_active: true, role }, "clockAttendance"), false, role);
  }
  assert.equal(hasPermission({ is_active: false, role: roles.TECHNICIAN }, "clockAttendance"), false);
  const { db, tech } = await world();
  for (const user of ["u_ops", "u_admin"]) assert.equal((await call(clockIn, db, user, { badge_token: tech, pin: PIN })).status, 403, user);
  assert.equal((await call(clockIn, db, undefined, { badge_token: tech, pin: PIN })).status, 403, "no actor");
  assert.equal(db.attendance_events.length, 0);
});

test("clock in then out: 201, server time only, derived channel, evidence-only response, chain valid, one derived session", async () => {
  const { db, tech } = await world();
  const a = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN, dispatch_card_id: "d1",
    server_time: "1999-01-01T00:00:00Z", capture_channel: "shared_kiosk", seq: 99, hours: 8, latitude: -17.8 });
  assert.equal(a.status, 201); assert.equal(a.res.headers["Cache-Control"], "no-store");
  assert.deepEqual([a.body.data.event.event_type, a.body.data.event.server_time, a.body.data.event.capture_channel, a.body.data.state, a.body.data.replayed, a.body.data.evidence_only],
    ["clock_in", "2026-11-24T06:00:00.000Z", "self_phone", "in", false, true]);
  assert.equal(a.body.data.open_since, "2026-11-24T06:00:00.000Z");
  assert.equal(JSON.stringify(a.body).match(/hours|rate|cost|payroll|billable|invoice|pin_hash|badge_token|ORAC-B1/i), null, "no money/hours/credential fields in the answer");
  clockNow = T0 + 8 * H;
  const b = await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN, dispatch_card_id: "d1" });
  assert.deepEqual([b.status, b.body.data.state, b.body.data.event.seq], [201, "out", 2]);
  assert.equal(verifyChain(db).ok, true);
  const [s] = deriveSessions(db);
  assert.deepEqual([s.status, s.elapsed_seconds, s.evidence_only], ["closed", 8 * 3600, true]);
  assert.deepEqual(Object.keys(db.attendance_events[0]).filter((k) => /hour|rate|cost|gps|lat|lon/i.test(k)), []);
});

test("retry safety: same client_event_id replays the ORIGINAL event (200) and writes nothing, even after the state moved on", async () => {
  const { db, tech } = await world(); const id = randomUUID();
  const first = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN, client_event_id: id });
  clockNow = T0 + 5000;
  const retry = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN, client_event_id: id.toUpperCase() });
  assert.deepEqual([retry.status, retry.body.data.replayed, retry.res.headers["Idempotency-Replayed"]], [200, true, "true"]);
  assert.deepEqual([retry.body.data.event.id, retry.body.data.event.server_time], [first.body.data.event.id, first.body.data.event.server_time], "original time, not the retry time");
  assert.equal(db.attendance_events.length, 1);
  clockNow = T0 + 2 * H; await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN });
  const late = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN, client_event_id: id });
  assert.deepEqual([late.status, late.body.data.replayed], [200, true], "a late lost-response retry is still a replay, not 'already clocked in' or a new event");
  assert.equal(db.attendance_events.length, 2);
});

test("retry safety: the same id for a different action or dispatch is refused 409 and writes nothing; a retry still needs the PIN", async () => {
  const { db, tech } = await world(); const id = randomUUID();
  await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN, client_event_id: id, dispatch_card_id: "d1" });
  for (const [handler, extra] of [[clockOut, {}], [clockIn, { dispatch_card_id: "d2" }]]) {
    const r = await call(handler, db, "u_tech", { badge_token: tech, pin: PIN, client_event_id: id, ...extra });
    assert.deepEqual([r.status, r.body.code], [409, "ATTENDANCE_EVENT_ID_REUSED"]);
  }
  const noPin = await call(clockIn, db, "u_tech", { badge_token: tech, pin: "000001", client_event_id: id, dispatch_card_id: "d1" });
  assert.equal(noPin.status, 403, "a replay is not a way around the PIN");
  assert.equal(db.attendance_events.length, 1);
});

test("state guard: duplicate clock-in, clock-out while out, and contradictory dispatch are refused; nothing is written", async () => {
  const { db, tech } = await world();
  const out1 = await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN });
  assert.deepEqual([out1.status, out1.body.code], [409, "ATTENDANCE_NOT_CLOCKED_IN"]);
  await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN, dispatch_card_id: "d1" });
  clockNow = T0 + H;
  const dup = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN });
  assert.deepEqual([dup.status, dup.body.code, dup.body.open_since], [409, "ATTENDANCE_ALREADY_CLOCKED_IN", "2026-11-24T06:00:00.000Z"]);
  const wrong = await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN, dispatch_card_id: "d2" });
  assert.deepEqual([wrong.status, wrong.body.code, wrong.body.open_dispatch_card_id], [409, "ATTENDANCE_DISPATCH_MISMATCH", "d1"]);
  assert.equal((await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN })).status, 201, "clock-out without a dispatch is allowed");
  assert.equal(db.attendance_events.length, 2);
  assert.equal(db.attendance_pin_credentials[0].failed_attempts, 0, "a state refusal never counts as a wrong PIN");
});

test("technicians are independent: one clocked in does not affect another", async () => {
  const { db, tech, tech2 } = await world();
  await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN });
  assert.equal((await call(clockIn, db, "u_tech2", { badge_token: tech2, pin: "730184" })).status, 201);
  assert.equal(clockState(db, "u_tech", clockNow).state, "in"); assert.equal(clockState(db, "u_tech2", clockNow).state, "in");
});

test("overdue open shift: clock-out refused with its own code (no invented clock-out); clock-in allowed and the old session is reported unclosed", async () => {
  const { db, tech } = await world();
  await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN });
  clockNow = T0 + (ATTENDANCE_POLICY.max_open_shift_hours + 1) * H;
  const out = await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN });
  assert.deepEqual([out.status, out.body.code], [409, "ATTENDANCE_OPEN_SHIFT_OVERDUE"]);
  assert.equal(db.attendance_events.length, 1);
  assert.equal((await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN })).status, 201);
  assert.deepEqual(deriveSessions(db, { nowMs: clockNow }).map((s) => s.status), ["unclosed", "open"]);
  assert.equal(verifyChain(db).ok, true);
});

test("server clock behind the last event: refused, nothing recorded", async () => {
  const { db, tech } = await world();
  await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN });
  clockNow = T0 - 1000;
  const r = await call(clockOut, db, "u_tech", { badge_token: tech, pin: PIN });
  assert.deepEqual([r.status, r.body.code], [409, "ATTENDANCE_SERVER_CLOCK_BEHIND"]);
  assert.equal(db.attendance_events.length, 1);
});

test("dispatch reference: must be a real dispatch card; none is allowed", async () => {
  const { db, tech } = await world();
  const r = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN, dispatch_card_id: "nope" });
  assert.deepEqual([r.status, r.body.code], [400, "ATTENDANCE_DISPATCH_UNKNOWN"]);
  assert.equal(db.attendance_events.length, 0);
  assert.equal((await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN })).body.data.event.dispatch_card_id, null);
});

test("wrong PIN: uniform 403, counted and flagged for saving, audited without the PIN, no event, attempts_remaining not leaked", async () => {
  const { db, tech } = await world();
  const bad = await call(clockIn, db, "u_tech", { badge_token: tech, pin: "000001" });
  const forged = await call(clockIn, db, "u_tech", { badge_token: tech.slice(0, -1) + (tech.endsWith("0") ? "1" : "0"), pin: PIN });
  assert.deepEqual([bad.status, bad.body.code, bad.body.message], [forged.status, forged.body.code, forged.body.message], "wrong PIN and forged badge look identical");
  assert.equal("attempts_remaining" in bad.body, false);
  assert.equal(bad.req.persistOnFailure, true, "the counter must be saved although the answer is an error");
  assert.equal(forged.req.persistOnFailure, undefined);
  assert.equal(db.attendance_pin_credentials[0].failed_attempts, 1);
  assert.deepEqual(db.audit_logs.map((a) => a.action), ["ATTENDANCE_PIN_FAILED"]);
  assert.equal(JSON.stringify(db.audit_logs).includes("000001"), false);
  assert.equal(db.attendance_events.length, 0);
  assert.equal((await call(clockIn, db, "u_tech", { badge_token: tech, pin: "12345" })).status, 400, "malformed PIN is refused before any check and is not counted");
  assert.equal(db.attendance_pin_credentials[0].failed_attempts, 1);
});

test("PIN lock: N wrong PINs lock, the right PIN is refused during the lock, and a clock action works after it expires", async () => {
  const { db, tech } = await world(); let last;
  for (let i = 0; i < ATTENDANCE_POLICY.pin_max_failures; i += 1) last = await call(clockIn, db, "u_tech", { badge_token: tech, pin: "000001" });
  assert.deepEqual([last.status, last.body.code], [423, "ATTENDANCE_PIN_LOCKED"]); assert.ok(last.body.retry_after_seconds > 0);
  assert.ok(db.audit_logs.some((a) => a.action === "ATTENDANCE_PIN_LOCKED"));
  const during = await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN });
  assert.deepEqual([during.status, during.req.persistOnFailure], [423, undefined]);
  clockNow = T0 + (ATTENDANCE_POLICY.pin_lock_minutes + 1) * 60000;
  assert.equal((await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN })).status, 201);
});

test("a Technician session cannot present another technician's badge, and cannot spend or lock that technician's PIN", async () => {
  const { db, tech2 } = await world();
  for (let i = 0; i < ATTENDANCE_POLICY.pin_max_failures + 2; i += 1) {
    const r = await call(clockIn, db, "u_tech", { badge_token: tech2, pin: "000001" });
    assert.deepEqual([r.status, r.body.code, r.req.persistOnFailure], [403, "ATTENDANCE_CREDENTIALS_INVALID", undefined]);
  }
  assert.deepEqual([db.attendance_pin_credentials[1].failed_attempts, db.attendance_pin_credentials[1].locked_until, db.attendance_events.length], [0, null, 0]);
});

test("a Supervisor presenting a technician's badge + PIN records it as shared_kiosk, attributed to the Supervisor", async () => {
  const { db, tech } = await world();
  const r = await call(clockIn, db, "u_supervisor", { badge_token: tech, pin: PIN });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.data.event.capture_channel, db.attendance_events[0].technician_id, db.attendance_events[0].recorded_by_user_id], ["shared_kiosk", "u_tech", "u_supervisor"]);
  const bad = await call(clockIn, db, "u_supervisor", { badge_token: tech, pin: "000001" });
  assert.equal(bad.status, 403); assert.equal(db.audit_logs.at(-1).actor_id, "u_supervisor");
  assert.equal(db.audit_logs.at(-1).entity_id, "u_tech");
});

test("withdrawn badge, inactive technician and no PIN are refused; nothing recorded", async () => {
  const { db, tech } = await world();
  db.attendance_badges[0].status = "withdrawn";
  assert.equal((await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN })).body.code, "ATTENDANCE_CREDENTIALS_INVALID");
  db.attendance_badges[0].status = "active"; db.attendance_pin_credentials.shift();
  assert.equal((await call(clockIn, db, "u_tech", { badge_token: tech, pin: PIN })).body.code, "ATTENDANCE_PIN_NOT_SET");
  assert.equal(db.attendance_events.length, 0);
});

test("request schema: strips unknown fields, requires UUID v4 + badge + pin, accepts upper-case ids", () => {
  const ok = ClockActionSchema.parse({ badge_token: "ORAC-B1.x", pin: "1", client_event_id: randomUUID().toUpperCase(), server_time: "x", hours: 8, capture_channel: "shared_kiosk", latitude: 1 });
  assert.deepEqual(Object.keys(ok).sort(), ["badge_token", "client_event_id", "pin"]);
  for (const bad of [{}, { badge_token: "a", pin: "1" }, { badge_token: "a", pin: "1", client_event_id: "nope" }, { badge_token: "a", pin: "1", client_event_id: randomUUID().replace("-4", "-1") },
    { badge_token: "", pin: "1", client_event_id: randomUUID() }, { badge_token: "a", pin: "1".repeat(33), client_event_id: randomUUID() }, { badge_token: "a", pin: 1, client_event_id: randomUUID() }]) {
    assert.throws(() => ClockActionSchema.parse(bad), JSON.stringify(bad));
  }
});

test("wiring: routes sit in the existing attendance router (after the auth wall), validated, and the module stays evidence-only", () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r/g, "");
  const routes = read("../src/attendance/routes.js");
  assert.match(routes, /post\("\/attendance\/clock-in", validate\(ClockActionSchema\), clockIn\)/);
  assert.match(routes, /post\("\/attendance\/clock-out", validate\(ClockActionSchema\), clockOut\)/);
  const router = read("../src/router.js").split("\n");
  assert.ok(router.findIndex((l) => /^router\.use\(attendanceRoutes\);/.test(l)) > router.findIndex((l) => /^router\.use\(authMiddleware\);/.test(l)));
  assert.equal(/clock/i.test(router.slice(0, router.findIndex((l) => /^router\.use\(authMiddleware\);/.test(l))).join("\n")), false, "no clock route before the auth wall");
  const code = read("../src/attendance/clockController.js").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/attendance_events\s*(=[^=]|\.(push|splice|pop|shift|sort))|jobActuals|recalculateVariance|\.timesheets\b|db\.invoices|hourly_rate|hours_logged|Date\.now\(|body\.(server_time|seq|capture_channel)/.test(code), false);
  assert.equal(/localStorage|navigator\.geolocation|latitude/.test(code), false);
  assert.equal(readdirSync(new URL("../src/attendance/", import.meta.url)).some((f) => /store/i.test(f) && f !== "eventStore.js"), false, "no second attendance store");
});
