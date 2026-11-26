// backend/tests/dispatchCardGrants.test.js
//
// Batch C Commit 2: Client Viewer-to-dispatch authorisation tests.
//
// Covers:
//   G-01: Admin creates a valid grant — record stored, audited
//   G-02: 30-day maximum enforced
//   G-03: Overlapping active grants for same user/dispatch refused
//   G-04: Non-Admin cannot create (Management, Sales, Client Viewer, Technician)
//   G-05: Target user must be active Client Viewer with client_id
//   G-06: Dispatch card must exist
//   G-07: Admin revokes with reason — immediate, audited
//   G-08: Revocation without reason refused
//   G-09: Non-Admin cannot revoke
//   G-10: activeGrantFor returns grant when within date range, null outside
//   G-11: Revoked grant not returned by activeGrantFor
//   G-12: listActiveGrantsForUser returns safe shape (no rates/billing)
//   G-13: Permission entries exist for grantDispatchCardAccess / revokeDispatchCardAccess
//   G-14: dispatch_card_grants in SCHEMA_COLLECTIONS
//   G-15: Second non-overlapping grant for same user/dispatch succeeds

import test from "node:test";
import assert from "node:assert/strict";

import {
  createDispatchCardGrant,
  revokeDispatchCardGrant,
  activeGrantFor,
  listActiveGrantsForUser,
  MAX_GRANT_DAYS
} from "../src/dispatchCardGrants.js";

import { permissions, hasPermission } from "../src/permissions.js";
import { SCHEMA_COLLECTIONS } from "../src/store.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockStore() {
  let counter = 0;
  const audits = [];
  return {
    id: (prefix) => `${prefix}_${++counter}`,
    audit: (db, actor, entity, entityId, action, before, after) => {
      audits.push({ actor, entity, entityId, action, before, after });
    },
    audits
  };
}

function makeDb() {
  return {
    users: [
      { id: "u-admin", role: "Admin", name: "Admin User", is_active: true },
      { id: "u-client", role: "Client Viewer", name: "Client Rep", is_active: true, client_id: "c-north" },
      { id: "u-client-no-cid", role: "Client Viewer", name: "Client No CID", is_active: true },
      { id: "u-client-inactive", role: "Client Viewer", name: "Inactive Client", is_active: false, client_id: "c-north" },
      { id: "u-mgmt", role: "Management", name: "Manager", is_active: true },
      { id: "u-sales", role: "Sales", name: "Sales Rep", is_active: true },
      { id: "u-tech", role: "Technician", name: "Technician", is_active: true }
    ],
    dispatch_cards: [
      { id: "disp-001", quotation_id: "q-001", status: "Active" },
      { id: "disp-002", quotation_id: "q-002", status: "Active" }
    ],
    dispatch_card_grants: [],
    audit_logs: []
  };
}

const admin = { id: "u-admin", role: "Admin", is_active: true };

// ── G-01: Admin creates a valid grant ────────────────────────────────────────

test("G-01: Admin creates a valid dispatch-card grant", () => {
  const db = makeDb();
  const store = createMockStore();

  const result = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-20",
    evidence_reference: "Management approval email 2026-11-25"
  });

  assert.equal(result.ok, true);
  assert.ok(result.grant);
  assert.ok(result.grant.id.startsWith("dcg_"));
  assert.equal(result.grant.user_id, "u-client");
  assert.equal(result.grant.client_id, "c-north");
  assert.equal(result.grant.dispatch_card_id, "disp-001");
  assert.equal(result.grant.granted_by_id, "u-admin");
  assert.equal(result.grant.grant_start, "2026-12-01");
  assert.equal(result.grant.grant_end, "2026-12-20");
  assert.equal(result.grant.status, "active");
  assert.equal(result.grant.revoked_at, null);
  assert.equal(result.grant.evidence_reference, "Management approval email 2026-11-25");
  assert.equal(db.dispatch_card_grants.length, 1);

  // Audit recorded
  const audit = store.audits.find((a) => a.action === "DISPATCH_GRANT_CREATED");
  assert.ok(audit, "Must audit DISPATCH_GRANT_CREATED");
  assert.equal(audit.after.user_id, "u-client");
  assert.equal(audit.after.dispatch_card_id, "disp-001");
});

// ── G-02: 30-day maximum enforced ───────────────────────────────────────────

test("G-02: Grant exceeding 30 calendar days is refused", () => {
  const db = makeDb();
  const store = createMockStore();

  const result = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2027-01-01"  // 31 days
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("30")));
  assert.equal(db.dispatch_card_grants.length, 0);
});

test("G-02: Grant of exactly 30 calendar days succeeds", () => {
  const db = makeDb();
  const store = createMockStore();

  const result = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-31"  // 30 days
  });

  assert.equal(result.ok, true);
});

