import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { appendEvent, verifyChain, siteDate, findByClientEventId, GENESIS_HASH, EVENT_TYPES, CAPTURE_CHANNELS } from "../src/attendance/eventStore.js";
import { deriveSessions, clockState } from "../src/attendance/sessions.js";
import { ATTENDANCE_POLICY } from "../src/attendance/policy.js";
import { SCHEMA_COLLECTIONS, normalizeDb } from "../src/store.js";

// Attendance commit 2: immutable raw events + derived sessions. Synthetic data only.
const T0 = Date.parse("2026-11-24T06:00:00.000Z");
const H = 3600000;
const make = (over = {}) => ({ technician_id: "u_tech", badge_id: "bdg_active0001", dispatch_card_id: "d1", event_type: "clock_in",
  recorded_by_user_id: "u_tech", capture_channel: "self_phone", client_event_id: randomUUID(), ...over });
const add = (db, over, at) => appendEvent(db, make(over), { nowMs: at }).event;
const emptyDb = () => ({ attendance_events: [] });

test("collection registered and normalised", () => {
  assert.ok(SCHEMA_COLLECTIONS.includes("attendance_events"));
  assert.deepEqual(normalizeDb({}, { seedDemoRecords: false }).attendance_events, []);
});

test("append: gap-free seq, chained hashes, server time only, site-date label, frozen, no hours/rate fields", () => {
  const db = emptyDb();
  const a = add(db, {}, T0);
  const b = add(db, { event_type: "clock_out" }, T0 + 8 * H);
  assert.deepEqual([a.seq, b.seq], [1, 2]);
  assert.equal(a.prev_hash, GENESIS_HASH); assert.equal(b.prev_hash, a.event_hash);
  assert.match(a.event_hash, /^[0-9a-f]{64}$/);
  assert.equal(a.server_time, "2026-11-24T06:00:00.000Z");
  assert.equal(Object.isFrozen(a), true);
  assert.throws(() => { "use strict"; a.event_type = "clock_out"; }, TypeError);
  const keys = Object.keys(a);
  assert.equal(keys.some((k) => /hour|rate|cost|price|pay|bill|invoice|amount|gps|lat|lon|location/i.test(k)), false, keys.join());
  assert.deepEqual(verifyChain(db), { ok: true, count: 2, head: { seq: 2, event_hash: b.event_hash }, problems: [] });
});

test("site date is a label at the site offset (CAT, UTC+2): 22:30Z is already the next day", () => {
  assert.equal(ATTENDANCE_POLICY.site_utc_offset_minutes, 120);
  assert.equal(siteDate(Date.parse("2026-11-24T21:59:59Z")), "2026-11-24");
  assert.equal(siteDate(Date.parse("2026-11-24T22:00:00Z")), "2026-11-25");
  assert.equal(siteDate(Date.parse("2026-12-31T23:00:00Z")), "2027-01-01");
});

test("idempotency: same client_event_id + same content replays the original without writing; different content conflicts; scoped per technician", () => {
  const db = emptyDb(); const id = randomUUID();
  const first = appendEvent(db, make({ client_event_id: id }), { nowMs: T0 });
  const again = appendEvent(db, make({ client_event_id: id }), { nowMs: T0 + 5000 });
  assert.equal(first.replay, false); assert.equal(again.replay, true);
  assert.equal(again.event, first.event); assert.equal(db.attendance_events.length, 1);
  for (const change of [{ event_type: "clock_out" }, { dispatch_card_id: "d2" }, { badge_id: "bdg_other00001" }, { capture_channel: "shared_kiosk" }, { recorded_by_user_id: "u_ops" }]) {
    assert.throws(() => appendEvent(db, make({ client_event_id: id, ...change }), { nowMs: T0 + 9000 }), (e) => e.status === 409 && e.code === "ATTENDANCE_EVENT_ID_REUSED", JSON.stringify(change));
  }
  assert.equal(appendEvent(db, make({ client_event_id: id, technician_id: "u_tech2" }), { nowMs: T0 + 9000 }).replay, false, "another technician may reuse the same UUID");
  assert.equal(db.attendance_events.length, 2);
  assert.equal(findByClientEventId(db, "u_tech", id).seq, 1);
});

test("append validation: types, channels, ids and time are checked and nothing is written on failure", () => {
  const db = emptyDb();
  assert.deepEqual(EVENT_TYPES, ["clock_in", "clock_out"]); assert.deepEqual(CAPTURE_CHANNELS, ["self_phone", "shared_kiosk"]);
  for (const bad of [{ event_type: "break_start" }, { event_type: undefined }, { capture_channel: "gps" }, { technician_id: "" }, { badge_id: undefined },
    { recorded_by_user_id: 5 }, { client_event_id: "not-a-uuid" }, { client_event_id: randomUUID().replace("-4", "-1") }, { client_event_id: undefined }]) {
    assert.throws(() => appendEvent(db, make(bad), { nowMs: T0 }), (e) => e.status === 400 && e.code === "ATTENDANCE_BAD_EVENT", JSON.stringify(bad));
  }
  assert.throws(() => appendEvent(db, make(), { nowMs: NaN }), (e) => e.status === 500);
  assert.equal(db.attendance_events.length, 0);
});

