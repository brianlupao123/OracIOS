import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import router from "../src/router.js";
import { createStore as createPostgresStore } from "../src/postgresStore.js";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import { generateToken } from "../src/middleware/auth.js";

/**
 * Creates an in-process PostgreSQL engine modeling two independent server connection pools
 * sharing a single database row, with exact SELECT ... FOR UPDATE row-locking,
 * BEGIN/COMMIT/ROLLBACK transaction semantics.
 */
function createTwoPoolFakePg(initialDb) {
  let committed = JSON.stringify(initialDb);
  let held = false;
  const waiters = [];
  const state = { commits: 0, rollbacks: 0 };

  const lock = () => new Promise((resolve) => {
    if (!held) {
      held = true;
      resolve();
    } else {
      waiters.push(resolve);
    }
  });

  const unlock = () => {
    const next = waiters.shift();
    if (next) next();
    else held = false;
  };

  const ok = { rowCount: 0, rows: [] };

  function makePool(poolName) {
    return {
      poolName,
      async connect() {
        let pending = null;
        let holding = false;
        return {
          async query(sql, params) {
            if (sql === "BEGIN" || sql.startsWith("SET LOCAL")) return ok;
            if (sql.startsWith("SELECT data")) {
              if (sql.includes("FOR UPDATE")) {
                await lock();
                holding = true;
              }
              return { rowCount: 1, rows: [{ data: JSON.parse(committed) }] };
            }
            if (sql.startsWith("UPDATE store")) {
              pending = JSON.stringify(params[0]);
              return { rowCount: 1, rows: [] };
            }
            if (sql === "COMMIT") {
              if (pending !== null) {
                committed = pending;
                state.commits += 1;
              }
              pending = null;
              if (holding) {
                holding = false;
                unlock();
              }
              return ok;
            }
            if (sql === "ROLLBACK") {
              pending = null;
              state.rollbacks += 1;
              if (holding) {
                holding = false;
                unlock();
              }
              return ok;
            }
            throw new Error(`unexpected SQL in fake pool: ${sql}`);
          },
          release() {}
        };
      }
    };
  }

  return {
    poolA: makePool("poolA"),
    poolB: makePool("poolB"),
    state,
    data: () => JSON.parse(committed)
  };
}

function buildApp(store) {
  const app = express();
  app.use(express.json());
  app.use("/api", persistenceMiddleware(store));
  app.use("/api", router);
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || error.status || 500).json({
      success: false,
      message: error.message,
      code: error.code
    });
  });
  return app;
}

async function withServers(storeA, storeB, fn) {
  const serverA = await new Promise((resolve) => {
    const s = buildApp(storeA).listen(0, "127.0.0.1", () => resolve(s));
  });
  const serverB = storeB ? await new Promise((resolve) => {
    const s = buildApp(storeB).listen(0, "127.0.0.1", () => resolve(s));
  }) : null;

  const urlA = `http://127.0.0.1:${serverA.address().port}/api`;
  const urlB = serverB ? `http://127.0.0.1:${serverB.address().port}/api` : null;

  const req = async (baseUrl, path, { method = "GET", body, token } = {}) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { status: res.status, body: parsed };
  };

  try {
    await fn({ urlA, urlB, req });
  } finally {
    await Promise.all([
      new Promise((resolve, reject) => serverA.close((err) => err ? reject(err) : resolve())),
      serverB ? new Promise((resolve, reject) => serverB.close((err) => err ? reject(err) : resolve())) : Promise.resolve()
    ]);
  }
}