// ── G-03: Overlapping active grants refused ─────────────────────────────────

test("G-03: Overlapping active grant for same user/dispatch is refused", () => {
  const db = makeDb();
  const store = createMockStore();

  // First grant
  const r1 = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-15"
  });
  assert.equal(r1.ok, true);

  // Overlapping grant
  const r2 = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-10",
    grant_end: "2026-12-25"
  });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes("overlapping")));
  assert.equal(db.dispatch_card_grants.length, 1);
});

// ── G-04: Non-Admin cannot create ───────────────────────────────────────────

test("G-04: Non-Admin roles cannot create a dispatch-card grant", () => {
  const db = makeDb();
  const store = createMockStore();
  const nonAdminRoles = [
    { id: "u-mgmt", role: "Management", is_active: true },
    { id: "u-sales", role: "Sales", is_active: true },
    { id: "u-client", role: "Client Viewer", is_active: true },
    { id: "u-tech", role: "Technician", is_active: true }
  ];

  for (const actor of nonAdminRoles) {
    const result = createDispatchCardGrant(db, store, actor, {
      user_id: "u-client",
      dispatch_card_id: "disp-001",
      grant_start: "2026-12-01",
      grant_end: "2026-12-15"
    });
    assert.equal(result.ok, false, `${actor.role} must be refused`);
    assert.ok(result.errors.some((e) => e.includes("Admin")));
  }
  assert.equal(db.dispatch_card_grants.length, 0);
});

// ── G-05: Target must be active Client Viewer with client_id ─────────────────

test("G-05: Target user must be active Client Viewer with client_id", () => {
  const db = makeDb();
  const store = createMockStore();
  const input = { dispatch_card_id: "disp-001", grant_start: "2026-12-01", grant_end: "2026-12-15" };

  // Non-Client Viewer role
  const r1 = createDispatchCardGrant(db, store, admin, { ...input, user_id: "u-mgmt" });
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes("Client Viewer")));

  // Inactive Client Viewer
  const r2 = createDispatchCardGrant(db, store, admin, { ...input, user_id: "u-client-inactive" });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes("not active")));

  // Client Viewer without client_id
  const r3 = createDispatchCardGrant(db, store, admin, { ...input, user_id: "u-client-no-cid" });
  assert.equal(r3.ok, false);
  assert.ok(r3.errors.some((e) => e.includes("client_id")));

  // Non-existent user
  const r4 = createDispatchCardGrant(db, store, admin, { ...input, user_id: "u-nobody" });
  assert.equal(r4.ok, false);
  assert.ok(r4.errors.some((e) => e.includes("not found")));
});

// ── G-06: Dispatch card must exist ──────────────────────────────────────────

test("G-06: Dispatch card must exist", () => {
  const db = makeDb();
  const store = createMockStore();

  const result = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-nonexistent",
    grant_start: "2026-12-01",
    grant_end: "2026-12-15"
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("Dispatch card not found")));
});

// ── G-07: Admin revokes with reason ─────────────────────────────────────────

test("G-07: Admin revokes a grant with reason — immediate, audited", () => {
  const db = makeDb();
  const store = createMockStore();

  // Create grant
  const created = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-20"
  });
  assert.equal(created.ok, true);

  // Revoke
  const revoked = revokeDispatchCardGrant(db, store, admin, created.grant.id, {
    reason: "Client contract terminated early"
  });

  assert.equal(revoked.ok, true);
  assert.equal(revoked.grant.status, "revoked");
  assert.ok(revoked.grant.revoked_at);
  assert.equal(revoked.grant.revoked_by_id, "u-admin");
  assert.equal(revoked.grant.revocation_reason, "Client contract terminated early");

  // Audit recorded
  const audit = store.audits.find((a) => a.action === "DISPATCH_GRANT_REVOKED");
  assert.ok(audit, "Must audit DISPATCH_GRANT_REVOKED");
});

// ── G-08: Revocation without reason refused ─────────────────────────────────

test("G-08: Revocation without reason is refused", () => {
  const db = makeDb();
  const store = createMockStore();

  const created = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-20"
  });

  const r1 = revokeDispatchCardGrant(db, store, admin, created.grant.id, {});
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes("reason")));
  assert.equal(created.grant.status, "active", "Grant must remain active");

  const r2 = revokeDispatchCardGrant(db, store, admin, created.grant.id, { reason: "   " });
  assert.equal(r2.ok, false);
});

// ── G-09: Non-Admin cannot revoke ───────────────────────────────────────────

test("G-09: Non-Admin roles cannot revoke a dispatch-card grant", () => {
  const db = makeDb();
  const store = createMockStore();

  const created = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-20"
  });

  const mgmt = { id: "u-mgmt", role: "Management", is_active: true };
  const result = revokeDispatchCardGrant(db, store, mgmt, created.grant.id, {
    reason: "Trying to revoke"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("Admin")));
  assert.equal(created.grant.status, "active");
});

