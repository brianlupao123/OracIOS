// backend/tests/pilotOperationalWorkflowPostgres.test.js
//
// ORAC Operational Parallel Pilot (PILOT-20261120)
// Complete real workflow executed through HTTP endpoints backed by real PostgreSQL:
//   1. Quote creation (Sales)
//   2. Quotation email preview, queue, and safe dispatch (controlled allowlist)
//   3. Client Purchase Requisition (PR) logging
//   4. Verified Client PO capture and mathematical validation
//   5. Field Dispatch transition, supervisor assignment, roster allocation
//   6. Field worksheet creation, client acknowledgement, and supervisor approval
//   7. Billable timesheet and material usage linked to approved worksheet
//   8. Invoice readiness validation (zero variances, all gates clear)
//   9. Two-person maker-checker legacy invoice draft preparation and issuance
//  10. Review-only Pastel export generation (# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED])
//  11. Invoice settlement recording and sales portfolio access verification
//  12. Reconnection proof: all entities and durable audit records persist across a fresh connection

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { describe } from "node:test";
import express from "express";
import pg from "pg";

import apiRouter from "../src/router.js";
import { persistenceMiddleware } from "../src/persistenceMiddleware.js";
import { createStore } from "../src/postgresStore.js";
import { generateToken } from "../src/middleware/auth.js";
import { sslConfig } from "../src/pool.js";
import { createClientPr } from "../src/services/clientPrService.js";

const TEST_DB_URL = process.env.ORAC_TEST_DATABASE_URL;
const skipSuite = TEST_DB_URL ? false : "ORAC_TEST_DATABASE_URL is not set; real PostgreSQL pilot tests skipped.";

function assertDedicatedTestDatabase(url) {
  assert.ok(url, "ORAC_TEST_DATABASE_URL must be set to run PostgreSQL pilot tests");
  const parsed = new URL(url);
  assert.match(
    parsed.pathname.slice(1),
    /test/i,
    "Refusing connection: target database name must contain 'test'"
  );
}

function createPilotDatabase() {
  const now = new Date().toISOString();
  return {
    company_profile: {
      company_name: "ORAC Industrial Services (Pvt) Ltd",
      tax_status: "provisional",
      currency: "USD",
      bank_name: "Stanbic Bank Zimbabwe",
      bank_account: "9140001234567",
      bank_branch: "Minerva Branch, Harare",
      quotation_tax_configuration: {
        tax_status: "provisional",
        applied_tax_rate: 0.15,
        approved: false,
        approval_reference: null
      }
    },
    users: [
      {
        id: "usr_pilot_admin",
        name: "Brian Lupao (Admin)",
        email: "Lupaobrian98@gmail.com",
        role: "Admin",
        is_active: true
      },
      {
        id: "usr_pilot_sales",
        name: "Brian Wabwile (Sales)",
        email: "brianwabwile79@gmail.com",
        role: "Sales",
        is_active: true
      },
      {
        id: "usr_pilot_client",
        name: "Pilot Client Viewer",
        email: "lupaob1@gmail.com",
        role: "Client Viewer",
        client_id: "cli_pilot_01",
        is_active: true
      },
      {
        id: "usr_pilot_fin1",
        name: "Finance Maker One",
        email: "fin1@pilot.invalid",
        role: "Finance",
        is_active: true
      },
      {
        id: "usr_pilot_fin2",
        name: "Finance Checker Two",
        email: "fin2@pilot.invalid",
        role: "Finance",
        is_active: true
      },
      {
        id: "usr_pilot_sup",
        name: "Field Supervisor",
        email: "sup@pilot.invalid",
        role: "Supervisor",
        is_active: true
      },
      {
        id: "usr_pilot_tech",
        name: "Field Artisan",
        email: "tech@pilot.invalid",
        role: "Technician",
        is_active: true
      }
    ],
    clients: [
      {
        id: "cli_pilot_01",
        name: "Freda Rebecca Gold Mine",
        email: "lupaob1@gmail.com",
        contact_email: "lupaob1@gmail.com",
        contact_name: "Mine Procurement",
        currency: "USD",
        payment_terms: "30 days"
      }
    ],
    mine_sites: [
      {
        id: "site_pilot_01",
        client_id: "cli_pilot_01",
        name: "Freda Rebecca Main Site",
        code: "FR-01"
      }
    ],
    plants: [
      {
        id: "plant_pilot_01",
        mine_site_id: "site_pilot_01",
        name: "Carbon-in-Leach Plant"
      }
    ],
    plant_sections: [
      {
        id: "section_pilot_01",
        plant_id: "plant_pilot_01",
        name: "Primary Crushing"
      }
    ],
    equipment_tags: [
      {
        id: "tag_pilot_01",
        client_id: "cli_pilot_01",
        plant_section_id: "section_pilot_01",
        tag_code: "TAG-PILOT-01",
        description: "Primary Jaw Crusher Feed Conveyor"
      }
    ],
    inventory: [
      {
        id: "inv_pilot_01",
        item_code: "STK-PILOT-01",
        name: "Heavy Duty Conveyor Belt 50m",
        quantity_on_hand: 20,
        unit_cost: 350
      }
    ],
    quotes: [],
    quote_lines: [],
    purchase_orders: [],
    client_prs: [],
    dispatch_cards: [],
    field_worksheets: [],
    timesheets: [],
    material_usage: [],
    invoices: [],
    invoice_lines: [],
    legacy_invoice_drafts: [],
    legacy_invoice_idempotency: [],
    invoice_payments: [],
    invoice_credit_notes: [],
    communication_queue: [],
    communication_evidence: [],
    audit_logs: []
  };
}

