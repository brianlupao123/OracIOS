// backend/src/controllers/dispatchCardGrantController.js
//
// Batch C Commit 2: Admin CRUD for dispatch-card grants.
// Follows existing ORAC controller conventions:
//   - getActor(req) from req.db.users
//   - requirePermission(actor, "permissionName")
//   - { success: true/false, data/message } response envelope
//   - req.store.audit() for auditing

import { requirePermission, hasPermission } from "../permissions.js";
import {
  createDispatchCardGrant,
  revokeDispatchCardGrant,
  activeGrantFor,
  listActiveGrantsForUser
} from "../dispatchCardGrants.js";

function getActor(req) {
  return req.db.users.find((u) => u.id === req.user.id);
}

// ── POST /admin/dispatch-card-grants ─────────────────────────────────
// Admin creates a new grant for a named Client Viewer.
export const createGrant = (req, res) => {
  const actor = getActor(req);
  requirePermission(actor, "grantDispatchCardAccess");

  const result = createDispatchCardGrant(req.db, req.store, actor, {
    user_id: req.body.user_id,
    dispatch_card_id: req.body.dispatch_card_id,
    grant_start: req.body.grant_start,
    grant_end: req.body.grant_end,
    evidence_reference: req.body.evidence_reference || null
  });

  if (!result.ok) {
    return res.status(400).json({ success: false, message: result.errors.join(" ") });
  }

  res.json({ success: true, data: result.grant });
};

// ── GET /admin/dispatch-card-grants ──────────────────────────────────
// Admin lists all dispatch-card grants (or filtered by user_id / dispatch_card_id).
export const listGrants = (req, res) => {
  const actor = getActor(req);
  requirePermission(actor, "grantDispatchCardAccess");

  let grants = req.db.dispatch_card_grants || [];

  // Optional query filters
  if (req.query.user_id) {
    grants = grants.filter((g) => g.user_id === req.query.user_id);
  }
  if (req.query.dispatch_card_id) {
    grants = grants.filter((g) => g.dispatch_card_id === req.query.dispatch_card_id);
  }
  if (req.query.status) {
    grants = grants.filter((g) => g.status === req.query.status);
  }

  res.json({ success: true, data: grants });
};

// ── POST /admin/dispatch-card-grants/:id/revoke ─────────────────────
// Admin revokes an active grant. Reason required.
export const revokeGrant = (req, res) => {
  const actor = getActor(req);
  requirePermission(actor, "revokeDispatchCardAccess");

  const result = revokeDispatchCardGrant(req.db, req.store, actor, req.params.id, {
    reason: req.body.reason
  });

  if (!result.ok) {
    return res.status(400).json({ success: false, message: result.errors.join(" ") });
  }

  res.json({ success: true, data: result.grant });
};

// ── GET /dispatch_cards/:id/job-card (Client Viewer grant enforcement) ──
//
// This middleware runs BEFORE getDispatchJobCard for Client Viewer requests.
// It checks whether the Client Viewer has an active grant for this dispatch
// card, and if the dispatch belongs to their client. If the grant check passes,
// the middleware patches canReadDispatchJobCard's result by setting a request
// flag that the modified getDispatchJobCard uses.
//
// IMPORTANT: This is a middleware, not a replacement for getDispatchJobCard.
// The existing getDispatchJobCard controller remains unchanged — this gate
// runs before it.
export const clientViewerDispatchGate = (req, res, next) => {
  const actor = req.db.users.find((u) => u.id === req.user.id);
  if (!actor || actor.role !== "Client Viewer") return next();

  // Client Viewer must have an active grant for this specific dispatch card
  const grant = activeGrantFor(req.db, actor.id, req.params.id);
  if (!grant) {
    return res.status(403).json({
      success: false,
      message: "No active dispatch-card grant for this dispatch."
    });
  }

  // Same-client check: the grant's client_id must match the actor's client_id
  const grantRecord = (req.db.dispatch_card_grants || []).find((g) => g.id === grant.id);
  if (!grantRecord || grantRecord.client_id !== actor.client_id) {
    return res.status(403).json({
      success: false,
      message: "Grant does not match your client."
    });
  }

  // Mark request so the response can be filtered for the Client Viewer
  req._dispatchCardGrant = grant;
  next();
};

// ── Wrapper for getDispatchJobCard that strips sensitive fields for Client Viewer
// This replaces the direct getDispatchJobCard binding on the route for granted
// Client Viewers. It delegates to the real controller then filters the response.
export const grantedDispatchJobCard = (originalHandler) => (req, res) => {
  const actor = req.db.users.find((u) => u.id === req.user.id);

  // Non-Client-Viewer: use original handler directly
  if (!actor || actor.role !== "Client Viewer") {
    return originalHandler(req, res);
  }

  // Client Viewer with grant: build a safe, rate-free response
  const job = req.db.dispatch_cards.find((item) => item.id === req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Dispatch card not found." });

  const quote = (req.db.quotes || []).find((item) => item.id === job.quotation_id) || null;
  const client = quote ? (req.db.clients || []).find((item) => item.id === quote.client_id) || null : null;

  // G9: Safe response — no rates, billing, payroll, roster details, audit, stock
  res.json({
    success: true,
    data: {
      identity: {
        id: job.id,
        dispatch_number: job.dispatch_number || null,
        status: job.status || null,
        scheduled_start: job.scheduled_start || null,
        site_id: job.site_id || null,
        client: client ? { id: client.id, name: client.name || null } : null
      },
      workflow: {
        quotation: quote ? { id: quote.id, quote_number: quote.quote_number || null, status: quote.status || null } : null,
        purchase_order: null  // Never expose PO to Client Viewer
      },
      evidence_summary: {
        timesheets: { total: (req.db.field_worksheets || []).filter((w) => w.dispatch_card_id === job.id && !w.superseded_by).length }
      },
      grant: {
        id: req._dispatchCardGrant.id,
        grant_start: req._dispatchCardGrant.grant_start,
        grant_end: req._dispatchCardGrant.grant_end
      }
    }
  });
};
