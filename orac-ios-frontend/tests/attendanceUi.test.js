import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ROLES, ROUTE_ACCESS, canAccessRoute } from "../src/accessPolicy.js";
import { sidebarGroups } from "../src/navModel.js";
import * as model from "../src/attendanceModel.js";
import { startBadgeScan, scanFailureMessage } from "../src/attendanceScanner.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const BACKEND = new URL("../../orac-backend/src/attendance/", import.meta.url);
const backendPresent = existsSync(new URL("schemas.js", BACKEND));
const backend = (name) => readFileSync(new URL(name, BACKEND), "utf8");

const TOKEN = "ORAC-B1.bdg_abcDEF123456.1893456000.0123456789abcdef0123456789abcdef";
const PIN = "482915";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OK_DATA = (type = "clock_in", extra = {}) => ({
  replayed: false,
  event: { id: "e1", seq: 1, event_type: type, server_time: "2026-11-25T06:00:00.000Z", site_date: "2026-11-25", dispatch_card_id: null, capture_channel: "self_phone" },
  technician: { id: "u_tech", name: "Tendai" }, state: type === "clock_in" ? "in" : "out", open_since: type === "clock_in" ? "2026-11-25T06:00:00.000Z" : null, evidence_only: true, ...extra
});

// ---------- role gating ----------
test("the attendance route is open to exactly Technician and Supervisor", () => {
  assert.deepEqual([...ROUTE_ACCESS["/attendance"]].sort(), [ROLES.SUPERVISOR, ROLES.TECHNICIAN].sort());
  for (const role of Object.values(ROLES)) {
    assert.equal(canAccessRoute(role, "/attendance"), role === ROLES.TECHNICIAN || role === ROLES.SUPERVISOR, role);
  }
});

test("navigation lists Attendance only for roles that can open it, under Field Work", () => {
  for (const role of Object.values(ROLES)) {
    const items = sidebarGroups(role).flatMap((g) => g.items);
    assert.equal(items.some((i) => i.path === "/attendance"), canAccessRoute(role, "/attendance"), role);
  }
  const group = sidebarGroups(ROLES.TECHNICIAN).find((g) => g.items.some((i) => i.path === "/attendance"));
  assert.equal(group.id, "field-work");
  assert.equal(group.items.find((i) => i.path === "/attendance").label, "Attendance");
});

test("UI roles mirror the backend clockAttendance permission", { skip: !existsSync(new URL("../../orac-backend/src/permissions.js", import.meta.url)) }, () => {
  const src = readFileSync(new URL("../../orac-backend/src/permissions.js", import.meta.url), "utf8");
  assert.match(src, /clockAttendance:\s*\[T,\s*V\]/);
  assert.match(src, /viewAttendanceStatus:\s*\[A,\s*O,\s*V,\s*T\]/);
});

test("mode is own for Technician, kiosk for Supervisor, none for anyone else", () => {
  assert.equal(model.attendanceModeFor("Technician"), "own");
  assert.equal(model.attendanceModeFor("Supervisor"), "kiosk");
  for (const role of ["Admin", "Management", "Sales", "Finance", "Operations", "Client Viewer", "", undefined, "__proto__", "constructor"]) {
    assert.equal(model.attendanceModeFor(role), null, String(role));
  }
});

test("App registers /attendance behind the same GuardedRoute as every other page", () => {
  const app = read("../src/App.jsx");
  assert.match(app, /<Route path="\/attendance" element=\{<GuardedRoute user=\{user\} path="\/attendance"><AttendancePage user=\{user\} \/><\/GuardedRoute>\} \/>/);
  assert.match(app, /import AttendancePage from "\.\/pages\/AttendancePage\.jsx"/);
});

