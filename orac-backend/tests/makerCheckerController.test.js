import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createProposal, listProposals, getProposal, approveProposal, rejectProposal
} from "../src/controllers/makerCheckerController.js";

// ── Helpers ──────────────────────────────────────────────────────────

// Valid 32-byte base64 key matching the regex in paymentDetails.js
const TEST_KEY = crypto.randomBytes(32).toString("base64");
const originalKey = process.env.ORAC_PAYMENT_ENCRYPTION_KEY;

// Minimal store stub with audit trail
function makeStore() {
  const auditLog = [];
  return {
    audit(db, actor, type, entityId, action, details) {
      if (!db.audit_logs) db.audit_logs = [];
      db.audit_logs.push({ actor_id: actor.id, type, entity_id: entityId, action, details, ts: new Date().toISOString() });
      auditLog.push({ action });
    },
    _auditLog: auditLog
  };
}

function makeDb() {
  return {
    users: [
      { id: "admin-a", name: "Alice Admin", role: "Admin", is_active: true },
      { id: "admin-b", name: "Bob Admin", role: "Admin", is_active: true },
      { id: "tech-c", name: "Charlie Tech", role: "Technician", is_active: true }
    ],
    bank_change_proposals: [],
    audit_logs: []
  };
}

function mockReq(userId, db, store, body = {}, params = {}) {
  return { user: { id: userId }, db, store, body, params };
}

function mockRes() {
  let statusCode = 200;
  let jsonData = null;
  return {
    status(code) { statusCode = code; return this; },
    json(data) { jsonData = data; return this; },
    get _status() { return statusCode; },
    get _json() { return jsonData; }
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("S-02: Maker-Checker HTTP Controller", () => {
  let db, store;

  beforeEach(() => {
    process.env.ORAC_PAYMENT_ENCRYPTION_KEY = TEST_KEY;
    db = makeDb();
    store = makeStore();
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.ORAC_PAYMENT_ENCRYPTION_KEY = originalKey;
    else delete process.env.ORAC_PAYMENT_ENCRYPTION_KEY;
  });

  it("POST /bank-change-proposals creates a proposal (Admin)", () => {
    const req = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB", bank_account: "9999" }
    });
    const res = mockRes();
    createProposal(req, res);
    assert.equal(res._status, 201);
    assert.equal(res._json.success, true);
    assert.ok(res._json.proposal.id.startsWith("bcp_"));
    assert.equal(res._json.proposal.status, "Pending");
  });

  it("POST /bank-change-proposals rejects non-Admin (403)", () => {
    const req = mockReq("tech-c", db, store, {
      target_user_id: "admin-a",
      proposed_details: { bank_name: "FNB" }
    });
    const res = mockRes();
    createProposal(req, res);
    assert.equal(res._status, 403);
    assert.equal(res._json.success, false);
  });

  it("GET /bank-change-proposals lists pending proposals", () => {
    // Create one first
    const req1 = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB" }
    });
    createProposal(req1, mockRes());

    const req2 = mockReq("admin-b", db, store);
    const res = mockRes();
    listProposals(req2, res);
    assert.equal(res._json.success, true);
    assert.equal(res._json.proposals.length, 1);
    // Should NOT include encrypted_proposed_details
    assert.equal(res._json.proposals[0].encrypted_proposed_details, undefined);
  });

  it("GET /bank-change-proposals/:id returns proposal metadata without encrypted details", () => {
    const req1 = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB" }
    });
    const res1 = mockRes();
    createProposal(req1, res1);
    const pid = res1._json.proposal.id;

    const req2 = mockReq("admin-b", db, store, {}, { id: pid });
    const res2 = mockRes();
    getProposal(req2, res2);
    assert.equal(res2._json.success, true);
    assert.equal(res2._json.proposal.id, pid);
    assert.equal(res2._json.proposal.status, "Pending");
    assert.equal(res2._json.proposal.encrypted_proposed_details, undefined);
  });

  it("POST /:id/approve — different Admin can approve", () => {
    const req1 = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB", bank_account: "1234" }
    });
    const res1 = mockRes();
    createProposal(req1, res1);
    const pid = res1._json.proposal.id;

    const req2 = mockReq("admin-b", db, store, {}, { id: pid });
    const res2 = mockRes();
    approveProposal(req2, res2);
    assert.equal(res2._json.success, true);
    assert.equal(res2._json.proposal.status, "Approved");
    assert.equal(res2._json.proposal.decided_by, "admin-b");

    // Verify bank details were applied to the target user
    const tech = db.users.find(u => u.id === "tech-c");
    assert.ok(tech.payment_details, "payment_details should exist on target user");
    assert.equal(tech.payment_details.updated_by, "admin-b");
  });

  it("POST /:id/approve — same Admin blocked (403, 2-person rule)", () => {
    const req1 = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB" }
    });
    const res1 = mockRes();
    createProposal(req1, res1);
    const pid = res1._json.proposal.id;

    const req2 = mockReq("admin-a", db, store, {}, { id: pid });
    const res2 = mockRes();
    approveProposal(req2, res2);
    assert.equal(res2._status, 403);
    assert.match(res2._json.message, /Maker-Checker/);
  });

  it("POST /:id/reject — another Admin rejects", () => {
    const req1 = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB" }
    });
    const res1 = mockRes();
    createProposal(req1, res1);
    const pid = res1._json.proposal.id;

    const req2 = mockReq("admin-b", db, store, { reason: "Wrong account" }, { id: pid });
    const res2 = mockRes();
    rejectProposal(req2, res2);
    assert.equal(res2._json.success, true);
    assert.equal(res2._json.action, "rejected");
    assert.equal(res2._json.proposal.status, "Rejected");
  });

  it("POST /:id/reject — proposer withdrawing own proposal", () => {
    const req1 = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB" }
    });
    const res1 = mockRes();
    createProposal(req1, res1);
    const pid = res1._json.proposal.id;

    const req2 = mockReq("admin-a", db, store, { reason: "Changed my mind" }, { id: pid });
    const res2 = mockRes();
    rejectProposal(req2, res2);
    assert.equal(res2._json.action, "withdrawn");
  });

  it("404 for non-existent proposal", () => {
    const req = mockReq("admin-a", db, store, {}, { id: "bcp_nonexistent" });
    const res = mockRes();
    getProposal(req, res);
    assert.equal(res._status, 404);
  });

  it("400 when target_user_id is missing", () => {
    const req = mockReq("admin-a", db, store, {
      proposed_details: { bank_name: "FNB" }
    });
    const res = mockRes();
    createProposal(req, res);
    assert.equal(res._status, 400);
  });

  it("audit log captures all lifecycle events", () => {
    // Create
    const req1 = mockReq("admin-a", db, store, {
      target_user_id: "tech-c",
      proposed_details: { bank_name: "FNB" }
    });
    const res1 = mockRes();
    createProposal(req1, res1);
    const pid = res1._json.proposal.id;

    // Approve
    const req2 = mockReq("admin-b", db, store, {}, { id: pid });
    approveProposal(req2, mockRes());

    const actions = db.audit_logs.map(a => a.action);
    assert.ok(actions.includes("BANK_CHANGE_PROPOSED"));
    assert.ok(actions.includes("BANK_CHANGE_APPROVED"));
  });
});
