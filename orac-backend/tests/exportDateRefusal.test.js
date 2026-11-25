// ORAC B1b - controlled review-export date refusal.
//
// An issued invoice or issued credit-note row whose date is missing, impossible,
// unparseable or zone-less must refuse the review export instead of exporting a blank
// date cell. The refusal reuses ORAC's existing BusinessRuleError / errorHandler
// response format and carries only record type, record identifier and field name.
// All data below is fictional.

import assert from "node:assert/strict";
import test from "node:test";
import { exportInvoicesCsv } from "../src/exporter.js";
import { exportPastel } from "../src/controllers/coreController.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { BusinessRuleError } from "../src/shared/errors/BusinessRuleError.js";

const TZ = { timezone: "Africa/Harare" };
const RAW = "SENTINEL-RAW-99-99-2026";

function makeDb() {
  return {
    users: [{ id: "u_fin", role: "Finance", is_active: true }],
    clients: [{ id: "c1", name: "Fictional Test Client" }],
    quotes: [{ id: "q1", client_id: "c1" }],
    purchase_orders: [{ id: "po1", quotation_id: "q1", po_reference: "PO-TEST-001" }],
    dispatch_cards: [{ id: "d1", quotation_id: "q1", equipment_tag_id: "eq1" }],
    equipment_tags: [{ id: "eq1", tag_code: "TAG-01" }],
    timesheets: [], material_usage: [], invoice_lines: [], invoice_credit_notes: [], audit_logs: [],
    invoices: []
  };
}

function addInvoice(db, fields = {}) {
  const invoice = {
    id: "inv1", invoice_number: "INV-T-001", purchase_order_id: "po1", dispatch_card_id: "d1",
    status: "issued", total_amount: 500, generated_at: "2026-10-15T10:00:00.000Z", ...fields
  };
  db.invoices.push(invoice);
  return invoice;
}

function addCreditNote(db, fields = {}) {
  db.invoice_credit_notes.push({
    id: `cn${db.invoice_credit_notes.length + 1}`, invoice_id: "inv1", status: "issued", amount: 50,
    reason: "Rate adjustment", issued_at: "2026-10-20T10:00:00.000Z", ...fields
  });
}

function refusal(db) {
  try {
    exportInvoicesCsv(db, TZ);
  } catch (error) {
    return error;
  }
  assert.fail("expected the export to be refused");
}

const dateColumn = (csv) => csv.split("\n").slice(1).map((line) => line.split(",")[2]);

// ---------- refusal: invoices ----------

for (const [label, fields] of [
  ["missing generated_at and created_at", { generated_at: undefined }],
  ["empty-string generated_at", { generated_at: "" }],
  ["impossible calendar date", { generated_at: "2026-02-30" }],
  ["impossible calendar date with a zoned time (V8 would roll it over)", { generated_at: "2026-02-30T10:00:00Z" }],
  ["impossible hour", { generated_at: "2026-10-15T25:00:00Z" }],
  ["unparseable text", { generated_at: "not-a-date" }],
  ["zone-less T datetime", { generated_at: "2026-10-15T10:00:00" }],
  ["zone-less space datetime", { generated_at: "2026-10-15 10:00" }],
  ["host-locale style text", { generated_at: "Oct 5 2026 10:00" }],
  ["leading-space date", { generated_at: " 2026-10-15" }],
  ["two-digit offset with no minutes (already blank before this change)", { generated_at: "2026-10-15T10:00:00+02" }],
  ["space before the offset (already blank before this change)", { generated_at: "2026-10-15T10:00:00 +02:00" }],
  ["impossible offset", { generated_at: "2026-10-15T10:00:00+25:00" }],
  ["boolean", { generated_at: true }]
]) {
  test(`invoice with ${label} refuses the export with safe correction info`, () => {
    const db = makeDb();
    addInvoice(db, fields);
    const error = refusal(db);
    assert.ok(error instanceof BusinessRuleError);
    assert.equal(error.statusCode, 422);
    assert.deepEqual(error.details, { records: [{ record_type: "invoice", record_id: "INV-T-001", field: "generated_at" }] });
  });
}

test("an invoice with no generated_at is read from created_at and reports created_at when that is bad", () => {
  const db = makeDb();
  addInvoice(db, { generated_at: undefined, created_at: "2026-10-15T10:00:00" });
  assert.deepEqual(refusal(db).details.records, [{ record_type: "invoice", record_id: "INV-T-001", field: "created_at" }]);
});

