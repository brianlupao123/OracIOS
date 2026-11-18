import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createMessage, queueMessage, processMessage, failMessage,
  retryMessage, cancelMessage, listQueuedMessages, listFailedMessages,
  getMessageById, getQueueStats
} from "../src/services/communicationQueueService.js";

// ── Helpers ──────────────────────────────────────────────────────────

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
  return { communication_queue: [], audit_logs: [] };
}

const originalDryRun = process.env.COMMUNICATIONS_DRY_RUN;

// ── Tests ────────────────────────────────────────────────────────────

describe("Communication Queue Service (Batch 2)", () => {
  let db, store;

  beforeEach(() => {
    process.env.COMMUNICATIONS_DRY_RUN = "true"; // Explicit dry-run
    db = makeDb();
    store = makeStore();
  });

  afterEach(() => {
    if (originalDryRun !== undefined) process.env.COMMUNICATIONS_DRY_RUN = originalDryRun;
    else delete process.env.COMMUNICATIONS_DRY_RUN;
  });

  it("createMessage produces a Draft message", () => {
    const msg = createMessage({
      subject: "Test Subject",
      body: "Test Body",
      recipientEmail: "client@example.com",
      recipientName: "Client",
      createdBy: "admin-1",
      store, db
    });
    assert.ok(msg.id.startsWith("msg_"));
    assert.equal(msg.status, "Draft");
    assert.equal(msg.recipient_email, "client@example.com");
    assert.equal(msg.retry_count, 0);
  });

  it("createMessage rejects missing subject", () => {
    assert.throws(() => createMessage({
      body: "Body", recipientEmail: "a@b.com", createdBy: "u1", store, db
    }), { message: /subject/ });
  });

  it("createMessage rejects missing recipientEmail", () => {
    assert.throws(() => createMessage({
      subject: "Subj", body: "Body", createdBy: "u1", store, db
    }), { message: /recipientEmail/ });
  });

  it("queueMessage transitions Draft → Queued", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    const queued = queueMessage({ messageId: msg.id, userId: "u1", store, db });
    assert.equal(queued.status, "Queued");
    assert.ok(queued.queued_at);
  });

  it("queueMessage rejects non-Draft message", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    assert.throws(() => queueMessage({ messageId: msg.id, userId: "u1", store, db }), { status: 409 });
  });

  it("processMessage in dry-run mode transitions Queued → Dispatched without sending", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    const dispatched = processMessage({ messageId: msg.id, userId: "u1", store, db });
    assert.equal(dispatched.status, "Dispatched");
    assert.equal(dispatched.dry_run, true);
    assert.ok(dispatched.dispatched_at);

    // Verify audit log has DRY_RUN action
    const actions = db.audit_logs.map(a => a.action);
    assert.ok(actions.includes("MESSAGE_DISPATCHED_DRY_RUN"));
  });

  it("processMessage in live mode throws 503 (no transport configured)", () => {
    process.env.COMMUNICATIONS_DRY_RUN = "false";
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    assert.throws(() => processMessage({ messageId: msg.id, userId: "u1", store, db }), { status: 503 });
  });

  it("failMessage transitions Queued → Failed with error and retry count", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    const failed = failMessage({ messageId: msg.id, error: "SMTP timeout", userId: "u1", store, db });
    assert.equal(failed.status, "Failed");
    assert.equal(failed.retry_count, 1);
    assert.equal(failed.last_error, "SMTP timeout");
  });

  it("retryMessage transitions Failed → Queued if under max retries", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    failMessage({ messageId: msg.id, error: "err", userId: "u1", store, db });
    const retried = retryMessage({ messageId: msg.id, userId: "u1", store, db });
    assert.equal(retried.status, "Queued");
  });

  it("retryMessage rejects when max retries exceeded (dead letter)", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    // Fail and retry 3 times to exhaust retries
    for (let i = 0; i < 3; i++) {
      failMessage({ messageId: msg.id, error: `err-${i}`, userId: "u1", store, db });
      if (i < 2) retryMessage({ messageId: msg.id, userId: "u1", store, db });
    }
    // Now retry_count is 3, should be rejected
    assert.throws(() => retryMessage({ messageId: msg.id, userId: "u1", store, db }), { status: 409 });
  });

  it("cancelMessage cancels a Draft", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    const cancelled = cancelMessage({ messageId: msg.id, reason: "Changed mind", userId: "u1", store, db });
    assert.equal(cancelled.status, "Cancelled");
  });

  it("cancelMessage cancels a Queued message", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    const cancelled = cancelMessage({ messageId: msg.id, reason: "No longer needed", userId: "u1", store, db });
    assert.equal(cancelled.status, "Cancelled");
  });

  it("cancelMessage rejects Dispatched message", () => {
    const msg = createMessage({
      subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "u1", store, db });
    processMessage({ messageId: msg.id, userId: "u1", store, db });
    assert.throws(() => cancelMessage({ messageId: msg.id, userId: "u1", store, db }), { status: 409 });
  });

  it("listQueuedMessages returns only Queued items", () => {
    const m1 = createMessage({ subject: "S1", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db });
    const m2 = createMessage({ subject: "S2", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db });
    queueMessage({ messageId: m1.id, userId: "u1", store, db });
    // m2 stays Draft
    const queued = listQueuedMessages({ db });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].id, m1.id);
  });

  it("getQueueStats returns correct counts", () => {
    createMessage({ subject: "S1", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db });
    const m2 = createMessage({ subject: "S2", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db });
    queueMessage({ messageId: m2.id, userId: "u1", store, db });
    processMessage({ messageId: m2.id, userId: "u1", store, db });

    const stats = getQueueStats({ db });
    assert.equal(stats.total, 2);
    assert.equal(stats.draft, 1);
    assert.equal(stats.dispatched, 1);
    assert.equal(stats.dry_run, true);
  });

  it("getMessageById returns message or null", () => {
    const msg = createMessage({ subject: "S", body: "B", recipientEmail: "a@b.com", createdBy: "u1", store, db });
    assert.equal(getMessageById({ messageId: msg.id, db }).id, msg.id);
    assert.equal(getMessageById({ messageId: "nonexistent", db }), null);
  });

  it("full lifecycle: Draft → Queued → Dispatched (dry-run) with audit trail", () => {
    const msg = createMessage({
      subject: "Quote QR-001", body: "Dear Client...", recipientEmail: "client@example.com",
      templateName: "quote_sent", entityType: "quote", entityId: "q-1",
      createdBy: "admin-1", store, db
    });
    queueMessage({ messageId: msg.id, userId: "admin-1", store, db });
    processMessage({ messageId: msg.id, userId: "admin-1", store, db });

    const final = getMessageById({ messageId: msg.id, db });
    assert.equal(final.status, "Dispatched");
    assert.equal(final.dry_run, true);
    assert.equal(final.entity_type, "quote");
    assert.equal(final.entity_id, "q-1");

    const actions = db.audit_logs.map(a => a.action);
    assert.ok(actions.includes("MESSAGE_DRAFTED"));
    assert.ok(actions.includes("MESSAGE_QUEUED"));
    assert.ok(actions.includes("MESSAGE_DISPATCHED_DRY_RUN"));
  });
});
