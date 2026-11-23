import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import express from "express";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import { roles } from "../src/permissions.js";
import {
  sendQuotationPdfEmail,
  confirmQuotationReceipt,
  resolveQuotationSend
} from "../src/services/quotationEmailService.js";
import {
  recordCommunicationEvidence,
  recordExternalSend,
  recordSystemCommunicationEvidence,
  getEntityCommunicationTimeline
} from "../src/services/communicationAuditService.js";

// All addresses use the reserved .test TLD. No real mailbox, credential or customer data.
const PILOT_A = "pilot-a@example.test";
const PILOT_B = "pilot-b@example.test";
const OUTSIDER = "outsider@example.test";

const SALES = { id: "usr_sales_1", role: roles.SALES, is_active: true };
const ADMIN = { id: "usr_admin_1", role: roles.ADMIN, is_active: true };
const TECH = { id: "usr_tech_1", role: roles.TECHNICIAN, is_active: true };

function makeDb() {
  return {
    quotes: [{
      id: "q_1", quote_number: "QT-TEST-1", client_id: "cli_1", status: "Draft",
      sales_owner_id: "usr_sales_1", total_amount: 1500, created_at: new Date().toISOString()
    }],
    clients: [{ id: "cli_1", name: "Test Client" }],
    quote_lines: [
      { id: "ql_1", quotation_id: "q_1", cost_type: "labour", description: "Overhaul", quantity: 10, unit_price: 100, line_total: 1000 },
      { id: "ql_2", quotation_id: "q_1", cost_type: "material", description: "Splice kit", quantity: 2, unit_price: 250, line_total: 500 }
    ],
    equipment_tags: [],
    company_profile: { company_name: "Test Co", legal_name: "Test Co (Pvt) Ltd" },
    communication_evidence: []
  };
}

/** failOn: audit action names for which store.audit throws, simulating a persistence failure. */
function makeStore({ failOn = [] } = {}) {
  const log = [];
  return {
    _log: log,
    audit(_db, actor, collection, entityId, action, details) {
      if (failOn.includes(action)) throw new Error("simulated audit persistence failure");
      log.push({ actor: actor?.id, collection, entityId, action, details });
    }
  };
}

function acceptingTransport() {
  const calls = [];
  const fn = async (message) => {
    calls.push(message);
    return { success: true, mode: "live-smtp", messageId: `<msg${calls.length}@orac.system>`, timestamp: new Date().toISOString() };
  };
  fn.calls = calls;
  return fn;
}

function failingTransport(error) {
  const calls = [];
  const fn = async (message) => { calls.push(message); throw error; };
  fn.calls = calls;
  return fn;
}

const definitiveFailure = (message = "SMTP server error (554): rejected") =>
  Object.assign(new Error(message), { outcomeUncertain: false });
const uncertainFailure = () =>
  Object.assign(new Error("SMTP connection closed after DATA was sent without a final reply"), { outcomeUncertain: true });

function send(db, store, deps, overrides = {}) {
  return sendQuotationPdfEmail({
    quoteId: "q_1", recipientEmail: PILOT_A, recipientName: "Pilot A",
    actor: SALES, store, db, deps: { sendEmail: deps }, ...overrides
  });
}

const rows = (db) => db.communication_evidence;
const actions = (store) => store._log.map((entry) => entry.action);

function assertNoDeliveredClaim(...artifacts) {
  for (const artifact of artifacts) {
    assert.doesNotMatch(JSON.stringify(artifact), /\bdelivered\b/i);
  }
}