test("a bad generated_at is not silently rescued by a valid created_at (existing source-field order kept)", () => {
  const db = makeDb();
  addInvoice(db, { generated_at: "2026-10-15T10:00:00", created_at: "2026-10-15T10:00:00.000Z" });
  assert.deepEqual(refusal(db).details.records, [{ record_type: "invoice", record_id: "INV-T-001", field: "generated_at" }]);
});

test("an invoice without a number is identified by its id", () => {
  const db = makeDb();
  addInvoice(db, { invoice_number: undefined, generated_at: undefined });
  assert.equal(refusal(db).details.records[0].record_id, "inv1");
});

// ---------- refusal: credit notes ----------

test("issued credit note with no issued_at and no prepared_at refuses, naming issued_at", () => {
  const db = makeDb();
  addInvoice(db);
  addCreditNote(db, { id: "cn-a", issued_at: undefined });
  assert.deepEqual(refusal(db).details.records, [{ record_type: "credit_note", record_id: "cn-a", field: "issued_at" }]);
});

test("issued credit note falling back to a bad prepared_at refuses, naming prepared_at", () => {
  const db = makeDb();
  addInvoice(db);
  addCreditNote(db, { id: "cn-b", issued_at: undefined, prepared_at: "2026-10-22T10:00:00" });
  assert.deepEqual(refusal(db).details.records, [{ record_type: "credit_note", record_id: "cn-b", field: "prepared_at" }]);
});

test("issued credit note with a zone-less issued_at refuses", () => {
  const db = makeDb();
  addInvoice(db);
  addCreditNote(db, { id: "cn-c", issued_at: "2026-10-20 10:00:00" });
  assert.equal(refusal(db).details.records[0].field, "issued_at");
});

test("all offending records are listed together, in export order", () => {
  const db = makeDb();
  addInvoice(db, { id: "inv1", invoice_number: "INV-T-001", generated_at: "nope" });
  addInvoice(db, { id: "inv2", invoice_number: "INV-T-002" });
  addCreditNote(db, { id: "cn-d", invoice_id: "inv2", issued_at: "2026-13-01" });
  const error = refusal(db);
  assert.deepEqual(error.details.records, [
    { record_type: "invoice", record_id: "INV-T-001", field: "generated_at" },
    { record_type: "credit_note", record_id: "cn-d", field: "issued_at" }
  ]);
  assert.match(error.message, /2 issued record\(s\)/);
});

// ---------- not in scope: rows the export does not emit ----------

test("voided invoices, their credit notes, and non-issued credit notes never trigger a refusal", () => {
  const db = makeDb();
  addInvoice(db, { id: "inv-void", invoice_number: "INV-V", status: "voided", generated_at: "garbage" });
  addCreditNote(db, { id: "cn-void", invoice_id: "inv-void", issued_at: "garbage" });
  addInvoice(db, { id: "inv1", invoice_number: "INV-T-001" });
  addCreditNote(db, { id: "cn-draft", status: "prepared", issued_at: undefined, prepared_at: undefined });
  assert.deepEqual(dateColumn(exportInvoicesCsv(db, TZ)), ["2026-10-15"]);
});

// ---------- the raw malformed value is never echoed ----------

test("the raw malformed date never appears in the message, details, or serialised error", () => {
  const db = makeDb();
  addInvoice(db, { generated_at: RAW });
  addCreditNote(db, { id: "cn-raw", issued_at: `${RAW}-cn` });
  const error = refusal(db);
  for (const text of [error.message, JSON.stringify(error.details), JSON.stringify(error.toJSON()), error.stack.split("\n")[0]]) {
    assert.equal(text.includes("SENTINEL"), false, text);
  }
});

// ---------- valid dates still export; Africa/Harare behaviour preserved ----------

