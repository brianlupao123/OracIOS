import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Enable artisan vault flag for this test suite
process.env.VITE_ORAC_ARTISAN_VAULT_SUBSYSTEM = "enabled";

const { ROLES, canAccessRoute, visibleNavigation, visibleNavigationGroups } = await import("../src/accessPolicy.js");
const { sidebarGroups } = await import("../src/navModel.js");

// Polyfill import.meta.env for testing client.js in Node.js
const clientSource = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
const { artisans } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);

test("artisan vault route is accessible to operational roles and technicians", () => {
  const allowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN];
  const forbidden = [ROLES.CLIENT_VIEWER, ROLES.SALES, ROLES.FINANCE];

  for (const role of allowed) {
    assert.ok(canAccessRoute(role, "/artisans"), `${role} should have access to /artisans`);
  }

  for (const role of forbidden) {
    assert.ok(!canAccessRoute(role, "/artisans"), `${role} should NOT have access to /artisans`);
  }
});

test("artisan vault navigation item is visible only to authorized roles in flat and grouped nav", () => {
  for (const role of Object.values(ROLES)) {
    const isAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN].includes(role);
    const inFlat = visibleNavigation(role).some((i) => i.path === "/artisans");
    assert.equal(inFlat, isAllowed, `${role} flat navigation for /artisans mismatch`);

    const inGrouped = visibleNavigationGroups(role)
      .flatMap((g) => g.items)
      .some((i) => i.path === "/artisans");
    assert.equal(inGrouped, isAllowed, `${role} grouped navigation for /artisans mismatch`);
  }
});

test("sidebar groups include artisan vault under field-work category for authorized roles", () => {
  const adminItems = sidebarGroups(ROLES.ADMIN).flatMap((g) => g.items);
  assert.ok(adminItems.some((i) => i.path === "/artisans"), "Admin sidebar should include /artisans");

  const techItems = sidebarGroups(ROLES.TECHNICIAN).flatMap((g) => g.items);
  assert.ok(techItems.some((i) => i.path === "/artisans"), "Technician sidebar should include /artisans");

  const salesItems = sidebarGroups(ROLES.SALES).flatMap((g) => g.items);
  assert.ok(!salesItems.some((i) => i.path === "/artisans"), "Sales sidebar should NOT include /artisans");
});

test("api client exports all required artisans vault methods", () => {
  assert.equal(typeof artisans.createQualification, "function");
  assert.equal(typeof artisans.listQualifications, "function");
  assert.equal(typeof artisans.recordInduction, "function");
  assert.equal(typeof artisans.listInductions, "function");
  assert.equal(typeof artisans.verifyDispatchGate, "function");
  assert.equal(typeof artisans.getSummary, "function");
});

test("ArtisanVaultPage source code adheres to ORAC tripwires and UX rules", () => {
  const src = readFileSync(new URL("../src/pages/ArtisanVaultPage.jsx", import.meta.url), "utf8");

  // Zero banned direct sale terms
  const banned = /direct[-_ ]?sale|cash[-_ ]?sale|walk[-_ ]?in[-_ ]sale|counter[-_ ]sale/i;
  assert.doesNotMatch(src, banned, "ArtisanVaultPage must not contain banned direct-sale terms");

  // No banned uppercase / tracking classes (per chatFOperationsConsole.test.js:31)
  assert.doesNotMatch(src, /\buppercase\b/, "ArtisanVaultPage must not contain uppercase class");
  assert.doesNotMatch(src, /\btracking-(?:tight|wide|wider|widest)\b/, "ArtisanVaultPage must not contain tracking-* class");

  // S-10 Sensitive Control present
  assert.match(src, /Sensitive Control S-10/);
  assert.match(src, /MINE_INDUCTION_EXPIRED/);

  // Tabpanels accessible
  assert.match(src, /role="tabpanel"/);
});
