// backend/src/dispatchCardGrants.js
//
// Batch C Commit 2: Client Viewer-to-dispatch authorisation.
//
// Pure domain logic — no HTTP concerns. Each function receives
// (db, store, actor, ...) and returns a result object or throws.
//
// Rules implemented:
//   G1: One named active Client Viewer may receive one dispatch-card grant.
//   G2: Grant maximum is 30 calendar days.
//   G3: Date evaluation uses Africa/Harare business dates.
//   G4: No automatic backfill of existing Client Viewers.
//   G5: Admin only may create or revoke grants.
//   G6: Revocation requires a reason and is immediate for future access.
//   G7: Overlapping active grants for the same user/dispatch are refused.
//   G8: Grants are audited.
//   G9: Grants must not expose rates, billing, payroll, real client data
//       or new client acknowledgement workflow.

import { formatBusinessDate, DEFAULT_BUSINESS_TIMEZONE } from "./businessTimezone.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_GRANT_DAYS = 30;

// ── Validation helpers ───────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function daysBetween(startStr, endStr) {
  const start = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

// ── Core: Create Grant ───────────────────────────────────────────────────────

/**
 * Create a dispatch-card grant for a named Client Viewer.
 *
 * @param {object} db        - data store
 * @param {object} store     - store helpers (id, audit)
 * @param {object} actor     - the Admin performing the action
 * @param {object} input     - { user_id, dispatch_card_id, grant_start, grant_end, evidence_reference? }
 * @returns {object}         - { ok, grant?, errors? }
 */
export function createDispatchCardGrant(db, store, actor, input) {
  const errors = [];

  // G5: Admin only
  if (!actor || actor.role !== "Admin" || !actor.is_active) {
    errors.push("Only an active Admin may create a dispatch-card grant.");
    return { ok: false, errors };
  }

  // Resolve the target user
  const user = (db.users || []).find((u) => u.id === input.user_id);
  if (!user) {
    errors.push("Target user not found.");
    return { ok: false, errors };
  }
  // G1: Must be an active Client Viewer
  if (user.role !== "Client Viewer") {
    errors.push("Target user must have the Client Viewer role.");
    return { ok: false, errors };
  }
  if (!user.is_active) {
    errors.push("Target user is not active.");
    return { ok: false, errors };
  }
  if (!user.client_id) {
    errors.push("Target Client Viewer has no client_id assignment.");
    return { ok: false, errors };
  }

  // Dispatch card must exist
  const dispatchCard = (db.dispatch_cards || []).find((d) => d.id === input.dispatch_card_id);
  if (!dispatchCard) {
    errors.push("Dispatch card not found.");
    return { ok: false, errors };
  }

  // G3: Validate dates as Africa/Harare business dates
  if (!isValidDate(input.grant_start)) {
    errors.push("grant_start must be a valid YYYY-MM-DD date.");
    return { ok: false, errors };
  }
  if (!isValidDate(input.grant_end)) {
    errors.push("grant_end must be a valid YYYY-MM-DD date.");
    return { ok: false, errors };
  }
  if (input.grant_end < input.grant_start) {
    errors.push("grant_end must not be before grant_start.");
    return { ok: false, errors };
  }

  // G2: Maximum 30 calendar days
  const duration = daysBetween(input.grant_start, input.grant_end);
  if (duration > MAX_GRANT_DAYS) {
    errors.push(`Grant duration ${duration} days exceeds the maximum of ${MAX_GRANT_DAYS} calendar days.`);
    return { ok: false, errors };
  }

  // G7: No overlapping active grants for the same user+dispatch
  db.dispatch_card_grants = db.dispatch_card_grants || [];
  const overlapping = db.dispatch_card_grants.find(
    (g) =>
      g.user_id === input.user_id &&
      g.dispatch_card_id === input.dispatch_card_id &&
      g.status === "active" &&
      g.grant_start <= input.grant_end &&
      g.grant_end >= input.grant_start
  );
  if (overlapping) {
    errors.push(`An active grant already exists for this user/dispatch (${overlapping.id}) covering an overlapping period.`);
    return { ok: false, errors };
  }

  // G3: Record today in Africa/Harare for audit
  const todayBusiness = formatBusinessDate(new Date(), DEFAULT_BUSINESS_TIMEZONE);

  // G8: Create the grant record
  const grant = {
    id: store.id("dcg"),
    user_id: input.user_id,
    client_id: user.client_id,
    dispatch_card_id: input.dispatch_card_id,
    granted_by_id: actor.id,
    grant_start: input.grant_start,
    grant_end: input.grant_end,
    status: "active",
    revoked_at: null,
    revoked_by_id: null,
    revocation_reason: null,
    evidence_reference: input.evidence_reference || null,
    created_at: new Date().toISOString(),
    business_date_created: todayBusiness
  };

  db.dispatch_card_grants.push(grant);

  // G8: Audit
  store.audit(db, actor, "dispatch_card_grant", grant.id, "DISPATCH_GRANT_CREATED", null, {
    user_id: grant.user_id,
    dispatch_card_id: grant.dispatch_card_id,
    grant_start: grant.grant_start,
    grant_end: grant.grant_end
  });

  return { ok: true, grant };
}

