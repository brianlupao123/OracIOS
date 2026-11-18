// tests/communicationAudit.test.js — Communication Audit History & Digest (Batch 4)
//
// Tests entity-linked communication history, manual evidence recording,
// combined timelines, and the daily chase digest engine.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  getEntityCommunicationHistory,
  getEntityCommunicationStats,
  recordCommunicationEvidence,
  getEntityEvidenceHistory,
  getEntityCommunicationTimeline,
  buildChaseDigest
} from "../src/services/communicationAuditService.js";

import {
  getTimeline, recordEvidence, getDigest
} from "../src/controllers/communicationsController.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeStore() {
  const auditLog = [];
  return {
    audit: (db, actor, collection, entityId, action, details) => {
      auditLog.push({ actor: actor?.id, collection, entityId, action, details });
    },
    _auditLog: auditLog
  };
}

function makeDb(overrides = {}) {
  return {
    communication_queue: [],
    communication_evidence: [],
    invoices: [],
    quotes: [],
    dispatch_cards: [],
    worksheets: [],
    ...overrides
  };
}

function makeReq(body = {}, db = null, params = {}, query = {}) {
  return {
    body,
    params,
    query,
    db: db || makeDb(),
    store: makeStore(),
    user: { id: "user-1" }
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _json: null,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; }
  };
  return res;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

// ═════════════════════════════════════════════════════════════════════
// Service: Entity Communication History
// ═════════════════════════════════════════════════════════════════════

