import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { roles } from "../src/permissions.js";
import communicationsRouter, {
  sendQuotationPdfHandler,
  confirmQuotationReceiptHandler
} from "../src/modules/communications/routes.js";
import { sendQuotationPdfEmail } from "../src/services/quotationEmailService.js";

const PILOT_A = "pilot-a@example.test";
const SALES_1 = { id: "usr_sales_1", role: roles.SALES, is_active: true };
const ADMIN = { id: "usr_admin_1", role: roles.ADMIN, is_active: true };
const TECH = { id: "usr_tech_1", role: roles.TECHNICIAN, is_active: true };

function makeDb() {
  const quote = (id, owner) => ({ id, quote_number: `QT-${id}`, client_id: "cli_1", status: "Draft", sales_owner_id: owner, total_amount: 100, created_at: new Date().toISOString() });
  return {
    // The real getActor() re-loads req.user from db.users on every request.
    // Keep this route fixture honest: it must seed the authenticated accounts
    // instead of assuming a token claim alone is a valid actor.
    users: [structuredClone(SALES_1), structuredClone(ADMIN), structuredClone(TECH)],
    quotes: [quote("q_own", "usr_sales_1"), quote("q_other", "usr_sales_2")],
    clients: [{ id: "cli_1", name: "Test Client" }],
    quote_lines: [], equipment_tags: [], company_profile: {}, communication_evidence: []
  };
}
function makeStore() {
  const log = [];
  return { _log: log, audit: (_db, actor, _c, id, action) => { log.push({ actor: actor?.id, id, action }); } };
}
const makeRes = () => ({ _status: null, _json: null, status(c) { this._status = c; return this; }, json(b) { this._json = b; return this; } });
const makeReq = (user, body, db, store, headers = {}) => ({ user, body, db, store, headers });

