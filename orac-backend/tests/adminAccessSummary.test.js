import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAdminAccess } from "../src/adminAccessSummary.js";

test("admin preflight is case-insensitive and returns no user or secret fields", () => {
  const users = [
    { id: "a", email: "Brian@Example.invalid", role: "Admin", is_active: true, password_hash: "private-hash", payment_envelope: "private-payment" },
    { id: "b", email: "other@example.invalid", role: "Admin", is_active: false, password_hash: "other-private-hash" },
    { id: "c", email: "sales@example.invalid", role: "Sales", is_active: true }
  ];
  const summary = summarizeAdminAccess(users, "  brian@example.invalid ");
  assert.deepEqual(summary, {
    target_found: true,
    target_is_admin: true,
    target_active: true,
    target_has_password: true,
    active_admin_count: 1
  });
  assert.doesNotMatch(JSON.stringify(summary), /private|@example|payment|hash/);
  assert.equal(summarizeAdminAccess(users, "missing@example.invalid").target_found, false);
});
