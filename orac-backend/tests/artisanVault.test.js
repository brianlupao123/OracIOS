// backend/tests/artisanVault.test.js
//
// Subsystem 6: HR Artisan Qualifications Vault & Mine Site Inductions
// Tests credential tracking, 30/60/90-day expiry calculation, and
// Sensitive Control S-10: Statutory Hard Gate blocking dispatch if mine induction is expired or missing.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createArtisanQualification,
  listArtisanQualifications,
  recordMineInduction,
  listMineInductions,
  verifyArtisanDispatchGate,
  getArtisanVaultSummary
} from "../src/controllers/artisanController.js";

import {
  calculateExpiryCategory,
  checkMineInductionGate,
  evaluateArtisanVault
} from "../src/services/expiryWatcherService.js";

function createMockReqRes({ user, body = {}, params = {}, query = {}, db = {} }) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    user: user || { id: "u-admin", role: "Admin", name: "Admin Lead" },
    body,
    params,
    query,
    db: {
      users: [
        { id: "u-admin", role: "Admin", name: "Admin Lead" },
        { id: "u-supervisor", role: "Supervisor", name: "Site Supervisor" },
        { id: "u-tech-1", role: "Technician", name: "Farai Zhou" },
        { id: "u-tech-2", role: "Technician", name: "Tendai Moyo" }
      ],
      artisan_qualifications: [],
      mine_site_inductions: [],
      artisan_dispatch_allocations: [],
      audit_logs: [],
      ...db
    },
    store: {
      id(prefix) {
        return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
      },
      audit(dbObj, actor, entityType, entityId, action, oldV, newV) {
        dbObj.audit_logs = dbObj.audit_logs || [];
        dbObj.audit_logs.push({
          entity_type: entityType,
          entity_id: entityId,
          action,
          actor_id: actor.id,
          created_at: new Date().toISOString()
        });
      }
    }
  };

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatus() {
      return statusCode;
    },
    getData() {
      return responseData;
    }
  };

  return { req, res };
}

test("Artisan Vault: registers artisan qualifications with automatic expiry categorization", () => {
  const futureExpiry = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  const { req, res } = createMockReqRes({
    body: {
      technician_id: "u-tech-1",
      technician_name: "Farai Zhou",
      trade_discipline: "RUBBER_LINING",
      qualification_type: "RED_SEAL",
      certificate_number: "RS-ZIM-2024-884",
      issuing_authority: "National Manpower Advisory Council (NAMACO)",
      issue_date: "2024-01-15",
      expiry_date: futureExpiry
    }
  });

  createArtisanQualification(req, res);

  assert.equal(res.getStatus(), 201);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.technician_name, "Farai Zhou");
  assert.equal(data.data.trade_discipline, "RUBBER_LINING");
  assert.equal(data.data.category, "VALID");
  assert.equal(req.db.artisan_qualifications.length, 1);
  assert.equal(req.db.audit_logs.length, 1);
});

test("Artisan Vault: records mine site induction and tracks medical clearance", () => {
  const futureExpiry = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const { req, res } = createMockReqRes({
    body: {
      technician_id: "u-tech-1",
      technician_name: "Farai Zhou",
      mine_site: "ZIMPLATS_SMC",
      induction_card_number: "ZIMP-IND-9982",
      induction_date: "2026-01-10",
      expiry_date: futureExpiry,
      medical_fit_to_work_pass: true
    }
  });

  recordMineInduction(req, res);

  assert.equal(res.getStatus(), 201);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.mine_site, "ZIMPLATS_SMC");
  assert.equal(data.data.medical_fit_to_work_pass, true);
  assert.equal(req.db.mine_site_inductions.length, 1);
});

test("Sensitive Control S-10: verifies and clears dispatch gate when induction is valid", () => {
  const validExpiry = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const { req, res } = createMockReqRes({
    db: {
      mine_site_inductions: [
        {
          id: "ind-1",
          technician_id: "u-tech-1",
          technician_name: "Farai Zhou",
          mine_site: "ZIMPLATS_SMC",
          induction_card_number: "ZIMP-IND-9982",
          expiry_date: validExpiry,
          medical_fit_to_work_pass: true,
          status: "VALID"
        }
      ]
    },
    body: {
      dispatch_card_id: "DC-FIELD-501",
      technician_id: "u-tech-1",
      mine_site: "ZIMPLATS_SMC"
    }
  });

  verifyArtisanDispatchGate(req, res);

  assert.equal(res.getStatus(), 200);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.gate_clearance_status, "CLEARED");
  assert.equal(req.db.artisan_dispatch_allocations.length, 1);
});

