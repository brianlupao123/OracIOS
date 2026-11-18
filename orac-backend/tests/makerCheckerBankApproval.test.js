import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createBankChangeProposal,
  approveBankChangeProposal,
  rejectBankChangeProposal,
  listPendingProposals,
  getProposalById
} from "../src/services/makerCheckerService.js";
import { decryptPaymentDetails } from "../src/paymentDetails.js";

// Generate a valid 32-byte base64 encryption key for tests
const TEST_KEY = crypto.randomBytes(32).toString("base64");
const originalKey = process.env.ORAC_PAYMENT_ENCRYPTION_KEY;

// Minimal in-memory store mock matching ORAC's store.audit() signature
function mockStore() {
  const auditLog = [];
  return {
    audit(db, actor, collection, entityId, action, payload) {
      if (!db.audit_logs) db.audit_logs = [];
      const entry = {
        id: `audit_${crypto.randomBytes(4).toString("hex")}`,
        actor_id: actor.id,
        collection,
        entity_id: entityId,
        action,
        payload,
        timestamp: new Date().toISOString()
      };
      db.audit_logs.push(entry);
      auditLog.push(entry);
    },
    _auditLog: auditLog
  };
}

function freshDb() {
  return {
    users: [
      { id: "user-tech-1", name: "John Tech", role: "Technician", is_active: true },
      { id: "admin-a", name: "Admin Alpha", role: "Admin", is_active: true },
      { id: "admin-b", name: "Admin Bravo", role: "Admin", is_active: true }
    ],
    bank_change_proposals: [],
    audit_logs: []
  };
}

