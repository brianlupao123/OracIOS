import { requirePermission } from "../permissions.js";
import {
  createBankChangeProposal,
  approveBankChangeProposal,
  rejectBankChangeProposal,
  listPendingProposals,
  getProposalById
} from "../services/makerCheckerService.js";

/**
 * S-02: Maker-Checker 2-Person Bank Approval — HTTP Controller.
 *
 * All endpoints require Admin role (manageBankChangeProposals).
 * The 2-person invariant (proposer !== approver) is enforced
 * in the service layer.
 */

function getActor(req) {
  return req.db.users.find((u) => u.id === req.user.id);
}

// POST /api/bank-change-proposals
export function createProposal(req, res) {
  try {
    const actor = getActor(req);
    requirePermission(actor, "manageBankChangeProposals");

    const { target_user_id, proposed_details } = req.body;
    if (!target_user_id) return res.status(400).json({ success: false, message: "target_user_id is required." });
    if (!proposed_details || typeof proposed_details !== "object") {
      return res.status(400).json({ success: false, message: "proposed_details object is required." });
    }

    const proposal = createBankChangeProposal({
      proposerId: actor.id,
      targetUserId: target_user_id,
      proposedDetails: proposed_details,
      store: req.store,
      db: req.db
    });

    return res.status(201).json({ success: true, proposal: { id: proposal.id, status: proposal.status, proposed_at: proposal.proposed_at } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /api/bank-change-proposals
export function listProposals(req, res) {
  try {
    const actor = getActor(req);
    requirePermission(actor, "manageBankChangeProposals");

    const pending = listPendingProposals({ db: req.db });
    // Never expose encrypted details in the listing — only metadata
    const safe = pending.map(p => ({
      id: p.id,
      target_user_id: p.target_user_id,
      proposed_by: p.proposed_by,
      proposed_at: p.proposed_at,
      proposed_fields: p.proposed_fields,
      status: p.status
    }));

    return res.json({ success: true, proposals: safe });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// GET /api/bank-change-proposals/:id
export function getProposal(req, res) {
  try {
    const actor = getActor(req);
    requirePermission(actor, "manageBankChangeProposals");

    const proposal = getProposalById({ proposalId: req.params.id, db: req.db });
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found." });

    return res.json({
      success: true,
      proposal: {
        id: proposal.id,
        target_user_id: proposal.target_user_id,
        proposed_by: proposal.proposed_by,
        proposed_at: proposal.proposed_at,
        proposed_fields: proposal.proposed_fields,
        status: proposal.status,
        decided_by: proposal.decided_by,
        decided_at: proposal.decided_at,
        rejection_reason: proposal.rejection_reason
      }
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /api/bank-change-proposals/:id/approve
export function approveProposal(req, res) {
  try {
    const actor = getActor(req);
    requirePermission(actor, "manageBankChangeProposals");

    const proposal = approveBankChangeProposal({
      proposalId: req.params.id,
      approverId: actor.id,
      store: req.store,
      db: req.db
    });

    return res.json({ success: true, proposal: { id: proposal.id, status: proposal.status, decided_by: proposal.decided_by } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// POST /api/bank-change-proposals/:id/reject
export function rejectProposal(req, res) {
  try {
    const actor = getActor(req);
    requirePermission(actor, "manageBankChangeProposals");

    const proposal = rejectBankChangeProposal({
      proposalId: req.params.id,
      rejectorId: actor.id,
      reason: req.body?.reason || null,
      store: req.store,
      db: req.db
    });

    const action = proposal.proposed_by === actor.id ? "withdrawn" : "rejected";
    return res.json({ success: true, action, proposal: { id: proposal.id, status: proposal.status } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
}