test("Sensitive Control S-10: strictly blocks dispatch with 403 MINE_INDUCTION_EXPIRED when induction is expired", () => {
  const pastExpiry = "2026-01-01"; // Expired
  const { req, res } = createMockReqRes({
    db: {
      mine_site_inductions: [
        {
          id: "ind-old",
          technician_id: "u-tech-2",
          technician_name: "Tendai Moyo",
          mine_site: "UNKI_CONCENTRATOR",
          induction_card_number: "UNKI-IND-1002",
          expiry_date: pastExpiry,
          medical_fit_to_work_pass: true,
          status: "EXPIRED"
        }
      ]
    },
    body: {
      dispatch_card_id: "DC-FIELD-502",
      technician_id: "u-tech-2",
      mine_site: "UNKI_CONCENTRATOR"
    }
  });

  verifyArtisanDispatchGate(req, res);

  assert.equal(res.getStatus(), 403);
  const data = res.getData();
  assert.equal(data.success, false);
  assert.equal(data.code, "MINE_INDUCTION_EXPIRED");
  assert.match(data.message, /Sensitive Control S-10 Hard Stop/);
  assert.equal(req.db.artisan_dispatch_allocations.length, 0); // Must NOT allocate!
  assert.ok(req.db.audit_logs.some((l) => l.action === "MINE_INDUCTION_EXPIRED"));
});

test("Sensitive Control S-10: strictly blocks dispatch with 403 MINE_INDUCTION_MISSING when technician has no induction for target mine", () => {
  const validExpiry = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const { req, res } = createMockReqRes({
    db: {
      mine_site_inductions: [
        {
          id: "ind-zim",
          technician_id: "u-tech-1",
          technician_name: "Farai Zhou",
          mine_site: "ZIMPLATS_SMC",
          induction_card_number: "ZIMP-IND-9982",
          expiry_date: validExpiry,
          medical_fit_to_work_pass: true,
          status: "VALID"
        }
      ]
    },
    body: {
      dispatch_card_id: "DC-FIELD-503",
      technician_id: "u-tech-1",
      mine_site: "MIMOSA_FLOTATION" // Different mine site!
    }
  });

  verifyArtisanDispatchGate(req, res);

  assert.equal(res.getStatus(), 403);
  const data = res.getData();
  assert.equal(data.success, false);
  assert.equal(data.code, "MINE_INDUCTION_MISSING");
  assert.match(data.message, /Statutory safety gate blocked/);
  assert.equal(req.db.artisan_dispatch_allocations.length, 0);
});

test("Expiry Watcher Service: accurately classifies 30/60/90-day warning tiers and aggregates vault summary", () => {
  const ref = "2026-11-17T00:00:00.000Z";

  // Tier testing
  assert.equal(calculateExpiryCategory("2026-11-10", ref).category, "EXPIRED");
  assert.equal(calculateExpiryCategory("2026-12-05", ref).category, "EXPIRING_URGENT_30");
  assert.equal(calculateExpiryCategory("2027-01-05", ref).category, "EXPIRING_SOON_60");
  assert.equal(calculateExpiryCategory("2027-02-05", ref).category, "EXPIRING_SOON_90");
  assert.equal(calculateExpiryCategory("2027-06-01", ref).category, "VALID");

  const quals = [
    { expiry_date: "2026-11-10" },
    { expiry_date: "2026-12-05" },
    { expiry_date: "2027-06-01" }
  ];
  const inds = [
    { expiry_date: "2026-11-01" },
    { expiry_date: "2027-06-01" }
  ];

  const summary = evaluateArtisanVault(quals, inds, ref);
  assert.equal(summary.total_qualifications, 3);
  assert.equal(summary.expired_qualifications, 1);
  assert.equal(summary.expiring_urgent_30, 1);
  assert.equal(summary.valid_qualifications, 1);
  assert.equal(summary.total_inductions, 2);
  assert.equal(summary.expired_inductions, 1);
  assert.equal(summary.valid_inductions, 1);
  assert.equal(summary.alerts.length, 3);
});