test("a client cannot influence time, sequence, hash or site date: extra input fields are ignored", () => {
  const db = emptyDb();
  const e = appendEvent(db, { ...make(), server_time: "1999-01-01T00:00:00Z", seq: 99, event_hash: "x", site_date: "1999-01-01", hours: 8, latitude: -17.8, prev_hash: "y" }, { nowMs: T0 }).event;
  assert.deepEqual([e.server_time, e.seq, e.site_date, e.prev_hash], ["2026-11-24T06:00:00.000Z", 1, "2026-11-24", GENESIS_HASH]);
  assert.equal("hours" in e || "latitude" in e, false);
});

function chain(n = 6) {
  const db = emptyDb();
  for (let i = 0; i < n; i += 1) add(db, { event_type: i % 2 ? "clock_out" : "clock_in", technician_id: i < 3 ? "u_tech" : "u_tech2" }, T0 + i * H);
  return db;
}
const thawed = (db) => { db.attendance_events = db.attendance_events.map((e) => ({ ...e })); return db; };

test("chain: editing ANY signed field of ANY event is detected", () => {
  for (const [field, value] of Object.entries({ technician_id: "u_other", badge_id: "bdg_zzzzzzzz", dispatch_card_id: "d9", event_type: "clock_out", server_time: "2026-11-24T05:00:00.000Z",
    site_date: "2026-11-23", recorded_by_user_id: "u_admin", capture_channel: "shared_kiosk", client_event_id: randomUUID(), id: "aev_forged" })) {
    for (const index of [0, 3, 5]) {
      const db = thawed(chain());
      const current = db.attendance_events[index][field];
      // Always make a REAL change: the chain has both clock_in and clock_out events, so for event_type flip it.
      db.attendance_events[index][field] = field === "event_type" ? (current === "clock_in" ? "clock_out" : "clock_in") : value;
      assert.notEqual(db.attendance_events[index][field], current, `${field}@${index} must actually change`);
      const v = verifyChain(db);
      assert.equal(v.ok, false, `${field}@${index}`);
      assert.ok(v.problems.some((p) => p.problem === "hash_mismatch" || p.problem === "prev_hash_mismatch" || p.problem === "duplicate_id"), `${field}@${index}`);
    }
  }
});

test("chain: delete, insert, reorder, replace and a recomputed-without-key hash are detected", () => {
  let db = thawed(chain()); db.attendance_events.splice(2, 1);
  assert.equal(verifyChain(db).ok, false);
  db = thawed(chain()); [db.attendance_events[1], db.attendance_events[2]] = [db.attendance_events[2], db.attendance_events[1]];
  assert.equal(verifyChain(db).ok, false);
  db = thawed(chain()); db.attendance_events.splice(2, 0, { ...db.attendance_events[1], seq: 3, id: "aev_inserted0" });
  assert.equal(verifyChain(db).ok, false);
  db = thawed(chain()); db.attendance_events[4] = { ...db.attendance_events[4], event_hash: "0".repeat(64) };
  assert.equal(verifyChain(db).ok, false);
  db = thawed(chain()); db.attendance_events[1].server_time = "2026-11-24T00:00:00.000Z"; // attacker also "fixes" hashes with a guessed key
  let prev = GENESIS_HASH; for (const e of db.attendance_events) { e.prev_hash = prev; e.event_hash = "f".repeat(64); prev = e.event_hash; }
  assert.equal(verifyChain(db).ok, false, "without the server secret the tags cannot be recomputed");
  db = thawed(chain()); db.attendance_events[0] = null;
  assert.equal(verifyChain(db).problems[0].problem, "not_an_event");
});

test("chain: a different server secret invalidates everything; losing the NEWEST events is only visible through the recorded head", () => {
  const db = chain(); const head = verifyChain(db).head;
  const rotated = process.env.ORAC_ATTENDANCE_SECRET; process.env.ORAC_ATTENDANCE_SECRET = "r".repeat(40);
  try { assert.equal(verifyChain(db).ok, false); } finally { if (rotated === undefined) delete process.env.ORAC_ATTENDANCE_SECRET; else process.env.ORAC_ATTENDANCE_SECRET = rotated; }
  const cut = thawed(chain()); cut.attendance_events.pop();
  const v = verifyChain(cut);
  assert.equal(v.ok, true, "documented limit: tail truncation leaves a valid shorter chain");
  assert.notDeepEqual(v.head, head, "but the head no longer matches the one recorded outside the database");
});

test("chain: empty log is valid with a null head", () => {
  assert.deepEqual(verifyChain({}), { ok: true, count: 0, head: null, problems: [] });
});