// ── G-10: activeGrantFor date-range check ───────────────────────────────────

test("G-10: activeGrantFor returns grant within range, null outside", () => {
  const db = makeDb();
  const store = createMockStore();

  createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-20"
  });

  // Within range
  const hit = activeGrantFor(db, "u-client", "disp-001", "2026-12-10");
  assert.ok(hit, "Should find active grant");
  assert.equal(hit.dispatch_card_id, "disp-001");

  // On start boundary
  const start = activeGrantFor(db, "u-client", "disp-001", "2026-12-01");
  assert.ok(start);

  // On end boundary
  const end = activeGrantFor(db, "u-client", "disp-001", "2026-12-20");
  assert.ok(end);

  // Before start
  const before = activeGrantFor(db, "u-client", "disp-001", "2026-11-30");
  assert.equal(before, null);

  // After end
  const after = activeGrantFor(db, "u-client", "disp-001", "2026-12-21");
  assert.equal(after, null);

  // Wrong dispatch
  const wrongDispatch = activeGrantFor(db, "u-client", "disp-002", "2026-12-10");
  assert.equal(wrongDispatch, null);
});

// ── G-11: Revoked grant not returned ────────────────────────────────────────

test("G-11: Revoked grant is not returned by activeGrantFor", () => {
  const db = makeDb();
  const store = createMockStore();

  const created = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-20"
  });

  revokeDispatchCardGrant(db, store, admin, created.grant.id, {
    reason: "Security review"
  });

  const hit = activeGrantFor(db, "u-client", "disp-001", "2026-12-10");
  assert.equal(hit, null, "Revoked grant must not be returned");
});

// ── G-12: listActiveGrantsForUser safe shape ────────────────────────────────

test("G-12: listActiveGrantsForUser returns safe shape (no rates/billing)", () => {
  const db = makeDb();
  const store = createMockStore();

  createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-20",
    evidence_reference: "Letter ref ABC"
  });

  const list = listActiveGrantsForUser(db, "u-client", "2026-12-10");
  assert.equal(list.length, 1);

  const g = list[0];
  const keys = Object.keys(g).sort();
  assert.deepEqual(keys, ["dispatch_card_id", "grant_end", "grant_start", "id", "status"]);
  // Must NOT contain sensitive fields
  assert.equal(g.evidence_reference, undefined);
  assert.equal(g.granted_by_id, undefined);
  assert.equal(g.client_id, undefined);
});

// ── G-13: Permission entries exist ──────────────────────────────────────────

test("G-13: grantDispatchCardAccess and revokeDispatchCardAccess permissions are Admin-only", () => {
  assert.ok(permissions.grantDispatchCardAccess, "grantDispatchCardAccess must exist");
  assert.deepEqual(permissions.grantDispatchCardAccess, ["Admin"]);
  assert.ok(permissions.revokeDispatchCardAccess, "revokeDispatchCardAccess must exist");
  assert.deepEqual(permissions.revokeDispatchCardAccess, ["Admin"]);

  // Admin has permission
  assert.equal(hasPermission({ role: "Admin", is_active: true }, "grantDispatchCardAccess"), true);
  assert.equal(hasPermission({ role: "Admin", is_active: true }, "revokeDispatchCardAccess"), true);

  // Non-Admin denied
  assert.equal(hasPermission({ role: "Management", is_active: true }, "grantDispatchCardAccess"), false);
  assert.equal(hasPermission({ role: "Client Viewer", is_active: true }, "grantDispatchCardAccess"), false);
  assert.equal(hasPermission({ role: "Sales", is_active: true }, "revokeDispatchCardAccess"), false);
});

// ── G-14: dispatch_card_grants in SCHEMA_COLLECTIONS ────────────────────────

test("G-14: dispatch_card_grants is registered in SCHEMA_COLLECTIONS", () => {
  assert.ok(SCHEMA_COLLECTIONS.includes("dispatch_card_grants"));
});

// ── G-15: Non-overlapping second grant succeeds ─────────────────────────────

test("G-15: Second non-overlapping grant for same user/dispatch succeeds", () => {
  const db = makeDb();
  const store = createMockStore();

  const r1 = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-01",
    grant_end: "2026-12-15"
  });
  assert.equal(r1.ok, true);

  // Non-overlapping second grant
  const r2 = createDispatchCardGrant(db, store, admin, {
    user_id: "u-client",
    dispatch_card_id: "disp-001",
    grant_start: "2026-12-16",
    grant_end: "2026-12-31"
  });
  assert.equal(r2.ok, true);
  assert.equal(db.dispatch_card_grants.length, 2);
});
