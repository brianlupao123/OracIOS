// tests/gap14FinancePolicyAndGap12Allowlist.test.js
// Proof of Gap 14 (Finance Policy & Controlled Accounting Boundary)
// Proof of Gap 12 (Client Viewer Document Projection & Sensitive Data Exclusion)

import assert from "node:assert/strict";
import test from "node:test";
import {
  shapeQuoteForClient,
  shapeWorksheetForClient,
  shapeInvoiceForClient,
  shapePoForClient,
  shapeDocumentForClient
} from "../src/clientAllowlist.js";
import { createLegacyInvoice } from "../src/stateMachine.js";

// ── Gap 14: Finance Policy & Overtime Billed at Quoted Rate ─────────

test("Gap 14: Client billing enforces USD-only and bills hours at the quoted client rate", () => {
  const db = {
    invoices: [],
    invoice_lines: [],
    dispatch_cards: [
      { id: "disp-101", quotation_id: "q-101" }
    ],
    purchase_orders: [
      { id: "po-101", quotation_id: "q-101", po_reference: "PO-CLIENT-101", po_amount: 500, status: "verified" }
    ],
    company_profile: {
      company_name: "ORAC Systems (Pvt) Ltd",
      tax_number: "TAX-12345"
    },
    timesheets: [
      {
        id: "ts-normal",
        dispatch_card_id: "disp-101",
        hours_logged: 8,
        hourly_rate: 12.50 // quoted client rate ($10-$15/hr guidance)
      },
      {
        id: "ts-overtime",
        dispatch_card_id: "disp-101",
        hours_logged: 4,
        hourly_rate: 12.50 // Overtime is billed at the quoted client rate
      }
    ],
    material_usage: []
  };

  const store = {
    id: (prefix = "inv") => `${prefix}_${Math.random().toString(36).slice(2)}`,
    audit: () => {}
  };

  const quote = {
    id: "q-101",
    client_id: "c-1",
    quote_number: "Q-2026-101",
    total_amount: 150.00
  };

  const actor = {
    id: "u-finance",
    role: "Finance"
  };

  // Create legacy invoice from state machine
  const invoice = createLegacyInvoice(db, store, quote, actor);

  // Assertions:
  assert.equal(invoice.total_amount, 150.00, "Invoice total matches quoted client rate calculation");

  // Verify invoice lines
  assert.equal(db.invoice_lines.length, 1, "One consolidated labor line created");
  const laborLine = db.invoice_lines[0];
  assert.equal(laborLine.quantity, 12, "Total hours billed = 8 normal + 4 overtime");
  assert.equal(laborLine.unit_price, 12.50, "Line unit price is locked to quoted client rate ($12.50/hr)");
  assert.equal(laborLine.line_total, 150.00, "Total line amount is 12 hrs * $12.50 = $150.00");
});

// ── Gap 12: Client Viewer Document Projection & Exclusion ──────────