describe("communicationAuditService — entity history", () => {
  it("returns messages linked to a specific entity", () => {
    const db = makeDb({
      communication_queue: [
        { id: "m1", entity_type: "quote", entity_id: "q-1", status: "Dispatched", created_at: daysAgo(2), dispatched_at: daysAgo(1) },
        { id: "m2", entity_type: "invoice", entity_id: "i-1", status: "Queued", created_at: daysAgo(1) },
        { id: "m3", entity_type: "quote", entity_id: "q-1", status: "Draft", created_at: daysAgo(0) }
      ]
    });

    const result = getEntityCommunicationHistory({ entityType: "quote", entityId: "q-1", db });
    assert.equal(result.length, 2);
    assert.equal(result[0].id, "m3"); // newest first
    assert.equal(result[1].id, "m1");
  });

  it("returns empty array when no messages match", () => {
    const db = makeDb();
    const result = getEntityCommunicationHistory({ entityType: "quote", entityId: "q-999", db });
    assert.equal(result.length, 0);
  });

  it("computes stats correctly", () => {
    const db = makeDb({
      communication_queue: [
        { id: "m1", entity_type: "quote", entity_id: "q-1", status: "Dispatched", created_at: daysAgo(5), dispatched_at: daysAgo(4) },
        { id: "m2", entity_type: "quote", entity_id: "q-1", status: "Failed", created_at: daysAgo(3) },
        { id: "m3", entity_type: "quote", entity_id: "q-1", status: "Draft", created_at: daysAgo(0) },
        { id: "m4", entity_type: "invoice", entity_id: "i-1", status: "Queued", created_at: daysAgo(1) }
      ]
    });

    const stats = getEntityCommunicationStats({ entityType: "quote", entityId: "q-1", db });
    assert.equal(stats.total, 3);
    assert.equal(stats.dispatched, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.draft, 1);
    assert.ok(stats.last_dispatched_at);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: Evidence Recording
// ═════════════════════════════════════════════════════════════════════

describe("communicationAuditService — evidence recording", () => {
  it("records communication evidence with valid channel", () => {
    const db = makeDb();
    const store = makeStore();

    const evidence = recordCommunicationEvidence({
      entityType: "invoice", entityId: "i-1",
      channel: "company_outlook",
      recipientEmail: "client@mine.co.zw",
      recipientName: "John Doe",
      subject: "Invoice INV-001",
      notes: "Sent via company Outlook with PDF attached",
      recordedBy: "user-1",
      store, db
    });

    assert.ok(evidence.id.startsWith("cev_"));
    assert.equal(evidence.entity_type, "invoice");
    assert.equal(evidence.channel, "company_outlook");
    assert.equal(evidence.recipient_email, "client@mine.co.zw");
    assert.ok(evidence.recorded_at);
    assert.equal(db.communication_evidence.length, 1);
    assert.equal(store._auditLog.length, 1);
    assert.equal(store._auditLog[0].action, "EVIDENCE_RECORDED");
  });

  it("rejects missing entityType", () => {
    const db = makeDb();
    const store = makeStore();

    assert.throws(
      () => recordCommunicationEvidence({ entityId: "i-1", channel: "phone_call", recordedBy: "u-1", store, db }),
      /entityType/
    );
  });

  it("rejects invalid channel", () => {
    const db = makeDb();
    const store = makeStore();

    assert.throws(
      () => recordCommunicationEvidence({ entityType: "quote", entityId: "q-1", channel: "telegram", recordedBy: "u-1", store, db }),
      /Invalid channel/
    );
  });

  it("supports all valid channels", () => {
    const channels = [
      "company_outlook", "personal_email", "whatsapp", "phone_call",
      "hand_delivery", "courier", "orac_system", "other"
    ];
    for (const channel of channels) {
      const db = makeDb();
      const store = makeStore();
      const ev = recordCommunicationEvidence({
        entityType: "quote", entityId: "q-1", channel,
        recordedBy: "u-1", store, db
      });
      assert.equal(ev.channel, channel);
    }
  });

  it("returns evidence history sorted newest-first", () => {
    const db = makeDb({
      communication_evidence: [
        { id: "e1", entity_type: "quote", entity_id: "q-1", recorded_at: daysAgo(3) },
        { id: "e2", entity_type: "quote", entity_id: "q-1", recorded_at: daysAgo(0) },
        { id: "e3", entity_type: "invoice", entity_id: "i-1", recorded_at: daysAgo(1) }
      ]
    });

    const history = getEntityEvidenceHistory({ entityType: "quote", entityId: "q-1", db });
    assert.equal(history.length, 2);
    assert.equal(history[0].id, "e2"); // newest first
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: Combined Timeline
// ═════════════════════════════════════════════════════════════════════

describe("communicationAuditService — combined timeline", () => {
  it("interleaves queue messages and evidence records", () => {
    const db = makeDb({
      communication_queue: [
        { id: "m1", entity_type: "quote", entity_id: "q-1", status: "Dispatched", created_at: daysAgo(5), dispatched_at: daysAgo(4), subject: "Quote sent", recipient_email: "a@b.com", template_name: "quote_sent", dry_run: false }
      ],
      communication_evidence: [
        { id: "e1", entity_type: "quote", entity_id: "q-1", channel: "phone_call", sent_at: daysAgo(2), recorded_at: daysAgo(2), subject: "Follow-up call", recipient_email: "a@b.com" }
      ]
    });

    const timeline = getEntityCommunicationTimeline({ entityType: "quote", entityId: "q-1", db });
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].type, "manual_evidence"); // more recent
    assert.equal(timeline[1].type, "queue_message");
  });

  it("returns empty timeline for unlinked entity", () => {
    const db = makeDb();
    const timeline = getEntityCommunicationTimeline({ entityType: "quote", entityId: "q-999", db });
    assert.equal(timeline.length, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: Daily Chase Digest
// ═════════════════════════════════════════════════════════════════════

describe("communicationAuditService — chase digest", () => {
  it("identifies unpaid invoices with correct urgency", () => {
    const db = makeDb({
      invoices: [
        { id: "i-1", invoice_ref: "INV-001", status: "Issued", created_at: daysAgo(45), total_incl_vat: 50000 },
        { id: "i-2", invoice_ref: "INV-002", status: "Paid", created_at: daysAgo(10), total_incl_vat: 20000 },
        { id: "i-3", invoice_ref: "INV-003", status: "Issued", created_at: daysAgo(5), total_incl_vat: 15000 }
      ]
    });

    const digest = buildChaseDigest({ db });
    const unpaid = digest.items.filter(i => i.category === "unpaid_invoice");
    assert.equal(unpaid.length, 2); // i-1 and i-3 (i-2 is paid)
    assert.equal(digest.summary.unpaid_invoices, 2);

    const high = unpaid.find(i => i.ref === "INV-001");
    assert.equal(high.urgency, "high"); // 45 days > 30
  });

  it("identifies pending POs from sent quotes", () => {
    const db = makeDb({
      quotes: [
        { id: "q-1", quote_ref: "QT-001", status: "Sent", created_at: daysAgo(35) },
        { id: "q-2", quote_ref: "QT-002", status: "PO Received", created_at: daysAgo(10) },
        { id: "q-3", quote_ref: "QT-003", status: "Approved", created_at: daysAgo(5) }
      ]
    });

    const digest = buildChaseDigest({ db });
    assert.equal(digest.summary.pending_pos, 2); // q-1 (Sent) and q-3 (Approved)
  });

  it("identifies stale dispatches beyond threshold", () => {
    const db = makeDb({
      dispatch_cards: [
        { id: "d-1", dispatch_ref: "DSP-001", dispatch_date: daysAgo(20), status: "In Progress" },
        { id: "d-2", dispatch_ref: "DSP-002", dispatch_date: daysAgo(5), status: "In Progress" },
        { id: "d-3", dispatch_ref: "DSP-003", dispatch_date: daysAgo(30), status: "Completed" }
      ]
    });

    const digest = buildChaseDigest({ db, staleDays: 14 });
    assert.equal(digest.summary.stale_dispatches, 1); // d-1 only (d-2 too recent, d-3 completed)
  });

  it("identifies overdue draft worksheets", () => {
    const db = makeDb({
      worksheets: [
        { id: "w-1", worksheet_ref: "WS-001", status: "Draft", created_at: daysAgo(10) },
        { id: "w-2", worksheet_ref: "WS-002", status: "Submitted", created_at: daysAgo(10) },
        { id: "w-3", worksheet_ref: "WS-003", status: "Draft", created_at: daysAgo(3) }
      ]
    });

    const digest = buildChaseDigest({ db, draftDays: 7 });
    assert.equal(digest.summary.overdue_worksheets, 1); // w-1 only (w-2 submitted, w-3 too recent)
  });

  it("sorts by urgency then age", () => {
    const db = makeDb({
      invoices: [
        { id: "i-1", invoice_ref: "INV-001", status: "Issued", created_at: daysAgo(70), total_incl_vat: 100000 },
        { id: "i-2", invoice_ref: "INV-002", status: "Issued", created_at: daysAgo(10), total_incl_vat: 5000 }
      ]
    });

    const digest = buildChaseDigest({ db });
    assert.equal(digest.items[0].urgency, "critical"); // 70 days > 60
    assert.equal(digest.items[0].ref, "INV-001");
  });

  it("returns empty digest when nothing needs attention", () => {
    const db = makeDb();
    const digest = buildChaseDigest({ db });
    assert.equal(digest.summary.total, 0);
    assert.equal(digest.items.length, 0);
    assert.ok(digest.generated_at);
  });

  it("custom thresholds are honored", () => {
    const db = makeDb({
      dispatch_cards: [
        { id: "d-1", dispatch_ref: "DSP-001", dispatch_date: daysAgo(5), status: "In Progress" }
      ]
    });

    // Default staleDays=14 would not catch this, but staleDays=3 should
    const digest = buildChaseDigest({ db, staleDays: 3 });
    assert.equal(digest.summary.stale_dispatches, 1);
    assert.equal(digest.stale_threshold_days, 3);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Controller: Batch 4 handlers
// ═════════════════════════════════════════════════════════════════════

describe("communicationsController — Batch 4 handlers", () => {
  it("GET /communications/timeline returns timeline and stats", () => {
    const db = makeDb({
      communication_queue: [
        { id: "m1", entity_type: "quote", entity_id: "q-1", status: "Dispatched", created_at: daysAgo(3), dispatched_at: daysAgo(2), subject: "Test", recipient_email: "a@b.com" }
      ]
    });
    const req = makeReq({}, db, { entityType: "quote", entityId: "q-1" });
    const res = makeRes();

    getTimeline(req, res);
    assert.equal(res._json.success, true);
    assert.equal(res._json.timeline.length, 1);
    assert.equal(res._json.stats.total, 1);
  });

  it("POST /communications/evidence records evidence", () => {
    const db = makeDb();
    const req = makeReq({
      entity_type: "invoice", entity_id: "i-1",
      channel: "company_outlook",
      recipient_email: "client@mine.co.zw",
      subject: "Invoice sent"
    }, db);
    const res = makeRes();

    recordEvidence(req, res);
    assert.equal(res._status, 201);
    assert.equal(res._json.success, true);
    assert.ok(res._json.evidence.id.startsWith("cev_"));
  });

  it("POST /communications/evidence rejects invalid channel", () => {
    const db = makeDb();
    const req = makeReq({
      entity_type: "invoice", entity_id: "i-1",
      channel: "pigeon"
    }, db);
    const res = makeRes();

    recordEvidence(req, res);
    assert.equal(res._status, 400);
    assert.equal(res._json.success, false);
  });

  it("GET /communications/digest returns chase digest", () => {
    const db = makeDb({
      invoices: [
        { id: "i-1", invoice_ref: "INV-001", status: "Issued", created_at: daysAgo(50), total_incl_vat: 75000 }
      ]
    });
    const req = makeReq({}, db, {}, { stale_days: "14" });
    const res = makeRes();

    getDigest(req, res);
    assert.equal(res._json.success, true);
    assert.equal(res._json.digest.summary.unpaid_invoices, 1);
    assert.ok(res._json.digest.generated_at);
  });
});