function makeInitialDb() {
  const admin = { id: "u-admin", role: "Admin", name: "Admin ORAC", is_active: true };
  const sales = { id: "u-sales", role: "Sales", name: "Sales ORAC", is_active: true };
  const tech = { id: "u-tech", role: "Technician", name: "Technician ORAC", is_active: true };
  const fin = { id: "u-fin", role: "Finance", name: "Finance ORAC", is_active: true };
  const sup = { id: "u-sup", role: "Supervisor", name: "Supervisor ORAC", is_active: true };
  const spec1 = { id: "u-spec-1", role: "Specialist", name: "Tafadzwa Specialist", is_active: true };
  const spec2 = { id: "u-spec-2", role: "Specialist", name: "Kuda Specialist", is_active: true };
  const cvMimosa = { id: "u-cv-mimosa", role: "Client Viewer", name: "Mimosa Viewer", client_id: "c-mimosa", is_active: true };
  const cvZimplats = { id: "u-cv-zimplats", role: "Client Viewer", name: "Zimplats Viewer", client_id: "c-zimplats", is_active: true };

  const mimosaClient = { id: "c-mimosa", name: "Mimosa Mining Company", mine_site: "Mimosa Zvishavane", status: "Active" };
  const zimplatsClient = { id: "c-zimplats", name: "Zimplats SMC", mine_site: "Zimplats Selous", status: "Active" };

  const booking1 = {
    id: "bk-001",
    reference: "REF-BK001",
    lead_id: "lead-001",
    company_name: "Mimosa Mining Company",
    contact_name: "Eng. Chitepo",
    slot_date: "2026-10-15",
    slot_time: "10:00",
    slot_status: "requested",
    survey_type: "Slurry Pump Liner Wear Audit",
    site_location: "Zvishavane Shaft 4",
    created_at: new Date().toISOString()
  };

  const booking2 = {
    id: "bk-002",
    reference: "REF-BK002",
    lead_id: "lead-002",
    company_name: "Mimosa Mining Company",
    contact_name: "Eng. Moyo",
    slot_date: "2026-10-15",
    slot_time: "10:00",
    slot_status: "requested",
    survey_type: "Cyclone Feed Pipe Audit",
    site_location: "Zvishavane Plant",
    created_at: new Date().toISOString()
  };

  const bookingCancelled = {
    id: "bk-cancelled",
    reference: "REF-CANCELLED",
    lead_id: "lead-003",
    company_name: "Mimosa Mining Company",
    contact_name: "Eng. Cancel",
    slot_date: "2026-10-19",
    slot_time: "11:00",
    slot_status: "cancelled",
    created_at: new Date().toISOString()
  };

  const lead1 = {
    id: "lead-001",
    name: "Eng. Chitepo",
    company: "Mimosa Mining Company",
    booking_reference: "REF-BK001",
    status: "New",
    created_at: new Date().toISOString()
  };

  const lead2 = {
    id: "lead-002",
    name: "Eng. Moyo",
    company: "Mimosa Mining Company",
    booking_reference: "REF-BK002",
    status: "New",
    created_at: new Date().toISOString()
  };

  return {
    users: [admin, sales, tech, fin, sup, spec1, spec2, cvMimosa, cvZimplats],
    clients: [mimosaClient, zimplatsClient],
    survey_bookings: [booking1, booking2, bookingCancelled],
    leads: [lead1, lead2],
    virtual_technical_surveys: [],
    audit_logs: []
  };
}

test("HTTP Route A: POST /api/surveys/convert-booking authorizes staff and rejects unauthorized roles", async () => {
  const pgEngine = createTwoPoolFakePg(makeInitialDb());
  const store = createPostgresStore(":memory:", pgEngine.poolA);

  const tokenAdmin = generateToken({ id: "u-admin", role: "Admin", name: "Admin ORAC" });
  const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });
  const tokenTech = generateToken({ id: "u-tech", role: "Technician", name: "Technician ORAC" });
  const tokenFin = generateToken({ id: "u-fin", role: "Finance", name: "Finance ORAC" });
  const tokenSup = generateToken({ id: "u-sup", role: "Supervisor", name: "Supervisor ORAC" });

  await withServers(store, null, async ({ urlA, req }) => {
    // 1. Unauthenticated -> 401
    const unauth = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      body: { booking_id: "bk-001", client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
    });
    assert.equal(unauth.status, 401);

    // 2. Denied roles -> 403 Forbidden
    for (const [name, token] of [["Technician", tokenTech], ["Finance", tokenFin], ["Supervisor", tokenSup]]) {
      const denied = await req(urlA, "/surveys/convert-booking", {
        method: "POST",
        token,
        body: { booking_id: "bk-001", client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
      });
      assert.equal(denied.status, 403, `Role ${name} must be rejected with 403`);
    }

    // 3. Authorized staff (Sales) -> 201 Created
    const okSales = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      token: tokenSales,
      body: {
        booking_id: "bk-001",
        client_id: "c-mimosa",
        host_specialist_id: "u-spec-1",
        duration_minutes: 60
      }
    });
    assert.equal(okSales.status, 201);
    assert.equal(okSales.body.success, true);
    assert.equal(okSales.body.data.client_id, "c-mimosa");
    assert.equal(okSales.body.data.host_specialist_id, "u-spec-1");
    assert.equal(okSales.body.data.status, "SCHEDULED");

    // Verify database state updated via PostgreSQL pool
    const data = pgEngine.data();
    const bk = data.survey_bookings.find((b) => b.id === "bk-001");
    assert.equal(bk.slot_status, "confirmed");
    assert.ok(bk.survey_id);
    const ld = data.leads.find((l) => l.id === "lead-001");
    assert.equal(ld.status, "In Progress");
  });
});

