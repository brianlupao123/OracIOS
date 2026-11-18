// Runs the website handlers through IOS's REAL persistenceMiddleware and REAL (file-backed) store,
// so locking, saving, rollbacks, audit and notifications are the genuine ones.
// Not covered here: the Postgres driver (needs a database) and Express routing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../src/store.js";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import * as web from "../src/modules/public/controllers/websiteController.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-web-"));
const dbFile = path.join(dir, "db.json");
const store = createStore(dbFile);
const mw = persistenceMiddleware(store);
const NOW = Date.UTC(2026, 9, 7, 6, 0); // Wed 2026-10-07 08:00 Zimbabwe time

// Drive a handler exactly like Express would: through the persistence middleware.
function call(handler, { method = "GET", path: p = "/", body, query = {}, params = {}, userId } = {}) {
  return new Promise((resolve) => {
    const req = { method, path: p, body, query, params, headers: {}, nowMs: NOW, ...(userId ? { user: { id: userId } } : {}) };
    const res = {
      statusCode: 200, destroyed: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      send(b) { resolve({ status: this.statusCode, body: b }); return this; },
      end() { return this; }, once() { return this; }, set() { return this; },
    };
    mw(req, res, (err) => {
      if (err) return resolve({ status: 500, body: { message: err.message } });
      try { handler(req, res); } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); } // what IOS's global error handler does
    });
  });
}

const snapshot = () => JSON.parse(fs.readFileSync(dbFile, "utf8"));
async function userId(role) {
  const { db, release } = await store.read();
  store.release(release);
  return db.users.find((u) => u.role === role && u.is_active).id;
}
const SETTINGS = { enabled: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "16:00", slotMinutes: 60, capacity: 1, leadHours: 24, horizonDays: 30, breaks: [], blockedDates: [] };
const survey = (i, date = "2026-10-09", time = "10:00") => ({ type: "survey", name: `Visitor ${i}`, phone: "0777", siteLocation: "Mine", surveyType: "Conveyor belt audit", slotDate: date, slotTime: time });
const book = (i, d, t) => call(web.createWebsiteEnquiry, { method: "POST", path: "/public/enquiries", body: survey(i, d, t) });
const enable = async (over = {}) => call(web.updateBookingSettings, { method: "PUT", userId: await userId("Admin"), body: { ...SETTINGS, ...over } });

test("online booking is OFF until staff turn it on", async () => {
  const r = await call(web.getPublicSlots);
  assert.equal(r.body.data.enabled, false);
  assert.deepEqual(r.body.data.days, []);
  assert.equal((await book(1)).status, 409); // cannot book while disabled
});

test("only Admin/Management/Operations can change the schedule; others get 403", async () => {
  for (const role of ["Sales", "Technician", "Client Viewer"]) {
    const r = await call(web.updateBookingSettings, { method: "PUT", userId: await userId(role), body: SETTINGS });
    assert.equal(r.status, 403, role);
  }
  assert.equal((await call(web.updateBookingSettings, { method: "PUT", userId: await userId("Admin"), body: { ...SETTINGS, start: "17:00" } })).status, 400);
  const ok = await enable();
  assert.equal(ok.status, 200);
  assert.equal(snapshot().booking_settings.enabled, true, "settings are saved to the store");
  assert.ok(snapshot().audit_logs.some((a) => a.action === "BOOKING_SETTINGS_UPDATED"));
});

test("public slots list free times and need no login", async () => {
  const r = await call(web.getPublicSlots, { query: { from: "2026-10-07", days: "7" } });
  const fri = r.body.data.days.find((d) => d.date === "2026-10-09");
  assert.equal(fri.slots.length, 8);
  assert.ok(fri.slots.every((s) => s.available));
  assert.ok(!JSON.stringify(r.body).includes("Visitor"), "never exposes who booked");
});

test("a website quote becomes a LEAD: system actor, Sales notified, no client created", async () => {
  const before = snapshot();
  const r = await call(web.createWebsiteEnquiry, { method: "POST", path: "/public/enquiries", body: { type: "quote", name: "Tendai", company: "Mine Co", email: "t@mine.co.zw", phone: "0777", items: ["Sandblasting"], message: "By Friday" } });
  assert.equal(r.status, 200);
  assert.match(r.body.data.reference, /^[0-9A-F]{8}$/);
  assert.equal(r.body.data.slot, null);
  assert.ok(!("id" in r.body.data) && !("lead" in r.body.data), "no internal ids leak");
  const after = snapshot();
  assert.equal(after.leads.length, before.leads.length + 1);
  assert.equal(after.clients.length, before.clients.length, "a visitor is never a client");
  const lead = after.leads.at(-1);
  assert.deepEqual([lead.status, lead.source, lead.urgency], ["New", "website", "standard"]);
  const audit = after.audit_logs.at(-1);
  assert.deepEqual([audit.action, audit.actor_id], ["LEAD_CREATED", "system"]);
  assert.ok(after.notifications.some((n) => n.type === "lead" && n.target_roles.includes("Sales")), "Sales is notified");
});