describe("quotation email routes: scope, errors and receipt endpoint", () => {
  const originalEnv = { ...process.env };
  let db, store;
  beforeEach(() => {
    process.env = { ...originalEnv, COMMUNICATIONS_DRY_RUN: "true", CONTROLLED_RECIPIENT_ALLOWLIST: PILOT_A };
    db = makeDb(); store = makeStore();
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  const post = async (handler, user, body, headers) => {
    const res = makeRes();
    await handler(makeReq(user, body, db, store, headers), res);
    return res;
  };
  const sendBody = (quote_id, extra = {}) => ({ quote_id, recipient_email: PILOT_A, ...extra });

  describe("Sales portfolio scope", () => {
    it("Sales can send a quote in its own portfolio", async () => {
      const res = await post(sendQuotationPdfHandler, SALES_1, sendBody("q_own"));
      assert.equal(res._status, 200);
      assert.equal(res._json.data.status, "dry_run");
      assert.equal(db.communication_evidence.length, 1);
    });

    it("Sales is refused for a quote outside its portfolio, with no evidence and no audit", async () => {
      const res = await post(sendQuotationPdfHandler, SALES_1, sendBody("q_other"));
      assert.equal(res._status, 403);
      assert.equal(res._json.code, "QUOTE_SCOPE_DENIED");
      assert.equal(db.communication_evidence.length, 0);
      assert.equal(store._log.length, 0);
    });

    it("a missing quote is indistinguishable from an out-of-portfolio quote (no existence oracle)", async () => {
      const missing = await post(sendQuotationPdfHandler, SALES_1, sendBody("q_nope"));
      const other = await post(sendQuotationPdfHandler, SALES_1, sendBody("q_other"));
      assert.equal(missing._status, 403);
      assert.deepEqual(missing._json, other._json);
    });

    it("cannot smuggle another quote past the generic guard by also naming an own record", async () => {
      // guardCommunication keys on business_record_*/entity_*; the handler must check quote_id itself.
      const res = await post(sendQuotationPdfHandler, SALES_1, sendBody("q_other", { business_record_type: "quote", business_record_id: "q_own", entity_type: "quote", entity_id: "q_own" }));
      assert.equal(res._status, 403);
      assert.equal(db.communication_evidence.length, 0);
    });

    it("Admin is not portfolio-limited", async () => {
      const res = await post(sendQuotationPdfHandler, ADMIN, sendBody("q_other"));
      assert.equal(res._status, 200);
    });

    it("a role without sendQuote is refused by the service even if the router guard were bypassed", async () => {
      const res = await post(sendQuotationPdfHandler, TECH, sendBody("q_own"));
      assert.equal(res._status, 403);
      assert.equal(db.communication_evidence.length, 0);
    });

    it("receipt endpoint enforces the same Sales scope and records nothing when refused", async () => {
      const sent = await post(sendQuotationPdfHandler, ADMIN, sendBody("q_other"));
      const res = await post(confirmQuotationReceiptHandler, SALES_1, { quote_id: "q_other", evidence_id: sent._json.data.evidenceId, method: "phone_call" });
      assert.equal(res._status, 403);
      assert.equal(res._json.code, "QUOTE_SCOPE_DENIED");
      assert.equal(db.communication_evidence.filter((e) => e.status === "receipt_confirmed").length, 0);
    });
  });

  describe("error mapping", () => {
    it("refuses an unlisted recipient with code and 403, before any evidence", async () => {
      const res = await post(sendQuotationPdfHandler, ADMIN, { quote_id: "q_own", recipient_email: "outsider@example.test" });
      assert.equal(res._status, 403);
      assert.equal(res._json.code, "RECIPIENT_NOT_ALLOWED");
      assert.equal(db.communication_evidence.length, 0);
    });

    it("rejects a malformed Idempotency-Key header and accepts the body field over it", async () => {
      const bad = await post(sendQuotationPdfHandler, ADMIN, sendBody("q_own"), { "idempotency-key": "bad key!" });
      assert.equal(bad._status, 400);
      assert.equal(bad._json.code, "INVALID_IDEMPOTENCY_KEY");
      const ok = await post(sendQuotationPdfHandler, ADMIN, sendBody("q_own", { idempotency_key: "body-key-0001" }), { "idempotency-key": "bad key!" });
      assert.equal(ok._status, 200);
    });

    it("passes structured error data through (receipt refused for a dry-run send)", async () => {
      const sent = await post(sendQuotationPdfHandler, ADMIN, sendBody("q_own"));
      const res = await post(confirmQuotationReceiptHandler, ADMIN, { quote_id: "q_own", evidence_id: sent._json.data.evidenceId, method: "phone_call" });
      assert.equal(res._status, 409);
      assert.equal(res._json.code, "RECEIPT_REQUIRES_ACCEPTED_SEND");
      assert.equal(res._json.data.evidenceId, sent._json.data.evidenceId);
    });
  });

  describe("receipt endpoint", () => {
    it("returns 201 with who/when/how for an accepted live send, and 409 on a repeat", async () => {
      process.env.COMMUNICATIONS_DRY_RUN = "false";
      const sent = await sendQuotationPdfEmail({
        quoteId: "q_own", recipientEmail: PILOT_A, actor: SALES_1, store, db,
        deps: { sendEmail: async () => ({ success: true, mode: "live-smtp", messageId: "<m@orac.system>", timestamp: new Date().toISOString() }) }
      });
      const body = { quote_id: "q_own", evidence_id: sent.evidenceId, method: "in_person", note: "Buyer confirmed at site meeting" };
      const first = await post(confirmQuotationReceiptHandler, SALES_1, body);
      assert.equal(first._status, 201);
      assert.equal(first._json.data.status, "receipt_confirmed");
      assert.equal(first._json.data.confirmedBy, "usr_sales_1");
      assert.ok(first._json.data.confirmedAt);
      assert.equal(first._json.data.method, "in_person");
      const second = await post(confirmQuotationReceiptHandler, SALES_1, body);
      assert.equal(second._status, 409);
      assert.equal(second._json.code, "RECEIPT_ALREADY_RECORDED");
    });
  });

  it("registers both routes behind guardCommunication (skipped where Router exposes no stack)", { skip: !Array.isArray(communicationsRouter.stack) }, () => {
    const layer = (path) => communicationsRouter.stack.find((l) => l.route?.path === path);
    for (const [path, handler] of [
      ["/communications/send-quotation-pdf", "sendQuotationPdfHandler"],
      ["/communications/quotation-pdf-receipt", "confirmQuotationReceiptHandler"]
    ]) {
      const names = layer(path).route.stack.map((l) => l.handle.name);
      assert.deepEqual(names, ["guardCommunication", handler]);
    }
  });
});