// ── Core: Revoke Grant ───────────────────────────────────────────────────────

/**
 * Revoke an active dispatch-card grant.
 *
 * @param {object} db        - data store
 * @param {object} store     - store helpers
 * @param {object} actor     - the Admin performing revocation
 * @param {string} grantId   - the grant to revoke
 * @param {object} input     - { reason }
 * @returns {object}         - { ok, grant?, errors? }
 */
export function revokeDispatchCardGrant(db, store, actor, grantId, input) {
  const errors = [];

  // G5: Admin only
  if (!actor || actor.role !== "Admin" || !actor.is_active) {
    errors.push("Only an active Admin may revoke a dispatch-card grant.");
    return { ok: false, errors };
  }

  // G6: Reason required
  if (!input?.reason || typeof input.reason !== "string" || !input.reason.trim()) {
    errors.push("A revocation reason is required.");
    return { ok: false, errors };
  }

  db.dispatch_card_grants = db.dispatch_card_grants || [];
  const grant = db.dispatch_card_grants.find((g) => g.id === grantId);
  if (!grant) {
    errors.push("Grant not found.");
    return { ok: false, errors };
  }
  if (grant.status !== "active") {
    errors.push(`Grant is already ${grant.status}.`);
    return { ok: false, errors };
  }

  // G6: Immediate revocation for future access
  const oldValues = { status: grant.status, revoked_at: grant.revoked_at };

  grant.status = "revoked";
  grant.revoked_at = new Date().toISOString();
  grant.revoked_by_id = actor.id;
  grant.revocation_reason = input.reason.trim();

  // G8: Audit
  store.audit(db, actor, "dispatch_card_grant", grant.id, "DISPATCH_GRANT_REVOKED", oldValues, {
    status: grant.status,
    revocation_reason: grant.revocation_reason,
    revoked_by_id: grant.revoked_by_id
  });

  return { ok: true, grant };
}

// ── Query: Check if a Client Viewer has an active grant for a dispatch ───────

/**
 * Check whether a Client Viewer currently has access to a specific dispatch card.
 *
 * @param {object} db        - data store
 * @param {string} userId    - the Client Viewer's user id
 * @param {string} dispatchCardId - the dispatch card to check
 * @param {string} [today]   - override for testability; defaults to Africa/Harare today
 * @returns {object|null}    - the active grant, or null
 */
export function activeGrantFor(db, userId, dispatchCardId, today) {
  const checkDate = today || formatBusinessDate(new Date(), DEFAULT_BUSINESS_TIMEZONE);
  return (db.dispatch_card_grants || []).find(
    (g) =>
      g.user_id === userId &&
      g.dispatch_card_id === dispatchCardId &&
      g.status === "active" &&
      g.grant_start <= checkDate &&
      g.grant_end >= checkDate
  ) || null;
}

/**
 * List all active grants for a given Client Viewer.
 * G9: Returns only grant metadata — no rates, billing, payroll fields.
 *
 * @param {object} db        - data store
 * @param {string} userId    - the Client Viewer's user id
 * @param {string} [today]   - override for testability
 * @returns {Array}          - safe grant records
 */
export function listActiveGrantsForUser(db, userId, today) {
  const checkDate = today || formatBusinessDate(new Date(), DEFAULT_BUSINESS_TIMEZONE);
  return (db.dispatch_card_grants || [])
    .filter(
      (g) =>
        g.user_id === userId &&
        g.status === "active" &&
        g.grant_start <= checkDate &&
        g.grant_end >= checkDate
    )
    .map((g) => ({
      id: g.id,
      dispatch_card_id: g.dispatch_card_id,
      grant_start: g.grant_start,
      grant_end: g.grant_end,
      status: g.status
    }));
}