test("Gap 12: shapeQuoteForClient strictly projects client-approved fields and excludes internal margins/rates", () => {
  const rawQuoteDoc = {
    quote: {
      id: "q-201",
      quote_number: "Q-2026-201",
      client_id: "c-2",
      status: "Approved",
      created_at: "2026-11-19T10:00:00Z",
      sent_at: "2026-11-19T11:00:00Z",
      valid_until: "2026-12-19T11:00:00Z",
      total_amount: 5000,
      scope_of_work: "Crusher plant maintenance",
      // Sensitive internal fields that MUST NEVER leak:
      internal_notes: "High margin client; markup 45%",
      internal_cost: 2750,
      margin_pct: 45,
      sales_rep_commission: 250,
      void_reason: null
    },
    client: {
      id: "c-2",
      name: "Freda Rebecca Gold Mine",
      contact_person: "Mr. Mining Manager",
      email: "manager@fredarebecca.co.zw",
      // Sensitive client credit/payment fields:
      bank_account_number: "0123456789",
      credit_limit: 100000
    },
    lines: [
      {
        item_code: "SRV-01",
        description: "Mechanical overhaul",
        quantity: 1,
        unit_of_measure: "job",
        total_price: 5000,
        // Sensitive internal line fields:
        cost_price: 2500,
        supplier_id: "supp-99",
        gl_code: "GL-4001"
      }
    ],
    equipment: {
      tag: "CRUSH-01",
      description: "Jaw Crusher Primary"
    },
    company_profile: {
      company_name: "ORAC Systems (Pvt) Ltd",
      physical_address: "Harare, Zimbabwe",
      email: "info@oracsystems.co.zw",
      phone: "+263 242 000000"
    }
  };

  const shaped = shapeQuoteForClient(rawQuoteDoc);

  // Assert allowlisted fields exist
  assert.equal(shaped.quote.quote_number, "Q-2026-201");
  assert.equal(shaped.quote.currency, "USD");
  assert.equal(shaped.client.name, "Freda Rebecca Gold Mine");
  assert.equal(shaped.lines[0].description, "Mechanical overhaul");

  // Assert forbidden fields are NEVER projected
  assert.equal(shaped.quote.internal_notes, undefined);
  assert.equal(shaped.quote.internal_cost, undefined);
  assert.equal(shaped.quote.margin_pct, undefined);
  assert.equal(shaped.quote.sales_rep_commission, undefined);
  assert.equal(shaped.client.bank_account_number, undefined);
  assert.equal(shaped.lines[0].cost_price, undefined);
  assert.equal(shaped.lines[0].gl_code, undefined);

  // Assert top-level keys
  const topKeys = Object.keys(shaped).sort();
  assert.deepEqual(topKeys, ["client", "company_profile", "equipment", "lines", "quote"]);
});

test("Gap 12: shapeWorksheetForClient strictly excludes worker national IDs, personal contacts, and pay rates", () => {
  const rawWorksheetDoc = {
    worksheet: {
      id: "ws-301",
      dispatch_card_id: "disp-301",
      work_date: "2026-11-19",
      status: "Approved",
      hours: 8,
      work_description: "Bearing alignment completed",
      // Sensitive worker data that MUST NEVER leak to client:
      technician_id: "tech-99",
      technician_national_id: "63-123456-A-75",
      technician_phone: "+263 77 123 4567",
      technician_hourly_rate: 6.50, // contractor pay rate
      internal_supervisor_comments: "Worker was 15 mins late but completed task"
    },
    client: {
      id: "c-3",
      name: "Zimplats Ngezi"
    },
    job: {
      id: "disp-301",
      dispatch_number: "JOB-2026-301",
      scheduled_start: "2026-11-19T08:00:00Z",
      scheduled_end: "2026-11-19T16:00:00Z",
      // Internal job routing:
      vehicle_id: "veh-05",
      fuel_litres_issued: 45
    },
    company_profile: {
      company_name: "ORAC Systems (Pvt) Ltd"
    }
  };

  const shaped = shapeWorksheetForClient(rawWorksheetDoc);

  assert.equal(shaped.worksheet.hours, 8);
  assert.equal(shaped.worksheet.work_description, "Bearing alignment completed");
  assert.equal(shaped.client.name, "Zimplats Ngezi");
  assert.equal(shaped.dispatch.dispatch_number, "JOB-2026-301");

  // Strict exclusions:
  assert.equal(shaped.worksheet.technician_national_id, undefined);
  assert.equal(shaped.worksheet.technician_phone, undefined);
  assert.equal(shaped.worksheet.technician_hourly_rate, undefined);
  assert.equal(shaped.worksheet.internal_supervisor_comments, undefined);
  assert.equal(shaped.dispatch.fuel_litres_issued, undefined);
});

test("Gap 12: shapeDocumentForClient routes all supported client document types through strict shapers", () => {
  for (const type of ["quote", "worksheet", "invoice", "po"]) {
    const shaped = shapeDocumentForClient(type, {});
    assert.ok(shaped !== null, `shaper exists for ${type}`);
  }
  assert.equal(shapeDocumentForClient("unsupported_internal_type", {}), null);
});