function makeServer(pool) {
  const store = createStore(":memory:", pool);
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", persistenceMiddleware(store));
  app.use("/api", apiRouter);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return { app, store };
}

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function request(baseUrl, path, actor, { method = "GET", body, headers = {} } = {}) {
  const token = generateToken(actor);
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await res.json();
    return { status: res.status, headers: res.headers, body: json };
  }
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text };
}

describe("ORAC Operational Parallel Pilot (PILOT-20261120) - Real PostgreSQL Suite", { skip: skipSuite }, () => {
  let pool;
  let serverInstance;
  let baseUrl;
  let store;
  let pilotDb;

  const adminActor = { id: "usr_pilot_admin", role: "Admin", email: "Lupaobrian98@gmail.com" };
  const salesActor = { id: "usr_pilot_sales", role: "Sales", email: "brianwabwile79@gmail.com" };
  const clientActor = { id: "usr_pilot_client", role: "Client Viewer", email: "lupaob1@gmail.com", client_id: "cli_pilot_01" };
  const fin1Actor = { id: "usr_pilot_fin1", role: "Finance", email: "fin1@pilot.invalid" };
  const fin2Actor = { id: "usr_pilot_fin2", role: "Finance", email: "fin2@pilot.invalid" };
  const supActor = { id: "usr_pilot_sup", role: "Supervisor", email: "sup@pilot.invalid" };
  const techActor = { id: "usr_pilot_tech", role: "Technician", email: "tech@pilot.invalid" };

  test("Run complete PILOT-20261120 operational lifecycle against real PostgreSQL", { skip: skipSuite }, async () => {
    assertDedicatedTestDatabase(TEST_DB_URL);

    pool = new pg.Pool({
      connectionString: TEST_DB_URL,
      ssl: sslConfig(TEST_DB_URL),
      max: 5,
      connectionTimeoutMillis: 10000
    });

    // 1. Ensure table and seed PILOT-20261120 dataset into real PostgreSQL
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);

    pilotDb = createPilotDatabase();
    await pool.query(
      `INSERT INTO store (id, data) VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET data = $1;`,
      [JSON.stringify(pilotDb)]
    );

    const node = makeServer(pool);
    store = node.store;
    serverInstance = await startServer(node.app);
    baseUrl = serverInstance.baseUrl;

    try {
      // ═════════════════════════════════════════════════════════════════
      // STEP 1: Quote Creation (Sales creates Quote with lines)
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 1: Quote Creation");
      const quoteRes = await request(baseUrl, "/quotes", salesActor, {
        method: "POST",
        body: {
          client_id: "cli_pilot_01",
          equipment_tag_id: "tag_pilot_01",
          currency: "USD",
          tax_status: "zero-rated",
          applied_tax_rate: 0,
          validity_days: 30,
          description: "Freda Rebecca Primary Conveyor Overhaul",
          lines: [
            {
              item_type: "standard",
              cost_type: "labour",
              description: "Mechanical Artisan Conveyor Overhaul Service",
              quantity: 8,
              unit_price: 50,
              total_price: 400
            },
            {
              item_type: "standard",
              cost_type: "material",
              inventory_item_id: "inv_pilot_01",
              description: "Heavy Duty Conveyor Belt 50m",
              quantity: 1,
              unit_price: 350,
              total_price: 350
            }
          ]
        }
      });

      assert.equal(quoteRes.status, 200, `Quote creation failed: ${JSON.stringify(quoteRes.body)}`);
      const quoteId = quoteRes.body.data.id;
      assert.ok(quoteId, "Quote ID must be returned");
      assert.equal(quoteRes.body.data.status, "Draft");
      assert.equal(quoteRes.body.data.sales_owner_id, "usr_pilot_sales");
      assert.equal(quoteRes.body.data.total_amount, 750);

      // ═════════════════════════════════════════════════════════════════
      // STEP 2: Quotation Email & Transition (Draft → Sent)
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 2: Quotation Email & Transition");
      const sendRes = await request(baseUrl, `/quotes/${quoteId}/transition`, salesActor, {
        method: "POST",
        body: {
          target_state: "Sent",
          channel: "orac_system_dry_run",
          recipient_email: "lupaob1@gmail.com",
          recipient_name: "Freda Rebecca Procurement",
          notes: "[PILOT] Quotation issued to controlled client email"
        }
      });
      assert.equal(sendRes.status, 200, `Send quote failed: ${JSON.stringify(sendRes.body)}`);
      const sentQuote = sendRes.body.data.quote || sendRes.body.data;
      assert.equal(sentQuote.status, "Sent");

      // Queue formal communication email with template
      const queueRes = await request(baseUrl, "/communications/queue", salesActor, {
        method: "POST",
        body: {
          template_name: "quote_sent",
          subject: "Quotation QT-PILOT-01 from ORAC Industrial Services",
          body: "Dear Client,\nPlease find attached our quotation for the conveyor overhaul.",
          recipient_email: "lupaob1@gmail.com",
          recipient_name: "Freda Rebecca Procurement",
          entity_type: "quote",
          entity_id: quoteId,
          auto_queue: true
        }
      });
      assert.equal(queueRes.status, 201, `Queue message failed: ${JSON.stringify(queueRes.body)}`);
      const messageId = queueRes.body.message.id;
      assert.equal(queueRes.body.message.status, "Queued");
      assert.equal(queueRes.body.message.recipient_email, "lupaob1@gmail.com");

      // Dispatch queued message (controlled safe dry-run)
      const dispatchMsgRes = await request(baseUrl, `/communications/queue/${messageId}/dispatch`, salesActor, {
        method: "POST"
      });
      assert.equal(dispatchMsgRes.status, 200, `Dispatch message failed: ${JSON.stringify(dispatchMsgRes.body)}`);
      assert.equal(dispatchMsgRes.body.message.status, "Dispatched");
      assert.equal(dispatchMsgRes.body.message.dry_run, true);

      // Verify Safety Gate: Attempt to queue message for unpermitted recipient is blocked
      const blockedQueueRes = await request(baseUrl, "/communications/queue", salesActor, {
        method: "POST",
        body: {
          subject: "Leak attempt",
          body: "Should be refused",
          recipient_email: "unauthorized_external@competitor.com",
          auto_queue: true
        }
      });
      assert.equal(blockedQueueRes.status, 201);
      const blockedId = blockedQueueRes.body.message.id;
      const blockedDispatchRes = await request(baseUrl, `/communications/queue/${blockedId}/dispatch`, salesActor, {
        method: "POST"
      });
      assert.equal(blockedDispatchRes.status, 403, "Unpermitted recipient must be rejected with 403");
      assert.ok(blockedDispatchRes.body.message.includes("outside the controlled pilot allowlist"));

      // ═════════════════════════════════════════════════════════════════
      // STEP 3: Client Purchase Requisition (PR) Logging
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 3: Client PR Logging");
      const { db: currentDb, release: r1 } = await store.read({ lock: true });
      let prRecord;
      try {
        prRecord = createClientPr({
          quotationId: quoteId,
          clientId: "cli_pilot_01",
          prNumber: "PILOT-PR-20261120",
          description: "Internal mine requisition for conveyor belt replacement",
          receivedBy: "usr_pilot_sales",
          store,
          db: currentDb
        });
        currentDb.client_prs.find((p) => p.id === prRecord.id).status = "Approved";
        await store.write(currentDb, r1);
      } catch (err) {
        if (r1) await store.release(r1);
        throw err;
      }
      assert.ok(prRecord.id.startsWith("pr_"));

      // Commercial approval (Sent → Approved_Pending_PO) by independent reviewer (Admin)
      const approveRes = await request(baseUrl, `/quotes/${quoteId}/transition`, adminActor, {
        method: "POST",
        body: {
          target_state: "Approved_Pending_PO",
          notes: "[PILOT] Independent commercial approval of quotation"
        }
      });
      assert.equal(approveRes.status, 200, `Quote approve failed: ${JSON.stringify(approveRes.body)}`);
      const approvedQuote = approveRes.body.data.quote || approveRes.body.data;
      assert.equal(approvedQuote.status, "Approved_Pending_PO");

      // ═════════════════════════════════════════════════════════════════
      // STEP 4: Verified Client PO Capture (Approved_Pending_PO → PO_Verified)
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 4: Client PO Capture");
      // 4A: Under-value PO attempt is strictly rejected
      const underValRes = await request(baseUrl, `/quotes/${quoteId}/po`, adminActor, {
        method: "POST",
        body: {
          po_reference: "PILOT-PO-UNDER",
          po_amount: 500, // Quote is 750
          po_date: new Date().toISOString().slice(0, 10)
        }
      });
      assert.equal(underValRes.status, 400, "Under-value PO must be rejected");
      assert.ok(underValRes.body.message.includes("PO amount (USD 500.00) is less than quotation grand total (USD 750.00)"));

      // 4B: Exact-value verified PO succeeds
      const poRes = await request(baseUrl, `/quotes/${quoteId}/po`, adminActor, {
        method: "POST",
        body: {
          po_reference: "PILOT-PO-20261120",
          po_amount: 750,
          po_date: new Date().toISOString().slice(0, 10)
        }
      });
      assert.equal(poRes.status, 200, `PO capture failed: ${JSON.stringify(poRes.body)}`);
      const verifiedQuote = poRes.body.quote || poRes.body.data.quote;
      const verifiedPo = poRes.body.data.po || poRes.body.data;
      assert.equal(verifiedQuote.status, "PO_Verified");
      assert.equal(verifiedPo.status, "verified");
      assert.equal(verifiedPo.po_reference, "PILOT-PO-20261120");

      // ═════════════════════════════════════════════════════════════════
      // STEP 5: Dispatch Creation (PO_Verified → Field_Dispatch)
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 5: Dispatch Creation");
      const dispatchRes = await request(baseUrl, `/quotes/${quoteId}/transition`, adminActor, {
        method: "POST",
        body: {
          target_state: "Field_Dispatch",
          mine_site_id: "site_pilot_01",
          plant_id: "plant_pilot_01"
        }
      });
      assert.equal(dispatchRes.status, 200, `Dispatch transition failed: ${JSON.stringify(dispatchRes.body)}`);
      const dispQuote = dispatchRes.body.data.quote || dispatchRes.body.data;
      assert.equal(dispQuote.status, "Field_Dispatch");

      // Retrieve created dispatch card
      const { db: dbAfterDisp } = await store.read({ lock: false });
      const dispatchCard = dbAfterDisp.dispatch_cards.find((d) => d.quotation_id === quoteId);
      assert.ok(dispatchCard, "Dispatch card must be created");
      const dispatchId = dispatchCard.id;

      // Assign Supervisor
      const supAssignRes = await request(baseUrl, `/dispatch_cards/${dispatchId}/supervisor`, adminActor, {
        method: "POST",
        body: { supervisor_id: "usr_pilot_sup" }
      });
      assert.equal(supAssignRes.status, 200);

      // Assign Technician to Roster
      const rosterRes = await request(baseUrl, `/dispatch_cards/${dispatchId}/roster`, adminActor, {
        method: "POST",
        body: { technician_id: "usr_pilot_tech" }
      });
      assert.equal(rosterRes.status, 200);

      // ═════════════════════════════════════════════════════════════════
      // STEP 6: Field Worksheet Creation, Acknowledgement, & Review
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 6: Field Worksheets");
      // 6A: Technician creates worksheet in Draft
      const today = new Date().toISOString().slice(0, 10);
      const wsCreateRes = await request(baseUrl, `/dispatch_cards/${dispatchId}/worksheets`, techActor, {
        method: "POST",
        body: {
          activity: "Mechanical Conveyor Overhaul Service",
          hours: 8,
          work_date: today,
          technician_id: "usr_pilot_tech"
        }
      });
      assert.equal(wsCreateRes.status, 200, `Worksheet creation failed: ${JSON.stringify(wsCreateRes.body)}`);
      const worksheetId = wsCreateRes.body.data.id;
      assert.equal(wsCreateRes.body.data.status, "Draft");

      // 6B: Technician submits worksheet (Draft → Submitted)
      const wsSubmitRes = await request(baseUrl, `/field_worksheets/${worksheetId}/submit`, techActor, {
        method: "POST"
      });
      assert.equal(wsSubmitRes.status, 200, `Worksheet submit failed: ${JSON.stringify(wsSubmitRes.body)}`);
      assert.equal(wsSubmitRes.body.data.status, "Submitted");

      // 6C: Client Viewer acknowledges worksheet (Submitted → Client_Acknowledged)
      const wsAckRes = await request(baseUrl, `/field_worksheets/${worksheetId}/client-acknowledge`, clientActor, {
        method: "POST",
        body: {
          signer_name: "Mine Mechanical Engineer",
          signer_role: "Section Engineer",
          acknowledgement: true
        }
      });
      assert.equal(wsAckRes.status, 200, `Client acknowledgement failed: ${JSON.stringify(wsAckRes.body)}`);
      assert.equal(wsAckRes.body.data.status, "Client_Acknowledged");

      // 6D: Independent Supervisor approves worksheet (Client_Acknowledged → Supervisor_Approved)
      const wsApproveRes = await request(baseUrl, `/field_worksheets/${worksheetId}/review`, supActor, {
        method: "POST",
        body: {
          decision: "approve"
        }
      });
      assert.equal(wsApproveRes.status, 200, `Supervisor review failed: ${JSON.stringify(wsApproveRes.body)}`);
      assert.equal(wsApproveRes.body.data.status, "Supervisor_Approved");

      // ═════════════════════════════════════════════════════════════════
      // STEP 7: Billable Timesheet & Material Usage
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 7: Timesheets & Materials");
      // 7A: Add billable timesheet linked to approved worksheet (8 hrs @ $50 = $400)
      const tsRes = await request(baseUrl, `/dispatch_cards/${dispatchId}/timesheets`, techActor, {
        method: "POST",
        body: {
          source_worksheet_id: worksheetId,
          work_date: today,
          hours_logged: 8,
          hourly_rate: 50,
          notes: "Conveyor overhaul labor completed"
        }
      });
      assert.equal(tsRes.status, 200, `Add timesheet failed: ${JSON.stringify(tsRes.body)}`);

      // 7B: Add material usage (1 conveyor belt @ $350 = $350)
      const matRes = await request(baseUrl, `/dispatch_cards/${dispatchId}/materials`, adminActor, {
        method: "POST",
        body: {
          description: "Heavy Duty Conveyor Belt 50m",
          quantity_used: 1,
          unit_cost: 350
        }
      });
      assert.equal(matRes.status, 200, `Add material failed: ${JSON.stringify(matRes.body)}`);

      // ═════════════════════════════════════════════════════════════════
      // STEP 8: Invoice Readiness Validation
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 8: Invoice Readiness");
      const readinessRes = await request(baseUrl, `/dispatch_cards/${dispatchId}/invoice-readiness`, adminActor);
      assert.equal(readinessRes.status, 200);
      assert.equal(readinessRes.body.data.readiness.ready_for_invoice_review, true, `Invoice readiness not ready: ${JSON.stringify(readinessRes.body)}`);
      assert.equal(readinessRes.body.data.commercial.calculated_invoice.labor_amount, 400);
      assert.equal(readinessRes.body.data.commercial.calculated_invoice.material_amount, 350);
      assert.equal(readinessRes.body.data.commercial.calculated_invoice.total_amount, 750);
      assert.equal(readinessRes.body.data.readiness.blocker, null);

      // ═════════════════════════════════════════════════════════════════
      // STEP 9: Two-Person Maker-Checker Legacy Invoice Draft & Issuance
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 9: Legacy Invoice Draft & Issuance");
      // 9A: Maker (Finance 1) prepares invoice draft
      const draftRes = await request(baseUrl, `/dispatch_cards/${dispatchId}/legacy-invoice-drafts`, fin1Actor, {
        method: "POST",
        body: {
          idempotency_key: "pilot-draft-key-001"
        }
      });
      assert.equal(draftRes.status, 201, `Create invoice draft failed: ${JSON.stringify(draftRes.body)}`);
      const draftId = draftRes.body.data.id;
      assert.equal(draftRes.body.data.status, "prepared");
      assert.equal(draftRes.body.data.candidate.total, 750);

      // 9B: Separation of duties check: Maker cannot issue their own draft
      const selfIssueRes = await request(baseUrl, `/legacy-invoice-drafts/${draftId}/issue`, fin1Actor, {
        method: "POST",
        body: { idempotency_key: "pilot-self-issue" }
      });
      assert.equal(selfIssueRes.status, 403, "Maker must not be permitted to issue own draft");
      assert.equal(selfIssueRes.body.code, "LEGACY_INVOICE_TWO_PERSON_REQUIRED");

      // 9C: Checker (Finance 2) issues invoice draft
      const issueRes = await request(baseUrl, `/legacy-invoice-drafts/${draftId}/issue`, fin2Actor, {
        method: "POST",
        body: {
          idempotency_key: "pilot-issue-key-001"
        }
      });
      assert.equal(issueRes.status, 201, `Issue invoice failed: ${JSON.stringify(issueRes.body)}`);
      const invoice = issueRes.body.data;
      const invoiceId = invoice.id;
      assert.ok(invoiceId, "Invoice must have ID");
      assert.equal(invoice.total_amount, 750);
      assert.equal(invoice.purchase_order_id, (poRes.body.data.po || poRes.body.data).id);

      // ═════════════════════════════════════════════════════════════════
      // STEP 10: Review-Only Pastel Export Verification
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 10: Review-Only Pastel Export");
      const pastelRes = await request(baseUrl, "/exports/pastel.csv", fin1Actor);
      assert.equal(pastelRes.status, 200, "Pastel export failed");
      assert.ok(typeof pastelRes.body === "string");
      assert.ok(
        pastelRes.body.startsWith("# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]"),
        "Pastel CSV must contain explicit non-posting review banner"
      );
      assert.ok(pastelRes.body.includes(invoice.invoice_number), "CSV must include issued invoice number");
      assert.ok(pastelRes.body.includes("Freda Rebecca Gold Mine"), "CSV must include client name");
      assert.ok(pastelRes.body.includes("400"), "CSV must include labour line amount 400");
      assert.ok(pastelRes.body.includes("350"), "CSV must include material line amount 350");

      // ═════════════════════════════════════════════════════════════════
      // STEP 11: Invoice Settlement Recording & Sales Portfolio Visibility
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 11: Settlement & Portfolio Visibility");
      // 11A: Finance records full settlement payment ($750 USD)
      const payRes = await request(baseUrl, `/invoices/${invoiceId}/payments`, fin1Actor, {
        method: "POST",
        headers: { "Idempotency-Key": "d1c0ffee-1111-4111-8111-111111111111" },
        body: {
          amount: 750,
          payment_method: "Bank Transfer",
          reference: "STANBIC-REF-99201",
          received_on: today,
          notes: "Full payment received for conveyor overhaul invoice"
        }
      });
      assert.equal(payRes.status, 201, `Record payment failed: ${JSON.stringify(payRes.body)}`);
      assert.equal(payRes.body.settlement.outstanding_amount, 0);
      assert.equal(payRes.body.settlement.paid_amount, 750);

      // 11B: Finance reads full settlement details (including payment ledger)
      const finSettleRes = await request(baseUrl, `/invoices/${invoiceId}/settlement`, fin1Actor);
      assert.equal(finSettleRes.status, 200);
      assert.equal(finSettleRes.body.data.status, "paid");
      assert.equal(finSettleRes.body.data.settlement.total_amount, 750);
      assert.equal(finSettleRes.body.data.settlement.paid_amount, 750);
      assert.equal(finSettleRes.body.data.settlement.outstanding_amount, 0);
      assert.ok(Array.isArray(finSettleRes.body.data.payments));
      assert.equal(finSettleRes.body.data.payments.length, 1);
      assert.equal(finSettleRes.body.data.payments[0].reference, "STANBIC-REF-99201");

      // 11C: Sales user reads settlement summary with STRICT REDACTION (no payments array)
      const salesSettleRes = await request(baseUrl, `/invoices/${invoiceId}/settlement`, salesActor);
      assert.equal(salesSettleRes.status, 200);
      assert.equal(salesSettleRes.body.data.settlement_status, "paid");
      assert.equal(salesSettleRes.body.data.received_total, 750);
      assert.equal(salesSettleRes.body.data.outstanding_total, 0);
      assert.equal(salesSettleRes.body.data.payments, undefined, "Sales must NEVER receive payments array");

      // ═════════════════════════════════════════════════════════════════
      // STEP 12: Reconnection Proof: Full Audit & Entity Persistence
      // ═════════════════════════════════════════════════════════════════
      console.log("==> [PILOT-20261120] STEP 12: Reconnection Proof");
      // Close server and pool, connect fresh pool to real PostgreSQL
      await serverInstance.close();
      await pool.end();

      const freshPool = new pg.Pool({
        connectionString: TEST_DB_URL,
        ssl: sslConfig(TEST_DB_URL)
      });

      const resql = await freshPool.query("SELECT data FROM store WHERE id = 'main';");
      assert.equal(resql.rows.length, 1);
      const persistedDb = resql.rows[0].data;

      // Verify all entities in PostgreSQL
      const persistedQuote = persistedDb.quotes.find((q) => q.id === quoteId);
      assert.equal(persistedQuote.status, "Invoiced");

      const persistedPo = persistedDb.purchase_orders.find((p) => p.quotation_id === quoteId);
      assert.equal(persistedPo.status, "verified");

      const persistedDispatch = persistedDb.dispatch_cards.find((d) => d.id === dispatchId);
      assert.ok(persistedDispatch);

      const persistedInvoice = persistedDb.invoices.find((i) => i.id === invoiceId);
      assert.equal(persistedInvoice.status, "paid");
      assert.equal(persistedInvoice.total_amount, 750);

      const persistedPayments = persistedDb.invoice_payments.filter((p) => p.invoice_id === invoiceId);
      assert.equal(persistedPayments.length, 1);
      assert.equal(persistedPayments[0].amount, 750);

      // Verify critical audit trails exist in PostgreSQL
      const auditActions = persistedDb.audit_logs.map((a) => a.action);
      assert.ok(auditActions.some((a) => a.startsWith("QUOTE_TRANSITION_")), "Audit must record quote transitions");
      assert.ok(auditActions.includes("PO_VERIFIED"), "Audit must record PO verification");
      assert.ok(auditActions.includes("DISPATCH_SUPERVISOR_ASSIGNED"), "Audit must record supervisor assignment");
      assert.ok(auditActions.includes("WORKSHEET_CLIENT_ACKNOWLEDGED"), "Audit must record client acknowledgement");
      assert.ok(auditActions.includes("WORKSHEET_APPROVED"), "Audit must record supervisor approval");
      assert.ok(auditActions.includes("LEGACY_INVOICE_DRAFT_PREPARED"), "Audit must record draft preparation");
      assert.ok(auditActions.includes("LEGACY_INVOICE_DRAFT_ISSUED"), "Audit must record draft issuance");
      assert.ok(auditActions.includes("PASTEL_EXPORT_GENERATED"), "Audit must record review-only Pastel export");
      assert.ok(auditActions.includes("INVOICE_PAYMENT_RECORDED"), "Audit must record payment settlement");
      assert.ok(auditActions.includes("MESSAGE_DISPATCHED_DRY_RUN"), "Audit must record communication dispatch");

      await freshPool.end();
    } finally {
      if (serverInstance) await serverInstance.close();
      if (pool && !pool.ended) await pool.end();
    }
  });
});
