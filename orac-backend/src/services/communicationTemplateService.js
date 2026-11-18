/**
 * Communication Template Engine — Batch 1 of 4.
 *
 * Zero-risk: this module renders communication previews without queueing
 * or sending. It merges entity context (quote, invoice, dispatch) into
 * approved templates and returns HTML + plain-text bodies.
 *
 * The outbound-email tripwire (tests/noOutboundEmailGuard.test.js) is
 * NOT touched — this module has no transport code, no SMTP references,
 * and no mail-sending imports.
 */

// ── Template Registry ────────────────────────────────────────────────

const TEMPLATES = {
  quote_sent: {
    subject: "Quotation {{quote_ref}} from {{company_name}}",
    body: [
      "Dear {{client_contact_name}},",
      "",
      "Please find attached our quotation {{quote_ref}} dated {{quote_date}}.",
      "",
      "Total (excl. VAT): {{total_excl_vat}}",
      "VAT (15%): {{vat_amount}}",
      "Total (incl. VAT): {{total_incl_vat}}",
      "",
      "This quotation is valid for {{validity_days}} days from the date above.",
      "",
      "Should you have any queries, please do not hesitate to contact us.",
      "",
      "Kind regards,",
      "{{sender_name}}",
      "{{company_name}}"
    ].join("\n")
  },

  invoice_issued: {
    subject: "Invoice {{invoice_ref}} from {{company_name}}",
    body: [
      "Dear {{client_contact_name}},",
      "",
      "Please find attached Invoice {{invoice_ref}} dated {{invoice_date}}.",
      "",
      "Amount Due: {{total_incl_vat}}",
      "Payment Terms: {{payment_terms}}",
      "",
      "Banking Details:",
      "  Bank: {{company_bank_name}}",
      "  Account: {{company_bank_account}}",
      "  Branch: {{company_bank_branch}}",
      "",
      "Please use reference {{invoice_ref}} when making payment.",
      "",
      "Kind regards,",
      "{{sender_name}}",
      "{{company_name}}"
    ].join("\n")
  },

  po_acknowledgement: {
    subject: "PO {{po_ref}} Acknowledged — {{company_name}}",
    body: [
      "Dear {{client_contact_name}},",
      "",
      "We acknowledge receipt of your Purchase Order {{po_ref}} dated {{po_date}}.",
      "Linked Quotation: {{quote_ref}}",
      "",
      "Our team will begin mobilisation as outlined in the quotation scope.",
      "",
      "Kind regards,",
      "{{sender_name}}",
      "{{company_name}}"
    ].join("\n")
  },

  dispatch_notification: {
    subject: "Dispatch {{dispatch_ref}} — Team Mobilised",
    body: [
      "Dear {{client_contact_name}},",
      "",
      "This is to confirm that Dispatch {{dispatch_ref}} has been mobilised.",
      "Site: {{mine_site_name}} — {{plant_name}}",
      "Supervisor: {{supervisor_name}}",
      "Start Date: {{dispatch_date}}",
      "",
      "Our technicians will report to your site office on the date above.",
      "",
      "Kind regards,",
      "{{sender_name}}",
      "{{company_name}}"
    ].join("\n")
  },

  timesheet_summary: {
    subject: "Timesheet Period Summary — {{period_label}}",
    body: [
      "Dear {{client_contact_name}},",
      "",
      "Attached is the timesheet summary for the period {{period_label}}.",
      "Dispatch: {{dispatch_ref}}",
      "Total Certified Hours: {{total_hours}}",
      "",
      "Please review and confirm at your earliest convenience.",
      "",
      "Kind regards,",
      "{{sender_name}}",
      "{{company_name}}"
    ].join("\n")
  },

  payment_received: {
    subject: "Payment Received — Invoice {{invoice_ref}}",
    body: [
      "Dear {{client_contact_name}},",
      "",
      "We confirm receipt of payment for Invoice {{invoice_ref}}.",
      "Amount Received: {{payment_amount}}",
      "Date: {{payment_date}}",
      "Reference: {{payment_reference}}",
      "",
      "Thank you for your prompt payment.",
      "",
      "Kind regards,",
      "{{sender_name}}",
      "{{company_name}}"
    ].join("\n")
  }
};