test("an emergency with only a phone number is accepted and flagged urgent", async () => {
  const r = await call(web.createWebsiteEnquiry, { method: "POST", path: "/public/enquiries", body: { type: "emergency", name: "Shift boss", phone: "0777", siteLocation: "Plant 2", message: "Belt snapped" } });
  assert.equal(r.status, 200);
  const lead = snapshot().leads.at(-1);
  assert.deepEqual([lead.urgency, lead.email], ["urgent", ""]);
  assert.match(lead.service_need, /^EMERGENCY/);
});

test("bad input and bots are refused and nothing is saved", async () => {
  const before = JSON.stringify(snapshot());
  const bad = await call(web.createWebsiteEnquiry, { method: "POST", body: { type: "emergency", name: "A", phone: "1" } });
  assert.equal(bad.status, 400);
  const bot = await call(web.createWebsiteEnquiry, { method: "POST", body: { type: "contact", name: "Bot", email: "b@x.co", message: "hi", website: "http://spam" } });
  assert.equal(bot.status, 400);
  assert.equal(JSON.stringify(snapshot()), before, "the stored data is byte-for-byte unchanged");
});

test("booking a slot saves the lead and the booking together, and the slot then shows as taken", async () => {
  const r = await book(0);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.slot, { date: "2026-10-09", time: "10:00", status: "requested" });
  const s = snapshot();
  const b = s.survey_bookings.find((x) => x.reference === r.body.data.reference);
  const lead = s.leads.find((x) => x.id === b.lead_id);
  assert.ok(lead && lead.booking_reference === r.body.data.reference, "booking and lead are linked");
  const slots = await call(web.getPublicSlots, { query: { from: "2026-10-07", days: "7" } });
  const fri = slots.body.data.days.find((d) => d.date === "2026-10-09");
  assert.equal(fri.slots.find((x) => x.time === "10:00").available, false);
  assert.equal(fri.slots.find((x) => x.time === "11:00").available, true);
});

test("RACE: 25 simultaneous bookings of one slot -> exactly one wins, one lead is created", async () => {
  const leadsBefore = snapshot().leads.length;
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => book(i, "2026-10-13", "11:00")));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.slot_taken === true));
  const s = snapshot();
  assert.equal(s.survey_bookings.filter((b) => b.slot_date === "2026-10-13" && b.slot_time === "11:00").length, 1);
  assert.equal(s.leads.length, leadsBefore + 1, "the 24 losers created no leads");
});

test("RACE: capacity 3 with 10 simultaneous bookings -> exactly three win", async () => {
  await enable({ capacity: 3 });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => book(i, "2026-10-14", "09:00")));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  await enable({ capacity: 1 });
});

test("staff: Sales can confirm/cancel; Technicians cannot; cancelling frees the slot; re-activating is refused if taken", async () => {
  const listed = await call(web.listBookings, { userId: await userId("Sales") });
  assert.equal(listed.status, 200);
  assert.equal((await call(web.listBookings, { userId: await userId("Technician") })).status, 403);

  const first = snapshot().survey_bookings.find((b) => b.slot_date === "2026-10-09" && b.slot_time === "10:00");
  const sales = await userId("Sales");
  assert.equal((await call(web.updateBookingStatus, { method: "PATCH", params: { id: first.id }, body: { status: "confirmed" }, userId: sales })).status, 200);
  assert.equal((await call(web.updateBookingStatus, { method: "PATCH", params: { id: first.id }, body: { status: "cancelled" }, userId: sales })).status, 200);

  assert.equal((await book(77)).status, 200, "a freed slot can be booked again");
  const refused = await call(web.updateBookingStatus, { method: "PATCH", params: { id: first.id }, body: { status: "confirmed" }, userId: sales });
  assert.equal(refused.status, 409);

  assert.equal((await call(web.updateBookingStatus, { method: "PATCH", params: { id: "nope" }, body: { status: "confirmed" }, userId: sales })).status, 404);
  assert.equal((await call(web.updateBookingStatus, { method: "PATCH", params: { id: first.id }, body: { status: "banana" }, userId: sales })).status, 400);
  const audit = snapshot().audit_logs.filter((a) => a.entity_type === "survey_booking").map((a) => a.action);
  assert.ok(audit.includes("SURVEY_SLOT_CONFIRMED") && audit.includes("SURVEY_SLOT_CANCELLED"));
});
