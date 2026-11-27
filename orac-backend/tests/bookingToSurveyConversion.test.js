// Tests the staff-controlled conversion of public website bookings to Virtual Technical Surveys.
// Uses IOS's real persistenceMiddleware and real file-backed store (matching website-booking.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../src/store.js";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import * as web from "../src/modules/public/controllers/websiteController.js";
import { convertBookingToSurvey, getSurveyMeetingAccess, listSurveys } from "../src/controllers/surveyController.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orac-booking-conv-"));
const dbFile = path.join(dir, "db.json");
const store = createStore(dbFile);
const mw = persistenceMiddleware(store);
const NOW = Date.UTC(2026, 9, 7, 6, 0); // Wed 2026-10-07 08:00 Zimbabwe time

function call(handler, { method = "GET", path: p = "/", body, query = {}, params = {}, userId } = {}) {
  return new Promise((resolve) => {
    const req = {
      method,
      path: p,
      body,
      query,
      params,
      headers: {},
      nowMs: NOW,
      ...(userId ? { user: { id: userId } } : {})
    };
    const res = {
      statusCode: 200,
      destroyed: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      send(b) { resolve({ status: this.statusCode, body: b }); return this; },
      end() { return this; },
      once() { return this; },
      set() { return this; },
      setHeader() { return this; }
    };
    mw(req, res, (err) => {
      if (err) return resolve({ status: 500, body: { message: err.message } });
      try {
        const result = handler(req, res);
        if (result && typeof result.then === "function") {
          result.catch((e) => res.status(e.statusCode || e.status || 500).json({ success: false, message: e.message }));
        }
      } catch (e) {
        res.status(e.statusCode || e.status || 500).json({ success: false, message: e.message });
      }
    });
  });
}

const snapshot = () => JSON.parse(fs.readFileSync(dbFile, "utf8"));

async function findUser(role) {
  const { db, release } = await store.read();
  store.release(release);
  return db.users.find((u) => u.role === role && u.is_active);
}

const SETTINGS = {
  enabled: true,
  days: [1, 2, 3, 4, 5],
  start: "08:00",
  end: "16:00",
  slotMinutes: 60,
  capacity: 1,
  leadHours: 24,
  horizonDays: 30,
  breaks: [],
  blockedDates: []
};

test("SETUP: enable public booking schedule and seed pilot client & specialist", async () => {
  const admin = await findUser("Admin");
  const enableRes = await call(web.updateBookingSettings, {
    method: "PUT",
    userId: admin.id,
    body: SETTINGS
  });
  assert.equal(enableRes.status, 200);

  // Add fictional client to db
  const { db, release } = await store.read();
  if (!Array.isArray(db.clients)) db.clients = [];
  db.clients.push({
    id: "c-pilot-mimosa",
    name: "Mimosa Mining Company",
    mine_site: "Mimosa Zvishavane",
    status: "Active"
  });
  db.clients.push({
    id: "c-pilot-zimplats",
    name: "Zimplats SMC",
    mine_site: "Zimplats Selous",
    status: "Active"
  });

  // Link Client Viewer to c-pilot-mimosa
  const clientUser = db.users.find((u) => u.role === "Client Viewer");
  if (clientUser) clientUser.client_id = "c-pilot-mimosa";

  // Add a second Client Viewer for wrong-client test
  db.users.push({
    id: "u-wrong-client",
    name: "Competitor Client Viewer",
    role: "Client Viewer",
    client_id: "c-pilot-zimplats",
    is_active: true
  });

  store.write(db, release);
});

