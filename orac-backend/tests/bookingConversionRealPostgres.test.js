import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import express from "express";
import router from "../src/router.js";
import { createStore as createPostgresStore } from "../src/postgresStore.js";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import { generateToken } from "../src/middleware/auth.js";

const PG_PORT = 54339;
const PG_DATA = "C:\\Users\\BRIAN LUPAO\\AppData\\Local\\Temp\\pg_disposable_booking_test";
const POSTGRES_BIN_DIR = "D:\\ORAC-Test\\PostgreSQL16\\bin";
const POSTGRES_EXE = path.join(POSTGRES_BIN_DIR, "postgres.exe");
const PG_CTL_EXE = path.join(POSTGRES_BIN_DIR, "pg_ctl.exe");
const INITDB_EXE = path.join(POSTGRES_BIN_DIR, "initdb.exe");
const CONNECTION_STRING = `postgres://postgres@127.0.0.1:${PG_PORT}/postgres`;

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

async function startDisposablePostgres() {
  if (!fs.existsSync(POSTGRES_EXE)) {
    throw new Error(`PostgreSQL binary not found at ${POSTGRES_EXE}`);
  }

  // Ensure data dir initialized
  if (!fs.existsSync(path.join(PG_DATA, "PG_VERSION"))) {
    fs.mkdirSync(PG_DATA, { recursive: true });
    execSync(`"${INITDB_EXE}" -D "${PG_DATA}" -U postgres -A trust --locale=C --encoding=UTF8`, { stdio: "pipe" });
  }

  // Remove any stale pid file
  const pidFile = path.join(PG_DATA, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch {}
  }

  const child = spawn(POSTGRES_EXE, ["-D", PG_DATA, "-p", String(PG_PORT)], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stderr.on("data", () => {});
  child.stdout.on("data", () => {});

  // Poll until PostgreSQL accepts connections
  let connected = false;
  const start = Date.now();
  while (!connected && Date.now() - start < 15000) {
    try {
      const client = new pg.Client({ connectionString: CONNECTION_STRING });
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      connected = true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!connected) {
    child.kill();
    throw new Error(`Failed to connect to disposable PostgreSQL on port ${PG_PORT} within 15s`);
  }

  return {
    process: child,
    async stop() {
      try {
        execSync(`"${PG_CTL_EXE}" -D "${PG_DATA}" stop -m fast`, { stdio: "ignore" });
      } catch {
        child.kill();
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  };
}

async function seedDatabase(pool, initialDb) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS store (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
    await client.query(
      `INSERT INTO store (id, data) VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET data = $1;`,
      [initialDb]
    );
  } finally {
    client.release();
  }
}

async function readPostgresData(pool) {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT data FROM store WHERE id = 'main'");
    return res.rows[0]?.data;
  } finally {
    client.release();
  }
}

const req = async (baseUrl, subPath, { method = "GET", body, token } = {}) => {
  const res = await fetch(baseUrl + subPath, {
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

test("PostgreSQL 16.15 Concurrency & HTTP Route Verification Suite", async (t) => {
  let pgInstance;
  let poolA;
  let poolB;
  let serverA;
  let serverB;
  let urlA;
  let urlB;

  t.before(async () => {
    pgInstance = await startDisposablePostgres();

    poolA = new pg.Pool({ connectionString: CONNECTION_STRING, max: 5 });
    poolB = new pg.Pool({ connectionString: CONNECTION_STRING, max: 5 });

    await seedDatabase(poolA, makeInitialDb());

    const storeA = createPostgresStore(":memory:", poolA);
    const storeB = createPostgresStore(":memory:", poolB);

    serverA = await new Promise((resolve) => {
      const s = buildApp(storeA).listen(0, "127.0.0.1", () => resolve(s));
    });
    serverB = await new Promise((resolve) => {
      const s = buildApp(storeB).listen(0, "127.0.0.1", () => resolve(s));
    });

    urlA = `http://127.0.0.1:${serverA.address().port}/api`;
    urlB = `http://127.0.0.1:${serverB.address().port}/api`;
  });

  t.after(async () => {
    if (serverA) await new Promise((r) => serverA.close(r));
    if (serverB) await new Promise((r) => serverB.close(r));
    if (poolA) await poolA.end();
    if (poolB) await poolB.end();
    if (pgInstance) await pgInstance.stop();
  });

  await t.test("Route A: POST /api/surveys/convert-booking enforces auth, permits Sales, updates PostgreSQL", async () => {
    await seedDatabase(poolA, makeInitialDb());

    const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });
    const tokenTech = generateToken({ id: "u-tech", role: "Technician", name: "Technician ORAC" });
    const tokenFin = generateToken({ id: "u-fin", role: "Finance", name: "Finance ORAC" });
    const tokenSup = generateToken({ id: "u-sup", role: "Supervisor", name: "Supervisor ORAC" });

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

    // 4. Verify PostgreSQL persistence directly via poolB
    const data = await readPostgresData(poolB);
    const bk = data.survey_bookings.find((b) => b.id === "bk-001");
    assert.equal(bk.slot_status, "confirmed");
    assert.ok(bk.survey_id);
    const ld = data.leads.find((l) => l.id === "lead-001");
    assert.equal(ld.status, "In Progress");
  });

  await t.test("Route B: POST /api/bookings/:id/convert-survey verifies parameter binding and authority", async () => {
    await seedDatabase(poolA, makeInitialDb());

    const tokenAdmin = generateToken({ id: "u-admin", role: "Admin", name: "Admin ORAC" });
    const tokenTech = generateToken({ id: "u-tech", role: "Technician", name: "Technician ORAC" });

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

  await t.test("Wrong-client scope: survey access is restricted to client owner", async () => {
    await seedDatabase(poolA, makeInitialDb());

    const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });
    const tokenCvMimosa = generateToken({ id: "u-cv-mimosa", role: "Client Viewer", name: "Mimosa Viewer" });
    const tokenCvZimplats = generateToken({ id: "u-cv-zimplats", role: "Client Viewer", name: "Zimplats Viewer" });

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

  await t.test("PostgreSQL two-pool concurrency: concurrent duplicate conversion serializes on row lock and idempotently returns existing survey", async () => {
    await seedDatabase(poolA, makeInitialDb());

    const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });

    // Fire concurrent conversion requests to two distinct server instances backed by separate real PostgreSQL connection pools
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

    // Test retry on either server: must return 200 with already_converted: true
    const retryRes = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      token: tokenSales,
      body: { booking_id: "bk-001", client_id: "c-mimosa", host_specialist_id: "u-spec-1" }
    });
    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.body.already_converted, true);
    assert.equal(retryRes.body.data.id, createdRes.body.data.id);

    // Verify real PostgreSQL database row integrity: exactly 1 survey created
    const data = await readPostgresData(poolA);
    const matchingSurveys = data.virtual_technical_surveys.filter((s) => s.booking_id === "bk-001");
    assert.equal(matchingSurveys.length, 1, "Exactly one survey must exist in real PostgreSQL database");
  });

  await t.test("PostgreSQL two-pool concurrency: overlapping specialist bookings serialize on row lock, exactly one succeeds, other returns 409 conflict", async () => {
    await seedDatabase(poolA, makeInitialDb());

    const tokenSales = generateToken({ id: "u-sales", role: "Sales", name: "Sales ORAC" });

    // Both booking 1 and booking 2 are scheduled for the exact same slot (2026-10-15 10:00).
    // Fire concurrent requests requesting the SAME specialist (u-spec-1) across separate connection pools.
    const [resA, resB] = await Promise.all([
      req(urlA, "/surveys/convert-booking", {
        method: "POST",
        token: tokenSales,
        body: {
          booking_id: "bk-001",
          client_id: "c-mimosa",
          host_specialist_id: "u-spec-1",
          duration_minutes: 60
        }
      }),
      req(urlB, "/surveys/convert-booking", {
        method: "POST",
        token: tokenSales,
        body: {
          booking_id: "bk-002",
          client_id: "c-mimosa",
          host_specialist_id: "u-spec-1",
          duration_minutes: 60
        }
      })
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [201, 409], "Exactly one overlapping request must succeed (201) and the conflicting one must fail (409)");

    const successRes = resA.status === 201 ? resA : resB;
    const conflictRes = resA.status === 409 ? resA : resB;

    assert.equal(successRes.body.success, true);
    assert.equal(conflictRes.body.code, "SPECIALIST_SCHEDULE_CONFLICT");
    assert.match(conflictRes.body.message, /already has a consultation scheduled/);

    // Now convert the unconfirmed booking with a different, non-conflicting specialist (u-spec-2)
    const unconfirmedBookingId = successRes.body.data.booking_id === "bk-001" ? "bk-002" : "bk-001";
    const okDiffSpec = await req(urlA, "/surveys/convert-booking", {
      method: "POST",
      token: tokenSales,
      body: {
        booking_id: unconfirmedBookingId,
        client_id: "c-mimosa",
        host_specialist_id: "u-spec-2",
        duration_minutes: 60
      }
    });
    assert.equal(okDiffSpec.status, 201);
    assert.equal(okDiffSpec.body.data.host_specialist_id, "u-spec-2");

    // Verify real PostgreSQL database row integrity: both distinct bookings now have surveys scheduled with different specialists
    const data = await readPostgresData(poolB);
    assert.equal(data.virtual_technical_surveys.length, 2);
    const spec1Surveys = data.virtual_technical_surveys.filter((s) => s.host_specialist_id === "u-spec-1");
    const spec2Surveys = data.virtual_technical_surveys.filter((s) => s.host_specialist_id === "u-spec-2");
    assert.equal(spec1Surveys.length, 1);
    assert.equal(spec2Surveys.length, 1);
  });
});