test("HTTP Route B: POST /api/bookings/:id/convert-survey verifies path parameter and authority", async () => {
  const pgEngine = createTwoPoolFakePg(makeInitialDb());
  const store = createPostgresStore(":memory:", pgEngine.poolA);

  const tokenAdmin = generateToken({ id: "u-admin", role: "Admin", name: "Admin ORAC" });
  const tokenTech = generateToken({ id: "u-tech", role: "Technician", name: "Technician ORAC" });

  await withServers(store, null, async ({ urlA, req }) => {
    // 1. Unauthenticated -> 401
    const unauth = await req(urlA, "/bookings/bk-001/convert-survey", {
      method: "POST",
      body: { client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
    });
    assert.equal(unauth.status, 401);

    // 2. Denied role (Technician) -> 403
    const denied = await req(urlA, "/bookings/bk-001/convert-survey", {
      method: "POST",
      token: tokenTech,
      body: { client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
    });
    assert.equal(denied.status, 403);

    // 3. Non-existent booking -> 404
    const notFound = await req(urlA, "/bookings/bk-non-existent/convert-survey", {
      method: "POST",
      token: tokenAdmin,
      body: { client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
    });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.code, "BOOKING_NOT_FOUND");

    // 4. Cancelled booking -> 409
    const cancelled = await req(urlA, "/bookings/bk-cancelled/convert-survey", {
      method: "POST",
      token: tokenAdmin,
      body: { client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
    });
    assert.equal(cancelled.status, 409);
    assert.equal(cancelled.body.code, "BOOKING_CANCELLED");

    // 5. Authorized staff (Admin) -> 201 Created using route param :id
    const okAdmin = await req(urlA, "/bookings/bk-001/convert-survey", {
      method: "POST",
      token: tokenAdmin,
      body: {
        client_id: "c-mimosa",
        host_specialist_id: "u-spec-1"
      }
    });
    assert.equal(okAdmin.status, 201);
    assert.equal(okAdmin.body.data.booking_id, "bk-001");
  });
});

test("Wrong-client scope: resulting survey access is restricted to client owner", async () => {
  const pgEngine = createTwoPoolFakePg(makeInitialDb());
  const store = createPostgresStore(":memory:", pgEngine.poolA);

  const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });
  const tokenCvMimosa = generateToken({ id: "u-cv-mimosa", role: "Client Viewer", name: "Mimosa Viewer" });
  const tokenCvZimplats = generateToken({ id: "u-cv-zimplats", role: "Client Viewer", name: "Zimplats Viewer" });

  await withServers(store, null, async ({ urlA, req }) => {
    // 1. Sales converts booking bk-001 for client c-mimosa
    const conv = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      token: tokenSales,
      body: { booking_id: "bk-001", client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
    });
    assert.equal(conv.status, 201);
    const surveyId = conv.body.data.id;

    // 2. Client Viewer from matching client (c-mimosa) lists surveys and sees their own survey
    const listMimosa = await req(urlA, "/surveys", {
      method: "GET",
      token: tokenCvMimosa
    });
    assert.equal(listMimosa.status, 200);
    assert.equal(listMimosa.body.data.length, 1);
    assert.equal(listMimosa.body.data[0].client_id, "c-mimosa");

    // Client Viewer from competitor client (c-zimplats) sees 0 surveys (scoped)
    const listZimplats = await req(urlA, "/surveys", {
      method: "GET",
      token: tokenCvZimplats
    });
    assert.equal(listZimplats.status, 200);
    assert.equal(listZimplats.body.data.length, 0);

    // 3. Client Viewer from matching client passes ownership check on room endpoint
    const accessMimosa = await req(urlA, `/surveys/${surveyId}/room`, {
      method: "GET",
      token: tokenCvMimosa
    });
    // Passes client authorization; returns 409 in local mock mode because mock video room is inactive
    assert.equal(accessMimosa.status === 200 || accessMimosa.status === 409, true);
    if (accessMimosa.status === 409) {
      assert.equal(accessMimosa.body.message, "This survey has no active video room.");
    }

    // 4. Client Viewer from wrong client (c-zimplats) is rejected with 403 Forbidden
    const deniedZimplats = await req(urlA, `/surveys/${surveyId}/room`, {
      method: "GET",
      token: tokenCvZimplats
    });
    assert.equal(deniedZimplats.status, 403);
    assert.match(deniedZimplats.body.message, /Survey access requires matching client ownership/);
  });
});