test("CONVERSION: staff successfully converts public booking and lead into Virtual Technical Survey", async () => {
  // 1. Submit public booking
  const bookRes = await call(web.createWebsiteEnquiry, {
    method: "POST",
    path: "/public/enquiries",
    body: {
      type: "survey",
      name: "Eng. Chitepo",
      company: "Mimosa Mining Company",
      email: "chitepo@mimosa.co.zw",
      phone: "+263771000001",
      siteLocation: "Zvishavane Shaft 4",
      surveyType: "Slurry Pump Liner Wear Audit",
      message: "Severe gouging on suction liner",
      slotDate: "2026-10-15",
      slotTime: "10:00"
    }
  });
  assert.equal(bookRes.status, 200);
  const ref = bookRes.body.data.reference;

  const sBefore = snapshot();
  const booking = sBefore.survey_bookings.find((b) => b.reference === ref);
  assert.ok(booking);
  assert.equal(booking.slot_status, "requested");
  const lead = sBefore.leads.find((l) => l.booking_reference === ref);
  assert.ok(lead);

  // 2. Sales staff converts booking into Virtual Technical Survey
  const sales = await findUser("Sales");
  const specialist = await findUser("Technician") || { id: "u-specialist-01", name: "Tawanda Specialist" };

  const convertRes = await call(convertBookingToSurvey, {
    method: "POST",
    userId: sales.id,
    body: {
      booking_id: booking.id,
      client_id: "c-pilot-mimosa",
      host_specialist_id: specialist.id,
      host_specialist_name: specialist.name,
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Feed Pump PU-101",
      duration_minutes: 60
    }
  });

  assert.equal(convertRes.status, 201);
  const survey = convertRes.body.data;
  assert.ok(survey.id);
  assert.equal(survey.client_id, "c-pilot-mimosa");
  assert.equal(survey.booking_id, booking.id);
  assert.equal(survey.booking_reference, ref);
  assert.equal(survey.lead_id, lead.id);
  assert.equal(survey.status, "SCHEDULED");
  assert.equal(survey.client_engineer_name, "Eng. Chitepo");
  assert.equal(survey.client_engineer_email, "chitepo@mimosa.co.zw");
  assert.equal(survey.equipment_tag_id, "TAG-PU-101");
  assert.match(survey.scheduled_at, /^2026-10-15T/);

  // 3. Verify original booking history is preserved and linked
  const sAfter = snapshot();
  const updatedBooking = sAfter.survey_bookings.find((b) => b.id === booking.id);
  assert.equal(updatedBooking.contact_name, "Eng. Chitepo");
  assert.equal(updatedBooking.email, "chitepo@mimosa.co.zw");
  assert.equal(updatedBooking.slot_date, "2026-10-15");
  assert.equal(updatedBooking.slot_time, "10:00");
  assert.equal(updatedBooking.source, "website");
  assert.equal(updatedBooking.survey_id, survey.id);
  assert.equal(updatedBooking.slot_status, "confirmed");

  // 4. Verify linked lead is updated
  const updatedLead = sAfter.leads.find((l) => l.id === lead.id);
  assert.equal(updatedLead.survey_id, survey.id);
  assert.equal(updatedLead.status, "In Progress");

  // 5. Verify audit logs
  assert.ok(sAfter.audit_logs.some((a) => a.action === "SURVEY_CONVERTED_FROM_BOOKING" && a.entity_id === survey.id));
  assert.ok(sAfter.audit_logs.some((a) => a.action === "SURVEY_SLOT_CONVERTED" && a.entity_id === booking.id));
});

test("IDEMPOTENCY: retrying conversion safely returns existing consultation without duplicates", async () => {
  const s = snapshot();
  const booking = s.survey_bookings.find((b) => b.slot_date === "2026-10-15" && b.slot_time === "10:00");
  assert.ok(booking?.survey_id);
  const surveyCountBefore = s.virtual_technical_surveys.length;

  const sales = await findUser("Sales");
  const retryRes = await call(convertBookingToSurvey, {
    method: "POST",
    userId: sales.id,
    body: {
      booking_id: booking.id,
      client_id: "c-pilot-mimosa",
      host_specialist_id: "u-specialist-01"
    }
  });

  assert.equal(retryRes.status, 200);
  assert.equal(retryRes.body.already_converted, true);
  assert.equal(retryRes.body.data.id, booking.survey_id);
  assert.equal(snapshot().virtual_technical_surveys.length, surveyCountBefore, "no duplicate survey created");
});

