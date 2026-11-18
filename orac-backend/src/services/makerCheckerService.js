import crypto from "node:crypto";
import { encryptPaymentDetails, decryptPaymentDetails, paymentEncryptionConfigured, PAYMENT_FIELDS } from "../paymentDetails.js";

/**
 * Maker-Checker 2-Person Bank Approval Service (S-02).
 *
 * Enforces dual-control: the Admin who proposes a bank detail change
 * CANNOT be the same Admin who approves it. All proposed values are
 * stored encrypted using the same AES-256-GCM envelope as live bank
 * details — plaintext bank numbers never appear in the proposals
 * collection.
 */

function generateId() {
  return `bcp_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Creates a pending bank change proposal. Does NOT apply the change.
 */
export function createBankChangeProposal({ proposerId, targetUserId, proposedDetails, store, db }) {
  if (!proposerId) throw Object.assign(new Error("proposerId is required"), { status: 400 });
  if (!targetUserId) throw Object.assign(new Error("targetUserId is required"), { status: 400 });
  if (!proposedDetails || typeof proposedDetails !== "object") {
    throw Object.assign(new Error("proposedDetails is required"), { status: 400 });
  }
  if (!paymentEncryptionConfigured()) {
    throw Object.assign(new Error("Payment encryption key not configured"), { status: 503 });
  }

  // Extract only recognized payment fields
  const fields = PAYMENT_FIELDS.filter(f => proposedDetails[f] !== undefined && proposedDetails[f] !== null);
  if (!fields.length) {
    throw Object.assign(new Error("No valid payment fields in proposal"), { status: 400 });
  }

  // Encrypt the proposed values
  const encryptedProposed = encryptPaymentDetails(proposedDetails);

  const proposal = {
    id: generateId(),
    target_user_id: targetUserId,
    proposed_by: proposerId,
    proposed_at: new Date().toISOString(),
    proposed_fields: fields,
    encrypted_proposed_details: encryptedProposed,
    status: "Pending",
    decided_by: null,
    decided_at: null,
    rejection_reason: null
  };

  if (!db.bank_change_proposals) db.bank_change_proposals = [];
  db.bank_change_proposals.push(proposal);

  store.audit(db, { id: proposerId }, "bank_change_proposal", proposal.id,
    "BANK_CHANGE_PROPOSED", { target_user_id: targetUserId, fields });

  return proposal;
}

/**
 * Approves a pending proposal and applies the bank details.
 * ENFORCES: approverId !== proposerId (the core 2-person invariant).
 */
export function approveBankChangeProposal({ proposalId, approverId, store, db }) {
  if (!proposalId) throw Object.assign(new Error("proposalId is required"), { status: 400 });
  if (!approverId) throw Object.assign(new Error("approverId is required"), { status: 400 });

  const proposals = db.bank_change_proposals || [];
  const proposal = proposals.find(p => p.id === proposalId);
  if (!proposal) throw Object.assign(new Error("Proposal not found"), { status: 404 });

  if (proposal.status !== "Pending") {
    throw Object.assign(
      new Error(`Cannot approve a proposal with status '${proposal.status}'`),
      { status: 409 }
    );
  }

  // ── CORE INVARIANT: 2-person rule ──
  if (proposal.proposed_by === approverId) {
    throw Object.assign(
      new Error("Maker-Checker violation: the proposer cannot approve their own bank change"),
      { status: 403 }
    );
  }

  // Decrypt the proposed details
  const proposedDetails = decryptPaymentDetails(proposal.encrypted_proposed_details);

  // Find and update the target user
  const users = db.users || [];
  const targetUser = users.find(u => u.id === proposal.target_user_id);
  if (!targetUser) {
    throw Object.assign(new Error("Target user not found"), { status: 404 });
  }

  // Apply the encrypted payment details to the user
  const liveEnvelope = encryptPaymentDetails(proposedDetails);
  targetUser.payment_details = {
    ...liveEnvelope,
    updated_by: approverId,
    updated_at: new Date().toISOString()
  };

  // Mark proposal as approved
  proposal.status = "Approved";
  proposal.decided_by = approverId;
  proposal.decided_at = new Date().toISOString();

  store.audit(db, { id: approverId }, "bank_change_proposal", proposal.id,
    "BANK_CHANGE_APPROVED", {
      target_user_id: proposal.target_user_id,
      fields: proposal.proposed_fields
    });

  return proposal;
}

/**
 * Rejects a pending proposal. A proposer MAY reject their own (withdrawal).
 */
export function rejectBankChangeProposal({ proposalId, rejectorId, reason, store, db }) {
  if (!proposalId) throw Object.assign(new Error("proposalId is required"), { status: 400 });
  if (!rejectorId) throw Object.assign(new Error("rejectorId is required"), { status: 400 });

  const proposals = db.bank_change_proposals || [];
  const proposal = proposals.find(p => p.id === proposalId);
  if (!proposal) throw Object.assign(new Error("Proposal not found"), { status: 404 });

  if (proposal.status !== "Pending") {
    throw Object.assign(
      new Error(`Cannot reject a proposal with status '${proposal.status}'`),
      { status: 409 }
    );
  }

  proposal.status = "Rejected";
  proposal.decided_by = rejectorId;
  proposal.decided_at = new Date().toISOString();
  proposal.rejection_reason = reason || null;

  const action = proposal.proposed_by === rejectorId
    ? "BANK_CHANGE_WITHDRAWN"
    : "BANK_CHANGE_REJECTED";

  store.audit(db, { id: rejectorId }, "bank_change_proposal", proposal.id,
    action, {
      target_user_id: proposal.target_user_id,
      reason: reason || null
    });

  return proposal;
}

/**
 * Returns all proposals with Pending status.
 */
export function listPendingProposals({ db }) {
  return (db.bank_change_proposals || []).filter(p => p.status === "Pending");
}

/**
 * Returns a single proposal by ID, or null if not found.
 */
export function getProposalById({ proposalId, db }) {
  return (db.bank_change_proposals || []).find(p => p.id === proposalId) || null;
}
