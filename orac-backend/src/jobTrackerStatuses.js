/**
 * Jobs Tracker Status Enum — 14 granular statuses.
 *
 * Extends the original 5-stage tracker (Waiting_For_PO, WIP, Ready_For_Invoice,
 * Invoiced, Completed) into a full 14-status lifecycle that covers the complete
 * quote-to-cash pipeline for ORAC's mine services operations.
 *
 * Status flow (happy path):
 *   Draft → Sent → Quoted → Awaiting_Client_PR → Awaiting_Client_PO →
 *   PO_Under_Verification → Mobilising → WIP → Demobilised →
 *   Ready_For_Invoice → Invoiced → Payment_Due → Settled → Completed
 *
 * Each status has a human-readable label, a colour for the UI, and the
 * set of previous statuses that can transition INTO it.
 */

export const JOB_STATUSES = {
  // ── Pre-award ─────────────────────────────────────────────────────
  Draft:                 { label: "Draft",                      colour: "gray",    stage: "Pre-Award",   order: 0 },
  Sent:                  { label: "Sent to Client",             colour: "blue",    stage: "Pre-Award",   order: 1 },
  Quoted:                { label: "Quoted (Awaiting Feedback)",  colour: "indigo",  stage: "Pre-Award",   order: 2 },
  Awaiting_Client_PR:    { label: "Awaiting Client PR",         colour: "purple",  stage: "Pre-Award",   order: 3 },

  // ── PO & Mobilisation ─────────────────────────────────────────────
  Awaiting_Client_PO:    { label: "Awaiting Client PO",         colour: "orange",  stage: "PO Phase",    order: 4 },
  PO_Under_Verification: { label: "PO Under Verification",      colour: "amber",   stage: "PO Phase",    order: 5 },
  Mobilising:            { label: "Mobilising",                  colour: "teal",    stage: "Execution",   order: 6 },

  // ── Execution ─────────────────────────────────────────────────────
  WIP:                   { label: "Work in Progress",            colour: "green",   stage: "Execution",   order: 7 },
  Demobilised:           { label: "Demobilised",                 colour: "lime",    stage: "Execution",   order: 8 },

  // ── Billing ───────────────────────────────────────────────────────
  Ready_For_Invoice:     { label: "Ready to Invoice",            colour: "yellow",  stage: "Billing",     order: 9 },
  Invoiced:              { label: "Invoiced",                    colour: "cyan",    stage: "Billing",     order: 10 },
  Payment_Due:           { label: "Payment Due",                 colour: "red",     stage: "Billing",     order: 11 },

  // ── Completion ────────────────────────────────────────────────────
  Settled:               { label: "Settled (Paid)",              colour: "emerald", stage: "Completion",  order: 12 },
  Completed:             { label: "Completed",                   colour: "slate",   stage: "Completion",  order: 13 }
};

export const STATUS_KEYS = Object.keys(JOB_STATUSES);

/**
 * Maps the existing quote/dispatch/invoice state to one of the 14 granular
 * statuses. This is the core classification function used by the Jobs Tracker.
 *
 * @param {{ quote, po, dispatch, invoices, pr, db }} context
 * @returns {string} one of the 14 status keys
 */
export function classifyJobStatus({ quote, po, dispatch, invoices, pr, db }) {
  const quoteStatus = String(quote?.status || "").toLowerCase();
  const nonVoidInvoices = (invoices || []).filter(
    inv => String(inv?.status || "").toLowerCase() !== "voided"
  );

  // Terminal: all invoices settled/paid
  if (nonVoidInvoices.length > 0) {
    const allSettled = nonVoidInvoices.every(inv => {
      const s = String(inv.status || "").toLowerCase();
      return s === "settled" || s === "paid";
    });
    if (allSettled) return "Completed";

    // Any invoice overdue? (created > 30 days ago and not settled)
    const now = Date.now();
    const anyOverdue = nonVoidInvoices.some(inv => {
      const s = String(inv.status || "").toLowerCase();
      if (s === "settled" || s === "paid") return false;
      const created = new Date(inv.created_at || 0).getTime();
      return (now - created) > 30 * 86400_000;
    });
    if (anyOverdue) return "Payment_Due";

    return "Invoiced";
  }

  // Check invoice readiness
  if (dispatch && isPoVerified(po, quote)) {
    // Import-free invoice readiness check: if we have dispatch + verified PO
    const dispatchStatus = String(dispatch.status || "").toLowerCase();

    if (dispatchStatus === "demobilised" || dispatchStatus === "completed") {
      return "Demobilised";
    }

    // If the dispatch has worksheets that are all approved → Ready_For_Invoice
    const worksheets = (db?.worksheets || []).filter(w => w.dispatch_id === dispatch.id);
    const hasApprovedWork = worksheets.some(w =>
      String(w.status || "").toLowerCase() === "approved" ||
      String(w.status || "").toLowerCase() === "reviewed"
    );
    if (hasApprovedWork) return "Ready_For_Invoice";

    if (dispatchStatus === "mobilising" || dispatchStatus === "pending") return "Mobilising";

    return "WIP";
  }

  // PO exists but not yet verified
  if (po && !isPoVerified(po, quote)) return "PO_Under_Verification";

  // Has PO → Awaiting verification
  if (quoteStatus === "po_verified" || quoteStatus === "field_dispatch") return "Mobilising";

  // PR tracking
  if (pr) {
    if (pr.status === "Approved" || pr.status === "Converted_To_PO") return "Awaiting_Client_PO";
    if (pr.status === "Received" || pr.status === "Under_Review") return "Awaiting_Client_PR";
  }

  // Quote approved, waiting for PR/PO
  if (quoteStatus === "approved_pending_po" || quoteStatus === "approved") return "Awaiting_Client_PO";

  // Quote sent
  if (quoteStatus === "sent") return "Sent";

  // Draft
  if (quoteStatus === "draft") return "Draft";

  // Quoted (any other non-draft active status)
  return "Quoted";
}

// ── Helpers ──────────────────────────────────────────────────────────

function isPoVerified(po, quote) {
  if (!po) return false;
  return Boolean(
    po.status === "Verified" ||
    po.status === "PO_Verified" ||
    po.verified_at ||
    quote?.status === "PO_Verified" ||
    quote?.status === "Field_Dispatch"
  );
}

/**
 * Returns the human-readable label for a status key.
 */
export function statusLabel(statusKey) {
  return JOB_STATUSES[statusKey]?.label || statusKey;
}

/**
 * Returns the stage group for a status key.
 */
export function statusStage(statusKey) {
  return JOB_STATUSES[statusKey]?.stage || "Unknown";
}