describe("S-02: Maker-Checker 2-Person Bank Approval", () => {
  let store, db;

  beforeEach(() => {
    process.env.ORAC_PAYMENT_ENCRYPTION_KEY = TEST_KEY;
    store = mockStore();
    db = freshDb();
  });

  // Restore original env after tests
  it("Admin A can create a bank change proposal → status is Pending, target unchanged", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "FNB", bank_account: "123456789" },
      store,
      db
    });

    assert.equal(proposal.status, "Pending");
    assert.equal(proposal.proposed_by, "admin-a");
    assert.equal(proposal.target_user_id, "user-tech-1");
    assert.ok(proposal.id.startsWith("bcp_"));
    assert.deepStrictEqual(proposal.proposed_fields, ["payment_method", "bank_name", "bank_account"]);

    // Target user's bank details must NOT be changed yet
    const target = db.users.find(u => u.id === "user-tech-1");
    assert.equal(target.payment_details, undefined, "Bank details must not change on proposal");
  });

  it("Admin B (different from A) can approve → status Approved, bank details applied", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "CBZ", bank_account: "987654321", bank_branch: "Harare" },
      store,
      db
    });

    const approved = approveBankChangeProposal({
      proposalId: proposal.id,
      approverId: "admin-b",
      store,
      db
    });

    assert.equal(approved.status, "Approved");
    assert.equal(approved.decided_by, "admin-b");
    assert.ok(approved.decided_at);

    // Target user's bank details MUST now be applied and encrypted
    const target = db.users.find(u => u.id === "user-tech-1");
    assert.ok(target.payment_details, "Bank details must be applied after approval");
    assert.ok(target.payment_details.data, "Bank details must be encrypted");
    assert.equal(target.payment_details.updated_by, "admin-b");

    // Decrypt and verify the values
    const decrypted = decryptPaymentDetails(target.payment_details);
    assert.equal(decrypted.bank_name, "CBZ");
    assert.equal(decrypted.bank_account, "987654321");
    assert.equal(decrypted.bank_branch, "Harare");
  });

  it("Admin A trying to approve their own proposal gets 403 (CORE INVARIANT)", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "ecocash", ecocash_number: "0771234567" },
      store,
      db
    });

    assert.throws(
      () => approveBankChangeProposal({
        proposalId: proposal.id,
        approverId: "admin-a", // SAME as proposer
        store,
        db
      }),
      (err) => {
        assert.equal(err.status, 403);
        assert.ok(err.message.includes("Maker-Checker"));
        return true;
      }
    );

    // Proposal must still be Pending
    const fetched = getProposalById({ proposalId: proposal.id, db });
    assert.equal(fetched.status, "Pending");
  });

  it("approved proposal cannot be approved again (idempotency)", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "Stanbic" },
      store,
      db
    });

    approveBankChangeProposal({ proposalId: proposal.id, approverId: "admin-b", store, db });

    assert.throws(
      () => approveBankChangeProposal({ proposalId: proposal.id, approverId: "admin-b", store, db }),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it("rejected proposal cannot be approved", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "ZB" },
      store,
      db
    });

    rejectBankChangeProposal({ proposalId: proposal.id, rejectorId: "admin-b", reason: "Incorrect details", store, db });

    assert.throws(
      () => approveBankChangeProposal({ proposalId: proposal.id, approverId: "admin-b", store, db }),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it("approved proposal cannot be rejected", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "ZB" },
      store,
      db
    });

    approveBankChangeProposal({ proposalId: proposal.id, approverId: "admin-b", store, db });

    assert.throws(
      () => rejectBankChangeProposal({ proposalId: proposal.id, rejectorId: "admin-b", reason: "Changed mind", store, db }),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it("listPendingProposals returns only Pending items", () => {
    createBankChangeProposal({
      proposerId: "admin-a", targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "A" }, store, db
    });
    const p2 = createBankChangeProposal({
      proposerId: "admin-a", targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "B" }, store, db
    });
    createBankChangeProposal({
      proposerId: "admin-a", targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "C" }, store, db
    });

    // Approve one
    approveBankChangeProposal({ proposalId: p2.id, approverId: "admin-b", store, db });

    const pending = listPendingProposals({ db });
    assert.equal(pending.length, 2);
    assert.ok(pending.every(p => p.status === "Pending"));
  });

  it("proposed values are stored encrypted (no plaintext bank details in proposal)", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "CABS", bank_account: "9999888877" },
      store,
      db
    });

    // The raw proposal record must NOT contain plaintext
    const raw = JSON.stringify(proposal);
    assert.ok(!raw.includes("9999888877"), "Plaintext bank account must not appear in proposal");
    assert.ok(!raw.includes("CABS"), "Plaintext bank name must not appear in proposal");
    assert.ok(proposal.encrypted_proposed_details.data, "Proposed details must be in encrypted envelope");
    assert.ok(proposal.encrypted_proposed_details.v === 1, "Envelope must have version marker");
  });

  it("audit log records both proposal creation and approval", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "FBC" },
      store,
      db
    });

    approveBankChangeProposal({ proposalId: proposal.id, approverId: "admin-b", store, db });

    const auditEntries = db.audit_logs.filter(e => e.entity_id === proposal.id);
    assert.equal(auditEntries.length, 2, "Must have exactly 2 audit entries (propose + approve)");
    assert.equal(auditEntries[0].action, "BANK_CHANGE_PROPOSED");
    assert.equal(auditEntries[0].actor_id, "admin-a");
    assert.equal(auditEntries[1].action, "BANK_CHANGE_APPROVED");
    assert.equal(auditEntries[1].actor_id, "admin-b");
  });

  it("proposer can withdraw (self-reject) their own proposal", () => {
    const proposal = createBankChangeProposal({
      proposerId: "admin-a",
      targetUserId: "user-tech-1",
      proposedDetails: { payment_method: "bank", bank_name: "NMB" },
      store,
      db
    });

    const rejected = rejectBankChangeProposal({
      proposalId: proposal.id,
      rejectorId: "admin-a", // Same as proposer — this is a withdrawal
      reason: "I entered wrong details",
      store,
      db
    });

    assert.equal(rejected.status, "Rejected");
    assert.equal(rejected.decided_by, "admin-a");
    assert.equal(rejected.rejection_reason, "I entered wrong details");

    // Audit should show withdrawal, not rejection
    const auditEntries = db.audit_logs.filter(e => e.entity_id === proposal.id);
    const withdrawalEntry = auditEntries.find(e => e.action === "BANK_CHANGE_WITHDRAWN");
    assert.ok(withdrawalEntry, "Self-rejection should be audited as WITHDRAWN");
  });
});
