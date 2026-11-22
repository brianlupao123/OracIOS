// backend/tests/batch0SecurityBaseline.test.js
//
// Batch 0: Security & Characterisation Baseline Test Suite
// Proves:
// 1. Real-router auth wall refusal (HTTP 401) for unauthenticated ingress
// 2. Direct controller resolution fail-closed behavior (no synthetic admin fallback)
// 3. Store and DB request-scoped mutex binding for artisan, fleet, and HSE controllers
// 4. Communication transport fail-closed allowlist behavior

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import express from "express";
import router from "../src/router.js";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import { createStore } from "../src/store.js";
import { generateToken } from "../src/middleware/auth.js";

// Controllers under test for fail-closed resolution
import { getRoleDashboardSummary } from "../src/controllers/dashboardController.js";
import { createProcurementRequest } from "../src/controllers/procurementController.js";
import { recordPreDispatchPpe } from "../src/controllers/hseController.js";
import { ingestTelemetry } from "../src/controllers/telemetryController.js";
import { bookSurvey } from "../src/controllers/surveyController.js";
import { createArtisanQualification } from "../src/controllers/artisanController.js";
import { submitFeedback } from "../src/controllers/feedbackController.js";
import { syncBatchMutations } from "../src/controllers/syncController.js";

// Mutex-bound controllers
import { postRegisterDocument } from "../src/controllers/artisanDocumentController.js";
import { postOdometerReading } from "../src/modules/fleet/controllers/fleetComplianceController.js";
import { postCreateJsa } from "../src/controllers/hseQualityController.js";

// Communication transport allowlist
import {
  getAllowedRecipients,
  isRecipientPermitted
} from "../src/services/communicationTransportService.js";

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "orac-batch0-test-"));
  const file = join(dir, "db.json");
  return { store: createStore(file), file };
}

