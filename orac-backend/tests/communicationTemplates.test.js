import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  interpolate, listTemplates, getTemplate, renderPreview,
  buildQuoteContext, buildInvoiceContext, buildDispatchContext
} from "../src/services/communicationTemplateService.js";
import {
  listCommunicationTemplates, getCommunicationTemplate, previewCommunication
} from "../src/controllers/communicationsController.js";

// ── Mock helpers ─────────────────────────────────────────────────────

function mockReq(body = {}, params = {}, db = {}) {
  return {
    user: { id: "admin-1" },
    body,
    params,
    db: {
      users: [{ id: "admin-1", name: "Admin User", role: "Admin", is_active: true }],
      company_profile: { company_name: "Test Corp", bank_name: "FNB", bank_account: "123456", bank_branch: "Main" },
      quotes: [
        { id: "q-1", quote_ref: "QR-001", client_id: "c-1", client_name: "Zimplats", created_at: "2026-11-01T10:00:00Z", totals: { subtotal: 10000, vat: 1500, total: 11500 }, validity_days: 30 }
      ],
      invoices: [
        { id: "inv-1", invoice_ref: "INV-001", client_id: "c-1", created_at: "2026-11-15T10:00:00Z", totals: { total: 11500 }, payment_terms: "30 days" }
      ],
      dispatch_cards: [
        { id: "d-1", dispatch_ref: "DSP-001", client_id: "c-1", mine_site_name: "Ngezi Mine", plant_name: "Crusher 2", supervisor_name: "John Doe", dispatch_date: "2026-11-10" }
      ],
      clients: [{ id: "c-1", name: "Zimplats Holdings" }],
      ...db
    }
  };
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

// ── Service Tests ────────────────────────────────────────────────────

describe("Communication Template Service", () => {
  it("interpolate replaces known placeholders", () => {
    const result = interpolate("Hello {{name}}, ref {{ref}}", { name: "Brian", ref: "QR-001" });
    assert.equal(result, "Hello Brian, ref QR-001");
  });

  it("interpolate leaves unknown placeholders as-is", () => {
    const result = interpolate("Dear {{client}}, total {{amount}}", { client: "Test" });
    assert.equal(result, "Dear Test, total {{amount}}");
  });

  it("interpolate handles empty template", () => {
    assert.equal(interpolate("", {}), "");
    assert.equal(interpolate(null, {}), "");
  });

  it("listTemplates returns all 6 registered templates", () => {
    const templates = listTemplates();
    assert.ok(templates.length >= 6);
    assert.ok(templates.includes("quote_sent"));
    assert.ok(templates.includes("invoice_issued"));
    assert.ok(templates.includes("po_acknowledgement"));
    assert.ok(templates.includes("dispatch_notification"));
    assert.ok(templates.includes("timesheet_summary"));
    assert.ok(templates.includes("payment_received"));
  });

  it("getTemplate returns template with subject and body", () => {
    const t = getTemplate("quote_sent");
    assert.ok(t);
    assert.ok(t.subject.includes("{{quote_ref}}"));
    assert.ok(t.body.includes("{{total_incl_vat}}"));
  });

  it("getTemplate returns null for unknown template", () => {
    assert.equal(getTemplate("nonexistent"), null);
  });

  it("renderPreview produces subject, body, and identifies missing fields", () => {
    const preview = renderPreview("quote_sent", { quote_ref: "QR-001", company_name: "ORAC" });
    assert.equal(preview.template_name, "quote_sent");
    assert.ok(preview.subject.includes("QR-001"));
    assert.ok(preview.subject.includes("ORAC"));
    assert.ok(preview.missing_fields.length > 0); // Other fields missing
    assert.ok(preview.missing_fields.includes("client_contact_name"));
  });

  it("renderPreview with all fields resolves everything", () => {
    const ctx = {
      quote_ref: "QR-001", company_name: "Test Corp", client_contact_name: "John",
      quote_date: "2026-11-01", total_excl_vat: "$10,000.00", vat_amount: "$1,500.00",
      total_incl_vat: "$11,500.00", validity_days: "30", sender_name: "Admin"
    };
    const preview = renderPreview("quote_sent", ctx);
    assert.deepEqual(preview.missing_fields, []);
  });

  it("renderPreview returns error for unknown template", () => {
    const preview = renderPreview("nonexistent", {});
    assert.ok(preview.error);
  });

  it("buildQuoteContext produces correct fields", () => {
    const ctx = buildQuoteContext(
      { quote_ref: "QR-001", created_at: "2026-11-01T10:00:00Z", totals: { subtotal: 10000, vat: 1500, total: 11500 }, validity_days: 30 },
      { company_name: "ORAC", bank_name: "FNB" },
      { name: "Admin" }
    );
    assert.equal(ctx.quote_ref, "QR-001");
    assert.equal(ctx.company_name, "ORAC");
    assert.equal(ctx.sender_name, "Admin");
    assert.ok(ctx.total_incl_vat.includes("11,500"));
  });

  it("buildInvoiceContext produces correct fields", () => {
    const ctx = buildInvoiceContext(
      { invoice_ref: "INV-001", totals: { total: 11500 }, payment_terms: "30 days" },
      { company_name: "ORAC" },
      { name: "Admin" }
    );
    assert.equal(ctx.invoice_ref, "INV-001");
    assert.equal(ctx.payment_terms, "30 days");
  });

  it("buildDispatchContext produces correct fields", () => {
    const ctx = buildDispatchContext(
      { dispatch_ref: "DSP-001", mine_site_name: "Ngezi", plant_name: "Crusher 2", supervisor_name: "John" },
      { company_name: "ORAC" },
      { name: "Admin" }
    );
    assert.equal(ctx.dispatch_ref, "DSP-001");
    assert.equal(ctx.mine_site_name, "Ngezi");
    assert.equal(ctx.supervisor_name, "John");
  });
});

// ── Controller Tests ─────────────────────────────────────────────────

describe("Communication Preview Controller", () => {
  it("GET /communications/templates returns template list", () => {
    const res = mockRes();
    listCommunicationTemplates(mockReq(), res);
    assert.equal(res._json.success, true);
    assert.ok(res._json.templates.length >= 6);
  });

  it("GET /communications/templates/:name returns template definition", () => {
    const res = mockRes();
    getCommunicationTemplate(mockReq({}, { name: "quote_sent" }), res);
    assert.equal(res._json.success, true);
    assert.equal(res._json.template_name, "quote_sent");
    assert.ok(res._json.subject);
    assert.ok(res._json.body);
  });

  it("GET /communications/templates/:name returns 404 for unknown template", () => {
    const res = mockRes();
    getCommunicationTemplate(mockReq({}, { name: "nonexistent" }), res);
    assert.equal(res._status, 404);
  });

  it("POST /communications/preview renders a preview with manual context", () => {
    const res = mockRes();
    previewCommunication(mockReq({
      template_name: "quote_sent",
      context: { quote_ref: "QR-001", company_name: "ORAC", client_contact_name: "Brian" }
    }), res);
    assert.equal(res._json.success, true);
    assert.ok(res._json.preview.subject.includes("QR-001"));
    assert.ok(res._json.preview.body.includes("Brian"));
  });

  it("POST /communications/preview auto-builds context from quote entity", () => {
    const res = mockRes();
    previewCommunication(mockReq({
      template_name: "quote_sent",
      entity_type: "quote",
      entity_id: "q-1"
    }), res);
    assert.equal(res._json.success, true);
    assert.ok(res._json.preview.subject.includes("QR-001"));
    assert.ok(res._json.preview.body.includes("11,500"));
  });

  it("POST /communications/preview auto-builds context from invoice entity", () => {
    const res = mockRes();
    previewCommunication(mockReq({
      template_name: "invoice_issued",
      entity_type: "invoice",
      entity_id: "inv-1"
    }), res);
    assert.equal(res._json.success, true);
    assert.ok(res._json.preview.subject.includes("INV-001"));
  });

  it("POST /communications/preview auto-builds context from dispatch entity", () => {
    const res = mockRes();
    previewCommunication(mockReq({
      template_name: "dispatch_notification",
      entity_type: "dispatch",
      entity_id: "d-1"
    }), res);
    assert.equal(res._json.success, true);
    assert.ok(res._json.preview.subject.includes("DSP-001"));
    assert.ok(res._json.preview.body.includes("Ngezi Mine"));
  });

  it("POST /communications/preview returns 400 when template_name missing", () => {
    const res = mockRes();
    previewCommunication(mockReq({}), res);
    assert.equal(res._status, 400);
  });

  it("POST /communications/preview returns 404 for unknown entity_id", () => {
    const res = mockRes();
    previewCommunication(mockReq({
      template_name: "quote_sent",
      entity_type: "quote",
      entity_id: "nonexistent"
    }), res);
    assert.equal(res._status, 404);
  });

  it("POST /communications/preview context overrides auto-built fields", () => {
    const res = mockRes();
    previewCommunication(mockReq({
      template_name: "quote_sent",
      entity_type: "quote",
      entity_id: "q-1",
      context: { client_contact_name: "Custom Name Override" }
    }), res);
    assert.equal(res._json.success, true);
    assert.ok(res._json.preview.body.includes("Custom Name Override"));
  });
});