test("the page refuses to render any control for a role with no attendance mode", () => {
  const page = read("../src/pages/AttendancePage.jsx");
  assert.match(page, /if \(!mode\) return <RestrictedState \/>/);
  assert.match(page, /useEffect\(\(\) => \{ if \(mode\) loadStatus\(\); \}/);
});

// ---------- supervisor kiosk contract ----------
test("kiosk mode has no technician picker or technician id; badge and PIN are always required", () => {
  const page = read("../src/pages/AttendancePage.jsx");
  assert.doesNotMatch(page, /technician_id|technicianId|SearchableSelect|TechnicianPicker/);
  assert.match(page, /canSubmit = status\.phase === "ready" && badgeReady && pinReady/);
  assert.match(page, /mode === "kiosk"/);
  assert.match(page, /Entered by/);
  assert.match(page, /recorded as entered by you/);
});

test("the shared-kiosk result keeps the operator and technician separate", () => {
  const s = model.summarizeClockResult(OK_DATA("clock_in", { event: { ...OK_DATA().event, capture_channel: "shared_kiosk" } }), { name: "Sup Visor" });
  assert.equal(s.technicianName, "Tendai");
  assert.equal(s.recordedBy, "Sup Visor");
  assert.equal(s.channel, "shared_kiosk");
  assert.equal(s.evidenceOnly, true);
});

// ---------- manual fallback / no scanner ----------
test("manual badge entry and PIN entry are always rendered, independent of scanner support", () => {
  const page = read("../src/pages/AttendancePage.jsx");
  const inputs = [...page.matchAll(/<Input id="attendance-badge"/g)];
  const supportCheck = page.indexOf("support.supported ?");
  assert.equal(inputs.length, 1, "exactly one badge input");
  assert.ok(supportCheck > 0 && inputs[0].index < supportCheck, "badge input sits before, not inside, the scanner conditional");
  assert.doesNotMatch(page, /support\.supported &&[^?]*<Input id="attendance-badge"/);
  assert.match(page, /id="attendance-pin"/);
  assert.match(page, /This browser cannot scan QR codes\. Type the badge code instead\./);
});

test("scannerSupport needs both a camera API and BarcodeDetector", () => {
  const cam = { mediaDevices: { getUserMedia() {} } };
  assert.equal(model.scannerSupport({ navigator: cam, BarcodeDetector: class {} }).supported, true);
  assert.equal(model.scannerSupport({ navigator: cam }).supported, false);
  assert.equal(model.scannerSupport({ navigator: {}, BarcodeDetector: class {} }).supported, false);
  assert.equal(model.scannerSupport({}).supported, false);
  assert.equal(model.scannerSupport({ navigator: { mediaDevices: {} }, BarcodeDetector: class {} }).supported, false);
});

test("manual entry is trimmed, whitespace and oversize values are not accepted, PIN input is digits only", () => {
  assert.equal(model.normalizeBadgeToken(`  ${TOKEN}\n`), TOKEN);
  assert.equal(model.normalizeBadgeToken("two words"), "");
  assert.equal(model.normalizeBadgeToken("x".repeat(129)), "");
  assert.equal(model.normalizeBadgeToken(null), "");
  assert.equal(model.sanitizePinInput("48a2-91 5999", 6), "482915");
  assert.equal(model.isValidPin("482915", 6), true);
  assert.equal(model.isValidPin("48291", 6), false);
  assert.equal(model.isValidPin("48291a", 6), false);
});

test("a scanned payload is accepted only if it is shaped like an attendance badge token", () => {
  assert.deepEqual(model.acceptScannedPayload(TOKEN), { ok: true, token: TOKEN });
  for (const bad of ["https://evil.example/?t=" + TOKEN, "ORAC-B1.x", "hello", "", null, `${TOKEN} extra`]) {
    assert.deepEqual(model.acceptScannedPayload(bad), { ok: false }, String(bad));
  }
});

function fakeScanEnv(rawValues) {
  const queue = []; const stopped = []; const video = { paused: false, srcObject: null, attrs: {}, play: async () => {}, pause() { this.paused = true; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const stream = { getTracks: () => [{ stop: () => stopped.push(true) }] };
  const env = {
    navigator: { mediaDevices: { async getUserMedia(c) { env.constraints = c; return stream; } } },
    BarcodeDetector: class { constructor(o) { env.formats = o.formats; } async detect() { return rawValues.length ? [{ rawValue: rawValues.shift() }] : []; } },
    setTimeout: (fn) => { queue.push(fn); return queue.length; }, clearTimeout: () => {}
  };
  return { env, video, stopped, tick: async () => { const fn = queue.shift(); if (fn) await fn(); } };
}

test("scanner delivers a valid badge once, stops the camera, and drops non-badge QR codes", async () => {
  const f = fakeScanEnv(["https://example.com/x", TOKEN]);
  const got = []; let unreadable = 0;
  await startBadgeScan({ video: f.video, env: f.env, onToken: (t) => got.push(t), onUnreadable: () => { unreadable += 1; } });
  assert.deepEqual(f.env.formats, ["qr_code"]);
  assert.equal(f.env.constraints.audio, false);
  await f.tick(); assert.equal(unreadable, 1); assert.deepEqual(got, []); assert.equal(f.stopped.length, 0);
  await f.tick(); assert.deepEqual(got, [TOKEN]); assert.equal(f.stopped.length, 1); assert.equal(f.video.srcObject, null);
  await f.tick(); assert.equal(got.length, 1);
});

test("scanner stop() releases the camera and is safe to call twice", async () => {
  const f = fakeScanEnv([]);
  const stop = await startBadgeScan({ video: f.video, env: f.env, onToken() {} });
  stop(); stop();
  assert.ok(f.stopped.length >= 1);
  assert.equal(f.video.paused, true);
});

test("camera failures turn into manual-entry guidance without exposing error text", () => {
  assert.match(scanFailureMessage({ name: "NotAllowedError" }), /manually/);
  assert.match(scanFailureMessage({ name: "NotFoundError" }), /No camera/);
  assert.match(scanFailureMessage(new Error("secret detail")), /manually/);
  assert.doesNotMatch(scanFailureMessage(new Error("secret detail")), /secret/);
});

// ---------- disabled state ----------
test("disabled wording is the backend's own FEATURE_DISABLED message", { skip: !backendPresent }, () => {
  const flag = backend("flag.js");
  assert.ok(flag.includes(`message: "${model.DISABLED_MESSAGE}"`), "client text matches flag.js");
  assert.match(flag, /res\.status\(409\)/);
  assert.match(flag, /code: "FEATURE_DISABLED"/);
});

test("status enabled:false and a FEATURE_DISABLED refusal both show the safe disabled message and no form", async () => {
  assert.deepEqual(model.describeStatus({ enabled: false, pin_length: 6 }), { enabled: false, pinLength: 6, message: "Attendance is not enabled yet." });
  assert.equal(model.describeStatus({ enabled: "enabled" }).enabled, false, "only a real true enables");
  assert.equal(model.describeStatus(null).enabled, false);
  const err = Object.assign(new Error("Attendance is not enabled yet."), { status: 409, code: "FEATURE_DISABLED" });
  assert.equal(model.describeAttendanceError(err).kind, "disabled");
  const tracker = model.createAttemptTracker();
  const out = await model.performClockAction({ api: { clockIn: async () => { throw err; } }, action: "clock_in", badgeToken: TOKEN, pin: PIN, tracker });
  assert.equal(out.ok, false); assert.equal(out.info.kind, "disabled"); assert.equal(out.info.message, "Attendance is not enabled yet.");
  const page = read("../src/pages/AttendancePage.jsx");
  assert.match(page, /status\.phase === "disabled" && <Notice[^>]*data-evidence="attendance-disabled"/);
  assert.match(page, /status\.phase === "ready" && \(/);
});

test("the UI never switches a flag on: no env flag is read and no flag value is written", () => {
  for (const file of ["../src/attendanceModel.js", "../src/attendanceScanner.js", "../src/pages/AttendancePage.jsx"]) {
    assert.doesNotMatch(read(file), /ORAC_ATTENDANCE|import\.meta\.env|process\.env/, file);
  }
});

// ---------- request payload boundaries ----------
async function loadClient() {
  const source = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8").replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
  globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function installBrowserDoubles() {
  const storageLog = [];
  const make = (name, seed = {}) => new Proxy({ ...seed }, { get(t, p) { if (typeof p === "string") storageLog.push(`${name}.${p}`); return (k, v) => (p === "getItem" ? (t[k] ?? null) : p === "setItem" ? (t[k] = String(v)) : delete t[k]); } });
  globalThis.localStorage = make("localStorage", { orac_token: "jwt-test" });
  globalThis.sessionStorage = make("sessionStorage");
  const calls = []; let next = { status: 200, body: { success: true, data: { ok: true } } };
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, method: options.method || "GET", headers: options.headers, raw: options.body, body: options.body ? JSON.parse(options.body) : undefined }); return { ok: next.status < 400, status: next.status, headers: { get: () => "application/json" }, text: async () => JSON.stringify(next.body) }; };
  return { storageLog, calls, respond: (status, body) => { next = { status, body }; }, reset: () => { storageLog.length = 0; calls.length = 0; } };
}

test("the attendance client exposes exactly status, clockIn, clockOut on the existing routes", async () => {
  const { attendance } = await loadClient();
  assert.deepEqual(Object.keys(attendance).sort(), ["clockIn", "clockOut", "status"]);
  const d = installBrowserDoubles();
  await attendance.status();
  await attendance.clockIn({ badge_token: TOKEN, pin: PIN, client_event_id: "x" });
  await attendance.clockOut({ badge_token: TOKEN, pin: PIN, client_event_id: "x" });
  assert.deepEqual(d.calls.map((c) => [c.method, c.url]), [["GET", "http://api.test/attendance/status"], ["POST", "http://api.test/attendance/clock-in"], ["POST", "http://api.test/attendance/clock-out"]]);
  assert.ok(d.calls.every((c) => !c.url.includes("?") && !c.url.includes(TOKEN) && !c.url.includes(PIN)), "no secret or query in any URL");
});

test("a clock request body carries exactly badge_token, pin and client_event_id, even if the caller adds more", async () => {
  const { attendance } = await loadClient(); const d = installBrowserDoubles();
  d.respond(201, { success: true, data: OK_DATA() });
  const tracker = model.createAttemptTracker();
  const out = await model.performClockAction({ api: attendance, action: "clock_in", badgeToken: TOKEN, pin: PIN, tracker, operator: { name: "Tendai" } });
  assert.equal(out.ok, true);
  assert.equal(d.calls.length, 1);
  assert.deepEqual(Object.keys(d.calls[0].body).sort(), [...model.CLOCK_PAYLOAD_KEYS].sort());
  assert.match(d.calls[0].body.client_event_id, UUID_V4);
  assert.equal(d.calls[0].body.badge_token, TOKEN); assert.equal(d.calls[0].body.pin, PIN);
  const forged = model.buildClockPayload({ badgeToken: TOKEN, pin: PIN, clientEventId: "id-1", technician_id: "u_other", hours: 8, server_time: "x", capture_channel: "shared_kiosk", latitude: 1, dispatch_card_id: "d1" });
  assert.deepEqual(Object.keys(forged).sort(), [...model.CLOCK_PAYLOAD_KEYS].sort());
});

test("the payload keys are accepted by the backend schema and nothing it strips is relied on", { skip: !backendPresent }, () => {
  const schema = backend("schemas.js");
  const block = schema.slice(schema.indexOf("export const ClockActionSchema"));
  for (const key of model.CLOCK_PAYLOAD_KEYS) assert.match(block, new RegExp(`\\b${key}:`), key);
  assert.match(block, /badge_token: z\.string\(\)\.min\(1[^)]*\)\.max\(128/);
  assert.equal(model.MAX_BADGE_TOKEN_LENGTH, 128);
  const routes = backend("routes.js");
  assert.match(routes, /"\/attendance\/status"/); assert.match(routes, /"\/attendance\/clock-in"/); assert.match(routes, /"\/attendance\/clock-out"/);
});

test("local validation refuses a missing badge or a malformed PIN without calling the server", async () => {
  let called = 0; const api = { clockIn: async () => { called += 1; return OK_DATA(); }, clockOut: async () => { called += 1; return OK_DATA("clock_out"); } };
  for (const [badgeToken, pin] of [["", PIN], [TOKEN, "123"], [TOKEN, "12345a"], ["two words", PIN]]) {
    const out = await model.performClockAction({ api, action: "clock_in", badgeToken, pin, tracker: model.createAttemptTracker() });
    assert.equal(out.ok, false); assert.equal(out.local, true);
  }
  assert.equal(called, 0);
  await assert.rejects(() => model.performClockAction({ api, action: "clock_everything", badgeToken: TOKEN, pin: PIN, tracker: model.createAttemptTracker() }));
});

test("clock-out uses the clock-out call and reports the closed state", async () => {
  const out = await model.performClockAction({ api: { clockOut: async () => OK_DATA("clock_out") }, action: "clock_out", badgeToken: TOKEN, pin: PIN, tracker: model.createAttemptTracker() });
  assert.equal(out.summary.stateLabel, "Clocked out"); assert.equal(out.summary.eventLabel, "Clock-out"); assert.equal(out.summary.openSince, null);
});

test("an unexpected success body is refused rather than shown", async () => {
  for (const data of [{}, { event: { event_type: "clock_in" } }, { ...OK_DATA(), state: "paused" }, { ...OK_DATA(), technician: null }]) {
    const out = await model.performClockAction({ api: { clockIn: async () => data }, action: "clock_in", badgeToken: TOKEN, pin: PIN, tracker: model.createAttemptTracker() });
    assert.equal(out.ok, false);
  }
});

// ---------- retry safety ----------
test("a retry after no server answer reuses the same client_event_id; a definite answer starts a new one", async () => {
  const seen = []; let mode = "network";
  const api = { clockIn: async (p) => { seen.push(p.client_event_id); if (mode === "network") throw Object.assign(new Error("x"), { network: true }); if (mode === "refuse") throw Object.assign(new Error("x"), { status: 409, code: "ATTENDANCE_ALREADY_CLOCKED_IN" }); return OK_DATA(); } };
  const tracker = model.createAttemptTracker(); const run = () => model.performClockAction({ api, action: "clock_in", badgeToken: TOKEN, pin: PIN, tracker });
  const first = await run(); assert.equal(first.info.kind, "network"); assert.match(first.info.message, /will not record it twice/);
  mode = "refuse"; await run();
  assert.equal(seen[0], seen[1], "same id after a lost response");
  mode = "ok"; await run();
  assert.notEqual(seen[1], seen[2], "a definite refusal ends the intent");
  await run();
  assert.notEqual(seen[2], seen[3], "success ends the intent");
});

test("a different action or badge never shares a submission reference", () => {
  let n = 0; const t = model.createAttemptTracker(() => `id-${++n}`);
  assert.equal(t.idFor("clock_in", "a"), t.idFor("clock_in", "a"));
  assert.notEqual(t.idFor("clock_in", "a"), t.idFor("clock_out", "a"));
  assert.notEqual(t.idFor("clock_out", "a"), t.idFor("clock_out", "b"));
});

test("newClientEventId yields a UUID v4 with or without randomUUID", () => {
  assert.match(model.newClientEventId(), UUID_V4);
  const noUuid = { getRandomValues: (a) => { a.fill(255); return a; } };
  assert.match(model.newClientEventId(noUuid), UUID_V4);
  assert.throws(() => model.newClientEventId({}));
});

// ---------- safe errors ----------
test("every backend attendance refusal code has fixed, safe client wording", { skip: !backendPresent }, () => {
  const sources = ["clockController.js", "credentials.js", "eventStore.js"].map(backend).join("\n");
  // Not HTTP refusals shown to a clocking person: config names, the audit action, and codes the UI can never trigger
  // because it sends no dispatch_card_id and a well-formed UUID.
  const notShown = ["ATTENDANCE_POLICY", "ATTENDANCE_SECRET", "ATTENDANCE_BAD_EVENT", "ATTENDANCE_PIN_FAILED", "ATTENDANCE_DISPATCH_UNKNOWN", "ATTENDANCE_DISPATCH_MISMATCH"];
  const codes = [...new Set(sources.match(/ATTENDANCE_[A-Z]+(?:_[A-Z]+)*/g))].filter((c) => !notShown.includes(c));
  assert.ok(codes.length >= 8, `found ${codes.join(",")}`);
  for (const code of codes) {
    const info = model.describeAttendanceError(Object.assign(new Error("server text"), { status: 409, code }));
    assert.notEqual(info.message, "The attendance action could not be completed.", `${code} has specific wording`);
    assert.doesNotMatch(info.message, /server text/);
  }
});

test("unknown codes, 403, 400 and 429 use fixed wording and never echo the server message", () => {
  const leaky = "Role Technician cannot perform clockAttendance. PIN 482915 token " + TOKEN;
  for (const [status, code] of [[403, undefined], [400, undefined], [429, undefined], [500, "WHATEVER"], [418, undefined]]) {
    const info = model.describeAttendanceError(Object.assign(new Error(leaky), { status, code }));
    assert.ok(info.message.length > 10);
    assert.ok(!info.message.includes("482915") && !info.message.includes(TOKEN) && !info.message.includes("Role Technician"), `${status}`);
  }
  assert.equal(model.describeAttendanceError(Object.assign(new Error("x"), { status: 401, sessionExpired: true })).kind, "session");
});

test("a wrong badge and a wrong PIN produce the same refusal, so the UI cannot reveal which was wrong", () => {
  const a = model.describeAttendanceError(Object.assign(new Error("a"), { status: 403, code: "ATTENDANCE_CREDENTIALS_INVALID" }));
  assert.equal(a.message, "Badge or PIN not accepted.");
  assert.doesNotMatch(read("../src/attendanceModel.js"), /attempts_remaining/);
});

// ---------- no sensitive browser storage, logs, URL or outbox ----------
const ATTENDANCE_FILES = ["../src/attendanceModel.js", "../src/attendanceScanner.js", "../src/pages/AttendancePage.jsx", "../src/features/attendance/api.js", "../src/features/attendance/pages/AttendancePage.jsx"];

test("attendance files use no browser storage, URL, history, cookie, console, service-worker or outbox API", () => {
  const banned = /localStorage|sessionStorage|indexedDB|document\.cookie|caches\b|serviceWorker|console\.|location\.(search|hash|href|assign|replace)|history\.(push|replace)State|URLSearchParams|useSearchParams|setSearchParams|useNavigate|navigate\(|<form|window\.open|sendBeacon|postMessage|BroadcastChannel|offlineTimesheetOutbox|offlineOutboxSync|offlineDraftModel|OfflineOutbox|TimesheetOutbox|enqueue|outbox/i;
  for (const file of ATTENDANCE_FILES) assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, ""), banned, file);
});

test("the attendance block of the API client touches no storage and no extra routes", () => {
  const src = read("../src/api/client.js");
  const block = src.slice(src.indexOf("export const attendance = {"), src.indexOf("export const notifications = {"));
  assert.match(block, /request\("\/attendance\/status"\)/);
  assert.doesNotMatch(block, /localStorage|sessionStorage|attendance\/(badges|pin|technicians)|\?/);
});

test("running a full clock flow reads only the existing session token and writes nothing to browser storage", async () => {
  const { attendance } = await loadClient(); const d = installBrowserDoubles();
  d.respond(201, { success: true, data: OK_DATA() });
  await attendance.status();
  const out = await model.performClockAction({ api: attendance, action: "clock_in", badgeToken: TOKEN, pin: PIN, tracker: model.createAttemptTracker() });
  assert.equal(out.ok, true);
  d.respond(409, { success: false, code: "ATTENDANCE_ALREADY_CLOCKED_IN", message: "m" });
  const refused = await model.performClockAction({ api: attendance, action: "clock_in", badgeToken: TOKEN, pin: PIN, tracker: model.createAttemptTracker() });
  assert.equal(refused.info.message, "This technician is already clocked in. Clock out first.");
  assert.ok(d.storageLog.every((entry) => entry === "localStorage.getItem"), `unexpected storage use: ${d.storageLog.join(", ")}`);
  assert.equal(d.storageLog.some((e) => e.startsWith("sessionStorage")), false);
  const secrets = JSON.stringify({ summary: out.summary, info: refused.info });
  assert.ok(!secrets.includes(PIN) && !secrets.includes(TOKEN), "results and messages carry no PIN or badge");
});

test("a refused clock action is never queued: a network failure issues one request and no retry loop", async () => {
  let calls = 0;
  const out = await model.performClockAction({ api: { clockIn: async () => { calls += 1; throw Object.assign(new Error("x"), { network: true }); } }, action: "clock_in", badgeToken: TOKEN, pin: PIN, tracker: model.createAttemptTracker() });
  assert.equal(calls, 1); assert.equal(out.info.kind, "network"); assert.match(out.info.message, /never saved offline/);
});

test("the page clears the PIN after every action and the badge after success; fields are masked and not autofilled", () => {
  const page = read("../src/pages/AttendancePage.jsx");
  assert.match(page, /setBusy\(false\); setPin\(""\)/);
  assert.match(page, /if \(outcome\.ok\) \{ setBadge\(""\)/);
  assert.equal((page.match(/type="password"/g) || []).length, 2);
  assert.equal((page.match(/autoComplete="off"/g) || []).length, 2);
  assert.match(page, /!online/);
  assert.doesNotMatch(page, /defaultValue|name="(pin|badge)/);
});

test("the page is responsive: single column on phones, two columns from lg, full-width buttons on small screens", () => {
  const page = read("../src/pages/AttendancePage.jsx");
  assert.match(page, /grid gap-5 lg:grid-cols-2/);
  assert.match(page, /flex-col gap-3 sm:flex-row/);
  assert.match(page, /w-full sm:w-auto/);
  assert.match(page, /aria-live="polite"/);
});

test("evidence-only boundary: no hours, pay or billing fields are read or computed", () => {
  const code = read("../src/attendanceModel.js") + read("../src/pages/AttendancePage.jsx");
  assert.doesNotMatch(code.replace(/\/\/.*$/gm, ""), /elapsed|hours_worked|payroll|billable|hourly_rate|invoice/i);
});
