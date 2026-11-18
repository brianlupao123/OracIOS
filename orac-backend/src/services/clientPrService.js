/**
 * Client Purchase Requisition (PR) Service.
 *
 * A PR is a formal client-side authorization request that PRECEDES a Purchase
 * Order (PO). In Zimbabwe mine operations, the client's procurement department
 * issues a PR internally, which then goes through their approval chain before
 * becoming a PO. ORAC tracks the PR as a separate entity so the Jobs Tracker
 * can show "Awaiting Client PR" before "Waiting for Client PO".
 *
 * State Machine: Received → Under_Review → Approved → Converted_To_PO | Rejected | Expired
 *
 * A PR is linked to a quote (FK quotation_id) and optionally to a client
 * (FK client_id). When the PR is approved and a PO is issued, the PR
 * transitions to Converted_To_PO.
 */

import crypto from "node:crypto";

// ── State Machine ───────────────────────────────────────────────────

export const PR_STATES = [
  "Received",
  "Under_Review",
  "Approved",
  "Converted_To_PO",
  "Rejected",
  "Expired"
];

const VALID_TRANSITIONS = {
  Received:       ["Under_Review", "Rejected", "Expired"],
  Under_Review:   ["Approved", "Rejected", "Expired"],
  Approved:       ["Converted_To_PO", "Expired"],
  Converted_To_PO: [],  // terminal
  Rejected:       [],   // terminal
  Expired:        []    // terminal
};

function assertTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw Object.assign(
      new Error(`Invalid PR transition: ${from} → ${to}`),
      { status: 409 }
    );
  }
}

// ── CRUD ────────────────────────────────────────────────────────────

/**
 * Creates a new Client PR record.
 */
export function createClientPr({ quotationId, clientId, prNumber, prDate, description, receivedBy, store, db }) {
  if (!quotationId) throw Object.assign(new Error("quotationId is required"), { status: 400 });
  if (!clientId) throw Object.assign(new Error("clientId is required"), { status: 400 });

  if (!db.client_prs) db.client_prs = [];

  // Prevent duplicate PR number for the same client
  if (prNumber) {
    const existing = db.client_prs.find(
      p => p.pr_number === prNumber && p.client_id === clientId && p.status !== "Rejected"
    );
    if (existing) {
      throw Object.assign(
        new Error(`PR number ${prNumber} already exists for this client`),
        { status: 409 }
      );
    }
  }

  const pr = {
    id: `pr_${crypto.randomBytes(8).toString("hex")}`,
    quotation_id: quotationId,
    client_id: clientId,
    pr_number: prNumber || null,
    pr_date: prDate || new Date().toISOString(),
    description: description || null,
    status: "Received",
    received_by: receivedBy,
    received_at: new Date().toISOString(),
    reviewed_at: null,
    approved_at: null,
    converted_at: null,
    rejected_at: null,
    rejection_reason: null,
    purchase_order_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.client_prs.push(pr);

  store.audit(db, { id: receivedBy }, "client_prs", pr.id,
    "PR_RECEIVED", {
      quotation_id: quotationId,
      client_id: clientId,
      pr_number: prNumber
    });

  return pr;
}

/**
 * Transitions a PR to a new state.
 */
export function transitionPr({ prId, toStatus, reason, purchaseOrderId, userId, store, db }) {
  const pr = findPr(prId, db);
  assertTransition(pr.status, toStatus);

  const before = { status: pr.status };
  pr.status = toStatus;
  pr.updated_at = new Date().toISOString();

  switch (toStatus) {
    case "Under_Review":
      pr.reviewed_at = new Date().toISOString();
      break;
    case "Approved":
      pr.approved_at = new Date().toISOString();
      break;
    case "Converted_To_PO":
      pr.converted_at = new Date().toISOString();
      if (purchaseOrderId) pr.purchase_order_id = purchaseOrderId;
      break;
    case "Rejected":
      pr.rejected_at = new Date().toISOString();
      pr.rejection_reason = reason || null;
      break;
    case "Expired":
      break;
  }

  store.audit(db, { id: userId }, "client_prs", pr.id,
    `PR_${toStatus.toUpperCase()}`, before, {
      status: toStatus,
      reason: reason || null,
      purchase_order_id: purchaseOrderId || null
    });

  return pr;
}

// ── Queries ─────────────────────────────────────────────────────────

export function getClientPr({ prId, db }) {
  return findPr(prId, db);
}

export function listClientPrs({ clientId, quotationId, status, db }) {
  let prs = db.client_prs || [];
  if (clientId) prs = prs.filter(p => p.client_id === clientId);
  if (quotationId) prs = prs.filter(p => p.quotation_id === quotationId);
  if (status) prs = prs.filter(p => p.status === status);
  return prs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/**
 * Returns the latest non-rejected PR for a quote, or null.
 * Used by the Jobs Tracker to determine "Awaiting Client PR" status.
 */
export function getActivePrForQuote({ quotationId, db }) {
  const prs = (db.client_prs || [])
    .filter(p => p.quotation_id === quotationId && p.status !== "Rejected" && p.status !== "Expired")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return prs[0] || null;
}

// ── Internal ────────────────────────────────────────────────────────

function findPr(prId, db) {
  const pr = (db.client_prs || []).find(p => p.id === prId);
  if (!pr) throw Object.assign(new Error("Client PR not found"), { status: 404 });
  return pr;
}