describe("Quotation email evidence is truthful (provider acceptance is not delivery)", () => {
  const originalEnv = { ...process.env };
  let db;
  let store;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.COMMUNICATIONS_DRY_RUN = "false";
    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = `${PILOT_A}, ${PILOT_B}`;
    db = makeDb();
    store = makeStore();
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("records Admin recovery against the original attempt and never resends a confirmed receipt", async () => {
    await assert.rejects(send(db, store, failingTransport(uncertainFailure())));
    const attempt = rows(db)[0];
    const input = { quoteId: "q_1", evidenceId: attempt.id, outcome: "receipt_confirmed",
      note: "Recipient confirmed the PDF by phone.", store, db };
    assert.throws(() => resolveQuotationSend({ ...input, actor: SALES }), { status: 403 });
    assert.throws(() => resolveQuotationSend({ ...input, actor: ADMIN, outcome: "unknown" }), { status: 400 });
    resolveQuotationSend({ ...input, actor: ADMIN });
    assert.equal(attempt.status, "send_uncertain");
    assert.equal(attempt.recovery.recorded_by, ADMIN.id);
    assert.ok(actions(store).includes("QUOTE_EMAIL_RECOVERY_RECORDED"));
    const timeline = { entityType: "quote", entityId: "q_1", db };
    assert.equal(getEntityCommunicationTimeline(timeline)[0].recovery, undefined);
    const adminRow = getEntityCommunicationTimeline({ ...timeline, includeRecovery: true })[0];
    assert.equal(adminRow.evidence_status, "send_uncertain");
    assert.equal(adminRow.recovery.outcome, "receipt_confirmed");
    assert.throws(() => resolveQuotationSend({ ...input, actor: ADMIN }), { status: 409 });
    const transport = acceptingTransport();
    await assert.rejects(send(db, store, transport), { code: "MAIL_RECOVERY_RECEIPT_CONFIRMED" });
    assert.equal(transport.calls.length, 0);
  });

  it("holds fresh reservations and allows one linked Admin resend after verified non-acceptance", async () => {
    await assert.rejects(send(db, store, acceptingTransport(), {
      checkpointWrite: async () => { throw new Error("fixture interrupted before transport"); }
    }));
    const attempt = rows(db)[0];
    const input = { quoteId: "q_1", evidenceId: attempt.id, outcome: "provider_not_accepted",
      note: "Provider logs confirm rejection before acceptance.", actor: ADMIN, store, db };
    assert.throws(() => resolveQuotationSend(input), { code: "SEND_IN_PROGRESS" });
    attempt.recorded_at = new Date(Date.now() - 120_000).toISOString();
    resolveQuotationSend(input);
    const transport = acceptingTransport();
    const resend = { resendOf: attempt.id, resendReason: input.note, idempotencyKey: "recovery-fixture",
      checkpointWrite: async () => db };
    await assert.rejects(send(db, store, transport, resend), { status: 403 });
    const first = await send(db, store, transport, { ...resend, actor: ADMIN });
    const duplicate = await send(db, store, transport, { ...resend, actor: ADMIN });
    assert.equal(first.status, "accepted");
    assert.equal(duplicate.replayed, true);
    assert.equal(transport.calls.length, 1);
    assert.equal(rows(db)[1].supersedes, attempt.id);
  });

  it("commits a reservation before sending and preserves it when saving acceptance fails", async () => {
    let saved = makeDb();
    let writes = 0;
    let calls = 0;
    const durableStore = {
      async read() { return { db: structuredClone(saved), release: {} }; },
      release() {},
      write(next) {
        if (++writes === 2) throw new Error("simulated outcome commit failure");
        saved = structuredClone(next);
      },
      audit(state, _actor, _collection, _id, action) {
        (state.audit_logs ||= []).push(action);
      }
    };
    const app = express();
    app.use(persistenceMiddleware(durableStore));
    app.post("/send", async (req, res) => {
      try {
        const result = await send(req.db, req.store, async () => {
          calls++;
          assert.equal(saved.communication_evidence.at(-1)?.status, "send_attempted");
          assert.ok(saved.audit_logs.includes("QUOTE_EMAIL_SEND_ATTEMPTED"));
          return { success: true, mode: "live-smtp", messageId: "synthetic-id" };
        }, { idempotencyKey: "fixture-reservation", checkpointWrite: req.checkpointWrite });
        res.json(result);
      } catch (err) {
        req.persistOnFailure = err.saveSendOutcome === true;
        res.status(err.status || 500).json({ code: err.code });
      }
    });
    app.use((_err, _req, res, _next) => res.status(500).json({ code: "FIXTURE_COMMIT_FAILED" }));

    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });
    try {
      const post = () => fetch(`http://127.0.0.1:${server.address().port}/send`, { method: "POST" });
      const first = await post();
      assert.equal(first.status, 500);
      assert.equal((await first.json()).code, "FIXTURE_COMMIT_FAILED");
      assert.equal(saved.communication_evidence[0].status, "send_attempted");
      const retry = await post();
      assert.equal(retry.status, 409);
      assert.equal((await retry.json()).code, "SEND_OUTCOME_UNRESOLVED");
      assert.equal(calls, 1);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it("never contacts the transport if the reservation checkpoint fails", async () => {
    const transport = acceptingTransport();
    await assert.rejects(send(db, store, transport, {
      checkpointWrite: async () => { throw new Error("simulated reservation failure"); }
    }), { code: "SEND_RESERVATION_UNAVAILABLE" });
    assert.equal(transport.calls.length, 0);
  });

  // ── Acceptance versus delivery ────────────────────────────────────────
  describe("acceptance versus delivery", () => {
    it("records live SMTP success as 'accepted', never 'delivered', and the evidence really persists", async () => {
      const transport = acceptingTransport();
      const result = await send(db, store, transport);

      assert.equal(transport.calls.length, 1);
      assert.equal(result.success, true);
      assert.equal(result.status, "accepted");
      assert.equal(result.mode, "live-smtp");
      assert.equal(result.recipientReceipt, "not_recorded");
      assert.equal(result.replayed, false);

      // Regression: the baseline recorded channel 'direct_smtp', which the audit service rejected,
      // and the service swallowed that error, so no live evidence was ever written.
      assert.equal(rows(db).length, 1);
      const row = rows(db)[0];
      assert.equal(row.status, "accepted");
      assert.equal(row.channel, "direct_smtp");
      assert.equal(row.transport_mode, "live-smtp");
      assert.equal(row.provider_message_id, null, "the ORAC-assigned Message-ID header is not a provider id");
      assert.equal(row.message_id_header, result.messageId);
      assert.ok(row.accepted_at);
      assert.deepEqual(row.status_history.map((h) => h.status), ["send_attempted", "accepted"]);
      assert.deepEqual(actions(store), ["QUOTE_EMAIL_SEND_ATTEMPTED", "QUOTE_EMAIL_SEND_ACCEPTED"]);
      assertNoDeliveredClaim(result, rows(db), store._log);
    });

    it("dry-run transmits nothing, reports dry_run and records status 'dry-run'", async () => {
      process.env.COMMUNICATIONS_DRY_RUN = "true";
      const result = await sendQuotationPdfEmail({ quoteId: "q_1", recipientEmail: PILOT_A, actor: SALES, store, db });
      assert.equal(result.status, "dry_run");
      assert.equal(result.mode, "dry-run");
      assert.match(result.note, /no email was transmitted/i);
      assert.equal(rows(db)[0].status, "dry-run");
      assert.equal(rows(db)[0].channel, "orac_system_dry_run");
      assert.equal(rows(db)[0].accepted_at, null);
      assertNoDeliveredClaim(result, rows(db), store._log);
    });

    it("the public evidence recorder cannot forge send-lifecycle, receipt or 'delivered' statuses", () => {
      for (const status of ["accepted", "send_attempted", "send_uncertain", "send_failed", "receipt_confirmed", "delivered"]) {
        assert.throws(
          () => recordCommunicationEvidence({ entityType: "quote", entityId: "q_1", channel: "other", recordedBy: "u1", status, store, db }),
          (err) => err.status === 400 && /EVIDENCE_STATUS_(RESERVED|NOT_ALLOWED)/.test(err.code),
          status
        );
      }
      assert.equal(rows(db).length, 0);
      // "delivered" is refused even for the system recorder.
      assert.throws(
        () => recordSystemCommunicationEvidence({ entityType: "quote", entityId: "q_1", channel: "other", recordedBy: "u1", status: "delivered", store, db }),
        { code: "EVIDENCE_STATUS_NOT_ALLOWED" }
      );
      // Existing manual-external behaviour is unchanged.
      const manual = recordExternalSend({ businessRecordType: "quote", businessRecordId: "q_1", recipientEmail: PILOT_A, recordedBy: "u1", store, db });
      assert.equal(manual.status, "manual-external");
    });

    it("timeline exposes the real evidence status alongside the unchanged 'recorded' marker", async () => {
      await send(db, store, acceptingTransport());
      const [entry] = getEntityCommunicationTimeline({ entityType: "quote", entityId: "q_1", db });
      assert.equal(entry.status, "recorded");
      assert.equal(entry.evidence_status, "accepted");
    });
  });

  // ── Send failure ──────────────────────────────────────────────────────
  describe("send failure", () => {
    it("a definitive failure records 'send_failed', rethrows, and never claims acceptance", async () => {
      const transport = failingTransport(definitiveFailure());
      await assert.rejects(send(db, store, transport), /SMTP server error \(554\)/);
      assert.equal(rows(db).length, 1);
      assert.equal(rows(db)[0].status, "send_failed");
      assert.equal(rows(db)[0].accepted_at ?? null, null);
      assert.match(rows(db)[0].failure_reason, /554/);
      assert.deepEqual(actions(store), ["QUOTE_EMAIL_SEND_ATTEMPTED", "QUOTE_EMAIL_SEND_FAILED"]);
      assert.equal(db.quotes[0].status, "Draft", "the service never transitions the quote");
    });

    it("a definitive failure allows a plain retry, which succeeds as attempt 2", async () => {
      await assert.rejects(send(db, store, failingTransport(definitiveFailure())));
      const transport = acceptingTransport();
      const result = await send(db, store, transport);
      assert.equal(result.status, "accepted");
      assert.equal(transport.calls.length, 1);
      assert.deepEqual(rows(db).map((r) => [r.status, r.attempt_number]), [["send_failed", 1], ["accepted", 2]]);
    });

    it("real transport: SMTP not configured is a definitive failure (nothing left the process)", async () => {
      delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
      await assert.rejects(
        sendQuotationPdfEmail({ quoteId: "q_1", recipientEmail: PILOT_A, actor: SALES, store, db, checkpointWrite: async () => db }),
        { status: 503, code: "SMTP_UNCONFIGURED" }
      );
      assert.equal(rows(db)[0].status, "send_failed");
    });

    it("real transport: connection refused is a definitive failure, not 'uncertain'", async () => {
      const probe = net.createServer();
      await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const closedPort = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      Object.assign(process.env, {
        SMTP_HOST: "127.0.0.1", SMTP_PORT: String(closedPort), SMTP_SECURE: "false",
        SMTP_USER: "u", SMTP_PASS: "not-a-real-password", SMTP_FROM: "pilot@example.test"
      });
      await assert.rejects(sendQuotationPdfEmail({ quoteId: "q_1", recipientEmail: PILOT_A, actor: SALES, store, db, checkpointWrite: async () => db }));
      assert.equal(rows(db)[0].status, "send_failed");
    });
  });

  // ── Audit failure ─────────────────────────────────────────────────────
  describe("audit failure", () => {
    it("audit failure AFTER provider acceptance is reported loudly, never as a clean success", async () => {
      const failing = makeStore({ failOn: ["QUOTE_EMAIL_SEND_ACCEPTED"] });
      const transport = acceptingTransport();
      await assert.rejects(send(db, failing, transport), (err) => {
        assert.equal(err.status, 500);
        assert.equal(err.code, "AUDIT_FAILED_AFTER_ACCEPT");
        assert.match(err.message, /WAS accepted/);
        assert.match(err.message, /Do NOT send it again/);
        assert.equal(err.data.accepted, true);
        assert.equal(err.data.traceable, false);
        assert.ok(err.data.evidenceId && err.data.messageId && err.data.pdfSha256);
        return true;
      });
      assert.equal(transport.calls.length, 1);
      // The ledger still shows what really happened, with the gap flagged.
      assert.equal(rows(db)[0].status, "accepted");
      assert.ok(rows(db)[0].audit_gap);
    });

    it("after an audit-gap send, a retry is a replayed error: it never re-sends and never reads as success", async () => {
      const failing = makeStore({ failOn: ["QUOTE_EMAIL_SEND_ACCEPTED"] });
      const transport = acceptingTransport();
      await assert.rejects(send(db, failing, transport), { code: "AUDIT_FAILED_AFTER_ACCEPT" });
      await assert.rejects(send(db, store, transport), { code: "AUDIT_FAILED_AFTER_ACCEPT" });
      assert.equal(transport.calls.length, 1, "SMTP cannot be rolled back, so it must not be repeated");
    });

    it("audit failure BEFORE sending refuses to send and leaves no orphan evidence", async () => {
      const failing = makeStore({ failOn: ["QUOTE_EMAIL_SEND_ATTEMPTED"] });
      const transport = acceptingTransport();
      await assert.rejects(send(db, failing, transport), { status: 503, code: "AUDIT_UNAVAILABLE_NOT_SENT" });
      assert.equal(transport.calls.length, 0);
      assert.equal(rows(db).length, 0);
    });

    it("refuses to send when no audit store is available", async () => {
      const transport = acceptingTransport();
      await assert.rejects(send(db, undefined, transport), { code: "COMMUNICATION_AUDIT_UNAVAILABLE" });
      await assert.rejects(send(db, {}, transport), { code: "COMMUNICATION_AUDIT_UNAVAILABLE" });
      assert.equal(transport.calls.length, 0);
    });

    it("audit failure while recording a failed send does not hide the send error", async () => {
      const failing = makeStore({ failOn: ["QUOTE_EMAIL_SEND_FAILED"] });
      await assert.rejects(send(db, failing, failingTransport(definitiveFailure())), (err) => {
        assert.match(err.message, /SMTP server error/);
        assert.equal(err.auditGap, true);
        return true;
      });
    });
  });

  // ── Allowlist ─────────────────────────────────────────────────────────
  describe("allowlist (fail closed)", () => {
    for (const [label, value] of [["missing", undefined], ["empty", ""], ["blank", "  ,  "], ["wildcard only", "*"]]) {
      it(`refuses every recipient when the allowlist is ${label}, before any evidence or send`, async () => {
        if (value === undefined) delete process.env.CONTROLLED_RECIPIENT_ALLOWLIST;
        else process.env.CONTROLLED_RECIPIENT_ALLOWLIST = value;
        const transport = acceptingTransport();
        await assert.rejects(send(db, store, transport), { status: 403, code: "RECIPIENT_NOT_ALLOWED" });
        assert.equal(transport.calls.length, 0);
        assert.equal(rows(db).length, 0);
        assert.equal(store._log.length, 0);
      });
    }

    it("refuses a recipient outside a non-empty allowlist", async () => {
      const transport = acceptingTransport();
      await assert.rejects(send(db, store, transport, { recipientEmail: OUTSIDER }), { status: 403, code: "RECIPIENT_NOT_ALLOWED" });
      assert.equal(transport.calls.length, 0);
    });

    it("the injected transport cannot widen the allowlist: the service gate runs first", async () => {
      process.env.CONTROLLED_RECIPIENT_ALLOWLIST = PILOT_B;
      const transport = acceptingTransport();
      await assert.rejects(send(db, store, transport, { recipientEmail: PILOT_A }), { code: "RECIPIENT_NOT_ALLOWED" });
      assert.equal(transport.calls.length, 0);
    });
  });

  // ── Role checks ───────────────────────────────────────────────────────
  describe("role checks", () => {
    it("requires the sendQuote permission and an actor", async () => {
      const transport = acceptingTransport();
      await assert.rejects(send(db, store, transport, { actor: TECH }), { status: 403 });
      await assert.rejects(send(db, store, transport, { actor: undefined }), { status: 401, code: "ACTOR_REQUIRED" });
      assert.equal(transport.calls.length, 0);
      assert.equal(rows(db).length, 0);
    });
  });

  // ── Retry / idempotency ───────────────────────────────────────────────
  describe("duplicate and retry behaviour", () => {
    it("an identical repeat of an accepted send is replayed and sends nothing", async () => {
      const transport = acceptingTransport();
      const first = await send(db, store, transport);
      const second = await send(db, store, transport);
      assert.equal(transport.calls.length, 1);
      assert.equal(second.replayed, true);
      assert.equal(second.evidenceId, first.evidenceId);
      assert.equal(second.messageId, first.messageId);
      assert.equal(rows(db).length, 1);
    });

    it("an explicit new idempotency_key is the deliberate way to send the same quote again", async () => {
      const transport = acceptingTransport();
      await send(db, store, transport, { idempotencyKey: "click-0001-aaaa" });
      await send(db, store, transport, { idempotencyKey: "click-0001-aaaa" }); // replay
      await send(db, store, transport, { idempotencyKey: "click-0002-bbbb" }); // deliberate
      assert.equal(transport.calls.length, 2);
      assert.equal(rows(db).length, 2);
    });

    it("the same idempotency_key for a different recipient is not a replay", async () => {
      const transport = acceptingTransport();
      await send(db, store, transport, { idempotencyKey: "shared-key-0001" });
      await send(db, store, transport, { idempotencyKey: "shared-key-0001", recipientEmail: PILOT_B });
      assert.equal(transport.calls.length, 2);
    });

    it("rejects a malformed idempotency_key before doing anything", async () => {
      const transport = acceptingTransport();
      await assert.rejects(send(db, store, transport, { idempotencyKey: "bad key!" }), { status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
      assert.equal(rows(db).length, 0);
    });

    it("an uncertain outcome is recorded as 'send_uncertain' and reported as uncertain, not failed", async () => {
      const transport = failingTransport(uncertainFailure());
      await assert.rejects(send(db, store, transport), (err) => {
        assert.equal(err.status, 502);
        assert.equal(err.code, "SEND_OUTCOME_UNCERTAIN");
        assert.match(err.message, /may or may not have been sent/);
        assert.equal(err.data.status, "send_uncertain");
        return true;
      });
      assert.equal(rows(db)[0].status, "send_uncertain");
      assert.deepEqual(actions(store), ["QUOTE_EMAIL_SEND_ATTEMPTED", "QUOTE_EMAIL_SEND_UNCERTAIN"]);
    });

    it("an untagged error with no HTTP status is treated as uncertain (unknown is not failed)", async () => {
      await assert.rejects(send(db, store, failingTransport(new Error("boom"))), { code: "SEND_OUTCOME_UNCERTAIN" });
      assert.equal(rows(db)[0].status, "send_uncertain");
    });

    it("after an uncertain outcome, any retry is blocked, even with different content or key", async () => {
      await assert.rejects(send(db, store, failingTransport(uncertainFailure())));
      const transport = acceptingTransport();
      for (const overrides of [{}, { subject: "A different subject" }, { idempotencyKey: "brand-new-key-1" }]) {
        await assert.rejects(send(db, store, transport, overrides), (err) => {
          assert.equal(err.status, 409);
          assert.equal(err.code, "SEND_OUTCOME_UNRESOLVED");
          assert.equal(err.data.status, "send_uncertain");
          return true;
        });
      }
      assert.equal(transport.calls.length, 0);
      assert.equal(rows(db).length, 1, "blocked retries write no new evidence");
    });

    it("the block is scoped to the quote and recipient: another recipient is unaffected", async () => {
      await assert.rejects(send(db, store, failingTransport(uncertainFailure())));
      const transport = acceptingTransport();
      const result = await send(db, store, transport, { recipientEmail: PILOT_B });
      assert.equal(result.status, "accepted");
    });

    it("a deliberate re-send needs resend_of plus a written reason, and links the superseded attempt", async () => {
      await assert.rejects(send(db, store, failingTransport(uncertainFailure())));
      const uncertainId = rows(db)[0].id;
      const transport = acceptingTransport();

      await assert.rejects(send(db, store, transport, { resendOf: uncertainId }), { code: "RESEND_REASON_REQUIRED" });
      await assert.rejects(send(db, store, transport, { resendOf: uncertainId, resendReason: "short" }), { code: "RESEND_REASON_REQUIRED" });
      await assert.rejects(send(db, store, transport, { resendOf: "cev_unknown", resendReason: "Checked sent mailbox, not there" }), { code: "RESEND_TARGET_INVALID" });
      assert.equal(transport.calls.length, 0);

      const result = await send(db, store, transport, { resendOf: uncertainId, resendReason: "Checked the sent mailbox: no copy was sent" });
      assert.equal(result.status, "accepted");
      assert.equal(transport.calls.length, 1);
      assert.equal(rows(db).length, 2);
      assert.equal(rows(db)[0].status, "send_uncertain", "history is append-only: the old row is not rewritten");
      assert.equal(rows(db)[1].supersedes, uncertainId);
      assert.match(rows(db)[1].resend_reason, /sent mailbox/);
    });

    it("resend_of cannot be used to duplicate an already-accepted send", async () => {
      const transport = acceptingTransport();
      const first = await send(db, store, transport);
      await assert.rejects(
        send(db, store, transport, { idempotencyKey: "second-click-01", resendOf: first.evidenceId, resendReason: "I want to send it again" }),
        { code: "RESEND_TARGET_INVALID" }
      );
      assert.equal(transport.calls.length, 1);
    });

    it("an interrupted attempt left in 'send_attempted' (e.g. a crash) blocks like an uncertain one", async () => {
      recordSystemCommunicationEvidence({
        entityType: "quote", entityId: "q_1", channel: "direct_smtp", recipientEmail: PILOT_A, recordedBy: "usr_sales_1",
        status: "send_attempted", transportMode: "live-smtp", sentAt: null, store, db,
        extra: { send_kind: "quotation_pdf", attempt_number: 1, idempotency_key_hash: "x" }
      });
      const transport = acceptingTransport();
      await assert.rejects(send(db, store, transport), { status: 409, code: "SEND_OUTCOME_UNRESOLVED" });
      assert.equal(transport.calls.length, 0);
    });

    it("two concurrent identical requests send exactly once", async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const calls = [];
      const slow = async (message) => {
        calls.push(message);
        await gate;
        return { success: true, mode: "live-smtp", messageId: "<slow@orac.system>", timestamp: new Date().toISOString() };
      };
      const first = send(db, store, slow);
      const second = send(db, store, slow);
      await assert.rejects(second, (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "SEND_IN_PROGRESS");
        return true;
      });
      release();
      const result = await first;
      assert.equal(result.status, "accepted");
      assert.equal(calls.length, 1);
      assert.equal(rows(db).length, 1);
    });

    it("dry-run never blocks and never replays", async () => {
      process.env.COMMUNICATIONS_DRY_RUN = "true";
      const a = await sendQuotationPdfEmail({ quoteId: "q_1", recipientEmail: PILOT_A, actor: SALES, store, db });
      const b = await sendQuotationPdfEmail({ quoteId: "q_1", recipientEmail: PILOT_A, actor: SALES, store, db });
      assert.equal(a.replayed, false);
      assert.equal(b.replayed, false);
      assert.equal(rows(db).length, 2);
    });
  });

  // ── Receipt evidence ──────────────────────────────────────────────────
  describe("recipient receipt is separate, human-recorded evidence", () => {
    async function acceptedSend() {
      const result = await send(db, store, acceptingTransport());
      return rows(db).find((r) => r.id === result.evidenceId);
    }
    const confirm = (overrides) => confirmQuotationReceipt({
      quoteId: "q_1", method: "recipient_reply_email", note: "Reply received from the buyer",
      actor: SALES, store, db, ...overrides
    });

    it("SMTP acceptance alone never produces receipt evidence", async () => {
      await acceptedSend();
      assert.equal(rows(db).filter((r) => r.status === "receipt_confirmed").length, 0);
      assert.equal(rows(db)[0].receipt_method ?? null, null);
    });

    it("records who, when and how receipt was known as a separate linked row; the send row stays 'accepted'", async () => {
      const sendRow = await acceptedSend();
      const reportedAt = new Date(Date.parse(sendRow.accepted_at) + 1).toISOString();
      const result = confirm({ evidenceId: sendRow.id, receivedAt: reportedAt });

      assert.equal(result.status, "receipt_confirmed");
      const receipt = rows(db).find((r) => r.id === result.evidenceId);
      assert.equal(receipt.status, "receipt_confirmed");
      assert.equal(receipt.related_evidence_id, sendRow.id);
      assert.equal(receipt.confirmed_by, "usr_sales_1");
      assert.ok(receipt.confirmed_at);
      assert.equal(receipt.receipt_method, "recipient_reply_email");
      assert.equal(receipt.receipt_reported_at, reportedAt);
      assert.equal(receipt.transport_mode, "human-recorded");
      assert.equal(receipt.recipient_email, PILOT_A);
      assert.match(receipt.notes, /Reply received from the buyer/);
      assert.equal(sendRow.status, "accepted", "the truthful acceptance record is untouched");
      assert.ok(actions(store).includes("QUOTE_EMAIL_RECEIPT_CONFIRMED"));
      assertNoDeliveredClaim(rows(db), store._log);
    });

    it("receipt without a reported time uses the server time and leaves received_at empty", async () => {
      const sendRow = await acceptedSend();
      const result = confirm({ evidenceId: sendRow.id, method: "phone_call", note: "" });
      assert.equal(result.receivedAt, null);
      assert.ok(result.confirmedAt);
    });

    it("only one receipt per send: a second confirmation is refused, not duplicated", async () => {
      const sendRow = await acceptedSend();
      const first = confirm({ evidenceId: sendRow.id });
      assert.throws(() => confirm({ evidenceId: sendRow.id, actor: ADMIN }), (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "RECEIPT_ALREADY_RECORDED");
        assert.equal(err.data.evidenceId, first.evidenceId);
        return true;
      });
      assert.equal(rows(db).filter((r) => r.status === "receipt_confirmed").length, 1);
    });

    it("refuses receipt for dry-run, failed and uncertain sends", async () => {
      process.env.COMMUNICATIONS_DRY_RUN = "true";
      const dry = await sendQuotationPdfEmail({ quoteId: "q_1", recipientEmail: PILOT_A, actor: SALES, store, db });
      process.env.COMMUNICATIONS_DRY_RUN = "false";
      await assert.rejects(send(db, store, failingTransport(definitiveFailure()), { recipientEmail: PILOT_B }));
      await assert.rejects(send(db, store, failingTransport(uncertainFailure()), { recipientEmail: PILOT_B }));
      for (const row of rows(db)) {
        assert.throws(() => confirm({ evidenceId: row.id }), { status: 409, code: "RECEIPT_REQUIRES_ACCEPTED_SEND" });
      }
      assert.ok(dry.evidenceId);
      assert.equal(rows(db).filter((r) => r.status === "receipt_confirmed").length, 0);
    });

    it("validates method, note, evidence id, quote match and timestamps", async () => {
      const sendRow = await acceptedSend();
      assert.throws(() => confirm({ evidenceId: sendRow.id, method: "telepathy" }), { code: "RECEIPT_METHOD_INVALID" });
      assert.throws(() => confirm({ evidenceId: sendRow.id, method: undefined }), { code: "RECEIPT_METHOD_INVALID" });
      assert.throws(() => confirm({ evidenceId: sendRow.id, method: "other", note: "" }), { code: "RECEIPT_NOTE_REQUIRED" });
      assert.throws(() => confirm({ evidenceId: sendRow.id, note: "x".repeat(501) }), { status: 400 });
      assert.throws(() => confirm({ evidenceId: "cev_unknown" }), { status: 404, code: "SEND_EVIDENCE_NOT_FOUND" });
      assert.throws(() => confirm({ evidenceId: sendRow.id, quoteId: "q_other" }), { status: 404 });
      assert.throws(() => confirm({ evidenceId: sendRow.id, receivedAt: "not-a-date" }), { code: "RECEIVED_AT_INVALID" });
      assert.throws(() => confirm({ evidenceId: sendRow.id, receivedAt: new Date(Date.now() + 3600e3).toISOString() }), { code: "RECEIVED_AT_INVALID" });
      assert.throws(() => confirm({ evidenceId: sendRow.id, receivedAt: new Date(Date.parse(sendRow.accepted_at) - 3600e3).toISOString() }), { code: "RECEIVED_AT_INVALID" });
      assert.equal(rows(db).filter((r) => r.status === "receipt_confirmed").length, 0);
    });

    it("requires the sendQuote permission and an actor", async () => {
      const sendRow = await acceptedSend();
      assert.throws(() => confirm({ evidenceId: sendRow.id, actor: TECH }), { status: 403 });
      assert.throws(() => confirm({ evidenceId: sendRow.id, actor: undefined }), { status: 401 });
    });

    it("a receipt audit failure rolls the row back and is safe to retry", async () => {
      const sendRow = await acceptedSend();
      const failing = makeStore({ failOn: ["QUOTE_EMAIL_RECEIPT_CONFIRMED"] });
      assert.throws(() => confirm({ evidenceId: sendRow.id, store: failing }), { status: 500, code: "COMMUNICATION_AUDIT_FAILED" });
      assert.equal(rows(db).filter((r) => r.status === "receipt_confirmed").length, 0);
      assert.equal(confirm({ evidenceId: sendRow.id }).status, "receipt_confirmed");
    });
  });

  // ── Redacted audit data ───────────────────────────────────────────────
  describe("redacted audit data", () => {
    it("never stores the SMTP password, bearer tokens, labelled secrets or PDF bytes in evidence or audit", async () => {
      const smtpPassword = "Sup3rS3cretPw!";
      process.env.SMTP_PASS = smtpPassword;
      const providerError = definitiveFailure(`535 auth failed password=${smtpPassword} echoed ${smtpPassword} Bearer abc.def.ghi token=tok_12345`);
      let thrown;
      await send(db, store, failingTransport(providerError), { subject: "Quote token=tok_in_subject_999" }).catch((e) => { thrown = e; });

      const everything = JSON.stringify({ evidence: rows(db), audit: store._log });
      for (const secret of [smtpPassword, "abc.def.ghi", "tok_12345", "tok_in_subject_999"]) {
        assert.ok(!everything.includes(secret), `leaked: ${secret}`);
      }
      assert.ok(everything.includes("[REDACTED]"));
      assert.ok(!thrown.message.includes(smtpPassword), "the API-facing error message is redacted too");
      assert.ok(!everything.includes("JVBERi"), "no base64 PDF bytes in the ledger");
      assert.ok(!everything.includes("%PDF"), "no raw PDF bytes in the ledger");
      assert.ok(!everything.includes("Please find attached"), "the email body is not stored");
    });

    it("audit events carry status and ids only, not recipient addresses or bodies", async () => {
      await send(db, store, acceptingTransport());
      const auditJson = JSON.stringify(store._log);
      assert.ok(!auditJson.includes(PILOT_A));
      assert.ok(!auditJson.includes("Please find attached"));
    });

    it("bounds failure_reason length", async () => {
      await assert.rejects(send(db, store, failingTransport(definitiveFailure("x".repeat(5000)))));
      assert.ok(rows(db)[0].failure_reason.length <= 300);
    });
  });
});
