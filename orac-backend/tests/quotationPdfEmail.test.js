import { test, describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import express from "express";
import { roles } from "../src/permissions.js";
import {
  buildQuotePdfModel,
  generateQuotePdfBuffer,
  sendQuotationPdfEmail
} from "../src/services/quotationEmailService.js";
import communicationsRouter from "../src/modules/communications/routes.js";

describe("Scoped Quotation PDF Email Action", () => {
  let db;
  let auditLogs;
  let mockStore;

  beforeEach(() => {
    process.env.COMMUNICATIONS_DRY_RUN = "true";
    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "lupaobrian98@gmail.com,brianwabwile79@gmail.com,lupaob1@gmail.com";

    auditLogs = [];
    mockStore = {
      audit(storeDb, actor, entity, entityId, action, meta) {
        auditLogs.push({ actor, entity, entityId, action, meta });
      }
    };

    db = {
      users: [
        { id: "usr_sales_1", name: "Sales Person", role: roles.SALES, is_active: true },
        { id: "usr_tech_1", name: "Technician", role: roles.TECHNICIAN, is_active: true },
        { id: "usr_admin_1", name: "Admin", role: roles.ADMIN, is_active: true }
      ],
      quotes: [
        {
          id: "q_test_101",
          quote_number: "QT-2026-101",
          client_id: "cli_freda",
          status: "Draft",
          sales_owner_id: "usr_sales_1",
          total_amount: 1500,
          created_at: new Date().toISOString()
        }
      ],
      clients: [
        {
          id: "cli_freda",
          name: "Freda Rebecca Gold Mine",
          email: "lupaob1@gmail.com"
        }
      ],
      quote_lines: [
        {
          id: "ql_1",
          quotation_id: "q_test_101",
          cost_type: "labour",
          description: "Field Overhaul Engineering",
          quantity: 10,
          unit_price: 100,
          line_total: 1000
        },
        {
          id: "ql_2",
          quotation_id: "q_test_101",
          cost_type: "material",
          description: "High-Tensile Conveyor Splice Kit",
          quantity: 2,
          unit_price: 250,
          line_total: 500
        }
      ],
      equipment_tags: [],
      company_profile: {
        company_name: "Orac Systems",
        legal_name: "Handon Enterprises (Pvt) Ltd"
      },
      communication_evidence: [],
      audit_logs: []
    };
  });

  it("buildQuotePdfModel builds valid quotation document model", () => {
    const model = buildQuotePdfModel(db, "q_test_101");
    assert.ok(model);
    assert.equal(model.documentType, "QUOTATION");
    assert.equal(model.documentNumber, "QT-2026-101");
    assert.equal(model.sections.length >= 3, true);
  });

  it("generateQuotePdfBuffer generates valid controlled PDF buffer starting with %PDF-", () => {
    const pdf = generateQuotePdfBuffer(db, "q_test_101");
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 500);
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
  });

  it("sendQuotationPdfEmail strictly refuses unpermitted recipient with 403", async () => {
    const actor = { id: "usr_sales_1", role: roles.SALES, is_active: true };
    await assert.rejects(
      async () => {
        await sendQuotationPdfEmail({
          quoteId: "q_test_101",
          recipientEmail: "hacker@unpermitted.test",
          actor,
          store: mockStore,
          db
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "RECIPIENT_NOT_ALLOWED");
        return true;
      }
    );
  });

  it("permits all three approved allowlist addresses and refuses an unlisted address", async () => {
    process.env.COMMUNICATIONS_DRY_RUN = "true";
    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "lupaobrian98@gmail.com,brianwabwile79@gmail.com,lupaob1@gmail.com";
    const actor = { id: "usr_sales_1", role: roles.SALES, is_active: true };

    const approvedRecipients = [
      "lupaobrian98@gmail.com",
      "brianwabwile79@gmail.com",
      "lupaob1@gmail.com"
    ];

    for (const recipient of approvedRecipients) {
      const result = await sendQuotationPdfEmail({
        quoteId: "q_test_101",
        recipientEmail: recipient,
        recipientName: "Approved Tester",
        actor,
        store: mockStore,
        db
      });
      assert.equal(result.success, true);
      assert.equal(result.recipientEmail, recipient);
      assert.ok(result.pdfSha256);
    }

    // Unlisted address must be refused
    await assert.rejects(
      async () => {
        await sendQuotationPdfEmail({
          quoteId: "q_test_101",
          recipientEmail: "unlisted@outside-allowlist.test",
          actor,
          store: mockStore,
          db
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "RECIPIENT_NOT_ALLOWED");
        return true;
      }
    );
  });

  it("sendQuotationPdfEmail strictly requires sendQuote permission", async () => {
    const actor = { id: "usr_tech_1", role: roles.TECHNICIAN, is_active: true };
    await assert.rejects(
      async () => {
        await sendQuotationPdfEmail({
          quoteId: "q_test_101",
          recipientEmail: "lupaob1@gmail.com",
          actor,
          store: mockStore,
          db
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it("sendQuotationPdfEmail in dry-run mode returns safe result and records communication evidence", async () => {
    process.env.COMMUNICATIONS_DRY_RUN = "true";
    const actor = { id: "usr_sales_1", role: roles.SALES, is_active: true };

    const result = await sendQuotationPdfEmail({
      quoteId: "q_test_101",
      recipientEmail: "lupaob1@gmail.com",
      recipientName: "Freda Rebecca",
      actor,
      store: mockStore,
      db
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.quoteNumber, "QT-2026-101");
    assert.equal(result.recipientEmail, "lupaob1@gmail.com");
    assert.equal(result.pdfFilename, "Quotation-QT-2026-101.pdf");
    assert.ok(result.pdfSha256 && result.pdfSha256.length === 64);

    // Verify durable evidence recorded
    const evidence = db.communication_evidence[0];
    assert.ok(evidence);
    assert.equal(evidence.business_record_type, "quote");
    assert.equal(evidence.business_record_id, "q_test_101");
    assert.equal(evidence.recipient_email, "lupaob1@gmail.com");
    assert.ok(evidence.notes.includes(result.pdfSha256.slice(0, 16)));
  });

  it("POST /api/communications/send-quotation-pdf endpoint enforces role and dispatches quotation email", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const userId = req.headers["x-user-id"] || "usr_sales_1";
      const user = db.users.find(u => u.id === userId) || { id: userId, role: req.headers["x-test-role"] || roles.SALES, is_active: true };
      req.user = user;
      req.db = db;
      req.store = mockStore;
      next();
    });
    app.use("/api", communicationsRouter);

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const port = server.address().port;

    try {
      // 1. Forbidden role (technician)
      const resForbidden = await fetch(`http://127.0.0.1:${port}/api/communications/send-quotation-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": roles.TECHNICIAN, "x-user-id": "usr_tech_1" },
        body: JSON.stringify({
          quote_id: "q_test_101",
          recipient_email: "lupaob1@gmail.com"
        })
      });
      assert.equal(resForbidden.status, 403);

      // 2. Permitted role (Sales)
      const resSales = await fetch(`http://127.0.0.1:${port}/api/communications/send-quotation-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": roles.SALES, "x-user-id": "usr_sales_1" },
        body: JSON.stringify({
          quote_id: "q_test_101",
          recipient_email: "lupaob1@gmail.com",
          recipient_name: "Freda Rebecca"
        })
      });
      assert.equal(resSales.status, 200);
      const json = await resSales.json();
      assert.equal(json.success, true);
      assert.equal(json.data.mode, "dry-run");
      assert.equal(json.data.quoteNumber, "QT-2026-101");
      assert.equal(json.data.pdfFilename, "Quotation-QT-2026-101.pdf");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("POST /api/communications/quotation-pdf-receipt endpoint verifies authenticated Sales success/refusal and 409 duplicate-receipt over HTTP", async () => {
    // Add out-of-scope quote owned by another sales user
    db.quotes.push({
      id: "q_test_out_of_scope",
      quote_number: "QT-2026-999",
      client_id: "cli_freda",
      status: "Draft",
      sales_owner_id: "usr_sales_other",
      total_amount: 500,
      created_at: new Date().toISOString()
    });

    // Seed an accepted live-smtp send evidence record for q_test_101
    const acceptedSendEv = {
      id: "ev_accepted_live_1",
      entity_type: "quote",
      entity_id: "q_test_101",
      send_kind: "quotation_pdf",
      status: "accepted",
      transport_mode: "live-smtp",
      accepted_at: new Date().toISOString(),
      recipient_email: "lupaob1@gmail.com",
      recipient_name: "Freda Rebecca",
      subject: "Quotation QT-2026-101",
      recorded_by: "usr_sales_1",
      sent_at: new Date().toISOString()
    };
    db.communication_evidence.push(acceptedSendEv);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const userId = req.headers["x-user-id"] || "usr_sales_1";
      const user = db.users.find((u) => u.id === userId) || { id: userId, role: req.headers["x-test-role"] || roles.SALES, is_active: true };
      req.user = user;
      req.db = db;
      req.store = mockStore;
      next();
    });
    app.use("/api", communicationsRouter);

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const port = server.address().port;

    try {
      // 1. Refusal: Sales attempts to confirm receipt for out-of-portfolio quote
      const resRefused = await fetch(`http://127.0.0.1:${port}/api/communications/quotation-pdf-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": roles.SALES, "x-user-id": "usr_sales_1" },
        body: JSON.stringify({
          quote_id: "q_test_out_of_scope",
          evidence_id: "ev_accepted_live_1",
          method: "phone_call",
          note: "Phone confirmation by site manager"
        })
      });
      assert.equal(resRefused.status, 403);
      const refusedJson = await resRefused.json();
      assert.equal(refusedJson.code, "QUOTE_SCOPE_DENIED");

      // 2. Success: Authenticated Sales confirms receipt for quote in its own portfolio
      const resSuccess = await fetch(`http://127.0.0.1:${port}/api/communications/quotation-pdf-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": roles.SALES, "x-user-id": "usr_sales_1" },
        body: JSON.stringify({
          quote_id: "q_test_101",
          evidence_id: "ev_accepted_live_1",
          method: "recipient_reply_email",
          note: "Client confirmed via email reply"
        })
      });
      assert.equal(resSuccess.status, 201);
      const successJson = await resSuccess.json();
      assert.equal(successJson.success, true);
      assert.equal(successJson.data.status, "receipt_confirmed");
      assert.equal(successJson.data.sendEvidenceId, "ev_accepted_live_1");
      assert.equal(successJson.data.method, "recipient_reply_email");

      // 3. Duplicate path: Repeating receipt confirmation for same send returns 409 Conflict
      const resDuplicate = await fetch(`http://127.0.0.1:${port}/api/communications/quotation-pdf-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": roles.SALES, "x-user-id": "usr_sales_1" },
        body: JSON.stringify({
          quote_id: "q_test_101",
          evidence_id: "ev_accepted_live_1",
          method: "recipient_reply_email",
          note: "Duplicate receipt confirmation attempt"
        })
      });
      assert.equal(resDuplicate.status, 409);
      const dupJson = await resDuplicate.json();
      assert.equal(dupJson.code, "RECEIPT_ALREADY_RECORDED");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