test("CONCURRENCY: concurrent conversion requests for one booking result in exactly one survey", async () => {
  // Create another booking
  const bRes = await call(web.createWebsiteEnquiry, {
    method: "POST",
    path: "/public/enquiries",
    body: {
      type: "survey",
      name: "Eng. Moyo",
      phone: "0777123456",
      siteLocation: "Mimosa South",
      surveyType: "Feed Pipe Relining",
      slotDate: "2026-10-16",
      slotTime: "14:00"
    }
  });
  assert.equal(bRes.status, 200);
  const ref = bRes.body.data.reference;
  const booking = snapshot().survey_bookings.find((b) => b.reference === ref);
  assert.ok(booking);

  const admin = await findUser("Admin");
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(convertBookingToSurvey, {
        method: "POST",
        userId: admin.id,
        body: {
          booking_id: booking.id,
          client_id: "c-pilot-mimosa",
          host_specialist_id: "u-specialist-distinct"
        }
      })
    )
  );

  // All 5 calls succeeded (either 201 created or 200 idempotent replay)
  assert.ok(results.every((r) => r.status === 200 || r.status === 201));
  const created = results.filter((r) => r.status === 201);
  assert.equal(created.length, 1, "exactly one request performed the creation");

  const s = snapshot();
  const surveys = s.virtual_technical_surveys.filter((x) => x.booking_id === booking.id);
  assert.equal(surveys.length, 1, "exactly one survey stored in database");
});

test("OVERLAP: rejects conversion if assigned specialist has overlapping survey", async () => {
  // Existing survey with host_specialist_id
  const s = snapshot();
  const existingSurvey = s.virtual_technical_surveys[0];
  assert.ok(existingSurvey);
  const specialistId = existingSurvey.host_specialist_id;

  // Create another booking for 2026-10-15 at 10:00
  // First update schedule capacity to allow second slot hold if needed
  await call(web.updateBookingSettings, {
    method: "PUT",
    userId: (await findUser("Admin")).id,
    body: { ...SETTINGS, capacity: 2 }
  });

  const bRes = await call(web.createWebsiteEnquiry, {
    method: "POST",
    path: "/public/enquiries",
    body: {
      type: "survey",
      name: "Eng. Overlap",
      phone: "0777999888",
      siteLocation: "Zvishavane Shaft 4",
      surveyType: "Secondary Pump Inspection",
      slotDate: "2026-10-15",
      slotTime: "10:00"
    }
  });
  assert.equal(bRes.status, 200);
  const booking = snapshot().survey_bookings.find((b) => b.reference === bRes.body.data.reference);
  assert.ok(booking);

  // Attempt to assign the same specialist
  const sales = await findUser("Sales");
  const conflictRes = await call(convertBookingToSurvey, {
    method: "POST",
    userId: sales.id,
    body: {
      booking_id: booking.id,
      client_id: "c-pilot-mimosa",
      host_specialist_id: specialistId
    }
  });

  assert.equal(conflictRes.status, 409);
  assert.equal(conflictRes.body.code, "SPECIALIST_SCHEDULE_CONFLICT");
  assert.match(conflictRes.body.message, /already has a consultation scheduled/);

  // But assigning a different specialist succeeds!
  const okRes = await call(convertBookingToSurvey, {
    method: "POST",
    userId: sales.id,
    body: {
      booking_id: booking.id,
      client_id: "c-pilot-mimosa",
      host_specialist_id: "u-specialist-free-02",
      host_specialist_name: "Farai Specialist"
    }
  });
  assert.equal(okRes.status, 201);
});