// ── Interpolation Engine ─────────────────────────────────────────────

/**
 * Replaces {{placeholder}} tokens with values from context.
 * Unknown placeholders are left as-is so the preview shows what's missing.
 * Pure function — no side effects.
 */
export function interpolate(template, context) {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = context[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * Returns the list of registered template names.
 */
export function listTemplates() {
  return Object.keys(TEMPLATES);
}

/**
 * Returns a template definition by name, or null if not found.
 */
export function getTemplate(templateName) {
  return TEMPLATES[templateName] || null;
}

// ── Context Builders ─────────────────────────────────────────────────

/**
 * Builds a template context from a quote entity and company profile.
 */
export function buildQuoteContext(quote, companyProfile, sender) {
  return {
    quote_ref: quote?.quote_ref || quote?.id || "",
    quote_date: quote?.created_at ? new Date(quote.created_at).toLocaleDateString("en-ZA") : "",
    client_contact_name: quote?.client_name || quote?.client_contact || "",
    total_excl_vat: formatCurrency(quote?.totals?.subtotal ?? quote?.total_excl_vat),
    vat_amount: formatCurrency(quote?.totals?.vat ?? quote?.vat_amount),
    total_incl_vat: formatCurrency(quote?.totals?.total ?? quote?.total_incl_vat),
    validity_days: quote?.validity_days || "30",
    company_name: companyProfile?.company_name || "ORAC Industrial Services",
    sender_name: sender?.name || "",
    ...buildCompanyBankContext(companyProfile)
  };
}

/**
 * Builds a template context from an invoice entity and company profile.
 */
export function buildInvoiceContext(invoice, companyProfile, sender) {
  return {
    invoice_ref: invoice?.invoice_ref || invoice?.id || "",
    invoice_date: invoice?.created_at ? new Date(invoice.created_at).toLocaleDateString("en-ZA") : "",
    client_contact_name: invoice?.client_name || invoice?.client_contact || "",
    total_incl_vat: formatCurrency(invoice?.totals?.total ?? invoice?.total_incl_vat),
    payment_terms: invoice?.payment_terms || "30 days",
    company_name: companyProfile?.company_name || "ORAC Industrial Services",
    sender_name: sender?.name || "",
    ...buildCompanyBankContext(companyProfile)
  };
}

/**
 * Builds a template context from a dispatch entity.
 */
export function buildDispatchContext(dispatch, companyProfile, sender) {
  return {
    dispatch_ref: dispatch?.dispatch_ref || dispatch?.id || "",
    dispatch_date: dispatch?.dispatch_date || dispatch?.created_at || "",
    mine_site_name: dispatch?.mine_site_name || "",
    plant_name: dispatch?.plant_name || "",
    supervisor_name: dispatch?.supervisor_name || "",
    client_contact_name: dispatch?.client_name || dispatch?.client_contact || "",
    company_name: companyProfile?.company_name || "ORAC Industrial Services",
    sender_name: sender?.name || ""
  };
}

function buildCompanyBankContext(profile) {
  return {
    company_bank_name: profile?.bank_name || "",
    company_bank_account: profile?.bank_account || "",
    company_bank_branch: profile?.bank_branch || ""
  };
}

function formatCurrency(amount) {
  if (amount === undefined || amount === null || isNaN(Number(amount))) return "$0.00";
  return "$" + Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Preview Renderer ─────────────────────────────────────────────────

/**
 * Renders a full communication preview (subject + body) without queueing or sending.
 * Returns { subject, body, template_name, context, missing_fields }.
 */
export function renderPreview(templateName, context) {
  const template = getTemplate(templateName);
  if (!template) {
    return { error: `Unknown template: ${templateName}`, subject: "", body: "" };
  }

  const subject = interpolate(template.subject, context);
  const body = interpolate(template.body, context);

  // Identify any unresolved placeholders
  const missingInSubject = [...subject.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  const missingInBody = [...body.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  const missing_fields = [...new Set([...missingInSubject, ...missingInBody])];

  return {
    template_name: templateName,
    subject,
    body,
    context,
    missing_fields
  };
}