test("valid ISO calendar dates and explicit-timezone timestamps still export unchanged", () => {
  const db = makeDb();
  addInvoice(db, { id: "i1", invoice_number: "A", generated_at: "2026-10-05" });
  addInvoice(db, { id: "i2", invoice_number: "B", generated_at: "2024-02-29" });
  addInvoice(db, { id: "i3", invoice_number: "C", generated_at: "2026-10-15T10:00:00Z" });
  addInvoice(db, { id: "i4", invoice_number: "D", generated_at: "2026-10-15T10:00:00.123Z" });
  addInvoice(db, { id: "i5", invoice_number: "E", generated_at: "2026-10-15T10:00:00+02:00" });
  addInvoice(db, { id: "i6", invoice_number: "F", generated_at: "2026-10-15 10:00:00Z" });
  addInvoice(db, { id: "i7", invoice_number: "G", generated_at: "2026-10-15T10:00Z" });
  addInvoice(db, { id: "i8", invoice_number: "H", generated_at: new Date("2026-10-15T10:00:00Z") });
  // Offset/case spellings the pre-change path already exported with a real date.
  addInvoice(db, { id: "i9", invoice_number: "I", generated_at: "2026-10-15T10:00:00+0200" });
  addInvoice(db, { id: "i10", invoice_number: "J", generated_at: "2026-10-15T10:00:00z" });
  addInvoice(db, { id: "i11", invoice_number: "K", generated_at: "2026-10-15t10:00:00Z" });
  addInvoice(db, { id: "i12", invoice_number: "L", generated_at: "2026-10-15T10:00:00.1234567Z" });
  assert.deepEqual(dateColumn(exportInvoicesCsv(db, TZ)), [
    "2026-10-05", "2024-02-29", "2026-10-15", "2026-10-15", "2026-10-15", "2026-10-15", "2026-10-15", "2026-10-15",
    "2026-10-15", "2026-10-15", "2026-10-15", "2026-10-15"
  ]);
});

test("Africa/Harare business date: 22:30Z on 31 Dec is 1 Jan for invoices and credit notes; +02:00 offsets convert", () => {
  const db = makeDb();
  addInvoice(db, { id: "inv1", invoice_number: "INV-T-001", generated_at: "2026-12-31T22:30:00.000Z" });
  addInvoice(db, { id: "inv2", invoice_number: "INV-T-002", generated_at: "2026-10-15T23:30:00-01:00" });
  addCreditNote(db, { id: "cn-a", invoice_id: "inv1", issued_at: "2026-12-31T22:30:00.000Z" });
  const rows = exportInvoicesCsv(db, TZ).split("\n").slice(1).map((line) => line.split(","));
  assert.equal(rows.find((r) => r[1] === "INV-T-001")[2], "2027-01-01");
  assert.equal(rows.find((r) => r[1] === "cn-a")[2], "2027-01-01");
  assert.equal(rows.find((r) => r[1] === "INV-T-002")[2], "2026-10-16");
});

test("credit note falls back to a valid prepared_at when issued_at is absent (existing behaviour)", () => {
  const db = makeDb();
  addInvoice(db);
  addCreditNote(db, { id: "cn-p", issued_at: undefined, prepared_at: "2026-10-22T10:00:00.000Z" });
  assert.equal(exportInvoicesCsv(db, TZ).split("\n").find((l) => l.includes("cn-p")).split(",")[2], "2026-10-22");
});

// ---------- controller + global error handler: existing response format ----------

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined, sent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.sent = true; return this; },
    header(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    send(body) { this.body = body; this.sent = true; return this; }
  };
}

test("exportPastel refuses via the existing error handler: no CSV, no audit, no download headers", () => {
  const db = makeDb();
  addInvoice(db, { generated_at: RAW });
  let audited = 0;
  const req = { db, user: { id: "u_fin" }, store: { audit() { audited += 1; } } };
  const res = mockRes();
  let thrown;
  try { exportPastel(req, res); } catch (error) { thrown = error; }
  assert.ok(thrown instanceof BusinessRuleError);
  assert.equal(audited, 0, "a refused export is not recorded as a generated export");
  assert.equal(res.sent, false);
  assert.equal(res.headers["content-disposition"], undefined);

  const out = mockRes();
  errorHandler(thrown, req, out, () => {});
  assert.equal(out.statusCode, 422);
  assert.deepEqual(Object.keys(out.body).sort(), ["code", "details", "message", "success", "timestamp"]);
  assert.equal(out.body.success, false);
  assert.equal(out.body.code, "BUSINESS_RULE_VIOLATION");
  assert.deepEqual(out.body.details, { records: [{ record_type: "invoice", record_id: "INV-T-001", field: "generated_at" }] });
  assert.equal(JSON.stringify(out.body).includes("SENTINEL"), false);
});

test("exportPastel still produces the review-only CSV and audit for valid dates", () => {
  const db = makeDb();
  addInvoice(db);
  addCreditNote(db);
  const audits = [];
  const req = { db, user: { id: "u_fin" }, store: { audit: (...args) => audits.push(args) } };
  const res = mockRes();
  exportPastel(req, res);
  assert.match(res.body, /^# \[PASTEL PARALLEL MODE — REVIEW ONLY \/ NOT POSTED\]\n/);
  assert.equal(audits.length, 1);
  assert.equal(audits[0][5], null);
  assert.equal(audits[0][6].accounting_posted, false);
  assert.equal(audits[0][6].designation, "REVIEW_NON_POSTING");
  assert.equal(audits[0][6].row_count, 2);
});