test("immutability guard: no attendance file other than eventStore.js can mutate attendance_events; eventStore exports no update/delete", () => {
  const dir = new URL("../src/attendance/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "eventStore.js")) {
    const code = readFileSync(new URL(file, dir), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/attendance_events\s*(=[^=]|\.(push|splice|pop|shift|unshift|sort|reverse|fill|copyWithin)\b)/.test(code), false, `${file} mutates attendance_events`);
    assert.equal(/delete\s+[\w.]*attendance_events|\.attendance_events\[[^\]]*\]\s*(=[^=]|\.)\w*\s*=[^=]/.test(code), false, file);
  }
  const store = readFileSync(new URL("eventStore.js", dir), "utf8");
  const exported = [...store.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
  assert.equal(exported.some((n) => /^(update|delete|remove|edit|patch|amend|set|clear|purge|reset)/i.test(n)), false, exported.join());
  assert.equal(/\.splice\(|\.pop\(|\.shift\(|filter\(/.test(store.replace(/^\s*\/\/.*$/gm, "").replace(/db\.attendance_events\.length/g, "")), false, "eventStore itself only ever pushes");
});

// ---- derived sessions ----
test("sessions: pair in/out, report ELAPSED seconds (never hours), evidence_only, no mutation of the evidence", () => {
  const db = emptyDb(); add(db, {}, T0); add(db, { event_type: "clock_out" }, T0 + 8 * H + 30 * 60000);
  const before = JSON.stringify(db);
  const [s] = deriveSessions(db, { nowMs: T0 + 9 * H });
  assert.deepEqual([s.status, s.elapsed_seconds, s.evidence_only, s.site_date, s.flags], ["closed", 8 * 3600 + 1800, true, "2026-11-24", []]);
  assert.equal(JSON.stringify(deriveSessions(db)).match(/"(hours|hours_logged|rate|hourly_rate|billable|certified|payable)"/), null);
  assert.equal(JSON.stringify(db), before);
});

test("sessions: overnight shift belongs to the day it STARTED on the site calendar", () => {
  const db = emptyDb(); const start = Date.parse("2026-11-24T18:00:00Z"); // 20:00 CAT
  add(db, {}, start); add(db, { event_type: "clock_out" }, start + 10 * H); // 06:00 CAT next day
  const [s] = deriveSessions(db);
  assert.deepEqual([s.site_date, s.elapsed_seconds, s.status], ["2026-11-24", 36000, "closed"]);
  assert.equal(db.attendance_events[1].site_date, "2026-11-25");
});

test("sessions: an unclosed session, an orphan clock-out and an overdue open session are reported, never repaired", () => {
  const db = emptyDb();
  add(db, {}, T0); add(db, { dispatch_card_id: "d2" }, T0 + 30 * H); add(db, { event_type: "clock_out" }, T0 + 38 * H);
  add(db, { event_type: "clock_out" }, T0 + 40 * H);
  add(db, {}, T0 + 50 * H);
  const s = deriveSessions(db, { nowMs: T0 + 50 * H + (ATTENDANCE_POLICY.max_open_shift_hours + 1) * H });
  assert.deepEqual(s.map((x) => x.status), ["unclosed", "closed", "orphan_clock_out", "open_overdue"]);
  assert.equal(s[0].elapsed_seconds, null); assert.equal(s[0].clock_out, null);
  assert.deepEqual(s[0].flags, ["next_clock_in_without_clock_out"]);
  assert.deepEqual(s[2].flags, ["clock_out_without_clock_in"]);
  assert.deepEqual(s[3].flags, ["open_longer_than_max_shift"]);
  assert.equal(deriveSessions(db, { nowMs: T0 + 50 * H + H })[3].status, "open");
});

test("sessions: an over-long closed session and a clock-out on another dispatch are flagged", () => {
  const db = emptyDb(); add(db, {}, T0); add(db, { event_type: "clock_out", dispatch_card_id: "d2" }, T0 + 20 * H);
  assert.deepEqual(deriveSessions(db)[0].flags, ["longer_than_max_shift", "clock_out_on_different_dispatch"]);
});

test("sessions: technicians are independent and can be filtered", () => {
  const db = emptyDb();
  add(db, { technician_id: "a" }, T0); add(db, { technician_id: "b" }, T0 + H); add(db, { technician_id: "a", event_type: "clock_out" }, T0 + 2 * H);
  assert.deepEqual(deriveSessions(db).map((s) => [s.technician_id, s.status]), [["a", "closed"], ["b", "open"]]);
  assert.deepEqual(deriveSessions(db, { technicianId: "b" }).map((s) => s.status), ["open"]);
});

test("clockState: out -> in -> out; an overdue open session lets the technician clock in again (and is reported)", () => {
  const db = emptyDb();
  assert.deepEqual(clockState(db, "u_tech", T0), { state: "out", open: null, overdue: null });
  const e = add(db, {}, T0);
  let s = clockState(db, "u_tech", T0 + H);
  assert.deepEqual([s.state, s.open.event_id, s.open.dispatch_card_id], ["in", e.id, "d1"]);
  assert.equal(clockState(db, "u_tech2", T0 + H).state, "out", "other technicians are unaffected");
  s = clockState(db, "u_tech", T0 + (ATTENDANCE_POLICY.max_open_shift_hours + 1) * H);
  assert.deepEqual([s.state, s.overdue.event_id], ["out", e.id]);
  add(db, { event_type: "clock_out" }, T0 + 2 * H);
  assert.equal(clockState(db, "u_tech", T0 + 3 * H).state, "out");
});