test("CANCELLED: refuses to convert cancelled booking", async () => {
  // Create and cancel a booking (2026-10-19 is Monday)
  const bRes = await call(web.createWebsiteEnquiry, {
    method: "POST",
    path: "/public/enquiries",
    body: {
      type: "survey",
      name: "Eng. Cancel",
      phone: "0777000111",
      siteLocation: "Mimosa North",
      surveyType: "Tank Inspection",
      slotDate: "2026-10-19",
      slotTime: "11:00"
    }
  });
  assert.equal(bRes.status, 200);
  const booking = snapshot().survey_bookings.find((b) => b.reference === bRes.body.data.reference);
  assert.ok(booking);
  const sales = await findUser("Sales");

  // Cancel it
  const cancelRes = await call(web.updateBookingStatus, {
    method: "PATCH",
    params: { id: booking.id },
    body: { status: "cancelled" },
    userId: sales.id
  });
  assert.equal(cancelRes.status, 200);

  // Attempt to convert
  const convRes = await call(convertBookingToSurvey, {
    method: "POST",
    userId: sales.id,
    body: {
      booking_id: booking.id,
      client_id: "c-pilot-mimosa",
      host_specialist_id: "u-specialist-01"
    }
  });
  assert.equal(convRes.status, 409);
  assert.equal(convRes.body.code, "BOOKING_CANCELLED");
});

test("AUTHORITY & WRONG CLIENT: non-staff cannot convert; wrong client denied survey access", async () => {
  // Create an unconverted booking (2026-10-20 is Tuesday)
  const bRes = await call(web.createWebsiteEnquiry, {
    method: "POST",
    path: "/public/enquiries",
    body: {
      type: "survey",
      name: "Eng. AuthCheck",
      phone: "0777333444",
      siteLocation: "Mimosa East",
      surveyType: "Belt Scraper Check",
      slotDate: "2026-10-20",
      slotTime: "09:00"
    }
  });
  assert.equal(bRes.status, 200);
  const unconv = snapshot().survey_bookings.find((b) => b.reference === bRes.body.data.reference);
  assert.ok(unconv);

  // 1. Unauthenticated -> 401
  const unauthRes = await call(convertBookingToSurvey, {
    method: "POST",
    body: { booking_id: unconv.id, client_id: "c-pilot-mimosa", host_specialist_id: "u-specialist-01" }
  });
  assert.equal(unauthRes.status, 401);

  // 2. Technician -> 403
  const tech = await findUser("Technician");
  if (tech) {
    const techRes = await call(convertBookingToSurvey, {
      method: "POST",
      userId: tech.id,
      body: { booking_id: unconv.id, client_id: "c-pilot-mimosa", host_specialist_id: "u-specialist-01" }
    });
    assert.equal(techRes.status, 403);
  }

  // 3. Client Viewer -> 403
  const clientViewer = await findUser("Client Viewer");
  const cvRes = await call(convertBookingToSurvey, {
    method: "POST",
    userId: clientViewer.id,
    body: { booking_id: unconv.id, client_id: "c-pilot-mimosa", host_specialist_id: "u-specialist-01" }
  });
  assert.equal(cvRes.status, 403);

  // 4. Invalid client ID -> 404
  const sales = await findUser("Sales");
  const badClientRes = await call(convertBookingToSurvey, {
    method: "POST",
    userId: sales.id,
    body: { booking_id: unconv.id, client_id: "c-does-not-exist", host_specialist_id: "u-specialist-01" }
  });
  assert.equal(badClientRes.status, 404);
  assert.equal(badClientRes.body.code, "CLIENT_NOT_FOUND");

  // 5. Wrong-client access denial on resulting survey
  const s = snapshot();
  const convertedSurvey = s.virtual_technical_surveys.find((x) => x.client_id === "c-pilot-mimosa");
  assert.ok(convertedSurvey);

  // Authorized client viewer (c-pilot-mimosa) can list/access
  const okList = await call(listSurveys, { userId: clientViewer.id });
  assert.equal(okList.status, 200);
  assert.ok(okList.body.data.every((srv) => srv.client_id === "c-pilot-mimosa"));

  // Wrong client viewer (c-pilot-zimplats) cannot access mimosa survey room
  const wrongViewer = s.users.find((u) => u.id === "u-wrong-client");
  assert.ok(wrongViewer);
  const deniedAccess = await call(getSurveyMeetingAccess, {
    params: { id: convertedSurvey.id },
    userId: wrongViewer.id
  });
  assert.equal(deniedAccess.status, 403);
  assert.match(deniedAccess.body.message, /Survey belongs to another client|matching client ownership/);
});