function buildApp(store) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", persistenceMiddleware(store));
  app.use("/api", router);
  app.use("/api", (req, res) => res.status(404).json({ success: false, message: "Route not found" }));
  app.use((err, req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
  return app;
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}/api`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const call = (url, token, body, method = "POST") => fetch(url, {
  method,
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  },
  ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) })
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Real Router Ingress Auth Wall Refusal Tests
// ═══════════════════════════════════════════════════════════════════════════

test("Real router blocks unauthenticated ingress to protected endpoints with HTTP 401", async () => {
  const { store } = makeStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const protectedRoutes = [
      { method: "GET", path: "/dashboard/role-summary" },
      { method: "POST", path: "/procurement/requests", body: { department: "Mechanical" } },
      { method: "POST", path: "/hse/ppe-checklists", body: { technician_id: "tech-1" } },
      { method: "POST", path: "/telemetry/ingest", body: { equipment_id: "eq-1" } },
      { method: "POST", path: "/surveys/book", body: { client_id: "c-1" } },
      { method: "POST", path: "/sync/mutations", body: { mutations: [] } },
      { method: "POST", path: "/feedback/submit", body: { score: 9 } }
    ];

    for (const route of protectedRoutes) {
      const res = await call(`${base}${route.path}`, null, route.body, route.method);
      assert.equal(res.status, 401, `Expected 401 for anonymous ${route.method} ${route.path}`);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.message, /Unauthorized|Token missing/i);
    }
  });
});

test("Real router allows authenticated valid user through authMiddleware", async () => {
  const { store } = makeStore();
  const { db, release } = await store.read();
  const testUser = {
    id: "u-test-admin",
    email: "admin@orac.co.zw",
    role: "Admin",
    name: "Test Admin",
    is_active: true
  };
  db.users = [testUser];
  await store.write(db, release);

  const app = buildApp(store);
  const token = generateToken(testUser);

  await withServer(app, async (base) => {
    const res = await call(`${base}/dashboard/role-summary`, token, null, "GET");
    assert.equal(res.status, 200, "Dashboard role-summary should return 200 for authenticated Admin");
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.subsystems);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Direct Controller Resolution Fail-Closed Tests
// ═══════════════════════════════════════════════════════════════════════════

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test("Controllers fail closed with HTTP 401 when req.user is missing", async () => {
  const mockDb = {
    users: [{ id: "u-valid", role: "Admin", name: "Valid User" }]
  };

  const controllers = [
    { name: "getRoleDashboardSummary", fn: (req, res) => getRoleDashboardSummary(req, res) },
    { name: "createProcurementRequest", fn: (req, res) => createProcurementRequest(req, res) },
    { name: "recordPreDispatchPpe", fn: (req, res) => recordPreDispatchPpe(req, res) },
    { name: "ingestTelemetry", fn: (req, res) => ingestTelemetry(req, res) },
    { name: "bookSurvey", fn: (req, res) => bookSurvey(req, res) },
    { name: "createArtisanQualification", fn: (req, res) => createArtisanQualification(req, res) },
    { name: "submitFeedback", fn: (req, res) => submitFeedback(req, res) },
    { name: "syncBatchMutations", fn: (req, res) => syncBatchMutations(req, res) }
  ];

  for (const { name, fn } of controllers) {
    const req = { user: null, db: mockDb, body: {} };
    const res = createMockRes();
    await fn(req, res);
    assert.equal(res.statusCode, 401, `${name} must return 401 when req.user is null`);
    assert.equal(res.body?.success, false);
  }
});

test("Controllers fail closed with HTTP 401 when user is not found in db.users", async () => {
  const mockDb = {
    users: [{ id: "u-valid", role: "Admin", name: "Valid User" }]
  };

  const controllers = [
    { name: "getRoleDashboardSummary", fn: (req, res) => getRoleDashboardSummary(req, res) },
    { name: "createProcurementRequest", fn: (req, res) => createProcurementRequest(req, res) },
    { name: "recordPreDispatchPpe", fn: (req, res) => recordPreDispatchPpe(req, res) },
    { name: "ingestTelemetry", fn: (req, res) => ingestTelemetry(req, res) },
    { name: "bookSurvey", fn: (req, res) => bookSurvey(req, res) },
    { name: "createArtisanQualification", fn: (req, res) => createArtisanQualification(req, res) },
    { name: "submitFeedback", fn: (req, res) => submitFeedback(req, res) },
    { name: "syncBatchMutations", fn: (req, res) => syncBatchMutations(req, res) }
  ];

  for (const { name, fn } of controllers) {
    const req = { user: { id: "u-nonexistent" }, db: mockDb, body: {} };
    const res = createMockRes();
    await fn(req, res);
    assert.equal(res.statusCode, 401, `${name} must return 401 for unknown user id`);
    assert.equal(res.body?.success, false);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Store and DB Transaction Mutex Binding Tests
// ═══════════════════════════════════════════════════════════════════════════

test("artisanDocumentController uses req.store and req.db directly", () => {
  const mockDb = {
    artisan_documents: []
  };
  const mockStore = {
    id: (prefix) => `${prefix}-mock-1`,
    audit: () => {}
  };

  const req = {
    store: mockStore,
    db: mockDb,
    body: {
      technicianId: "tech-101",
      documentType: "journeyman_card",
      documentNumber: "RS-8921",
      fileName: "journeyman_card.pdf",
      issueDate: "2024-01-01",
      expiryDate: "2027-01-01",
      issuingAuthority: "Ministry of Higher Education"
    },
    user: { id: "u-admin" },
    app: { locals: {} } // locals is empty, proving req.store and req.db are used!
  };
  const res = createMockRes();

  postRegisterDocument(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body?.ok, true);
  assert.equal(mockDb.artisan_documents.length, 1);
  assert.equal(mockDb.artisan_documents[0].technician_id, "tech-101");
});

test("fleetComplianceController uses req.db directly", () => {
  const mockDb = {
    odometer_readings: [],
    vehicles: [{ id: "veh-1", reg_number: "AFK-1029", current_odometer_km: 10000 }]
  };

  const req = {
    db: mockDb,
    body: {
      vehicleId: "veh-1",
      readingKm: 12500,
      notes: "Routine check"
    },
    user: { id: "u-tech" },
    app: { locals: {} }
  };
  const res = createMockRes();

  postOdometerReading(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body?.ok, true);
  assert.equal(mockDb.odometer_readings.length, 1);
  assert.equal(mockDb.odometer_readings[0].reading_km, 12500);
});

test("hseQualityController uses req.db directly", () => {
  const mockDb = {
    jsa_records: []
  };

  const req = {
    db: mockDb,
    body: {
      dispatchId: "disp-100",
      jobDescription: "Furnace relining",
      location: "Zimplats SMC",
      hazardSteps: [{ workStep: "Entry", hazard: "Toxic gas", likelihood: "Possible", severity: "Moderate" }]
    },
    user: { id: "u-supervisor" },
    app: { locals: {} }
  };
  const res = createMockRes();

  postCreateJsa(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body?.ok, true);
  assert.equal(mockDb.jsa_records.length, 1);
  assert.equal(mockDb.jsa_records[0].dispatch_id, "disp-100");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Communication Transport Allowlist Tests
// ═══════════════════════════════════════════════════════════════════════════

test("Communication transport allowlist fails closed when env is unset or empty", () => {
  const originalEnv = process.env.CONTROLLED_RECIPIENT_ALLOWLIST;

  try {
    delete process.env.CONTROLLED_RECIPIENT_ALLOWLIST;
    assert.deepEqual(getAllowedRecipients(), []);
    assert.equal(isRecipientPermitted("brian@example.com"), false);
    assert.equal(isRecipientPermitted("admin@orac.co.zw"), false);

    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "";
    assert.deepEqual(getAllowedRecipients(), []);
    assert.equal(isRecipientPermitted("admin@orac.co.zw"), false);

    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "   ";
    assert.deepEqual(getAllowedRecipients(), []);
    assert.equal(isRecipientPermitted("admin@orac.co.zw"), false);

    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "*";
    assert.deepEqual(getAllowedRecipients(), []);
    assert.equal(isRecipientPermitted("admin@orac.co.zw"), false);
  } finally {
    if (originalEnv !== undefined) {
      process.env.CONTROLLED_RECIPIENT_ALLOWLIST = originalEnv;
    } else {
      delete process.env.CONTROLLED_RECIPIENT_ALLOWLIST;
    }
  }
});

test("Communication transport allowlist permits only configured emails", () => {
  const originalEnv = process.env.CONTROLLED_RECIPIENT_ALLOWLIST;

  try {
    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "operations@orac.co.zw, finance@orac.co.zw";
    assert.deepEqual(getAllowedRecipients(), ["operations@orac.co.zw", "finance@orac.co.zw"]);
    assert.equal(isRecipientPermitted("operations@orac.co.zw"), true);
    assert.equal(isRecipientPermitted("finance@orac.co.zw"), true);
    assert.equal(isRecipientPermitted("OPERATIONS@ORAC.CO.ZW"), true); // Case-insensitive
    assert.equal(isRecipientPermitted("external@client.com"), false);
    assert.equal(isRecipientPermitted("personal@gmail.com"), false);
  } finally {
    if (originalEnv !== undefined) {
      process.env.CONTROLLED_RECIPIENT_ALLOWLIST = originalEnv;
    } else {
      delete process.env.CONTROLLED_RECIPIENT_ALLOWLIST;
    }
  }
});