test("PostgreSQL two-pool concurrency: concurrent duplicate conversion requests serialize on row lock and return existing survey idempotently", async () => {
  const pgEngine = createTwoPoolFakePg(makeInitialDb());
  const storeA = createPostgresStore(":memory:", pgEngine.poolA);
  const storeB = createPostgresStore(":memory:", pgEngine.poolB);

  const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });

  await withServers(storeA, storeB, async ({ urlA, urlB, req }) => {
    // Fire concurrent conversion requests to two distinct server instances backed by PostgreSQL
    const [resA, resB] = await Promise.all([
      req(urlA, "/surveys/convert-booking", {
        method: "POST",
        token: tokenSales,
        body: { booking_id: "bk-001", client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
      }),
      req(urlB, "/surveys/convert-booking", {
        method: "POST",
        token: tokenSales,
        body: { booking_id: "bk-001", client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
      })
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [200, 201], "One request must create (201) and the concurrent duplicate must return existing (200)");

    const createdRes = resA.status === 201 ? resA : resB;
    const existingRes = resA.status === 200 ? resA : resB;

    assert.equal(createdRes.body.success, true);
    assert.equal(existingRes.body.success, true);
    assert.equal(existingRes.body.already_converted, true);
    assert.equal(createdRes.body.data.id, existingRes.body.data.id, "Both requests must resolve to the identical survey ID");

    // Assert PostgreSQL state integrity: exactly 1 survey created, committed via row locking
    const data = pgEngine.data();
    const matchingSurveys = data.virtual_technical_surveys.filter((s) => s.booking_id === "bk-001");
    assert.equal(matchingSurveys.length, 1, "Exactly one survey must exist in PostgreSQL storage");
    assert.equal(pgEngine.state.commits >= 2, true, "Transactions committed successfully");
  });
});

test("PostgreSQL storage: rejects overlapping specialist bookings with 409 conflict and permits different specialist", async () => {
  const pgEngine = createTwoPoolFakePg(makeInitialDb());
  const store = createPostgresStore(":memory:", pgEngine.poolA);
  const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });

  await withServers(store, null, async ({ urlA, req }) => {
    // 1. Convert booking 1 (slot: 2026-10-15 10:00) with specialist u-spec-1
    const conv1 = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      token: tokenSales,
      body: {
        booking_id: "bk-001",
        client_id: "c-mimosa",
        host_specialist_id: "u-spec-1",
        duration_minutes: 60
      }
    });
    assert.equal(conv1.status, 201);

    // 2. Booking 2 is at the exact same slot (2026-10-15 10:00).
    // Attempting to convert booking 2 to the same specialist u-spec-1 MUST be rejected with 409
    const conflictRes = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      token: tokenSales,
      body: {
        booking_id: "bk-002",
        client_id: "c-mimosa",
        host_specialist_id: "u-spec-1",
        duration_minutes: 60
      }
    });
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.body.code, "SPECIALIST_SCHEDULE_CONFLICT");
    assert.match(conflictRes.body.message, /already has a consultation scheduled/);

    // 3. Converting booking 2 with a different specialist (u-spec-2) succeeds
    const okDiffSpec = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      token: tokenSales,
      body: {
        booking_id: "bk-002",
        client_id: "c-mimosa",
        host_specialist_id: "u-spec-2",
        duration_minutes: 60
      }
    });
    assert.equal(okDiffSpec.status, 201);
    assert.equal(okDiffSpec.body.data.host_specialist_id, "u-spec-2");

    // Verify PostgreSQL stored both distinct surveys
    const data = pgEngine.data();
    assert.equal(data.virtual_technical_surveys.length, 2);
  });
});
